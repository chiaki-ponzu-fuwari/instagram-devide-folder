import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

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

test('team detail overlay alone does not switch account creation into team workspace', () => {
  const saveAcc = sliceFunction('saveAcc', 'doDeleteAcc');

  assert.match(saveAcc, /const isTeamMode = !!teamProjectsExpanded/);
  assert.doesNotMatch(saveAcc, /teamOv[\s\S]*classList\.contains\('show'\)/);
});

test('team detail overlay alone does not switch folder creation into team workspace', () => {
  const saveFolder = sliceFunction('saveFolder', 'doDeleteFolder');

  assert.match(saveFolder, /const isTeamMode = !!teamProjectsExpanded/);
  assert.doesNotMatch(saveFolder, /teamOv[\s\S]*classList\.contains\('show'\)/);
});

test('project save treats records as team projects only inside the expanded team workspace', () => {
  const saveProject = sliceFunction('saveProject', 'getProjectScope');

  assert.match(saveProject, /const inTeamContext = !!teamProjectsExpanded/);
  assert.doesNotMatch(saveProject, /teamOv[\s\S]*classList\.contains\('show'\)/);
});

test('personal workspace state excludes team-scoped records before personal cloud save', () => {
  const getLocalWorkspaceState = sliceFunction('getLocalWorkspaceState', 'applyWorkspaceSnapshotToState');

  assert.match(getLocalWorkspaceState, /filterPersonalWorkspaceRecords/);
  assert.match(getLocalWorkspaceState, /const accounts = filterPersonalWorkspaceRecords\(S\.accounts/);
  assert.match(getLocalWorkspaceState, /const folders = filterPersonalWorkspaceRecords\(S\.folders/);
});

test('team workspace display and edits never overwrite the personal device cache', () => {
  const save = sliceFunction('save', 'uid');
  const openTeamProjects = sliceFunction('openTeamProjectsExpanded', 'closeTeamProjectsExpanded');
  const syncTeam = sliceFunction('syncTeamWorkspaceForTeam', '_ensureTeamSettings');
  const teamBranch = save.indexOf('if (teamProjectsExpanded)');
  const personalPersist = save.indexOf('persistLocalCache()', teamBranch);

  assert.notEqual(teamBranch, -1);
  assert.notEqual(personalPersist, -1);
  assert.doesNotMatch(save.slice(0, teamBranch), /persistLocalCache\(\)/);
  assert.match(save.slice(teamBranch, personalPersist), /return;/);
  assert.doesNotMatch(openTeamProjects, /applyWorkspaceSnapshotToState\([^;]+persist:\s*true/);
  assert.doesNotMatch(syncTeam, /applyWorkspaceSnapshotToState\(teamWorkspaceSnapshot,\s*\{ persist:\s*true/);
});

test('personal cloud updates are held separately while a team workspace is visible', () => {
  const syncPersonal = sliceFunction('syncPersonalWorkspaceForUser', 'applyBackupJSON');

  assert.match(syncPersonal, /if \(teamProjectsExpanded\) \{/);
  assert.match(syncPersonal, /personalWorkspaceSnapshotBeforeTeam\s*=\s*cloneTeamWorkspaceSnapshot\(merged\)/);
});

test('personal project list hides leaked team-scoped records', () => {
  const getMainWorkspaceAccounts = sliceFunction('getMainWorkspaceAccounts', 'openTeamProjectsExpanded');

  assert.match(getMainWorkspaceAccounts, /filterPersonalWorkspaceRecords\(S\.accounts/);
});

test('team account saves stamp team scope on both account and project records', () => {
  const saveAcc = sliceFunction('saveAcc', 'doDeleteAcc');

  assert.match(saveAcc, /const scopedProject = nextProjectFinal[\s\S]*scope: targetScope[\s\S]*teamId: isTeamMode \? teamId : ''/);
  assert.match(saveAcc, /const now = Date\.now\(\);/);
  assert.match(saveAcc, /updatedAt: now,/);
  assert.match(saveAcc, /if \(nextProjectFinal\) \{/);
  assert.match(saveAcc, /next\.project = scopedProject;/);
  assert.match(saveAcc, /next\.project\.updatedAt = now;/);
  assert.match(saveAcc, /project: scopedProject \|\| undefined/);
});

test('legacy team accounts are recognized even if only the account has team scope', () => {
  const scopeHelpers = sliceFunction('getProjectScope', 'isScopedProject');

  assert.match(scopeHelpers, /a\?\.project\?\.scope \|\| a\?\.scope/);
  assert.match(scopeHelpers, /a\?\.project\?\.teamId \|\| a\?\.teamId/);
});
