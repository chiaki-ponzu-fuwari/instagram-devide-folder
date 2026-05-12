function cleanString(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function cloneRecord(value) {
  if (value == null) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function getRecordId(record, fallback = '') {
  return cleanString(record?.id, fallback);
}

function getRecordUpdatedAt(record) {
  return toNumber(record?.updatedAt, 0);
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

    const localUpdatedAt = getRecordUpdatedAt(existing);
    const cloudUpdatedAt = getRecordUpdatedAt(record);
    if (cloudUpdatedAt >= localUpdatedAt) {
      merged.set(key, cloneRecord(record));
    }
  }

  return [...merged.values()];
}

function normalizeSettingsRecord(input, ctx = {}) {
  const base = cloneRecord(input || {});
  const now = toNumber(ctx.now, Date.now());
  const ownerUid = cleanString(ctx.ownerUid);
  return normalizeWorkspaceRecord({
    ...base,
    id: getRecordId(base, 'main'),
  }, { ownerUid, now, collection: 'settings' });
}

function normalizeProjectRecord(input, ctx = {}) {
  const base = cloneRecord(input || {});
  const now = toNumber(ctx.now, Date.now());
  const ownerUid = cleanString(ctx.ownerUid);
  return normalizeWorkspaceRecord({
    ...base,
    id: getRecordId(base, cleanString(ctx.fallbackId)),
    accountId: cleanString(base.accountId, cleanString(ctx.accountId)),
  }, { ownerUid, now, collection: 'projects' });
}

export function normalizeWorkspaceRecord(input, { ownerUid, now, collection } = {}) {
  const base = cloneRecord(input || {});
  const stamp = toNumber(now, Date.now());
  const id = getRecordId(base, collection === 'settings' ? 'main' : '');
  return {
    ...base,
    id,
    ownerUid: cleanString(base.ownerUid, cleanString(ownerUid)),
    collection: cleanString(base.collection, cleanString(collection)),
    createdAt: toNumber(base.createdAt, stamp),
    updatedAt: toNumber(base.updatedAt, stamp),
  };
}

export function mergeWorkspaceSnapshot(localState = {}, cloudState = {}) {
  const localFolders = Array.isArray(localState.folders) ? localState.folders : [];
  const cloudFolders = Array.isArray(cloudState.folders) ? cloudState.folders : [];
  const localAccounts = Array.isArray(localState.accounts) ? localState.accounts : [];
  const cloudAccounts = Array.isArray(cloudState.accounts) ? cloudState.accounts : [];
  const localProjects = Array.isArray(localState.projects) ? localState.projects : [];
  const cloudProjects = Array.isArray(cloudState.projects) ? cloudState.projects : [];
  const localTemplates = Array.isArray(localState.templates) ? localState.templates : [];
  const cloudTemplates = Array.isArray(cloudState.templates) ? cloudState.templates : [];

  const localSettings = localState.settings && typeof localState.settings === 'object'
    ? localState.settings
    : (localState.meta && typeof localState.meta === 'object' ? localState.meta : null);
  const cloudSettings = cloudState.settings && typeof cloudState.settings === 'object'
    ? cloudState.settings
    : (cloudState.meta && typeof cloudState.meta === 'object' ? cloudState.meta : null);

  const settings = localSettings || cloudSettings
    ? mergeRecordLists(
        localSettings ? [normalizeSettingsRecord(localSettings, { ownerUid: localState.ownerUid })] : [],
        cloudSettings ? [normalizeSettingsRecord(cloudSettings, { ownerUid: cloudState.ownerUid })] : [],
      )[0] || null
    : null;

  return {
    folders: mergeRecordLists(localFolders, cloudFolders),
    accounts: mergeRecordLists(localAccounts, cloudAccounts),
    projects: mergeRecordLists(localProjects, cloudProjects),
    templates: mergeRecordLists(localTemplates, cloudTemplates),
    settings: settings ? { ...settings } : null,
  };
}

export function shouldMigrateLocalWorkspace({ cloudDocCount, localRecordCount }) {
  return cloudDocCount === 0 && localRecordCount > 0;
}

export function countLocalRecords(localState = {}) {
  const folders = Array.isArray(localState.folders) ? localState.folders.length : 0;
  const accounts = Array.isArray(localState.accounts) ? localState.accounts.length : 0;
  const projectsArray = Array.isArray(localState.projects) ? localState.projects : null;
  const derivedProjects = projectsArray
    ? projectsArray.length
    : (Array.isArray(localState.accounts) ? localState.accounts.filter((account) => account && account.project).length : 0);
  const templates = Array.isArray(localState.templates) ? localState.templates.length : 0;
  const settings = localState.settings || localState.meta ? 1 : 0;
  return folders + accounts + derivedProjects + templates + settings;
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

  return {
    folders,
    accounts,
    projects,
    templates,
    settings,
  };
}
