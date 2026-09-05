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

test('team schedule cards open projects without a duplicate project management button', () => {
  const renderScheduleItems = sliceFunction('_renderScheduleItems', 'setScheduleTab');

  assert.doesNotMatch(renderScheduleItems, /data-sched-open-project=/);
  assert.doesNotMatch(renderScheduleItems, /sched-open-project/);
  assert.match(renderScheduleItems, /sched-card/);
  assert.match(renderScheduleItems, /data-aid=/);
});

test('team schedule cards open the matching team project', () => {
  const openHandler = sliceFunction('openTeamProjectFromSchedule', 'bindTeamScheduleProjectButtons');
  const binder = sliceFunction('bindTeamScheduleProjectButtons', 'setScheduleTab');
  const teamSchedule = sliceFunction('renderTeamSchedule', 'renderTeamSchedulePane');
  const teamPane = sliceFunction('renderTeamSchedulePane', null);

  assert.match(openHandler, /openTeamProjectsExpanded/);
  assert.match(openHandler, /openProjectModal/);
  assert.doesNotMatch(binder, /data-sched-open-project/);
  assert.match(binder, /\.sched-card\[data-aid\]/);
  assert.match(teamSchedule, /bindTeamScheduleProjectButtons\(list\)/);
  assert.match(teamPane, /bindTeamScheduleProjectButtons\(list\)/);
});

test('team deadline banner labels the project management entry clearly', () => {
  const banner = sliceFunction('updateTeamDeadlineBanner', '_teamAggMonth');

  assert.match(banner, /チーム案件を管理/);
  assert.doesNotMatch(banner, /予定を確認/);
  assert.doesNotMatch(html, /タップで予定タブを開く/);
});
