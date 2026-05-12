/* global window */
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  initializeAuth,
  browserLocalPersistence,
  browserSessionPersistence,
  getAuth,
  GoogleAuthProvider,
  OAuthProvider,
  signInWithRedirect,
  getRedirectResult,
  signInWithPopup,
  signInWithCredential,
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

function googleWebClientId() {
  const c = firebaseConfig();
  const id = c && typeof c.googleWebClientId === 'string' ? c.googleWebClientId.trim() : '';
  return id && !/REPLACE|placeholder/i.test(id) ? id : '';
}

function isNative() {
  try {
    const C = window.Capacitor;
    return !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform());
  } catch {
    return false;
  }
}

function withTimeout(promise, label, ms = 15000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    timeout,
  ]);
}

function randomNonce(length = 32) {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._';
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  let result = '';
  for (let i = 0; i < bytes.length; i += 1) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

async function sha256Hex(value) {
  const data = new TextEncoder().encode(value);
  const hash = await window.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function initFirebaseCore() {
  if (!hasFirebaseConfig()) throw new Error('DM_FIREBASE_CONFIG missing');
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const apps = getApps();
    app = apps.length ? apps[0] : initializeApp(firebaseConfig());
    try {
      auth = initializeAuth(app, {
        persistence: [browserLocalPersistence, browserSessionPersistence],
      });
    } catch {
      auth = getAuth(app);
    }
    db = getFirestore(app);
    if (!isNative()) {
      try {
        await getRedirectResult(auth);
      } catch {
        // Redirect result can fail after cancelled login. Keep app usable.
      }
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
    const plugin = window.Capacitor?.Plugins?.GoogleSignIn;
    if (plugin?.initialize && plugin?.signIn) {
      const clientId = googleWebClientId();
      if (!clientId) throw new Error('DM_FIREBASE_CONFIG.googleWebClientId missing');
      await plugin.initialize({ clientId });
      const result = await plugin.signIn();
      const idToken = result?.idToken;
      if (!idToken) throw new Error('Google sign-in did not return an ID token');
      const credential = GoogleAuthProvider.credential(idToken);
      await withTimeout(signInWithCredential(core.auth, credential), 'Firebase sign-in');
      return;
    }
    throw new Error('GoogleSignIn native plugin missing');
  }
  try {
    await signInWithPopup(core.auth, provider);
  } catch {
    await signInWithRedirect(core.auth, provider);
  }
}

export async function signInWithApple() {
  const core = await getFirebaseCore();
  if (!isNative()) {
    throw new Error('Apple sign-in is available on iPhone only');
  }
  const plugin = window.Capacitor?.Plugins?.SignInWithApple;
  if (!plugin?.authorize) {
    throw new Error('SignInWithApple native plugin missing');
  }
  const rawNonce = randomNonce();
  const hashedNonce = await sha256Hex(rawNonce);
  const result = await plugin.authorize({
    clientId: 'com.chiaki.dmmanager',
    redirectURI: 'https://localhost/login',
    scopes: 'email name',
    state: String(Date.now()),
    nonce: hashedNonce,
  });
  const identityToken = result?.response?.identityToken;
  if (!identityToken) throw new Error('Apple sign-in did not return an identity token');
  const provider = new OAuthProvider('apple.com');
  const credential = provider.credential({ idToken: identityToken, rawNonce });
  await withTimeout(signInWithCredential(core.auth, credential), 'Firebase Apple sign-in');
}

export async function signOutGoogle() {
  const core = await getFirebaseCore();
  try {
    await window.Capacitor?.Plugins?.GoogleSignIn?.signOut?.();
  } catch {
    // Firebase sign-out below is the source of truth for app state.
  }
  await signOut(core.auth);
}

export { serverTimestamp };
