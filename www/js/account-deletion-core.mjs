const SUPPORTED_PROVIDERS = new Set(['google.com', 'apple.com']);
const REAUTHENTICATION_MAX_AGE_MS = 5 * 60 * 1000;

const SAFE_FUNCTION_ERRORS = new Map([
  ['functions/unauthenticated', 'authentication-required'],
  ['functions/invalid-argument', 'invalid-request'],
  ['functions/permission-denied', 'permission-denied'],
  ['functions/aborted', 'retry-required'],
  ['functions/unavailable', 'temporarily-unavailable'],
]);

export class AccountDeletionClientError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AccountDeletionClientError';
    this.code = code;
  }
}

function fail(code) {
  throw new AccountDeletionClientError(code);
}

function linkedProviderIds(currentUser) {
  return [...new Set(
    (Array.isArray(currentUser?.providerData) ? currentUser.providerData : [])
      .map((provider) => String(provider?.providerId || '').trim())
      .filter(Boolean),
  )];
}

export function selectReauthenticationProvider(currentUser, lastLoginProvider = '') {
  if (!currentUser?.uid) fail('authentication-required');
  const linked = linkedProviderIds(currentUser);
  const last = String(lastLoginProvider || '').trim();
  if (SUPPORTED_PROVIDERS.has(last) && linked.includes(last)) return last;
  if (SUPPORTED_PROVIDERS.has(last) && linked.length === 0) return last;

  const supported = linked.filter((providerId) => SUPPORTED_PROVIDERS.has(providerId));
  if (supported.length === 1) return supported[0];
  if (supported.length > 1) fail('provider-selection-required');
  fail('unsupported-provider');
}

export function shouldConnectFunctionsEmulator({ enabled, hostname } = {}) {
  if (enabled !== true) return false;
  const normalized = String(hostname || '').trim().toLowerCase();
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '[::1]'
    || normalized === '::1';
}

function safeClientError(error, fallback = 'account-deletion-failed') {
  if (error instanceof AccountDeletionClientError) return error;
  const code = String(error?.code || '');
  const reason = String(error?.details?.reason || '');
  if (reason === 'recent-authentication-required') {
    return new AccountDeletionClientError('reauthentication-required');
  }
  return new AccountDeletionClientError(SAFE_FUNCTION_ERRORS.get(code) || fallback);
}

function validAuthorizationCode(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function createAccountDeletionClient(deps) {
  let reauthenticationProof = null;

  async function fetchAccountDeletionPlan() {
    try {
      const result = await deps.invokeCallable('getAccountDeletionPlan', {});
      return result?.data;
    } catch (error) {
      throw safeClientError(error);
    }
  }

  async function reauthenticateForAccountDeletion() {
    reauthenticationProof = null;
    try {
      const currentUser = await deps.getCurrentUser();
      const providerId = selectReauthenticationProvider(
        currentUser,
        deps.getLastLoginProvider(),
      );

      let credential;
      let authorizationCode;
      let nativeCredential;
      if (providerId === 'google.com') {
        credential = await deps.getGoogleCredential({
          currentUser,
          native: deps.isNativePlatform(),
        });
        if (!credential) fail('google-credential-missing');
      } else {
        const appleProof = await deps.getAppleCredential({ currentUser });
        credential = appleProof?.credential;
        authorizationCode = appleProof?.authorizationCode;
        nativeCredential = appleProof?.nativeCredential;
        if (!credential) fail('apple-identity-token-missing');
        if (!validAuthorizationCode(authorizationCode)) {
          fail('apple-authorization-code-missing');
        }
      }

      await deps.reauthenticateWithCredential(currentUser, credential);
      if (providerId === 'apple.com') {
        if (!nativeCredential) fail('apple-identity-token-missing');
        await deps.prepareAppleRevocation(nativeCredential);
      }
      reauthenticationProof = {
        uid: currentUser.uid,
        providerId,
        authorizationCode,
        authenticatedAt: deps.now(),
      };
      return { providerId };
    } catch (error) {
      reauthenticationProof = null;
      throw safeClientError(error, 'reauthentication-failed');
    }
  }

  async function deleteCurrentAccount({ requestId, teamDecisions } = {}) {
    const proof = reauthenticationProof;
    reauthenticationProof = null;
    const currentUser = await deps.getCurrentUser();
    if (
      !proof
      || !currentUser?.uid
      || currentUser.uid !== proof.uid
      || !Number.isFinite(proof.authenticatedAt)
      || deps.now() - proof.authenticatedAt > REAUTHENTICATION_MAX_AGE_MS
      || deps.now() < proof.authenticatedAt
    ) {
      fail('reauthentication-required');
    }

    if (proof.providerId === 'apple.com') {
      try {
        await deps.revokeAppleAuthorizationCode(proof.authorizationCode);
      } catch {
        fail('apple-revoke-failed');
      }
    }

    try {
      const result = await deps.invokeCallable('deleteAccount', { requestId, teamDecisions });
      return result?.data;
    } catch (error) {
      throw safeClientError(error);
    }
  }

  return {
    fetchAccountDeletionPlan,
    reauthenticateForAccountDeletion,
    deleteCurrentAccount,
  };
}
