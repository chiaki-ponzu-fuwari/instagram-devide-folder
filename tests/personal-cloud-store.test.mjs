import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import {
  buildWorkspaceSnapshotFromLocal,
  countLocalRecords,
  mergeWorkspaceSnapshot,
  normalizeWorkspaceRecord,
  shouldMigrateLocalWorkspace,
  getSyncStatus,
  subscribeSyncStatus,
  hasPendingWrites,
  loadPendingWorkspace,
  savePendingWorkspace,
  clearPendingWorkspace,
} from '../www/js/personal-cloud-store.mjs';

const storeSource = readFileSync(new URL('../www/js/personal-cloud-store.mjs', import.meta.url), 'utf8');
const htmlSource = readFileSync(new URL('../www/index.html', import.meta.url), 'utf8');

const html = readFileSync(new URL('../www/index.html', import.meta.url), 'utf8');

function sliceFunction(name, nextName) {
  const pattern = new RegExp(`function\\s+${name}\\s*\\(`);
  const match = pattern.exec(html);
  const start = match ? match.index : -1;
  assert.notEqual(start, -1, `${name} should exist`);
  const end = nextName ? html.indexOf(`function ${nextName}`, start + 1) : html.length;
  assert.notEqual(end, -1, `${nextName} should exist after ${name}`);
  return html.slice(start, end);
}

test('normalizeWorkspaceRecord stamps ownership and timestamps', () => {
  const rec = normalizeWorkspaceRecord({
    id: 'a1',
    name: 'Folder A',
  }, { ownerUid: 'u1', now: 1778572800000, collection: 'folders' });
  assert.equal(rec.id, 'a1');
  assert.equal(rec.ownerUid, 'u1');
  assert.equal(rec.collection, 'folders');
  assert.equal(rec.updatedAt, 1778572800000);
});

test('mergeWorkspaceSnapshot keeps the newest record by updatedAt and server wins on tie', () => {
  const merged = mergeWorkspaceSnapshot(
    {
      folders: [{ id: 'f1', name: 'Local', updatedAt: 10 }],
      accounts: [{ id: 'a1', username: '@local', updatedAt: 5 }],
      templates: [],
      settings: { includeTeamShareInAnalysis: false },
    },
    {
      folders: [{ id: 'f1', name: 'Cloud', updatedAt: 20 }],
      accounts: [{ id: 'a1', username: '@cloud', updatedAt: 5 }],
      templates: [],
      settings: { includeTeamShareInAnalysis: true },
    }
  );
  assert.equal(merged.folders[0].name, 'Cloud');
  assert.equal(merged.accounts[0].username, '@cloud');
  assert.equal(merged.settings.includeTeamShareInAnalysis, true);
});

test('shouldMigrateLocalWorkspace returns true only when cloud is empty', () => {
  assert.equal(shouldMigrateLocalWorkspace({ cloudDocCount: 0, localRecordCount: 3 }), true);
  assert.equal(shouldMigrateLocalWorkspace({ cloudDocCount: 2, localRecordCount: 3 }), false);
});

test('countLocalRecords counts folders, accounts, derived projects, templates, and settings', () => {
  assert.equal(countLocalRecords({
    folders: [{ id: 'f1' }],
    accounts: [{ id: 'a1', project: { status: '相談中' } }],
    templates: [{ id: 't1' }],
    meta: { theme: 'dark' },
  }), 5);
});

test('buildWorkspaceSnapshotFromLocal creates per-record docs and keeps account projects', () => {
  const snapshot = buildWorkspaceSnapshotFromLocal({
    folders: [{ id: 'f1', name: 'Folder A' }],
    accounts: [{ id: 'a1', username: '@a1', project: { name: 'Project A', status: '相談中' } }],
    templates: [{ id: 't1', title: 'Template A' }],
    meta: { includeTeamShareInAnalysis: false },
  }, { ownerUid: 'u1' });

  assert.equal(snapshot.folders[0].ownerUid, 'u1');
  assert.equal(snapshot.accounts[0].ownerUid, 'u1');
  assert.equal(snapshot.accounts[0].project.name, 'Project A');
  assert.equal(snapshot.projects[0].id, 'a1');
  assert.equal(snapshot.projects[0].accountId, 'a1');
  assert.equal(snapshot.projects[0].ownerUid, 'u1');
  assert.equal(snapshot.settings.id, 'main');
  assert.equal(snapshot.settings.ownerUid, 'u1');
  assert.equal(snapshot.settings.collection, 'settings');
  assert.equal(snapshot.settings.scope, 'personal');
  assert.equal(snapshot.accounts[0].updatedBy, 'u1');
});

test('getSyncStatus returns a snapshot with default fields', () => {
  const status = getSyncStatus();
  assert.equal(typeof status, 'object');
  assert.equal(typeof status.lastSyncedAt, 'number');
  assert.equal(typeof status.pendingCount, 'number');
  assert.equal(typeof status.inFlight, 'boolean');
  assert.equal(typeof status.online, 'boolean');
  assert.ok(Object.prototype.hasOwnProperty.call(status, 'lastError'));
});

test('subscribeSyncStatus fires immediately with current snapshot and returns an unsubscribe function', () => {
  let received = null;
  const unsub = subscribeSyncStatus((status) => { received = status; });
  assert.ok(received, 'callback should fire immediately');
  assert.equal(typeof received.pendingCount, 'number');
  assert.equal(typeof unsub, 'function');
  unsub();
});

test('hasPendingWrites returns false when no writes are queued', () => {
  assert.equal(hasPendingWrites(), false);
  assert.equal(hasPendingWrites('u-test'), false);
});

test('pending personal cloud data is scoped to the signed-in user and clears only that user', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const snapshot = { folders: [{ id: 'f1', name: 'only user one' }], accounts: [], projects: [], templates: [], settings: null };

  savePendingWorkspace('user-one', snapshot, { storage });
  assert.deepEqual(loadPendingWorkspace('user-one', { storage }), snapshot);
  assert.equal(loadPendingWorkspace('user-two', { storage }), null);
  clearPendingWorkspace('user-two', { storage });
  assert.deepEqual(loadPendingWorkspace('user-one', { storage }), snapshot);
  clearPendingWorkspace('user-one', { storage });
  assert.equal(loadPendingWorkspace('user-one', { storage }), null);
});

test('cloud write queue durably saves pending work before upload and clears it only after success', () => {
  const queue = storeSource.match(/export function queuePersonalCloudWrite\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(queue, /savePendingWorkspace\(uid, payload\)/);
  assert.match(queue, /await retryPersonalCloudWrite/);
  assert.match(queue, /clearPendingWorkspace\(uid\)/);
  assert.ok(
    queue.indexOf('savePendingWorkspace(uid, payload)') < queue.indexOf('await retryPersonalCloudWrite'),
    'pending data must be persisted before the network upload',
  );
  assert.ok(
    queue.indexOf('await retryPersonalCloudWrite') < queue.indexOf('clearPendingWorkspace(uid)'),
    'pending data must remain until the upload succeeds',
  );
});

test('a failed cloud write remains queued for the next online retry', () => {
  const queue = storeSource.match(/export function queuePersonalCloudWrite\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(queue, /const durablePendingWorkspace = loadPendingWorkspace\(uid\)/);
  assert.match(queue, /personalCloudPendingPayloads\.set\(uid, \{ user, snapshot: durablePendingWorkspace \}\)/);
});

test('personal bootstrap restores only the current user pending snapshot before cloud merge', () => {
  const bootstrap = storeSource.match(/export async function bootstrapPersonalWorkspace\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(bootstrap, /loadPendingWorkspace\(user\.uid\)/);
  assert.match(bootstrap, /mergeWorkspaceSnapshot\(/);
  assert.match(
    bootstrap,
    /if \(pendingWorkspace\) \{\s*queuePersonalCloudWrite\(user, mergedWorkspace\);/,
    'a recovered pending snapshot must be queued again after an app restart',
  );
  assert.ok(
    bootstrap.indexOf('loadPendingWorkspace(user.uid)') < bootstrap.indexOf('loadWorkspaceFromFirestore'),
    'durable same-user work must be recovered before comparing with cloud data',
  );
});

test('sign-in sync loads a UID-scoped local workspace and saves it after cloud bootstrap', () => {
  const sync = sliceFunction('syncPersonalWorkspaceForUser', 'applyBackupJSON');
  assert.match(sync, /loadPersonalWorkspaceCache\(user\.uid\)/);
  assert.match(sync, /savePersonalWorkspaceCache\(user\.uid, bootstrapped\)/);
  assert.ok(
    sync.indexOf('loadPersonalWorkspaceCache(user.uid)') < sync.indexOf('bootstrapPersonalWorkspace'),
    'a previously signed-in user must restore only their own local mirror',
  );
});

test('logout cancels stale cloud sync and clears the displayed signed-in workspace without erasing its UID cache', () => {
  const sync = sliceFunction('syncPersonalWorkspaceForUser', 'applyBackupJSON');
  const signOut = htmlSource.match(/const signOutCurrent = async \(\) => \{([\s\S]*?)\n  \};\n  if \(loginRow\)/)?.[1] || '';
  assert.match(sync, /personalCloudSyncToken \+= 1/);
  assert.match(sync, /resetPersonalWorkspaceAfterSignOut\(/);
  assert.match(signOut, /savePersonalWorkspaceCache\(currentUid, getWorkspaceSnapshot\(\)\)/);
  assert.ok(signOut.indexOf('savePersonalWorkspaceCache(currentUid, getWorkspaceSnapshot())') < signOut.indexOf('signOutCurrentUser'));
});

test('personal autosave waits until cloud restore finished for the signed-in user', () => {
  const saveFn = sliceFunction('save', 'uid');

  assert.match(saveFn, /personalCloudSyncedUserUid/);
  assert.match(saveFn, /currentUser\.uid !== personalCloudSyncedUserUid/);
  assert.match(saveFn, /return;/);
  assert.ok(
    saveFn.indexOf('currentUser.uid !== personalCloudSyncedUserUid') <
      saveFn.indexOf('queuePersonalCloudWrite'),
    'autosave guard should run before queuePersonalCloudWrite',
  );
  assert.match(saveFn, /savePersonalWorkspaceCache\(currentUser\.uid, workspace\)/);
});

test('mergeWorkspaceSnapshot hydrates account.project from cloud project docs', () => {
  const merged = mergeWorkspaceSnapshot(
    {
      folders: [],
      accounts: [{ id: 'a1', username: '@local', updatedAt: 10 }],
      projects: [],
      templates: [],
      settings: null,
    },
    {
      folders: [],
      accounts: [{ id: 'a1', username: '@cloud', updatedAt: 20 }],
      projects: [{ id: 'a1', accountId: 'a1', name: 'Cloud Project', updatedAt: 20 }],
      templates: [],
      settings: null,
    },
  );

  assert.equal(merged.accounts[0].username, '@cloud');
  assert.equal(merged.accounts[0].project.name, 'Cloud Project');
  assert.equal(merged.projects[0].accountId, 'a1');
});

test('mergeWorkspaceSnapshot never revives an orphan project after its account was deleted', () => {
  const merged = mergeWorkspaceSnapshot(
    {
      folders: [{ id: 'f1', name: 'Folder' }],
      accounts: [{ id: 'a1', username: '@kept', folderId: 'f1', updatedAt: 20 }],
      projects: [],
      templates: [],
      settings: null,
    },
    {
      folders: [],
      accounts: [],
      projects: [
        { id: 'p1', accountId: 'a1', name: 'Existing Project', updatedAt: 20 },
        { id: 'p2', accountId: 'a2', name: 'Recovered Project', status: '契約中', updatedAt: 30 },
      ],
      templates: [],
      settings: null,
    },
  );

  assert.equal(merged.accounts.length, 1);
  assert.equal(merged.accounts.find((row) => row.id === 'a1').username, '@kept');
  assert.equal(merged.accounts.find((row) => row.id === 'a2'), undefined);
  assert.equal(merged.projects.find((row) => row.accountId === 'a2').status, '契約中');
});

test('personal cloud writes preserve tombstones and never delete records missing from a stale snapshot', () => {
  const write = storeSource.match(/export async function writeWorkspaceToFirestore[\s\S]*?\n\}/)?.[0] || '';
  assert.match(write, /runTransaction/);
  assert.match(write, /revision/);
  assert.doesNotMatch(write, /batch\.delete|deleteDoc/);
});

test('personal account folder and template deletion queue tombstones before hiding records', () => {
  const accountDelete = htmlSource.match(/function doDeleteAcc\(aid\) \{([\s\S]*?)\n\}\nfunction doToggleNewDM/)?.[1] || '';
  const folderDelete = htmlSource.match(/function doDeleteFolder\(fid\) \{([\s\S]*?)\n\}\n\n\/\/ =+\n\/\/ ACCOUNT CRUD/)?.[1] || '';
  const templateDelete = htmlSource.match(/function renderTemplateList\([\s\S]*?\n\}\n\nfunction renderTeamTemplatesPage/)?.[0] || '';
  assert.match(accountDelete, /personalCloudSyncedUserUid/);
  assert.match(accountDelete, /deletedAt/);
  assert.match(folderDelete, /personalCloudSyncedUserUid/);
  assert.match(templateDelete, /personalCloudSyncedUserUid/);
});
