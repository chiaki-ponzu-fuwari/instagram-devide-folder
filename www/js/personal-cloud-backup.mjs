import {
  doc,
  getDoc,
  setDoc,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseCore, serverTimestamp } from './firestore-core.mjs';

export async function savePersonalBackup({ user, data }) {
  if (!user?.uid) throw new Error('login-required');
  const { db } = await getFirebaseCore();
  await setDoc(doc(db, 'users', user.uid), {
    profile: {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || '',
      photoURL: user.photoURL || '',
    },
    privateBackup: data,
    syncMeta: {
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
      schemaVersion: 1,
    },
  }, { merge: true });
}

export async function loadPersonalBackup({ user }) {
  if (!user?.uid) throw new Error('login-required');
  const { db } = await getFirebaseCore();
  const snap = await getDoc(doc(db, 'users', user.uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  return data.privateBackup || null;
}
