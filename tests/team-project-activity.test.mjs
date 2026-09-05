import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildActivityText } from '../www/js/team-model.mjs';

const html = readFileSync(new URL('../www/index.html', import.meta.url), 'utf8');
const store = readFileSync(new URL('../www/js/team-workspace-store.mjs', import.meta.url), 'utf8');
const cloud = readFileSync(new URL('../www/js/team-cloud.mjs', import.meta.url), 'utf8');
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

test('project activity messages cover the four approved actions', () => {
  assert.equal(buildActivityText({ actorName: '山田', action: 'createProject', targetName: '春案件' }), '山田さんが「春案件」を追加しました');
  assert.equal(buildActivityText({ actorName: '山田', action: 'markDelivered', targetName: '春案件' }), '山田さんが「春案件」を納品済みに変更しました');
  assert.equal(buildActivityText({ actorName: '山田', action: 'markCompleted', targetName: '春案件' }), '山田さんが「春案件」を終了済みに変更しました');
  assert.equal(buildActivityText({ actorName: '山田', action: 'deleteProject', targetName: '春案件' }), '山田さんが「春案件」を削除しました');
});

test('status history is based on the final saved transition', () => {
  const saveProject = html.match(/function saveProject\(\) \{([\s\S]*?)\n\}\n\n\/\/ =+\n\/\/ REVENUE/)?.[1] || '';
  assert.match(saveProject, /prevStatus/);
  assert.match(saveProject, /statusFinal === '納品済'/);
  assert.match(saveProject, /statusFinal === '終了'/);
  assert.match(saveProject, /queueTeamProjectActivity/);
  assert.doesNotMatch(saveProject, /相談中['"],\s*'契約中/);
});

test('team deletion writes a tombstone and captures identity before removal', () => {
  const deletion = html.match(/function doDeleteAcc\(aid\) \{([\s\S]*?)\n\}\nfunction doToggleNewDM/)?.[1] || '';
  assert.match(deletion, /projectName/);
  assert.match(deletion, /deletedAt/);
  assert.match(deletion, /deletedBy/);
  assert.match(deletion, /deleteProject/);
  assert.ok(deletion.indexOf('projectName') < deletion.indexOf('S.accounts = S.accounts.filter'), 'name must be captured before removal');
});

test('team folder deletion tombstones every removed folder and project before hiding them', () => {
  const deletion = html.match(/function doDeleteFolder\(fid\) \{([\s\S]*?)\n\}\n\n\/\/ =+\n\/\/ ACCOUNT CRUD/)?.[1] || '';
  assert.match(deletion, /canCurrentViewerDeleteTeamProject/);
  assert.match(deletion, /deletedAt/);
  assert.match(deletion, /deletedBy/);
  assert.match(deletion, /queueTeamProjectActivity/);
  assert.ok(deletion.indexOf('deletedAt') < deletion.indexOf('S.accounts = S.accounts.filter'), 'tombstones must be queued before records are hidden');
});

test('team template deletion writes a tombstone instead of only removing local state', () => {
  const templates = html.match(/function renderTemplateList\([\s\S]*?\n\}\n\nfunction renderTeamTemplatesPage/)?.[0] || '';
  assert.match(templates, /deletedAt/);
  assert.match(templates, /deletedBy/);
  assert.match(templates, /scope[^\n]*team|teamProjectsExpanded/);
});

test('workspace transaction persists idempotent activity documents with project writes', () => {
  assert.match(store, /activityEvents/);
  assert.match(store, /teams', targetTeamId, 'activity'/);
  assert.match(store, /transaction\.set\(/);
  assert.match(store, /teams', targetTeamId, 'operations'/);
  assert.match(store, /serverTimestamp\(\)/);
  assert.match(store, /pendingEvents/);
});

test('rules validate actor identity and allowed project activity fields', () => {
  assert.match(rules, /isValidProjectActivity/);
  assert.match(rules, /actorUid == request\.auth\.uid/);
  assert.match(rules, /createProject/);
  assert.match(rules, /markDelivered/);
  assert.match(rules, /markCompleted/);
  assert.match(rules, /deleteProject/);
  assert.match(rules, /affectedKeys|hasOnly/);
});

test('every approved member subscribes to and renders the shared activity stream', () => {
  const start = cloud.indexOf('export function subscribeTeam(');
  assert.notEqual(start, -1);
  const subscribeTeam = cloud.slice(start);
  assert.match(subscribeTeam, /onSnapshot\(collection\(db, 'teams', teamId, 'activity'\)/);
  assert.doesNotMatch(subscribeTeam, /if \(includeJoinRequests\)[\s\S]*?activity/);
  assert.match(rules, /match \/activity\/\{activityId\}[\s\S]*?allow read: if isApprovedMember\(teamId\) \|\| isTeamCreator\(teamId\)/);
  assert.match(html, /if \(event\.type === 'activity'\) cloudTeamActivity = event\.data/);
  assert.match(html, /const combinedActs = \[\.\.\.\(cloudTeamActivity \|\| \[\]\)/);
});

test('project tombstones are subscribed for every team workspace and removed from the visible UI', () => {
  const subscribeWorkspace = store.match(/export async function subscribeTeamWorkspace\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(subscribeWorkspace, /onSnapshot\(teamCollectionRef\(db, targetTeamId, 'projects'\), refresh, refresh\)/);
  assert.match(html, /filterActiveTeamWorkspaceRecords/);
  assert.match(html, /record\?\.deletedAt == null && record\?\.project\?\.deletedAt == null/);
});
