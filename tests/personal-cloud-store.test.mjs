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
