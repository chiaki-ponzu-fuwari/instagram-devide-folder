/**
 * Firebase Auth (Google) — Capacitor は redirect、ブラウザは popup を優先
 * 事前に index.html の window.DM_FIREBASE_CONFIG を設定してください。
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

let app;
let auth;
let initPromise;

function cfg() {
  return typeof window !== 'undefined' ? window.DM_FIREBASE_CONFIG : null;
}

function isNative() {
  try {
    const C = window.Capacitor;
    return !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform());
  } catch {
    return false;
  }
}

export function hasFirebaseConfig() {
  const c = cfg();
  return !!(c && c.apiKey && c.projectId);
}

export async function initFirebase() {
  if (!hasFirebaseConfig()) {
    throw new Error('DM_FIREBASE_CONFIG missing');
  }
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const c = cfg();
    app = initializeApp(c);
    auth = getAuth(app);
    try {
      await getRedirectResult(auth);
    } catch {
      /* ignore */
    }
  })();
  return initPromise;
}

/** 初回の認証状態が確定するまで待つ（復元・リダイレクト後） */
export function waitForInitialAuth() {
  return initFirebase().then(
    () =>
      new Promise((resolve) => {
        const unsub = onAuthStateChanged(auth, (user) => {
          unsub();
          resolve(user);
        });
      }),
  );
}

export function getCurrentUser() {
  return auth?.currentUser ?? null;
}

export function subscribeAuth(callback) {
  initFirebase()
    .then(() => {
      onAuthStateChanged(auth, callback);
    })
    .catch(() => {});
}

export async function signInWithGoogle() {
  await initFirebase();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  if (isNative()) {
    await signInWithRedirect(auth, provider);
    return;
  }
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    await signInWithRedirect(auth, provider);
  }
}

export async function signOutGoogle() {
  await initFirebase();
  await signOut(auth);
}
