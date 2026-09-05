import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cloud = readFileSync(new URL('../www/js/team-cloud.mjs', import.meta.url), 'utf8');
const store = readFileSync(new URL('../www/js/team-workspace-store.mjs', import.meta.url), 'utf8');
const html = readFileSync(new URL('../www/index.html', import.meta.url), 'utf8');

function slice(source, startText, endText) {
  const start = source.indexOf(startText);
  assert.notEqual(start, -1, `${startText} should exist`);
  const end = source.indexOf(endText, start + startText.length);
  assert.notEqual(end, -1, `${endText} should follow ${startText}`);
  return source.slice(start, end);
}

test('member profile writes keep email and note outside public member documents', () => {
  const createTeam = slice(cloud, 'export async function createTeam(', 'export async function listMyTeams(');
  const approve = slice(cloud, 'export async function approveJoinRequest(', 'export async function updateTeamName(');
  const update = slice(cloud, 'export async function updateMemberProfile(', 'export async function updateMemberPayout(');
  const createPublicWrite = slice(createTeam, 'batch.set(memberRef(', 'batch.set(memberEmailRef(');
  const approvePublicWrite = slice(approve, 'batch.set(memberRef(', 'batch.set(memberEmailRef(');
  const updatePublicWrite = slice(update, 'batch.set(memberRef(', 'batch.set(memberEmailRef(');

  assert.match(cloud, /function memberEmailRef\(/);
  assert.match(cloud, /function memberNoteRef\(/);
  assert.match(createTeam, /buildPublicMemberRecord/);
  assert.match(createTeam, /memberEmailRef/);
  assert.doesNotMatch(createPublicWrite, /email:|note:/);
  assert.match(approve, /memberEmailRef/);
  assert.doesNotMatch(approvePublicWrite, /email:|note:/);
  assert.match(update, /displayName:/);
  assert.match(update, /memberEmailRef/);
  assert.match(update, /memberNoteRef/);
  assert.doesNotMatch(updatePublicWrite, /email:|note:/);
});

test('team subscription reads private profile collections only when authorized', () => {
  const start = cloud.indexOf('export function subscribeTeam(');
  assert.notEqual(start, -1);
  const subscribe = cloud.slice(start);
  assert.match(subscribe, /workspaceAccess/);
  assert.match(subscribe, /canReadAllMemberEmails/);
  assert.match(subscribe, /canReadAllMemberNotes/);
  assert.match(subscribe, /memberEmails/);
  assert.match(subscribe, /memberNotes/);
  assert.match(subscribe, /userUid/);
});

test('optional team subscriptions cannot eject an approved member from the team screen', () => {
  const subscribe = cloud.slice(cloud.indexOf('export function subscribeTeam('));
  const teamListenerEnd = subscribe.indexOf('const canUseWorkspace');
  assert.notEqual(teamListenerEnd, -1);
  const coreTeamListener = subscribe.slice(0, teamListenerEnd);
  const childListeners = subscribe.slice(teamListenerEnd);

  assert.match(coreTeamListener, /onSnapshot\(teamRef[\s\S]*?, onError\)\)/);
  assert.match(childListeners, /reportOptionalReadFailure/);
  assert.doesNotMatch(childListeners, /\}, onError\)\)/);
});

test('locked team access is resolved before workspace reads, writes, or subscriptions', () => {
  const resolve = slice(store, 'export async function resolveTeamWorkspaceAccessFromFirestore(', 'export async function loadTeamWorkspaceFromFirestore(');
  const write = slice(store, 'export async function writeTeamWorkspaceToFirestore(', 'const teamWorkspaceQueues');
  const bootstrap = slice(store, 'export async function bootstrapTeamWorkspace(', 'export async function subscribeTeamWorkspace(');
  const subscribe = store.slice(store.indexOf('export async function subscribeTeamWorkspace('));

  assert.match(resolve, /resolveTeamWorkspaceAccess/);
  assert.match(write, /assertTeamWorkspaceAccess/);
  assert.match(bootstrap, /assertTeamWorkspaceAccess/);
  assert.match(subscribe, /assertTeamWorkspaceAccess/);
  assert.match(subscribe, /access:\s*'locked'/);
  assert.match(subscribe, /onSnapshot\(teamRef\(db, targetTeamId\), refresh, refresh\)/);
  assert.match(subscribe, /const \{ db \} = await getFirebaseCore\(\)/);
  assert.doesNotMatch(subscribe, /const \{ db, onSnapshot \} = await getFirebaseCore\(\)/);
  const refresh = slice(subscribe, 'const refresh = () => {', 'const unsubs = [');
  assert.match(refresh, /resolveTeamWorkspaceAccessFromFirestore/);
  assert.doesNotMatch(refresh, /resolvedAccess,/);
});

test('locked team access blocks cached workspace application and queued writes in the UI', () => {
  const queueSave = slice(html, 'function queueTeamWorkspaceSave(', 'function save(');
  const save = slice(html, 'function save(', '// =========================================================\n// UTILS');
  const openProjects = slice(html, 'async function openTeamProjectsExpanded(', 'function closeTeamProjectsExpanded(');
  const sync = slice(html, 'async function syncTeamWorkspaceForTeam(', 'function _ensureTeamSettings(');

  assert.match(html, /teamSecurityAccessById/);
  assert.match(queueSave, /teamSecurityAccessById/);
  assert.match(save, /teamSecurityAccessById/);
  assert.match(sync, /resolveTeamWorkspaceAccessFromFirestore/);
  assert.match(sync, /teamSecurityAccessById\.set/);
  assert.match(sync, /teamWorkspaceSnapshot = null/);
  assert.match(sync, /personalWorkspaceSnapshotBeforeTeam/);
  assert.match(openProjects, /team-migration-required|locked/);
  assert.ok(openProjects.indexOf('locked') < openProjects.indexOf('teamProjectsExpanded = true'));
});

test('locked team UI shows a migration notice and uses authorized private member maps', () => {
  const openTeam = slice(html, 'async function openTeamDetail()', 'function closeTeam(');
  const renderTeam = slice(html, 'function renderTeam()', 'function _setTeamSettingsPane(');

  assert.match(html, /cloudTeamMemberEmails\s*=\s*new Map\(\)/);
  assert.match(html, /cloudTeamMemberNotes\s*=\s*new Map\(\)/);
  assert.match(openTeam, /workspaceAccess:/);
  assert.match(openTeam, /event\.type === 'memberEmails'/);
  assert.match(openTeam, /event\.type === 'memberNotes'/);
  assert.match(html, /teamSecurityMigrationNotice/);
  assert.match(renderTeam, /team-security-migration-required/);
  assert.match(renderTeam, /cloudTeamMemberEmails\.get/);
  assert.match(renderTeam, /cloudTeamMemberNotes\.get/);
  assert.doesNotMatch(renderTeam, /email:\s*m\.email/);
  assert.doesNotMatch(renderTeam, /note:\s*m\.note/);
  assert.ok(
    renderTeam.indexOf('team-security-migration-required') < renderTeam.indexOf('getTeamAnalysisDisplayRecords'),
    'locked teams must stop before project and reward analysis is read',
  );
});

test('assignment permission stores member UIDs in the canonical cloud setting', () => {
  const settings = slice(html, 'function _ensureTeamSettings(', 'function describeErr(');
  const controls = slice(html, 'function renderTeamEditControls()', 'async function issueInviteLink(');
  assert.match(settings, /assignOwnerUids/);
  assert.match(controls, /assignOwnerUids/);
  assert.match(controls, /setTeamSetting\('assignOwnerUids'/);
});

test('team delete controls and handler follow the same permission as Firestore rules', () => {
  const card = slice(html, 'function cardHTML(', 'function formatYen(');
  const actions = slice(html, 'function showAccAS(', 'function showAS(');
  const deletion = slice(html, 'function doDeleteAcc(', 'function doToggleNewDM(');

  assert.match(html, /function canCurrentViewerDeleteTeamProject\(/);
  assert.match(card, /canCurrentViewerDeleteTeamProject/);
  assert.match(actions, /canCurrentViewerDeleteTeamProject/);
  assert.match(deletion, /canCurrentViewerDeleteTeamProject/);
  assert.match(deletion, /この案件を削除する権限がありません/);
});

test('team project saves persist canonical assignee UIDs without exposing reward edits', () => {
  const saveProject = slice(html, 'function saveProject()', '// =========================================================\n// REVENUE');

  assert.match(saveProject, /assigneeUids/);
  assert.match(saveProject, /rewardAllocations[\s\S]*?filter\(\(row\) => row\?\.assigned\)/);
  assert.match(saveProject, /prevProject\.assigneeUids/);
});

test('transient workspace reload errors keep the last approved access instead of reporting denial', () => {
  const subscribe = store.slice(store.indexOf('export async function subscribeTeamWorkspace('));
  const refresh = slice(subscribe, 'const refresh = () => {', 'const unsubs = [');

  assert.match(store, /function isPermissionDeniedError\(/);
  assert.match(refresh, /isPermissionDeniedError\(error\)/);
  assert.match(refresh, /access:\s*resolvedAccess\.access/);
  assert.doesNotMatch(refresh, /catch \(error\) \{[\s\S]*?onChange\(\{ access: 'denied', snapshot: null \}\);/);
});

test('initial transient sync failure uses the approved cached team instead of marking it denied', () => {
  const sync = slice(html, 'async function syncTeamWorkspaceForTeam(', 'function _ensureTeamSettings(');

  assert.match(html, /function isTeamWorkspacePermissionError\(/);
  assert.match(sync, /loadTeamWorkspaceCache\(targetTeamId\)/);
  assert.match(sync, /fallbackAccess/);
  assert.match(sync, /isTeamWorkspacePermissionError\(error\)/);
  assert.doesNotMatch(sync, /catch \(error\) \{[\s\S]*?teamSecurityAccessById\.set\(targetTeamId, code === 'team-migration-required' \? 'locked' : 'denied'\)/);
});

test('new teams start ready because they contain no legacy workspace data', () => {
  const createTeam = slice(cloud, 'export async function createTeam(', 'export async function listMyTeams(');
  assert.match(createTeam, /securitySchemaVersion:\s*2/);
  assert.match(createTeam, /securityMigrationState:\s*'ready'/);
});
