import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWorkspaceSnapshotFromLocal,
  countLocalRecords,
  mergeWorkspaceSnapshot,
  normalizeWorkspaceRecord,
  shouldMigrateLocalWorkspace,
} from '../www/js/personal-cloud-store.mjs';

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
});
