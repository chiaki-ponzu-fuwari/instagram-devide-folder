import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../www/index.html', import.meta.url), 'utf8');

function sliceFunction(name, nextName) {
  const start = html.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const end = nextName ? html.indexOf(`function ${nextName}`, start + 1) : html.length;
  assert.notEqual(end, -1, `${nextName} should exist after ${name}`);
  return html.slice(start, end);
}

test('promoting the first duplicate keeps the existing project as child one', () => {
  const saveAcc = sliceFunction('saveAcc', 'doDeleteAcc');
  const existingChild = sliceFunction('createRepeatChildFromExistingAccount', 'promoteAccountToRepeatParent');

  assert.match(saveAcc, /createRepeatChildFromExistingAccount\(repeatLink\.promote/);
  assert.match(existingChild, /parent\.id/);
  assert.match(saveAcc, /cloneProjectForRepeatChild\(repeatParent\.project \|\| \{\}, repeatParent\.id/);
});

test('same username repeat prompt works within personal or the current team only', () => {
  const accountsByUsername = sliceFunction('accountsByUsername', 'findRepeatParentByUsername');
  const saveAcc = sliceFunction('saveAcc', 'doDeleteAcc');

  assert.match(accountsByUsername, /String\(getProjectScope\(a\) \|\| 'personal'\) !== targetScope/);
  assert.match(accountsByUsername, /String\(getProjectTeamId\(a\) \|\| ''\) !== targetTeamId/);
  assert.match(saveAcc, /const targetScope = isTeamMode \? 'team' : 'personal'/);
  assert.match(saveAcc, /accountsByUsername\(username, targetScope, teamId\)/);
  assert.match(saveAcc, /if \(forceRepeatLink === null && sameAccounts\.length\)/);
  assert.doesNotMatch(saveAcc, /if \(!isTeamMode && forceRepeatLink === null && sameAccounts\.length\)/);
});

test('repeat parent keeps only shared/basic project fields', () => {
  const parentProject = sliceFunction('buildRepeatParentProject', 'cloneProjectForRepeatChild');

  assert.match(parentProject, /contractType:\s*'repeat'/);
  assert.match(parentProject, /repeatParentId:\s*''/);
  assert.doesNotMatch(parentProject, /status:/);
  assert.doesNotMatch(parentProject, /shootDate:/);
  assert.doesNotMatch(parentProject, /draftAt:/);
  assert.doesNotMatch(parentProject, /deadline:/);
  assert.doesNotMatch(parentProject, /paidConfirmed:/);
  assert.doesNotMatch(parentProject, /deliveredAt:/);
});

test('repeat child copies editable project fields from the source project', () => {
  const childProject = sliceFunction('cloneProjectForRepeatChild', 'createRepeatChildFromExistingAccount');

  assert.match(childProject, /status:/);
  assert.match(childProject, /shootDate:/);
  assert.match(childProject, /draftAt:/);
  assert.match(childProject, /deadline:/);
  assert.match(childProject, /rewardYen:/);
  assert.match(childProject, /costYen:/);
  assert.match(childProject, /expenses:/);
  assert.match(childProject, /platforms:/);
  assert.match(childProject, /tags:/);
  assert.match(childProject, /mapUrl:/);
});

test('new repeat children inherit parent url and project basics while staying editable', () => {
  const saveAcc = sliceFunction('saveAcc', 'doDeleteAcc');
  const createChild = sliceFunction('createRepeatChild', 'listDoneHiddenEmptyHTML');

  assert.match(saveAcc, /url: repeatParent \? \(repeatParent\.url \|\| url \|\| ''\) : url/);
  assert.match(saveAcc, /cloneProjectForRepeatChild\(repeatParent\.project \|\| \{\}, repeatParent\.id/);
  assert.match(createChild, /url: parent\.url \|\| ''/);
  assert.match(createChild, /cloneProjectForRepeatChild\(p, parent\.id/);
});

test('repeat child list shows shoot date instead of parent label', () => {
  const repeatSection = sliceFunction('renderProjRepeatSection', 'openProjectModal');

  assert.match(repeatSection, /formatRepeatChildSub\(kid\)/);
  assert.doesNotMatch(repeatSection, /<div class="proj-repeat-row-sub">\$\{esc\(tt\('proj_repeat_child_of'\)\)/);
});

test('legacy repeat parents migrate their own project into a first child on load', () => {
  const migration = sliceFunction('migrateRepeatParentsToContainerModel', 'migrateLegacyStatusesInAccounts');
  const nativeLoad = sliceFunction('loadNativeOrLocal', 'listNativeBackups');

  assert.match(migration, /createRepeatChildFromExistingAccount\(a, a/);
  assert.match(migration, /promoteAccountToRepeatParent\(a/);
  assert.match(nativeLoad, /migrateLegacyStatusesInAccounts\(S\.accounts\)/);
});

test('account save button calls saveAcc without passing the click event', () => {
  assert.doesNotMatch(html, /addEventListener\('click', saveAcc\)/);
  assert.match(html, /addEventListener\('click', \(\) => saveAcc\(\)\)/);
});
