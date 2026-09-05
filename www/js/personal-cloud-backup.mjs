import {
  buildWorkspaceSnapshotFromLocal,
} from './personal-cloud-store.mjs';

let firestoreRuntimePromise = null;

async function getFirestoreRuntime() {
  if (!firestoreRuntimePromise) {
    firestoreRuntimePromise = (async () => {
      const firestore = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
      const core = await import('./firestore-core.mjs');
      const { db } = await core.getFirebaseCore();
      return {
        ...firestore,
        db,
        serverTimestamp: core.serverTimestamp,
      };
    })();
  }
  return firestoreRuntimePromise;
}

function cloneRecord(value) {
  if (value == null) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function workspaceSnapshotToLegacyBackup(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  return {
    folders: Array.isArray(snapshot.folders) ? snapshot.folders.map(cloneRecord) : [],
    accounts: Array.isArray(snapshot.accounts) ? snapshot.accounts.map(cloneRecord) : [],
    projects: Array.isArray(snapshot.projects) ? snapshot.projects.map(cloneRecord) : [],
    templates: Array.isArray(snapshot.templates) ? snapshot.templates.map(cloneRecord) : [],
    meta: snapshot.settings && typeof snapshot.settings === 'object'
      ? cloneRecord(snapshot.settings)
      : (snapshot.meta && typeof snapshot.meta === 'object' ? cloneRecord(snapshot.meta) : {}),
  };
}

function legacyBackupToWorkspaceSnapshot(data, { ownerUid }) {
  if (!data || typeof data !== 'object') return null;
  const normalized = buildWorkspaceSnapshotFromLocal({
    folders: Array.isArray(data.folders) ? data.folders : [],
    accounts: Array.isArray(data.accounts) ? data.accounts : [],
    projects: Array.isArray(data.projects) ? data.projects : [],
    templates: Array.isArray(data.templates) ? data.templates : [],
    settings: data.settings && typeof data.settings === 'object' ? data.settings : null,
    meta: data.meta && typeof data.meta === 'object' ? data.meta : {},
  }, { ownerUid });
  return normalized;
}

export function serializePersonalBackupData(data, { ownerUid } = {}) {
  return legacyBackupToWorkspaceSnapshot(data, { ownerUid });
}

export function deserializePersonalBackupData(data) {
  return workspaceSnapshotToLegacyBackup(data);
}

export async function savePersonalBackup({ user, data }) {
  if (!user?.uid) throw new Error('login-required');
  const { db, doc, setDoc, serverTimestamp } = await getFirestoreRuntime();
  const privateBackup = legacyBackupToWorkspaceSnapshot(data, { ownerUid: user.uid });
  await setDoc(doc(db, 'users', user.uid), {
    profile: {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || '',
      photoURL: user.photoURL || '',
    },
    privateBackup,
    syncMeta: {
      migratedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
      schemaVersion: 1,
    },
  }, { merge: true });
}

export async function loadPersonalBackup({ user }) {
  if (!user?.uid) throw new Error('login-required');
  const { db, doc, getDoc } = await getFirestoreRuntime();
  const snap = await getDoc(doc(db, 'users', user.uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  return deserializePersonalBackupData(data.privateBackup || null);
}
