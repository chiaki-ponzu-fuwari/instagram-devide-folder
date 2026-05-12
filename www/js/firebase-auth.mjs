export {
  hasFirebaseConfig,
  initFirebaseCore as initFirebase,
  waitForInitialAuth,
  waitForAuthReady,
  getCurrentUser,
  getLastLoginProvider,
  subscribeAuth,
  signInWithGoogle,
  signInWithApple,
  signOutGoogle,
  signOutCurrentUser,
} from './firestore-core.mjs';

export {
  getLoginUiState,
  shouldOpenLogoutSheet,
} from './auth-state.mjs';
