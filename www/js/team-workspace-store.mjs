import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  deleteField,
  runTransaction,
  Timestamp,
  query,
  where,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseCore } from './firestore-core.mjs';
import { deriveActivityIdentityUids } from './activity-identity.mjs';
import { resolveTeamWorkspaceAccess } from './team-security-model.mjs';
import {
  buildV2Account,
  buildV2Folder,
  buildV2Project,
  buildV2Settings,
  buildV2Template,
  buildRewardShares,
  buildRewardTotal,
  buildProjectCost,
} from './team-v2-records.mjs';
import {
  createMemoryStorage,
  createTeamMutationQueue,
} from './team-mutation-queue.mjs';
import {
  countLocalRecords,
  mergeWorkspaceSnapshot,
  normalizeWorkspaceRecord,
  shouldMigrateLocalWorkspace,
} from './personal-cloud-store.mjs';

function requireUser(user) {
  if (!user?.uid) throw new Error('login-required');
  return user;
}

function teamRef(db, teamId) {
  return doc(db, 'teams', teamId);
}

function teamSettingsRef(db, teamId) {
  return doc(db, 'teams', teamId, 'settings', 'main');
}

function teamCollectionRef(db, teamId, name) {
  return collection(db, 'teams', teamId, name);
}

function teamAccessError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function isPermissionDeniedError(error) {
  const code = String(error?.code || error?.message || '').toLowerCase();
  return code.includes('permission-denied') || code.includes('permission_denied');
}

export async function resolveTeamWorkspaceAccessFromFirestore({ user, teamId }) {
  requireUser(user);
  const targetTeamId = String(teamId || '').trim();
  if (!targetTeamId) throw new Error('team-id-required');
  const { db } = await getFirebaseCore();
  const [teamSnap, memberSnap] = await Promise.all([
    getDoc(teamRef(db, targetTeamId)),
    getDoc(doc(db, 'teams', targetTeamId, 'members', user.uid)),
  ]);
  const team = teamSnap.exists() ? { id: teamSnap.id, ...cloneRecord(teamSnap.data()) } : null;
  const member = memberSnap.exists() ? { id: memberSnap.id, ...cloneRecord(memberSnap.data()) } : null;
  return {
    team,
    member,
    access: resolveTeamWorkspaceAccess({ team, member, uid: user.uid }),
  };
}

async function assertTeamWorkspaceAccess({ user, teamId, allowLocked = false, resolvedAccess = null }) {
  const resolved = resolvedAccess || await resolveTeamWorkspaceAccessFromFirestore({ user, teamId });
  if (resolved.access === 'denied') throw teamAccessError('permission-denied');
  if (resolved.access === 'locked' && !allowLocked) throw teamAccessError('team-migration-required');
  return resolved;
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

function getRecordUpdatedAt(record) {
  const v = record?.updatedAt;
  if (v && typeof v.toMillis === 'function') return v.toMillis();
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function getRecordCreatedAt(record) {
  const v = record?.createdAt;
  if (v && typeof v.toMillis === 'function') return v.toMillis();
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function isDeletedWorkspaceRecord(record) {
  return record?.deletedAt != null || record?.project?.deletedAt != null;
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

function normalizeSettingsRecord(input, ctx = {}) {
  return normalizeWorkspaceRecord({
    ...cloneRecord(input || {}),
    id: 'main',
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
    id: String(base?.id || ctx.fallbackId || '').trim(),
    accountId: String(base?.accountId || ctx.accountId || '').trim(),
  }, {
    ownerUid: ctx.ownerUid,
    now: ctx.now,
    collection: 'projects',
  });
}

function buildTeamWorkspaceSnapshotFromLocal(localState = {}, { ownerUid } = {}) {
  const now = Date.now();
  const folders = (Array.isArray(localState.folders) ? localState.folders : []).map((record) => (
    normalizeWorkspaceRecord({
      ...cloneRecord(record),
      scope: 'team',
    }, { ownerUid, now, collection: 'folders' })
  ));
  const accounts = (Array.isArray(localState.accounts) ? localState.accounts : []).map((record) => (
    normalizeWorkspaceRecord({
      ...cloneRecord(record),
      scope: 'team',
    }, { ownerUid, now, collection: 'accounts' })
  ));
  const explicitProjects = Array.isArray(localState.projects) ? localState.projects : [];
  const derivedProjects = accounts
    .filter((account) => account && account.project)
    .map((account) => normalizeProjectRecord({
      ...cloneRecord(account.project),
      scope: 'team',
      id: String(account.project?.id || account.id || '').trim(),
      accountId: account.id,
    }, {
      ownerUid,
      now,
      fallbackId: account.id,
      accountId: account.id,
    }));
  const projects = mergeRecordLists(
    explicitProjects.map((record) => normalizeProjectRecord({
      ...cloneRecord(record),
      scope: 'team',
    }, { ownerUid, now, fallbackId: record?.id })),
    derivedProjects,
  );
  const templates = (Array.isArray(localState.templates) ? localState.templates : []).map((record) => (
    normalizeWorkspaceRecord({
      ...cloneRecord(record),
      scope: 'team',
    }, { ownerUid, now, collection: 'templates' })
  ));
  const rawSettings = localState.settings && typeof localState.settings === 'object'
    ? localState.settings
    : (localState.meta && typeof localState.meta === 'object' ? localState.meta : {});
  const settings = normalizeSettingsRecord({
    ...cloneRecord(rawSettings),
    scope: 'team',
    id: String(rawSettings?.id || 'main').trim() || 'main',
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

function hydrateWorkspaceSnapshot(snapshot = {}) {
  const ownerUid = String(snapshot.ownerUid || '').trim();
  const folders = Array.isArray(snapshot.folders) ? snapshot.folders.map((r) => cloneRecord(r)) : [];
  const explicitProjects = Array.isArray(snapshot.projects) ? snapshot.projects.map((r) => cloneRecord(r)) : [];
  const accounts = Array.isArray(snapshot.accounts) ? snapshot.accounts.map((r) => cloneRecord(r)) : [];
  const templates = Array.isArray(snapshot.templates) ? snapshot.templates.map((r) => cloneRecord(r)) : [];
  const settings = getWorkspaceSettings(snapshot) ? cloneRecord(getWorkspaceSettings(snapshot)) : null;

  const projectMap = new Map();
  for (const project of explicitProjects) {
    if (!project || project.id == null) continue;
    projectMap.set(String(project.accountId || project.id), project);
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
      deletedAt: isDeletedWorkspaceRecord(account) ? (account.project?.deletedAt || account.deletedAt) : null,
      deletedBy: isDeletedWorkspaceRecord(account) ? (account.project?.deletedBy || account.deletedBy || '') : null,
      id: String(account.project?.id || account.id || '').trim(),
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

export function mergeTeamWorkspaceSnapshot(localState = {}, cloudState = {}) {
  const localSettings = getWorkspaceSettings(localState);
  const cloudSettings = getWorkspaceSettings(cloudState);
  const settings = localSettings || cloudSettings
    ? mergeRecordLists(
        localSettings ? [normalizeSettingsRecord(localSettings, { ownerUid: localState.ownerUid })] : [],
        cloudSettings ? [normalizeSettingsRecord(cloudSettings, { ownerUid: cloudState.ownerUid })] : [],
      )[0] || null
    : null;

  return hydrateWorkspaceSnapshot({
    ownerUid: String(localState.ownerUid || cloudState.ownerUid || '').trim(),
    folders: mergeRecordLists(Array.isArray(localState.folders) ? localState.folders : [], Array.isArray(cloudState.folders) ? cloudState.folders : []),
    accounts: mergeRecordLists(Array.isArray(localState.accounts) ? localState.accounts : [], Array.isArray(cloudState.accounts) ? cloudState.accounts : []),
    projects: mergeRecordLists(Array.isArray(localState.projects) ? localState.projects : [], Array.isArray(cloudState.projects) ? cloudState.projects : []),
    templates: mergeRecordLists(Array.isArray(localState.templates) ? localState.templates : [], Array.isArray(cloudState.templates) ? cloudState.templates : []),
    settings,
  });
}

function loadCollectionSnapshot(db, teamId, collectionName) {
  return getDocs(teamCollectionRef(db, teamId, collectionName)).then((snap) => {
    const records = snap.docs.map((d) => normalizeWorkspaceRecord({
      id: d.id,
      ...cloneRecord(d.data()),
    }, {
      ownerUid: teamId,
      collection: collectionName,
    }));
    records.sort((a, b) => {
      const delta = getRecordUpdatedAt(b) - getRecordUpdatedAt(a);
      if (delta !== 0) return delta;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
    return records;
  });
}

function countWorkspaceDocs(snapshot = {}) {
  const folders = Array.isArray(snapshot.folders) ? snapshot.folders.length : 0;
  const accounts = Array.isArray(snapshot.accounts) ? snapshot.accounts.length : 0;
  const projects = Array.isArray(snapshot.projects) ? snapshot.projects.length : 0;
  const templates = Array.isArray(snapshot.templates) ? snapshot.templates.length : 0;
  const settings = snapshot.settings ? 1 : 0;
  return folders + accounts + projects + templates + settings;
}

function getTeamFinancialAccess(resolved, uid) {
  const isAdmin = resolved?.access === 'admin';
  const visibility = String(resolved?.team?.settings?.rewardVisibility || 'self');
  return {
    isAdmin,
    readTotals: isAdmin || visibility === 'self_plus_total' || visibility === 'all',
    readAllShares: isAdmin || visibility === 'all',
    uid: String(uid || '').trim(),
  };
}

async function loadFinancialSnapshot(db, teamId, resolved, uid) {
  const access = getTeamFinancialAccess(resolved, uid);
  const empty = Promise.resolve([]);
  const readRows = (ref) => getDocs(ref).then((snap) => snap.docs.map((row) => ({ id: row.id, ...cloneRecord(row.data()) })));
  const totals = access.readTotals ? readRows(teamCollectionRef(db, teamId, 'projectRewardTotals')) : empty;
  const sharesRef = access.readAllShares
    ? teamCollectionRef(db, teamId, 'projectRewardShares')
    : query(teamCollectionRef(db, teamId, 'projectRewardShares'), where('memberUid', '==', access.uid));
  const shares = access.uid ? readRows(sharesRef) : empty;
  const costs = access.isAdmin ? readRows(teamCollectionRef(db, teamId, 'projectCosts')) : empty;
  const [rewardTotals, rewardShares, projectCosts] = await Promise.all([totals, shares, costs]);
  return { rewardTotals, rewardShares, projectCosts };
}

function attachFinancialSnapshot(snapshot, financials) {
  const totals = new Map((financials.rewardTotals || []).map((row) => [String(row.projectId || row.id), row]));
  const costs = new Map((financials.projectCosts || []).map((row) => [String(row.projectId || row.id), row]));
  const shares = new Map();
  for (const row of financials.rewardShares || []) {
    const key = String(row.projectId || '');
    if (!key) continue;
    const list = shares.get(key) || [];
    list.push({
      uid: String(row.memberUid || ''),
      memberUid: String(row.memberUid || ''),
      amountYen: Number(row.amountYen || 0) || 0,
      assigned: !!row.assigned,
    });
    shares.set(key, list);
  }
  const enrich = (project) => {
    if (!project?.id) return project;
    const id = String(project.id);
    const total = totals.get(id);
    const cost = costs.get(id);
    return {
      ...project,
      ...(total ? { rewardYen: Number(total.totalYen || 0) || 0 } : {}),
      rewardAllocations: shares.get(id) || [],
      ...(cost ? { costYen: Number(cost.costYen || 0) || 0, expenses: cloneRecord(cost.expenses || []) } : {}),
    };
  };
  snapshot.projects = (snapshot.projects || []).map(enrich);
  snapshot.accounts = (snapshot.accounts || []).map((account) => account?.project
    ? { ...account, project: enrich(account.project) }
    : account);
  return snapshot;
}

export async function loadTeamWorkspaceFromFirestore({ user, teamId, resolvedAccess = null }) {
  const resolved = await assertTeamWorkspaceAccess({ user, teamId, resolvedAccess });
  const targetTeamId = String(teamId || '').trim();
  if (!targetTeamId) throw new Error('team-id-required');
  const { db } = await getFirebaseCore();
  const [folders, accounts, projects, templates, settingsSnap, financials] = await Promise.all([
    loadCollectionSnapshot(db, targetTeamId, 'folders'),
    loadCollectionSnapshot(db, targetTeamId, 'accounts'),
    loadCollectionSnapshot(db, targetTeamId, 'projects'),
    loadCollectionSnapshot(db, targetTeamId, 'templates'),
    getDoc(teamSettingsRef(db, targetTeamId)),
    loadFinancialSnapshot(db, targetTeamId, resolved, user.uid),
  ]);

  const settings = settingsSnap.exists()
    ? normalizeSettingsRecord({
        id: 'main',
        ...stripSyncMeta(settingsSnap.data()),
      }, { ownerUid: targetTeamId, now: Date.now() })
    : null;

  const snapshot = attachFinancialSnapshot(hydrateWorkspaceSnapshot({
    ownerUid: targetTeamId,
    folders,
    accounts,
    projects,
    templates,
    settings,
  }), financials);

  return {
    snapshot,
    recordCount: countWorkspaceDocs(snapshot) + (settingsSnap.exists() && !snapshot.settings ? 1 : 0),
    settingsExists: settingsSnap.exists(),
  };
}

export async function writeTeamWorkspaceToFirestore({ user, teamId, snapshot, activityEvents = [], resolvedAccess = null, operationId = '' }) {
  requireUser(user);
  const resolved = await assertTeamWorkspaceAccess({ user, teamId, resolvedAccess });
  const targetTeamId = String(teamId || '').trim();
  if (!targetTeamId) throw new Error('team-id-required');
  const { db } = await getFirebaseCore();
  const now = Date.now();
  const workspace = hydrateWorkspaceSnapshot({
    ...cloneRecord(snapshot || {}),
    ownerUid: targetTeamId,
  });

  const isReady = Number(resolved?.team?.securitySchemaVersion || 0) === 2
    && resolved?.team?.securityMigrationState === 'ready';

  // Locked teams are admin-only and remain on the legacy shape until the explicit
  // migration tool has backed them up and verified the V2 projection.
  if (!isReady) {
    if (resolved.access !== 'admin') throw teamAccessError('team-migration-required');
    const legacyBatch = writeBatch(db);
    const writeLegacyCollection = (name, records = []) => {
      for (const record of records) {
        if (!record?.id) continue;
        legacyBatch.set(doc(db, 'teams', targetTeamId, name, String(record.id)), {
          ...cloneRecord(record),
          ownerUid: targetTeamId,
          collection: name,
          updatedAt: getRecordUpdatedAt(record) || now,
          updatedBy: user.uid,
        });
      }
    };
    writeLegacyCollection('folders', workspace.folders);
    writeLegacyCollection('accounts', workspace.accounts);
    writeLegacyCollection('projects', workspace.projects);
    writeLegacyCollection('templates', workspace.templates);
    legacyBatch.set(teamSettingsRef(db, targetTeamId), {
      ...stripSyncMeta(getWorkspaceSettings(workspace)),
      id: 'main', ownerUid: targetTeamId, scope: 'team', collection: 'settings',
      createdAt: getRecordCreatedAt(workspace.settings) || now,
      updatedAt: now, updatedBy: user.uid,
    }, { merge: true });
    await legacyBatch.commit();
    return workspace;
  }

  const receiptId = String(operationId || '').trim();
  if (receiptId) {
    const receipt = await getDoc(doc(db, 'teams', targetTeamId, 'operations', receiptId));
    if (receipt.exists()) return workspace;
  }

  const eventByProject = new Map();
  for (const event of Array.isArray(activityEvents) ? activityEvents : []) {
    const projectId = String(event?.projectId || '').trim();
    if (!projectId) continue;
    const rows = eventByProject.get(projectId) || [];
    rows.push(cloneRecord(event));
    eventByProject.set(projectId, rows);
  }

  const accountById = new Map(workspace.accounts.filter((row) => row?.id).map((row) => [String(row.id), row]));
  const projects = workspace.projects.filter((row) => row?.id);
  for (const sourceProject of projects) {
    const projectId = String(sourceProject.id);
    const accountId = String(sourceProject.accountId || projectId);
    const sourceAccount = accountById.get(accountId) || accountById.get(projectId) || { id: accountId };
    const existingShareDocs = resolved.access === 'admin'
      ? await getDocs(query(
          teamCollectionRef(db, targetTeamId, 'projectRewardShares'),
          where('projectId', '==', projectId),
        ))
      : { docs: [] };
    await runTransaction(db, async (transaction) => {
      const projectRef = doc(db, 'teams', targetTeamId, 'projects', projectId);
      const accountRef = doc(db, 'teams', targetTeamId, 'accounts', accountId);
      const [currentProjectSnap, currentAccountSnap] = await Promise.all([
        transaction.get(projectRef),
        transaction.get(accountRef),
      ]);
      const currentProject = currentProjectSnap.exists() ? cloneRecord(currentProjectSnap.data()) : null;
      const incomingUpdatedAt = getRecordUpdatedAt(sourceProject) || now;
      const isUndo = currentProject?.deletedAt != null
        && sourceProject.deletedAt == null
        && Number(sourceProject.undoDeletedAt || 0) === Number(currentProject.deletedAt || 0);
      if (currentProject?.deletedAt != null && !isUndo) return;
      if (currentProject && !isUndo && incomingUpdatedAt < getRecordUpdatedAt(currentProject)) return;

      const project = buildV2Project({
        teamId: targetTeamId,
        accountId,
        project: sourceProject,
        actorUid: user.uid,
        now,
      });
      project.revision = Math.max(1, Number(currentProject?.revision || 0) + 1);
      if (project.deletedAt != null) project.deletedAt = Timestamp.fromMillis(Number(project.deletedAt));
      const account = buildV2Account({ teamId: targetTeamId, account: sourceAccount, actorUid: user.uid, now });
      account.deletedAt = project.deletedAt;
      account.deletedBy = project.deletedBy;
      account.revision = Math.max(1, Number(currentAccountSnap.data()?.revision || 0) + 1);
      transaction.set(projectRef, project);
      transaction.set(accountRef, account);

      if (resolved.access === 'admin') {
        const rewardSource = sourceAccount.project || sourceProject;
        transaction.set(doc(db, 'teams', targetTeamId, 'projectRewardTotals', projectId),
          buildRewardTotal({ projectId, project: rewardSource, actorUid: user.uid, now }));
        transaction.set(doc(db, 'teams', targetTeamId, 'projectCosts', projectId),
          buildProjectCost({ projectId, project: rewardSource, actorUid: user.uid, now }));
        const nextShares = buildRewardShares({ projectId, project: rewardSource, actorUid: user.uid, now });
        const nextShareIds = new Set(nextShares.map((share) => share.id));
        for (const share of nextShares) {
          transaction.set(doc(db, 'teams', targetTeamId, 'projectRewardShares', share.id), (({ id, ...data }) => data)(share));
        }
        for (const oldShare of existingShareDocs.docs) {
          if (nextShareIds.has(oldShare.id)) continue;
          const oldData = cloneRecord(oldShare.data());
          transaction.set(oldShare.ref, {
            projectId,
            memberUid: String(oldData.memberUid || ''),
            amountYen: 0,
            assigned: false,
            createdAt: oldData.createdAt || now,
            updatedAt: now,
            updatedBy: user.uid,
          });
        }
      }

      for (const event of eventByProject.get(projectId) || []) {
        const eventId = String(event?.id || '').trim();
        const action = String(event?.action || '').trim();
        const targetName = String(event?.targetName || '案件').trim().slice(0, 120) || '案件';
        const coreText = String(event?.coreText || '').trim().slice(0, 240);
        if (!eventId || !action || !coreText) continue;
        const actorName = String(user.displayName || user.email || 'メンバー').trim().slice(0, 80) || 'メンバー';
        transaction.set(doc(db, 'teams', targetTeamId, 'activity', eventId), {
          action, actorUid: user.uid, actorName, projectId, targetName, coreText,
          identityUids: deriveActivityIdentityUids({ actorUid: user.uid }),
          text: `${actorName}さんが${coreText}`,
          createdAt: serverTimestamp(),
        });
      }
    });
  }

  const projectedWrites = [];
  for (const record of workspace.folders) {
    if (record?.id) projectedWrites.push([
      doc(db, 'teams', targetTeamId, 'folders', String(record.id)),
      buildV2Folder({ teamId: targetTeamId, folder: record, actorUid: user.uid, now }),
    ]);
  }
  for (const record of workspace.templates) {
    if (record?.id) projectedWrites.push([
      doc(db, 'teams', targetTeamId, 'templates', String(record.id)),
      buildV2Template({ teamId: targetTeamId, template: record, actorUid: user.uid, now }),
    ]);
  }
  const projectAccountIds = new Set(projects.map((row) => String(row.accountId || row.id)));
  for (const record of workspace.accounts) {
    if (record?.id && !projectAccountIds.has(String(record.id))) {
      projectedWrites.push([
        doc(db, 'teams', targetTeamId, 'accounts', String(record.id)),
        buildV2Account({ teamId: targetTeamId, account: record, actorUid: user.uid, now }),
      ]);
    }
  }
  projectedWrites.push([teamSettingsRef(db, targetTeamId), buildV2Settings({
    teamId: targetTeamId,
    settings: getWorkspaceSettings(workspace) || {},
    actorUid: user.uid,
    now,
  })]);
  for (let start = 0; start < projectedWrites.length; start += 400) {
    const chunk = projectedWrites.slice(start, start + 400);
    await runTransaction(db, async (transaction) => {
      const currentRows = [];
      for (const [ref, data] of chunk) {
        currentRows.push({ ref, data, current: await transaction.get(ref) });
      }
      for (const { ref, data, current } of currentRows) {
        if (!current.exists()) {
          transaction.set(ref, { ...data, revision: 1 });
          continue;
        }
        const previous = cloneRecord(current.data());
        if (getRecordUpdatedAt(data) < getRecordUpdatedAt(previous)) continue;
        transaction.set(ref, {
          ...data,
          revision: Math.max(1, Number(previous.revision || 0) + 1),
        });
      }
    });
  }
  if (receiptId) {
    await setDoc(doc(db, 'teams', targetTeamId, 'operations', receiptId), {
      operationId: receiptId,
      actorUid: user.uid,
      createdAt: serverTimestamp(),
    });
  }
  return workspace;
}

const teamWorkspaceQueues = new Map();
const fallbackQueueStorage = createMemoryStorage();

function mutationStorage() {
  try { return globalThis.localStorage || fallbackQueueStorage; } catch { return fallbackQueueStorage; }
}

export function queueTeamWorkspaceWrite({ user, teamId, snapshot, activityEvents = [] }) {
  if (!user?.uid || !teamId) return Promise.resolve(null);
  const targetTeamId = String(teamId || '').trim();
  const payload = hydrateWorkspaceSnapshot({
    ...cloneRecord(snapshot || {}),
    ownerUid: targetTeamId,
  });
  const persistentQueue = createTeamMutationQueue({ storage: mutationStorage(), uid: user.uid });
  const existing = persistentQueue.list().find((row) => row.teamId === targetTeamId);
  const pendingEvents = new Map();
  for (const event of existing?.activityEvents || []) {
    if (event?.id) pendingEvents.set(String(event.id), cloneRecord(event));
  }
  for (const event of activityEvents || []) {
    if (event?.id) pendingEvents.set(String(event.id), cloneRecord(event));
  }
  const operation = {
    operationId: `${targetTeamId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    teamId: targetTeamId,
    actorUid: user.uid,
    createdAt: Date.now(),
    snapshot: payload,
    activityEvents: [...pendingEvents.values()],
  };
  const remaining = persistentQueue.list().filter((row) => row.teamId !== targetTeamId);
  persistentQueue.replace([...remaining, operation]);
  const previous = teamWorkspaceQueues.get(targetTeamId) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      const latest = persistentQueue.list().find((row) => row.teamId === targetTeamId);
      if (!latest) return null;
      if (latest.actorUid !== user.uid) throw teamAccessError('actor-mismatch');
      const result = await writeTeamWorkspaceToFirestore({
        user,
        teamId: targetTeamId,
        snapshot: latest.snapshot,
        activityEvents: latest.activityEvents,
        operationId: latest.operationId,
      });
      persistentQueue.remove(latest.operationId);
      return result;
    });
  let tracked = null;
  tracked = next.finally(() => {
    if (teamWorkspaceQueues.get(targetTeamId) === tracked) {
      teamWorkspaceQueues.delete(targetTeamId);
    }
  });
  teamWorkspaceQueues.set(targetTeamId, tracked);
  return next;
}

async function replayTeamWorkspaceWrite({ user, teamId, resolvedAccess }) {
  const persistentQueue = createTeamMutationQueue({ storage: mutationStorage(), uid: user.uid });
  const pending = persistentQueue.list().find((row) => row.teamId === teamId);
  if (!pending) return null;
  const result = await writeTeamWorkspaceToFirestore({
    user,
    teamId,
    snapshot: pending.snapshot,
    activityEvents: pending.activityEvents,
    operationId: pending.operationId,
    resolvedAccess,
  });
  persistentQueue.remove(pending.operationId);
  return result;
}

export async function bootstrapTeamWorkspace({ user, teamId, localState }) {
  requireUser(user);
  const targetTeamId = String(teamId || '').trim();
  if (!targetTeamId) throw new Error('team-id-required');
  const resolvedAccess = await assertTeamWorkspaceAccess({ user, teamId: targetTeamId });
  try {
    await replayTeamWorkspaceWrite({ user, teamId: targetTeamId, resolvedAccess });
  } catch (error) {
    console.warn('[team-workspace] queued write replay failed', {
      teamId: targetTeamId,
      code: String(error?.code || ''),
      message: String(error?.message || error || ''),
    });
    throw error;
  }
  let cloud;
  try {
    cloud = await loadTeamWorkspaceFromFirestore({ user, teamId: targetTeamId, resolvedAccess });
  } catch (error) {
    console.warn('[team-workspace] cloud load failed', {
      teamId: targetTeamId,
      code: String(error?.code || ''),
      message: String(error?.message || error || ''),
    });
    throw error;
  }
  if (shouldMigrateLocalWorkspace({
    cloudDocCount: cloud.recordCount,
    localRecordCount: countLocalRecords(localState),
  })) {
    const migrated = buildTeamWorkspaceSnapshotFromLocal(localState, { ownerUid: targetTeamId });
    await writeTeamWorkspaceToFirestore({ user, teamId: targetTeamId, snapshot: migrated, resolvedAccess });
    return migrated;
  }
  return cloud.snapshot;
}

export async function subscribeTeamWorkspace({ user, teamId, onChange }) {
  const targetTeamId = String(teamId || '').trim();
  if (!targetTeamId || typeof onChange !== 'function') return () => {};
  const resolvedAccess = await assertTeamWorkspaceAccess({
    user,
    teamId: targetTeamId,
    allowLocked: true,
  });
  if (resolvedAccess.access === 'locked') {
    onChange({ access: 'locked', snapshot: null });
    return () => {};
  }
  const { db } = await getFirebaseCore();
  let disposed = false;
  let chain = Promise.resolve();
  const refresh = () => {
    chain = chain.then(async () => {
      if (disposed) return;
      try {
        const currentAccess = await resolveTeamWorkspaceAccessFromFirestore({
          user,
          teamId: targetTeamId,
        });
        if (currentAccess.access === 'locked' || currentAccess.access === 'denied') {
          if (!disposed) onChange({ access: currentAccess.access, snapshot: null });
          return;
        }
        const loaded = await loadTeamWorkspaceFromFirestore({
          user,
          teamId: targetTeamId,
          resolvedAccess: currentAccess,
        });
        if (!disposed) onChange({ access: currentAccess.access, snapshot: loaded.snapshot });
      } catch (error) {
        console.warn('[team-workspace] subscribe reload failed', error);
        if (disposed) return;
        if (isPermissionDeniedError(error)) {
          onChange({ access: 'denied', snapshot: null, error });
          return;
        }
        onChange({ access: resolvedAccess.access, error });
      }
    }).catch(() => {});
  };
  const unsubs = [
    onSnapshot(teamRef(db, targetTeamId), refresh, refresh),
    onSnapshot(teamCollectionRef(db, targetTeamId, 'folders'), refresh, refresh),
    onSnapshot(teamCollectionRef(db, targetTeamId, 'accounts'), refresh, refresh),
    onSnapshot(teamCollectionRef(db, targetTeamId, 'projects'), refresh, refresh),
    onSnapshot(teamCollectionRef(db, targetTeamId, 'templates'), refresh, refresh),
    onSnapshot(teamSettingsRef(db, targetTeamId), refresh, refresh),
  ];
  const financialAccess = getTeamFinancialAccess(resolvedAccess, user.uid);
  if (financialAccess.readTotals) {
    unsubs.push(onSnapshot(teamCollectionRef(db, targetTeamId, 'projectRewardTotals'), refresh, refresh));
  }
  const rewardSharesRef = financialAccess.readAllShares
    ? teamCollectionRef(db, targetTeamId, 'projectRewardShares')
    : query(teamCollectionRef(db, targetTeamId, 'projectRewardShares'), where('memberUid', '==', user.uid));
  unsubs.push(onSnapshot(rewardSharesRef, refresh, refresh));
  if (financialAccess.isAdmin) {
    unsubs.push(onSnapshot(teamCollectionRef(db, targetTeamId, 'projectCosts'), refresh, refresh));
  }
  refresh();
  return () => {
    disposed = true;
    for (const unsub of unsubs) {
      try { unsub(); } catch {}
    }
  };
}
