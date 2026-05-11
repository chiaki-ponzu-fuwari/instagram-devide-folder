/* global window */
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

let app;
let auth;
let db;
let initPromise;

export function firebaseConfig() {
  return typeof window !== 'undefined' ? window.DM_FIREBASE_CONFIG : null;
}

export function hasFirebaseConfig() {
  const c = firebaseConfig();
  return !!(c && c.apiKey && c.projectId);
}

function isNative() {
  try {
    const C = window.Capacitor;
    return !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform());
  } catch {
    return false;
  }
}

export async function initFirebaseCore() {
  if (!hasFirebaseConfig()) throw new Error('DM_FIREBASE_CONFIG missing');
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const apps = getApps();
    app = apps.length ? apps[0] : initializeApp(firebaseConfig());
    auth = getAuth(app);
    db = getFirestore(app);
    try {
      await getRedirectResult(auth);
    } catch {
      // Redirect result can fail after cancelled login. Keep app usable.
    }
    return { app, auth, db };
  })();
  return initPromise;
}

export async function getFirebaseCore() {
  await initFirebaseCore();
  return { app, auth, db };
}

export async function waitForInitialAuth() {
  const core = await getFirebaseCore();
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(core.auth, (user) => {
      unsub();
      resolve(user);
    });
  });
}

export function getCurrentUser() {
  return auth?.currentUser ?? null;
}

export function subscribeAuth(callback) {
  initFirebaseCore()
    .then(({ auth: activeAuth }) => onAuthStateChanged(activeAuth, callback))
    .catch(() => {});
}

export async function signInWithGoogle() {
  const core = await getFirebaseCore();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  if (isNative()) {
    await signInWithRedirect(core.auth, provider);
    return;
  }
  try {
    await signInWithPopup(core.auth, provider);
  } catch {
    await signInWithRedirect(core.auth, provider);
  }
}

export async function signOutGoogle() {
  const core = await getFirebaseCore();
  await signOut(core.auth);
}

export { serverTimestamp };
