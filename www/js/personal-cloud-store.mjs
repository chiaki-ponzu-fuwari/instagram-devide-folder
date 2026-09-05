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

function cleanString(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function toNumber(value, fallback = 0) {
  if (value && typeof value.toMillis === 'function') {
    const millis = value.toMillis();
    return Number.isFinite(millis) ? millis : fallback;
  }
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : fallback;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function cloneRecord(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((entry) => cloneRecord(entry));
  if (typeof value === 'object') {
    if (typeof value.toMillis === 'function') return value.toMillis();
    const out = {};
    for (const [key, entry] of Object.entries(value)) out[key] = cloneRecord(entry);
    return out;
  }
  return value;
}

function getRecordId(record, fallback = '') {
  return cleanString(record?.id, fallback);
}

function getRecordUpdatedAt(record) {
  return toNumber(record?.updatedAt, 0);
}

function getRecordCreatedAt(record) {
  return toNumber(record?.createdAt, 0);
}

function stripSyncMeta(value) {
  if (!value || typeof value !== 'object') return {};
  const out = cloneRecord(value);
  delete out.syncMeta;
  return out;
}

function getWorkspaceSettings(snapshot) {
  if (snapshot?.settings && typeof snapshot.settings === 'object') return snapshot.settings;
  if (snapshot?.meta && typeof snapshot.meta === 'object') return snapshot.meta;
  return null;
}

function mergeRecordLists(localRecords = [], cloudRecords = []) {
  const merged = new Map();
  for (const record of localRecords || []) {
    if (!record || record.id == null) continue;
    merged.set(String(record.id), cloneRecord(record));
  }
  for (const record of cloudRecords || []) {
    if (!record || record.id == null) continue;
    const key = String(record.id);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, cloneRecord(record));
      continue;
    }
    if (getRecordUpdatedAt(record) >= getRecordUpdatedAt(existing)) {
      merged.set(key, cloneRecord(record));
    }
  }
  return [...merged.values()];
}

export function normalizeWorkspaceRecord(input, { ownerUid, now, collection } = {}) {
  const base = cloneRecord(input || {});
  const stamp = toNumber(now, Date.now());
  const id = getRecordId(base, collection === 'settings' ? 'main' : '');
  return {
    ...base,
    id,
    ownerUid: cleanString(base.ownerUid, cleanString(ownerUid)),
    scope: cleanString(base.scope, 'personal'),
    collection: cleanString(base.collection, cleanString(collection)),
    createdAt: toNumber(base.createdAt, stamp),
    updatedAt: toNumber(base.updatedAt, stamp),
    updatedBy: cleanString(base.updatedBy, cleanString(ownerUid)),
  };
}

function normalizeSettingsRecord(input, ctx = {}) {
  return normalizeWorkspaceRecord({
    ...cloneRecord(input || {}),
    id: getRecordId(input, 'main'),
  }, {
    ownerUid: ctx.ownerUid,
    now: ctx.now,
    collection: 'settings',
  });
}

function normalizeProjectRecord(input, ctx = {}) {
  const base = cloneRecord(input || {});
  return normalizeWorkspaceRecord({
    ...base,
    id: getRecordId(base, cleanString(ctx.fallbackId)),
    accountId: cleanString(base.accountId, cleanString(ctx.accountId)),
  }, {
    ownerUid: ctx.ownerUid,
    now: ctx.now,
    collection: 'projects',
  });
}

function hydrateWorkspaceSnapshot(snapshot = {}) {
  const ownerUid = cleanString(snapshot.ownerUid);
  const folders = Array.isArray(snapshot.folders) ? snapshot.folders.map((r) => cloneRecord(r)) : [];
  const explicitProjects = Array.isArray(snapshot.projects) ? snapshot.projects.map((r) => cloneRecord(r)) : [];
  const accounts = Array.isArray(snapshot.accounts) ? snapshot.accounts.map((r) => cloneRecord(r)) : [];
  const templates = Array.isArray(snapshot.templates) ? snapshot.templates.map((r) => cloneRecord(r)) : [];
  const settings = getWorkspaceSettings(snapshot) ? cloneRecord(getWorkspaceSettings(snapshot)) : null;

  const projectMap = new Map();
  for (const project of explicitProjects) {
    if (!project || project.id == null) continue;
    projectMap.set(cleanString(project.accountId, String(project.id)), project);
  }

  const hydratedAccounts = accounts.map((account) => {
    if (!account || account.id == null) return cloneRecord(account);
    const key = String(account.id);
    const accountProject = account.project && typeof account.project === 'object' ? cloneRecord(account.project) : null;
    const project = accountProject || projectMap.get(key) || null;
    return project ? { ...cloneRecord(account), project } : cloneRecord(account);
  });

  const derivedProjects = hydratedAccounts
    .filter((account) => account && account.project)
    .map((account) => normalizeProjectRecord({
      ...cloneRecord(account.project),
      id: getRecordId(account.project, account.id),
      accountId: account.id,
    }, {
      ownerUid,
      now: getRecordUpdatedAt(account) || Date.now(),
      fallbackId: account.id,
      accountId: account.id,
    }));

  return {
    ownerUid,
    folders,
    accounts: hydratedAccounts,
    projects: mergeRecordLists(explicitProjects, derivedProjects),
    templates,
    settings,
  };
}

export function mergeWorkspaceSnapshot(localState = {}, cloudState = {}) {
  const localSettings = getWorkspaceSettings(localState);
  const cloudSettings = getWorkspaceSettings(cloudState);
  const settings = localSettings || cloudSettings
    ? mergeRecordLists(
        localSettings ? [normalizeSettingsRecord(localSettings, { ownerUid: localState.ownerUid })] : [],
        cloudSettings ? [normalizeSettingsRecord(cloudSettings, { ownerUid: cloudState.ownerUid })] : [],
      )[0] || null
    : null;

  return hydrateWorkspaceSnapshot({
    ownerUid: cleanString(localState.ownerUid, cleanString(cloudState.ownerUid)),
    folders: mergeRecordLists(Array.isArray(localState.folders) ? localState.folders : [], Array.isArray(cloudState.folders) ? cloudState.folders : []),
    accounts: mergeRecordLists(Array.isArray(localState.accounts) ? localState.accounts : [], Array.isArray(cloudState.accounts) ? cloudState.accounts : []),
    projects: mergeRecordLists(Array.isArray(localState.projects) ? localState.projects : [], Array.isArray(cloudState.projects) ? cloudState.projects : []),
    templates: mergeRecordLists(Array.isArray(localState.templates) ? localState.templates : [], Array.isArray(cloudState.templates) ? cloudState.templates : []),
    settings,
  });
}

export function shouldMigrateLocalWorkspace({ cloudDocCount, localRecordCount }) {
  return cloudDocCount === 0 && localRecordCount > 0;
}

export function countLocalRecords(localState = {}) {
  const folders = Array.isArray(localState.folders) ? localState.folders.length : 0;
  const accounts = Array.isArray(localState.accounts) ? localState.accounts.length : 0;
  const projects = Array.isArray(localState.projects)
    ? localState.projects.length
    : (Array.isArray(localState.accounts) ? localState.accounts.filter((account) => account && account.project).length : 0);
  const templates = Array.isArray(localState.templates) ? localState.templates.length : 0;
  const settings = localState.settings || localState.meta ? 1 : 0;
  return folders + accounts + projects + templates + settings;
}

export function buildWorkspaceSnapshotFromLocal(localState = {}, { ownerUid } = {}) {
  const now = Date.now();
  const folders = (Array.isArray(localState.folders) ? localState.folders : []).map((record) => (
    normalizeWorkspaceRecord(record, { ownerUid, now, collection: 'folders' })
  ));
  const accounts = (Array.isArray(localState.accounts) ? localState.accounts : []).map((record) => (
    normalizeWorkspaceRecord(record, { ownerUid, now, collection: 'accounts' })
  ));
  const explicitProjects = Array.isArray(localState.projects) ? localState.projects : [];
  const derivedProjects = accounts
    .filter((account) => account && account.project)
    .map((account) => normalizeProjectRecord({
      ...cloneRecord(account.project),
      id: getRecordId(account.project, account.id),
      accountId: account.id,
    }, {
      ownerUid,
      now,
      fallbackId: account.id,
      accountId: account.id,
    }));
  const projects = mergeRecordLists(
    explicitProjects.map((record) => normalizeProjectRecord(record, { ownerUid, now, fallbackId: record?.id })),
    derivedProjects,
  );
  const templates = (Array.isArray(localState.templates) ? localState.templates : []).map((record) => (
    normalizeWorkspaceRecord(record, { ownerUid, now, collection: 'templates' })
  ));
  const rawSettings = localState.settings && typeof localState.settings === 'object'
    ? localState.settings
    : (localState.meta && typeof localState.meta === 'object' ? localState.meta : {});
  const settings = normalizeSettingsRecord({
    ...cloneRecord(rawSettings),
    id: getRecordId(rawSettings, 'main'),
  }, { ownerUid, now });

  return hydrateWorkspaceSnapshot({
    ownerUid,
    folders,
    accounts,
    projects,
    templates,
    settings,
  });
}

async function loadCollectionSnapshot(db, uid, collectionName) {
  const { collection, getDocs } = await getFirestoreRuntime();
  const snap = await getDocs(collection(db, 'users', uid, collectionName));
  const records = snap.docs.map((d) => normalizeWorkspaceRecord({
    id: d.id,
    ...cloneRecord(d.data()),
  }, {
    ownerUid: uid,
    collection: collectionName,
  }));
  records.sort((a, b) => {
    const delta = getRecordUpdatedAt(b) - getRecordUpdatedAt(a);
    if (delta !== 0) return delta;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
  return records;
}

function countWorkspaceDocs(snapshot = {}) {
  const folders = Array.isArray(snapshot.folders) ? snapshot.folders.length : 0;
  const accounts = Array.isArray(snapshot.accounts) ? snapshot.accounts.length : 0;
  const projects = Array.isArray(snapshot.projects) ? snapshot.projects.length : 0;
  const templates = Array.isArray(snapshot.templates) ? snapshot.templates.length : 0;
  const settings = snapshot.settings ? 1 : 0;
  return folders + accounts + projects + templates + settings;
}

export async function loadWorkspaceFromFirestore({ user }) {
  if (!user?.uid) throw new Error('login-required');
  const { db, doc, getDoc } = await getFirestoreRuntime();
  const [folders, accounts, projects, templates, settingsSnap] = await Promise.all([
    loadCollectionSnapshot(db, user.uid, 'folders'),
    loadCollectionSnapshot(db, user.uid, 'accounts'),
    loadCollectionSnapshot(db, user.uid, 'projects'),
    loadCollectionSnapshot(db, user.uid, 'templates'),
    getDoc(doc(db, 'users', user.uid, 'settings', 'main')),
  ]);

  const settings = settingsSnap.exists()
    ? normalizeSettingsRecord({
        id: 'main',
        ...stripSyncMeta(settingsSnap.data()),
      }, { ownerUid: user.uid, now: Date.now() })
    : null;

  const snapshot = hydrateWorkspaceSnapshot({
    ownerUid: user.uid,
    folders,
    accounts,
    projects,
    templates,
    settings,
  });

  return {
    snapshot,
    recordCount: countWorkspaceDocs(snapshot) + (settingsSnap.exists() && !snapshot.settings ? 1 : 0),
    settingsExists: settingsSnap.exists(),
  };
}

export async function writeWorkspaceToFirestore({ user, snapshot }) {
  if (!user?.uid) throw new Error('login-required');
  const { db, doc, runTransaction, serverTimestamp } = await getFirestoreRuntime();
  const uid = user.uid;
  const now = Date.now();
  const workspace = hydrateWorkspaceSnapshot({
    ...cloneRecord(snapshot || {}),
    ownerUid: uid,
  });

  const writes = [];
  const appendCollection = (name, records = []) => {
    for (const record of records) {
      if (!record || !record.id) continue;
      writes.push([doc(db, 'users', uid, name, String(record.id)), {
        ...cloneRecord(record),
        ownerUid: uid,
        collection: name,
        updatedAt: toNumber(record.updatedAt, now),
        updatedBy: cleanString(record.updatedBy, uid),
      }]);
    }
  };

  appendCollection('folders', workspace.folders);
  appendCollection('accounts', workspace.accounts);
  appendCollection('projects', workspace.projects);
  appendCollection('templates', workspace.templates);
  writes.push([doc(db, 'users', uid, 'settings', 'main'), {
    ...stripSyncMeta(getWorkspaceSettings(workspace)),
    id: 'main',
    ownerUid: uid,
    scope: 'personal',
    collection: 'settings',
    createdAt: getRecordCreatedAt(workspace.settings) || now,
    updatedAt: now,
    updatedBy: uid,
    syncMeta: {
      schemaVersion: 1,
      migratedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    },
  }]);

  for (let start = 0; start < writes.length; start += 200) {
    const chunk = writes.slice(start, start + 200);
    await runTransaction(db, async (transaction) => {
      const currentRows = [];
      for (const [ref, data] of chunk) {
        currentRows.push({ ref, data, current: await transaction.get(ref) });
      }
      for (const { ref, data, current } of currentRows) {
        const previous = current.exists() ? cloneRecord(current.data()) : null;
        if (previous && getRecordUpdatedAt(data) < getRecordUpdatedAt(previous)) continue;
        transaction.set(ref, {
          ...data,
          revision: Math.max(1, Number(previous?.revision || 0) + 1),
        });
      }
    });
  }
  return workspace;
}

const personalCloudWriteQueues = new Map();
const personalCloudPendingPayloads = new Map();
const personalCloudPendingCounts = new Map();
const personalCloudInflight = new Set();
const syncStatusListeners = new Set();
const syncStatusState = {
  lastSyncedAt: 0,
  lastAttemptAt: 0,
  pendingCount: 0,
  inFlight: false,
  lastError: null,
  online: detectOnline(),
  uid: '',
};

function detectOnline() {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      return navigator.onLine;
    }
  } catch {}
  return true;
}

function notifySyncStatus() {
  const snapshot = getSyncStatus();
  for (const fn of [...syncStatusListeners]) {
    try { fn(snapshot); } catch {}
  }
}

export function getSyncStatus() {
  return { ...syncStatusState };
}

export function subscribeSyncStatus(callback) {
  if (typeof callback !== 'function') return () => {};
  syncStatusListeners.add(callback);
  try { callback(getSyncStatus()); } catch {}
  return () => { syncStatusListeners.delete(callback); };
}

function setSyncStatus(patch = {}) {
  let changed = false;
  for (const [key, value] of Object.entries(patch)) {
    if (syncStatusState[key] !== value) {
      syncStatusState[key] = value;
      changed = true;
    }
  }
  if (changed) notifySyncStatus();
}

function recomputePendingCount() {
  let total = 0;
  for (const count of personalCloudPendingCounts.values()) total += count;
  for (const _ of personalCloudInflight) total += 1;
  setSyncStatus({ pendingCount: total });
}

function bumpPending(uid, delta) {
  if (!uid) return;
  const current = personalCloudPendingCounts.get(uid) || 0;
  const next = Math.max(0, current + delta);
  if (next === 0) personalCloudPendingCounts.delete(uid);
  else personalCloudPendingCounts.set(uid, next);
  recomputePendingCount();
}

export function hasPendingWrites(uid) {
  if (uid) {
    const queued = personalCloudPendingCounts.get(uid) || 0;
    const flying = personalCloudInflight.has(uid) ? 1 : 0;
    return queued + flying > 0;
  }
  return syncStatusState.pendingCount > 0;
}

export async function waitForPendingWrites(uid, { timeoutMs = 15000 } = {}) {
  if (!hasPendingWrites(uid)) return true;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsub();
      resolve(ok);
    };
    const unsub = subscribeSyncStatus(() => {
      if (!hasPendingWrites(uid)) finish(true);
    });
    const timer = setTimeout(() => finish(false), Math.max(500, timeoutMs));
  });
}

async function retryPersonalCloudWrite(task, { attempts = 3, delayMs = 250 } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
  throw lastError;
}

export function queuePersonalCloudWrite(user, snapshot) {
  if (!user?.uid) return Promise.resolve(null);
  const uid = user.uid;
  const payload = hydrateWorkspaceSnapshot({
    ...cloneRecord(snapshot || {}),
    ownerUid: uid,
  });
  personalCloudPendingPayloads.set(uid, { user, snapshot: payload });
  bumpPending(uid, +1);
  setSyncStatus({ uid, lastError: null });

  const previous = personalCloudWriteQueues.get(uid) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      const latest = personalCloudPendingPayloads.get(uid);
      if (!latest) return null;
      personalCloudPendingPayloads.delete(uid);
      personalCloudInflight.add(uid);
      setSyncStatus({ inFlight: true, lastAttemptAt: Date.now() });
      recomputePendingCount();
      try {
        const result = await retryPersonalCloudWrite(
          () => writeWorkspaceToFirestore({ user: latest.user, snapshot: latest.snapshot })
        );
        setSyncStatus({
          lastSyncedAt: Date.now(),
          lastError: null,
        });
        return result;
      } finally {
        personalCloudInflight.delete(uid);
        bumpPending(uid, -1);
        if (syncStatusState.pendingCount === 0) {
          setSyncStatus({ inFlight: false });
        }
      }
    })
    .catch((error) => {
      console.warn('[personal-cloud] write failed', error);
      setSyncStatus({
        lastError: error && (error.message || String(error)) ? (error.message || String(error)) : 'sync-failed',
      });
      return null;
    });
  let tracked = null;
  tracked = next.finally(() => {
    if (personalCloudWriteQueues.get(uid) === tracked) {
      personalCloudWriteQueues.delete(uid);
    }
  });
  personalCloudWriteQueues.set(uid, tracked);
  return next;
}

export async function forceSyncNow({ user, snapshot } = {}) {
  if (!user?.uid) throw new Error('login-required');
  const payload = hydrateWorkspaceSnapshot({
    ...cloneRecord(snapshot || {}),
    ownerUid: user.uid,
  });
  setSyncStatus({ uid: user.uid, lastError: null });
  await queuePersonalCloudWrite(user, payload);
  await waitForPendingWrites(user.uid, { timeoutMs: 20000 });
  if (syncStatusState.lastError) {
    throw new Error(syncStatusState.lastError);
  }
  return getSyncStatus();
}

export async function forceRestoreNow({ user } = {}) {
  if (!user?.uid) throw new Error('login-required');
  const cloud = await loadWorkspaceFromFirestore({ user });
  return cloud.snapshot;
}

function flushPendingQueuesOnOnline() {
  if (!detectOnline()) return;
  setSyncStatus({ online: true });
  for (const [uid, payload] of [...personalCloudPendingPayloads.entries()]) {
    if (!payload?.user || !payload.snapshot) continue;
    if (payload.user.uid !== uid) continue;
    queuePersonalCloudWrite(payload.user, payload.snapshot);
  }
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  try {
    window.addEventListener('online', () => {
      setSyncStatus({ online: true });
      flushPendingQueuesOnOnline();
    });
    window.addEventListener('offline', () => {
      setSyncStatus({ online: false });
    });
  } catch {}
}

export async function bootstrapPersonalWorkspace({ user, localState }) {
  if (!user?.uid) throw new Error('login-required');
  setSyncStatus({ uid: user.uid });
  const cloud = await loadWorkspaceFromFirestore({ user });
  if (shouldMigrateLocalWorkspace({
    cloudDocCount: cloud.recordCount,
    localRecordCount: countLocalRecords(localState),
  })) {
    const migrated = buildWorkspaceSnapshotFromLocal(localState, { ownerUid: user.uid });
    await writeWorkspaceToFirestore({ user, snapshot: migrated });
    setSyncStatus({ lastSyncedAt: Date.now(), lastError: null });
    return migrated;
  }
  setSyncStatus({ lastSyncedAt: Date.now(), lastError: null });
  return mergeWorkspaceSnapshot(
    buildWorkspaceSnapshotFromLocal(localState, { ownerUid: user.uid }),
    cloud.snapshot,
  );
}

export async function subscribePersonalWorkspace({ user, onChange }) {
  if (!user?.uid || typeof onChange !== 'function') return () => {};
  const { db, collection, doc, onSnapshot } = await getFirestoreRuntime();
  let disposed = false;
  let chain = Promise.resolve();
  const refresh = () => {
    chain = chain.then(async () => {
      if (disposed) return;
      try {
        const loaded = await loadWorkspaceFromFirestore({ user });
        if (!disposed) {
          onChange(loaded.snapshot);
          setSyncStatus({ lastSyncedAt: Date.now(), lastError: null });
        }
      } catch (error) {
        console.warn('[personal-cloud] subscribe reload failed', error);
      }
    }).catch(() => {});
  };
  const unsubs = [
    onSnapshot(collection(db, 'users', user.uid, 'folders'), refresh, refresh),
    onSnapshot(collection(db, 'users', user.uid, 'accounts'), refresh, refresh),
    onSnapshot(collection(db, 'users', user.uid, 'projects'), refresh, refresh),
    onSnapshot(collection(db, 'users', user.uid, 'templates'), refresh, refresh),
    onSnapshot(doc(db, 'users', user.uid, 'settings', 'main'), refresh, refresh),
  ];
  refresh();
  return () => {
    disposed = true;
    for (const unsub of unsubs) {
      try { unsub(); } catch {}
    }
  };
}

export const subscribeWorkspaceFromFirestore = subscribePersonalWorkspace;
