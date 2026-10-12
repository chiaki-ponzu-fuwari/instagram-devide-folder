import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  AccountDeletionClientError,
  createAccountDeletionClient,
  selectReauthenticationProvider,
  shouldConnectFunctionsEmulator,
} from '../www/js/account-deletion-core.mjs';

const adapterSource = readFileSync(new URL('../www/js/account-deletion.mjs', import.meta.url), 'utf8');
const firestoreCoreSource = readFileSync(new URL('../www/js/firestore-core.mjs', import.meta.url), 'utf8');
const firebaseAuthSource = readFileSync(new URL('../www/js/firebase-auth.mjs', import.meta.url), 'utf8');
const appHtmlSource = readFileSync(new URL('../www/index.html', import.meta.url), 'utf8');
const rootPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function user(providers = ['google.com']) {
  return {
    uid: 'user-1',
    providerData: providers.map((providerId) => ({ providerId })),
  };
}

function harness(overrides = {}) {
  const calls = [];
  const deps = {
    getCurrentUser: async () => user(),
    getLastLoginProvider: () => 'google.com',
    isNativePlatform: () => true,
    getGoogleCredential: async () => ({ kind: 'google-credential' }),
    getAppleCredential: async () => ({
      credential: { kind: 'apple-credential' },
      authorizationCode: 'apple-one-time-code',
      nativeCredential: { identityToken: 'apple-id-token', rawNonce: 'fresh-raw-nonce' },
    }),
    reauthenticateWithCredential: async (currentUser, credential) => {
      calls.push(['reauthenticate', currentUser, credential]);
    },
    invokeCallable: async (name, data) => {
      calls.push(['callable', name, data]);
      return { data: { ok: true } };
    },
    revokeAppleAuthorizationCode: async (authorizationCode) => {
      calls.push(['revoke', authorizationCode]);
    },
    prepareAppleRevocation: async (nativeCredential) => {
      calls.push(['prepare-apple-revocation', nativeCredential]);
    },
    now: () => 1_000,
    ...overrides,
  };
  return { client: createAccountDeletionClient(deps), calls, deps };
}

test('provider selection prefers the last linked supported provider', () => {
  assert.equal(selectReauthenticationProvider(
    user(['google.com', 'apple.com']),
    'apple.com',
  ), 'apple.com');
  assert.equal(selectReauthenticationProvider(user(['password', 'google.com']), ''), 'google.com');
  assert.equal(selectReauthenticationProvider(user([]), 'google.com'), 'google.com');
});

test('provider selection rejects unsupported or ambiguous accounts clearly', () => {
  assert.throws(
    () => selectReauthenticationProvider(user(['password']), 'password'),
    (error) => error instanceof AccountDeletionClientError
      && error.code === 'unsupported-provider',
  );
  assert.throws(
    () => selectReauthenticationProvider(user(['google.com', 'apple.com']), ''),
    (error) => error instanceof AccountDeletionClientError
      && error.code === 'provider-selection-required',
  );
});

test('Google reauthentication uses a fresh credential on the current user', async () => {
  const currentUser = user(['google.com']);
  let credentialRequests = 0;
  const { client, calls } = harness({
    getCurrentUser: async () => currentUser,
    getGoogleCredential: async ({ native }) => {
      credentialRequests += 1;
      assert.equal(native, true);
      return { kind: 'fresh-google-credential' };
    },
  });

  assert.deepEqual(await client.reauthenticateForAccountDeletion(), { providerId: 'google.com' });
  assert.equal(credentialRequests, 1);
  assert.deepEqual(calls[0], [
    'reauthenticate', currentUser, { kind: 'fresh-google-credential' },
  ]);
});

test('Apple reauthentication requires identity proof and keeps authorization code in memory', async () => {
  const currentUser = user(['apple.com']);
  const { client, calls } = harness({
    getCurrentUser: async () => currentUser,
    getLastLoginProvider: () => 'apple.com',
  });

  assert.deepEqual(await client.reauthenticateForAccountDeletion(), { providerId: 'apple.com' });
  assert.deepEqual(calls[0], [
    'reauthenticate', currentUser, { kind: 'apple-credential' },
  ]);
  assert.deepEqual(calls[1], [
    'prepare-apple-revocation',
    { identityToken: 'apple-id-token', rawNonce: 'fresh-raw-nonce' },
  ]);

  await client.deleteCurrentAccount({
    requestId: 'request_123456789012345678901234',
    teamDecisions: [],
  });
  assert.deepEqual(calls.slice(2), [
    ['revoke', 'apple-one-time-code'],
    ['callable', 'deleteAccount', {
      requestId: 'request_123456789012345678901234',
      teamDecisions: [],
    }],
  ]);
});

test('Apple reauthentication rejects a missing authorization code', async () => {
  const { client } = harness({
    getCurrentUser: async () => user(['apple.com']),
    getLastLoginProvider: () => 'apple.com',
    getAppleCredential: async () => ({ credential: { kind: 'apple' } }),
  });

  await assert.rejects(
    client.reauthenticateForAccountDeletion(),
    (error) => error.code === 'apple-authorization-code-missing',
  );
});

test('Apple native Auth synchronization failure leaves no deletion proof', async () => {
  const { client, calls } = harness({
    getCurrentUser: async () => user(['apple.com']),
    getLastLoginProvider: () => 'apple.com',
    prepareAppleRevocation: async () => {
      throw new Error('native auth unavailable');
    },
  });
  await assert.rejects(
    client.reauthenticateForAccountDeletion(),
    (error) => error.code === 'reauthentication-failed',
  );
  await assert.rejects(
    client.deleteCurrentAccount({ requestId: 'request_123456789012345678901234', teamDecisions: [] }),
    (error) => error.code === 'reauthentication-required',
  );
  assert.equal(calls.some(([kind]) => kind === 'revoke' || kind === 'callable'), false);
});

test('deletion requires a fresh one-use reauthentication proof', async () => {
  let now = 1_000;
  const { client } = harness({ now: () => now });
  await assert.rejects(
    client.deleteCurrentAccount({ requestId: 'request_123456789012345678901234', teamDecisions: [] }),
    (error) => error.code === 'reauthentication-required',
  );

  await client.reauthenticateForAccountDeletion();
  now += 5 * 60 * 1_000 + 1;
  await assert.rejects(
    client.deleteCurrentAccount({ requestId: 'request_123456789012345678901234', teamDecisions: [] }),
    (error) => error.code === 'reauthentication-required',
  );
});

test('deletion rejects a proof after the signed-in account changes', async () => {
  let currentUser = user(['google.com']);
  const { client, calls } = harness({ getCurrentUser: async () => currentUser });
  await client.reauthenticateForAccountDeletion();
  currentUser = { ...user(['google.com']), uid: 'user-2' };

  await assert.rejects(
    client.deleteCurrentAccount({ requestId: 'request_123456789012345678901234', teamDecisions: [] }),
    (error) => error.code === 'reauthentication-required',
  );
  assert.equal(calls.some(([kind]) => kind === 'revoke' || kind === 'callable'), false);
});

test('Apple revoke failure prevents deletion callable and consumes the proof', async () => {
  let revokeAttempts = 0;
  const { client, calls } = harness({
    getCurrentUser: async () => user(['apple.com']),
    getLastLoginProvider: () => 'apple.com',
    revokeAppleAuthorizationCode: async () => {
      revokeAttempts += 1;
      throw new Error('secret provider response');
    },
  });
  await client.reauthenticateForAccountDeletion();

  await assert.rejects(
    client.deleteCurrentAccount({ requestId: 'request_123456789012345678901234', teamDecisions: [] }),
    (error) => error.code === 'apple-revoke-failed'
      && !error.message.includes('secret provider response'),
  );
  assert.equal(revokeAttempts, 1);
  assert.equal(calls.some(([kind]) => kind === 'callable'), false);
  await assert.rejects(
    client.deleteCurrentAccount({ requestId: 'request_123456789012345678901234', teamDecisions: [] }),
    (error) => error.code === 'reauthentication-required',
  );
});

test('Google deletion skips Apple revoke and callable receives only approved fields', async () => {
  const { client, calls } = harness();
  await client.reauthenticateForAccountDeletion();
  await client.deleteCurrentAccount({
    requestId: 'request_123456789012345678901234',
    teamDecisions: [{ teamId: 'team-1', action: 'leave' }],
    ignored: 'must-not-leak',
  });

  assert.equal(calls.some(([kind]) => kind === 'revoke'), false);
  assert.deepEqual(calls.at(-1), ['callable', 'deleteAccount', {
    requestId: 'request_123456789012345678901234',
    teamDecisions: [{ teamId: 'team-1', action: 'leave' }],
  }]);
});

test('plan uses the named callable and callable errors become safe UI codes', async () => {
  const { client, calls } = harness();
  assert.deepEqual(await client.fetchAccountDeletionPlan(), { ok: true });
  assert.deepEqual(calls[0], ['callable', 'getAccountDeletionPlan', {}]);

  const failing = harness({
    invokeCallable: async () => {
      const error = new Error('owner@example.com internal detail');
      error.code = 'functions/failed-precondition';
      error.details = { reason: 'recent-authentication-required', email: 'owner@example.com' };
      throw error;
    },
  }).client;
  await assert.rejects(
    failing.fetchAccountDeletionPlan(),
    (error) => error.code === 'reauthentication-required'
      && !error.message.includes('owner@example.com')
      && error.details === undefined,
  );
});

test('Functions emulator requires both an explicit flag and a loopback hostname', () => {
  assert.equal(shouldConnectFunctionsEmulator({ enabled: true, hostname: 'localhost' }), true);
  assert.equal(shouldConnectFunctionsEmulator({ enabled: true, hostname: '127.0.0.1' }), true);
  assert.equal(shouldConnectFunctionsEmulator({ enabled: false, hostname: 'localhost' }), false);
  assert.equal(shouldConnectFunctionsEmulator({ enabled: true, hostname: 'dm-management-ecc1f.web.app' }), false);
});

test('Firebase adapter uses regional callables and only explicitly connects localhost emulator', () => {
  assert.match(adapterSource, /firebase-functions\.js/);
  assert.match(adapterSource, /getFunctions\(app,\s*'asia-northeast1'\)/);
  assert.match(adapterSource, /httpsCallable\([^,]+,\s*name\)/);
  assert.match(adapterSource, /shouldConnectFunctionsEmulator/);
  assert.match(adapterSource, /connectFunctionsEmulator\(functions,\s*'127\.0\.0\.1',\s*5001\)/);
  assert.doesNotMatch(adapterSource, /localStorage|sessionStorage|console\./);
});

test('iPhone content security policy permits the regional account-deletion callable', () => {
  assert.match(
    appHtmlSource,
    /Content-Security-Policy[\s\S]{0,1000}https:\/\/asia-northeast1-dm-management-ecc1f\.cloudfunctions\.net/,
  );
});

test('Firebase auth adapter reauthenticates the current user instead of signing in', () => {
  assert.match(firestoreCoreSource, /reauthenticateWithCredential\(currentUser,\s*credential\)/);
  assert.match(firestoreCoreSource, /currentUser\.getIdToken\(true\)/);
  assert.match(firestoreCoreSource, /reauthenticateWithPopup\(\s*currentUser,\s*provider/);
  assert.match(firebaseAuthSource, /fetchAccountDeletionPlan/);
  assert.match(firebaseAuthSource, /reauthenticateForAccountDeletion/);
  assert.match(firebaseAuthSource, /deleteCurrentAccount/);
});

test('root scripts run and syntax-check the account deletion client', () => {
  assert.match(rootPackage.scripts.test, /tests\/account-deletion-client\.test\.mjs/);
  assert.match(rootPackage.scripts['test:account-deletion'], /tests\/account-deletion-client\.test\.mjs/);
  assert.match(rootPackage.scripts['check:js'], /www\/js\/account-deletion-core\.mjs/);
  assert.match(rootPackage.scripts['check:js'], /www\/js\/account-deletion\.mjs/);
});
