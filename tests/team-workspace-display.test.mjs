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

test('team workspace records merge both account and project snapshots', () => {
  const fn = sliceFunction('getTeamWorkspaceRecordsForTeam', 'getTeamWorkspaceAccounts');

  assert.match(fn, /const projectMap = new Map\(\);/);
  assert.match(fn, /const id = String\(row\?\.id \|\| row\?\.accountId \|\| ''\)\.trim\(\);/);
  assert.match(fn, /projectMap\.forEach\(\(project, id\) => \{/);
  assert.match(fn, /mergeSnapshot\(live\);/);
  assert.match(fn, /mergeSnapshot\(cached\);/);
});

test('team revenue buttons show confirmed amounts only', () => {
  const fn = sliceFunction('renderTeamRevenue', '_parseDeadlineToDate');

  assert.match(fn, /const valueText = yen\(Number\(itemStats\.confirmed \|\| 0\) \|\| 0\);/);
});

test('team in-progress status count includes contracted and delivered projects', () => {
  const fn = sliceFunction('renderTeam', '_setTeamSettingsPane');

  assert.match(
    fn,
    /const stProg = teamStatusSource\.filter\(a => \['契約中', '納品済'\]\.includes\(normalizeStatus\(a\.project\.status\)\)\)\.length;/,
  );
});

test('team done status count includes completed projects only', () => {
  const fn = sliceFunction('renderTeam', '_setTeamSettingsPane');

  assert.match(
    fn,
    /const stDone = teamStatusSource\.filter\(a => normalizeStatus\(a\.project\.status\) === '終了'\)\.length;/,
  );
});

test('team status cards open filtered project lists', () => {
  const opener = sliceFunction('openTeamStatusProjects', 'setTeamRevenueBasis');
  const init = sliceFunction('initModals', '_doMove');

  assert.match(opener, /const configs = \{/);
  assert.match(opener, /consulting:\s*\{ label: '相談中', statuses: \['相談中'\] \}/);
  assert.match(opener, /progress:\s*\{ label: '契約中', statuses: \['契約中', '納品済'\] \}/);
  assert.match(opener, /done:\s*\{ label: '終了済', statuses: \['終了'\] \}/);
  assert.match(opener, /teamAssignedProjectFilter = \{/);
  assert.match(opener, /kind: 'status'/);
  assert.match(opener, /openTeamProjectsExpanded\(\)/);
  assert.match(init, /teamStNew[\s\S]*openTeamStatusProjects\('consulting'\)/);
  assert.match(init, /teamStProg[\s\S]*openTeamStatusProjects\('progress'\)/);
  assert.match(init, /teamStDone[\s\S]*openTeamStatusProjects\('done'\)/);
  assert.match(init, /closest\('\#teamStNew, #teamStProg, #teamStDone'\)/);
  assert.match(init, /statusMap\.get\(t\.id\)/);
});

test('team projects pane filters by selected status card', () => {
  const pane = sliceFunction('renderTeamProjectsPane', 'openTeamMemberAssignedProjects');

  assert.match(pane, /const statusFilter = filter && filter\.kind === 'status'/);
  assert.match(pane, /const filterStatuses = statusFilter \? \(Array\.isArray\(filter\.statuses\) \? filter\.statuses : \[\]\) : \[\]/);
  assert.match(pane, /filterStatuses\.includes\(normalizeStatus\(a\?\.project\?\.status\)\)/);
  assert.match(pane, /const title = statusFilter\s*\?\s*`\$\{statusFilter\.label \|\| 'ステータス'\}の案件一覧`/);
});

test('team reward amount falls back to allocation totals when rewardYen is empty', () => {
  const fn = sliceFunction('getAnalysisRewardAmount', 'renderTeamRevenueAnalysis');

  assert.match(fn, /if \(mode === 'team'\) \{/);
  assert.match(fn, /const teamReward = Number\(p\.rewardYen \|\| 0\) \|\| 0;/);
  assert.match(fn, /return sumTeamProjectRewardAllocations\(p\.rewardAllocations \|\| \[\]\);/);
});
