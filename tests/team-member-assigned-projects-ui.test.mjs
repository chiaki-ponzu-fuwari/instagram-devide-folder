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

test('assigned project back button returns to the member detail when opened from a member', () => {
  const openAssigned = sliceFunction('openTeamMemberAssignedProjects', 'setTeamRevenueBasis');
  const backHtml = sliceFunction('teamProjectsBackHTML', 'bindSortBtn');
  const binder = sliceFunction('bindSortBtn', 'isRepeatParentAccount');

  assert.match(openAssigned, /fromMemberDetail:\s*true/);
  assert.match(backHtml, /teamAssignedProjectFilter\?\.fromMemberDetail/);
  assert.match(backHtml, /メンバー詳細に戻る/);
  assert.match(binder, /returnToTeamMemberDetailFromAssignedProjects/);
  assert.doesNotMatch(binder, /backBtn\) backBtn\.addEventListener\('click', closeTeamProjectsExpanded\)/);
});

test('reward allocation members list admins before regular members', () => {
  const rewardMembers = sliceFunction('getTeamProjectRewardMembers', 'normalizeTeamProjectRewardAllocations');

  assert.match(rewardMembers, /a\.role === 'admin'/);
  assert.match(rewardMembers, /b\.role === 'admin'/);
  assert.match(rewardMembers, /if \(aAdmin !== bAdmin\) return aAdmin - bAdmin/);
});

test('assigned projects page does not show redundant member filter labels', () => {
  const pane = sliceFunction('renderTeamProjectsPane', 'openTeamMemberAssignedProjects');

  assert.doesNotMatch(pane, /\? `\$\{filterName \|\| 'メンバー'\}の案件`/);
  assert.doesNotMatch(pane, /id="teamProjectFilterClear"/);
  assert.doesNotMatch(pane, /このメンバーが担当に入っている案件だけを表示/);
  assert.doesNotMatch(pane, /class="team-project-filter"/);
  assert.doesNotMatch(pane, /teamAssignedProjectFilter = null;\s*renderMain\(\);/);
});

test('assigned projects page header names the selected member', () => {
  const pane = sliceFunction('renderTeamProjectsPane', 'openTeamMemberAssignedProjects');

  assert.match(pane, /const filterName = filter \? String\(filter\.name \|\| filter\.displayName \|\| ''\)\.trim\(\) : ''/);
  assert.match(pane, /\? `\$\{filterName \|\| 'メンバー'\}の案件一覧`/);
  assert.match(pane, /setMainHeaderTitle\(title, \{ assignedProjectsTitle: !!filter \}\)/);
});

test('assigned projects page uses a smaller header title only for member-filtered lists', () => {
  const pane = sliceFunction('renderTeamProjectsPane', 'openTeamMemberAssignedProjects');
  const setHeader = sliceFunction('setMainHeaderTitle', 'loadTeamWorkspaceModules');

  assert.match(html, /\.hdr-title\.assigned-projects-title[\s\S]*font-size:18px/);
  assert.match(pane, /setMainHeaderTitle\(title, \{ assignedProjectsTitle: !!filter \}\)/);
  assert.match(setHeader, /classList\.toggle\('assigned-projects-title', !!assignedProjectsTitle\)/);
});
