import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const store = readFileSync(new URL('../www/js/team-workspace-store.mjs', import.meta.url), 'utf8');
const html = readFileSync(new URL('../www/index.html', import.meta.url), 'utf8');

function sliceFunction(source, name, nextName) {
  const pattern = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = pattern.exec(source);
  const start = match ? match.index : -1;
  assert.notEqual(start, -1, `${name} should exist`);
  const end = nextName ? source.indexOf(`function ${nextName}`, start + 1) : source.length;
  assert.notEqual(end, -1, `${nextName} should exist after ${name}`);
  return source.slice(start, end);
}

test('team workspace writes avoid deletes so member-shared saves are not rejected by rules', () => {
  const writer = sliceFunction(store, 'writeTeamWorkspaceToFirestore', 'queueTeamWorkspaceWrite');

  assert.doesNotMatch(writer, /batch\.delete\(/);
  assert.match(writer, /transaction\.set\(/);
});

test('ready team writes use V2 allowlist projections and persistent retry storage', () => {
  const writer = sliceFunction(store, 'writeTeamWorkspaceToFirestore', 'queueTeamWorkspaceWrite');
  const queue = sliceFunction(store, 'queueTeamWorkspaceWrite', 'bootstrapTeamWorkspace');

  assert.match(store, /team-v2-records\.mjs/);
  assert.match(store, /team-mutation-queue\.mjs/);
  assert.match(writer, /buildV2Account/);
  assert.match(writer, /buildV2Project/);
  assert.match(writer, /runTransaction/);
  assert.match(writer, /existingShareDocs/);
  assert.match(writer, /amountYen:\s*0/);
  assert.match(writer, /assigned:\s*false/);
  const readyWriter = writer.slice(writer.indexOf('const eventByProject'));
  assert.doesNotMatch(readyWriter, /ownerUid:\s*targetTeamId/);
  assert.doesNotMatch(readyWriter, /collection:\s*name/);
  assert.match(queue, /createTeamMutationQueue/);
  assert.match(store, /globalThis\.localStorage/);
  assert.match(queue, /persistentQueue\.remove/);
  assert.doesNotMatch(queue, /catch\(\(error\) => \{[\s\S]*?return null;/);
});

test('team workspace keeps tombstones so stale cached projects cannot return', () => {
  assert.match(store, /deletedAt/);
  assert.match(store, /deletedBy/);
  assert.match(html, /filterActiveTeamWorkspaceRecords/);
});

test('V2 separated rewards are loaded and subscribed with the current member scope', () => {
  const load = sliceFunction(store, 'loadTeamWorkspaceFromFirestore', 'writeTeamWorkspaceToFirestore');
  const subscribe = store.slice(store.indexOf('export async function subscribeTeamWorkspace('));
  assert.match(store, /projectRewardTotals/);
  assert.match(store, /projectRewardShares/);
  assert.match(store, /projectCosts/);
  assert.match(store, /where\('memberUid',\s*'==',\s*access\.uid\)/);
  assert.match(store, /rewardAllocations/);
  assert.match(subscribe, /projectRewardTotals/);
  assert.match(subscribe, /projectRewardShares/);
  assert.match(subscribe, /projectCosts/);
});

test('authoritative team cloud snapshot replaces stale local cache after queued writes replay', () => {
  const bootstrap = sliceFunction(store, 'bootstrapTeamWorkspace', 'subscribeTeamWorkspace');

  assert.match(bootstrap, /const resolvedAccess = await assertTeamWorkspaceAccess/);
  assert.match(bootstrap, /const migrated = buildTeamWorkspaceSnapshotFromLocal\(localState, \{ ownerUid: targetTeamId \}\)/);
  assert.match(bootstrap, /await writeTeamWorkspaceToFirestore\(\{ user, teamId: targetTeamId, snapshot: migrated, resolvedAccess \}\)/);
  assert.match(bootstrap, /return cloud\.snapshot;/);
  assert.doesNotMatch(bootstrap, /return mergeWorkspaceSnapshot\(/);
});

test('authoritative team snapshots replace the display cache used by schedules', () => {
  const sync = sliceFunction(html, 'syncTeamWorkspaceForTeam', '_ensureTeamSettings');
  const cacheWrites = sync.match(/saveTeamWorkspaceCache\(targetTeamId, teamWorkspaceSnapshot\)/g) || [];

  assert.equal(cacheWrites.length, 2, 'bootstrap and live subscription must both replace stale cache');
});

test('schedule and project list use only the authoritative live snapshot once it exists', () => {
  const records = sliceFunction(html, 'getTeamWorkspaceRecordsForTeam', 'getTeamWorkspaceAccounts');

  assert.match(records, /if \(live\) \{/);
  assert.match(records, /mergeSnapshot\(live\);[\s\S]*?return filterActiveTeamWorkspaceRecords/);
  const afterLive = records.slice(records.indexOf('if (live)'));
  assert.ok(afterLive.indexOf('return filterActiveTeamWorkspaceRecords') < afterLive.indexOf('mergeSnapshot(cached)'), 'cached data must not be merged after a live snapshot is available');
});

test('team workspace bootstrap state merges local team records with cached snapshots', () => {
  const bootstrapState = sliceFunction(html, 'getTeamWorkspaceBootstrapState', 'syncTeamWorkspaceForTeam');

  assert.match(bootstrapState, /mergeTeamWorkspaceBootstrapRecords\(teamScopedFolders, cachedSnapshot\?\.folders, currentSnapshot\?\.folders\)/);
  assert.match(bootstrapState, /mergeTeamWorkspaceBootstrapRecords\(teamScopedAccounts, cachedSnapshot\?\.accounts, currentSnapshot\?\.accounts\)/);
  assert.match(bootstrapState, /mergeTeamWorkspaceBootstrapRecords\(teamScopedProjects, cachedSnapshot\?\.projects, currentSnapshot\?\.projects\)/);
});

test('team workspace hydration does not revive projects whose account tombstone removed them', () => {
  assert.doesNotMatch(store, /rebuildMissingWorkspaceAccounts/);
});

test('team-scoped saves queue a workspace write even outside expanded team mode', () => {
  const helper = sliceFunction(html, 'queueTeamWorkspaceSave', 'save');
  const projectSave = sliceFunction(html, 'saveProject', 'renderTeamRevenue');
  const accountSave = sliceFunction(html, 'saveAcc', 'doDeleteAcc');

  assert.match(helper, /if \(teamProjectsExpanded && getTeamProjectsWorkspaceTeamId\(\) === target\) return;/);
  assert.match(helper, /const snapshot = getTeamWorkspaceBootstrapState\(target\);/);
  assert.match(projectSave, /const now = Date\.now\(\);/);
  assert.match(projectSave, /a\.updatedAt = now;/);
  assert.match(projectSave, /if \(scope === 'team' && teamId\) \{/);
  assert.match(projectSave, /queueTeamWorkspaceSave\(teamId\);/);
  assert.match(accountSave, /const now = Date\.now\(\);/);
  assert.match(accountSave, /updatedAt: now,/);
  assert.match(accountSave, /if \(targetScope === 'team' && teamId\) queueTeamWorkspaceSave\(teamId\);/);
  assert.match(html, /reportTeamWorkspaceSyncError/);
  assert.doesNotMatch(helper, /\.catch\(\(\) => \{\}\)/);
});
