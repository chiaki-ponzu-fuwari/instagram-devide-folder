/* global window */
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js';

import {
  getFirebaseCore,
  getFreshAppleReauthenticationCredential,
  getFreshGoogleReauthenticationCredential,
  getLastLoginProvider,
  isNativePlatform,
  reauthenticateCurrentUser,
} from './firestore-core.mjs';
import {
  createAccountDeletionClient,
  shouldConnectFunctionsEmulator,
} from './account-deletion-core.mjs';

let callableFunctions;

async function invokeCallable(name, data) {
  if (!callableFunctions) {
    const { app } = await getFirebaseCore();
    const functions = getFunctions(app, 'asia-northeast1');
    const enabled = window.DM_USE_FIREBASE_EMULATORS === true;
    const hostname = window.location?.hostname || '';
    if (shouldConnectFunctionsEmulator({ enabled, hostname })) {
      connectFunctionsEmulator(functions, '127.0.0.1', 5001);
    }
    callableFunctions = functions;
  }
  return httpsCallable(callableFunctions, name)(data);
}

const accountDeletionClient = createAccountDeletionClient({
  getCurrentUser: async () => (await getFirebaseCore()).auth.currentUser,
  getLastLoginProvider,
  isNativePlatform,
  getGoogleCredential: ({ currentUser }) => (
    getFreshGoogleReauthenticationCredential(currentUser)
  ),
  getAppleCredential: ({ currentUser }) => (
    getFreshAppleReauthenticationCredential(currentUser)
  ),
  reauthenticateWithCredential: reauthenticateCurrentUser,
  prepareAppleRevocation: async ({ identityToken, rawNonce, expectedUid }) => {
    const plugin = window.Capacitor?.Plugins?.SignInWithApple;
    if (!plugin?.prepareAuthorizationRevocation) {
      throw new Error('Apple revocation is unavailable');
    }
    await plugin.prepareAuthorizationRevocation({ identityToken, rawNonce, expectedUid });
  },
  invokeCallable,
  revokeAppleAuthorizationCode: async (authorizationCode) => {
    const plugin = window.Capacitor?.Plugins?.SignInWithApple;
    if (!plugin?.revokeAuthorizationCode) throw new Error('Apple revocation is unavailable');
    await plugin.revokeAuthorizationCode({ authorizationCode });
  },
  now: () => Date.now(),
});

export const {
  fetchAccountDeletionPlan,
  reauthenticateForAccountDeletion,
  deleteCurrentAccount,
} = accountDeletionClient;
