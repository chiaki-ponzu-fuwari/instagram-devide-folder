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

test('team revenue scope buttons are rendered in the monthly revenue card', () => {
  assert.match(html, /id="teamRevScopeList"/);
  assert.match(html, /aria-label="今月の表示対象"/);
});

test('team revenue scope options follow the team reward visibility setting', () => {
  const fn = sliceFunction('getTeamRevenueScopeOptions', 'getTeamRevenueDefaultScope');

  assert.match(fn, /const rows = \[\]/);
  assert.match(fn, /if \(isAdmin \|\| visibility === 'self_plus_total' \|\| visibility === 'all'\) rows\.push\(\{ key: 'team', label: 'チーム合計', sub: 'チーム全体の報酬' \}\);/);
  assert.match(fn, /if \(isAdmin \|\| visibility === 'all'\) \{/);
  assert.match(fn, /getTeamProjectRewardMembers\(team\)\.forEach\(\(member\) => \{/);
  assert.match(fn, /sub: '自分のメンバー枠'/);
  assert.match(fn, /getCurrentTeamMember\(team\)/);
});

test('team reward visibility modes preserve self, self plus total, and all-member scopes', () => {
  const fn = sliceFunction('getTeamProjectRewardVisibility', 'getCurrentTeamMember');

  assert.match(fn, /if \(raw === 'self'\) return 'self';/);
  assert.match(fn, /if \(raw === 'self_plus_total'\) return 'self_plus_total';/);
  assert.match(fn, /if \(raw === 'all' \|\| raw === 'all_members'\) return 'all';/);
});

test('team project reward access grants admins all editing rights and members scoped viewing only', () => {
  const fn = sliceFunction('getTeamProjectRewardAccess', 'canViewerSeeTeamProjectReward');

  assert.match(fn, /canEdit: true/);
  assert.match(fn, /canViewTotal: true/);
  assert.match(fn, /canViewAllMembers: true/);
  assert.match(fn, /mode === 'self_plus_total'/);
  assert.match(fn, /canViewTotal: mode === 'self_plus_total' \|\| mode === 'all'/);
  assert.match(fn, /canViewAllMembers: mode === 'all'/);
  assert.match(fn, /canViewOwn: hasOwnReward/);
});

test('team project reward editor hides total input and other member amounts without permission', () => {
  assert.match(html, /id="projRewardField"/);
  const fn = sliceFunction('renderTeamProjectRewardAllocations', 'bindCards');

  assert.match(fn, /const access = getTeamProjectRewardAccess\(team, project\);/);
  assert.match(fn, /rewardField\.style\.display = showRewardField \? '' : 'none';/);
  assert.match(fn, /if \(!showRewardField && inTeamContext\) rewardInput\.value = '';/);
  assert.match(fn, /const visibleRows = canEditAssignments \|\| canEditReward \|\| access\.canViewAllMembers\s*\? rawRows\s*: rawRows\.filter/);
  assert.match(fn, /sumEl\.innerHTML = access\.canViewTotal/);
  assert.match(fn, /const amount = canEditReward \? rowEl\.querySelector/);
});

test('team reward allocation draft survives status rerenders and resets when the editor is reopened', () => {
  const renderer = sliceFunction('renderTeamProjectRewardAllocations', 'bindCards');
  const opener = sliceFunction('openProjectModal', '_projRewardValueNow');

  assert.match(renderer, /list\.dataset\.allocProjectId === String\(projAccountId \|\| ''\)/);
  assert.match(renderer, /readTeamProjectRewardAllocationsFromUI\(team\)/);
  assert.match(renderer, /list\.dataset\.allocProjectId = String\(projAccountId \|\| ''\)/);
  assert.match(opener, /delete rewardAllocList\.dataset\.allocProjectId/);
  assert.match(opener, /rewardAllocList\.innerHTML = ''/);
});

test('team revenue default scope keeps the current allowed scope or falls back to team', () => {
  const fn = sliceFunction('getTeamRevenueDefaultScope', 'getTeamRevenueRewardAmount');

  assert.match(fn, /if \(keys\.includes\(teamRevScope\)\) return teamRevScope;/);
  assert.match(fn, /if \(keys\.includes\('team'\)\) return 'team';/);
  assert.match(fn, /return keys\[0\] \|\| 'team';/);
});

test('team revenue month stats can switch to member breakdowns', () => {
  const fn = sliceFunction('getTeamRevenueMonthStats', 'renderTeamRevenueAnalysis');

  assert.match(fn, /const key = String\(scopeKey \|\| 'team'\)\.trim\(\) \|\| 'team';/);
  assert.match(fn, /if \(key === 'team'\)/);
  assert.match(fn, /else if \(key === 'self'\)/);
  assert.match(fn, /r = getTeamRevenueMemberRewardAmount\(a, team, key\);/);
  assert.match(fn, /if \(!include\) return;/);
});

test('team revenue analysis stays on team totals only', () => {
  const fn = sliceFunction('renderTeamRevenueAnalysis', 'renderTeamRevenue');

  assert.doesNotMatch(fn, /teamRevScope/);
  assert.match(fn, /getAnalysisRewardAmount\(a, 'team'\)/);
  assert.match(fn, /teamAnaPlatformTtl/);
});

test('team revenue renderer wires the band buttons and uses the selected scope', () => {
  const fn = sliceFunction('renderTeamRevenue', '_parseDeadlineToDate');

  assert.match(fn, /const scopeOptions = getTeamRevenueScopeOptions\(team\);/);
  assert.match(fn, /teamRevScope = getTeamRevenueDefaultScope\(team\);/);
  assert.match(fn, /const scopeList = document\.getElementById\('teamRevScopeList'\);/);
  assert.match(fn, /team-rev-band-btn/);
  assert.match(fn, /const stats = getTeamRevenueMonthStats\(teamId, team, k, teamRevScope\);/);
});
