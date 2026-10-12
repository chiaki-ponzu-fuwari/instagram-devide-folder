import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../www/index.html', import.meta.url), 'utf8');

test('personal schedule tabs stay on one row with compact labels', () => {
  assert.match(html, /\.sched-tabs\.equal-three-option-tabs\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(html, /\.sched-tabs \.settings-lang-btn\{[\s\S]*?font-size:11px/);
  assert.doesNotMatch(html.match(/id="schedTabs"[^>]*>/)?.[0] || '', /grid-template-columns:1fr 1fr/);
});

test('calendar marks days that have schedule items with a visible fill color', () => {
  assert.match(html, /\.sched-calendar-day button\.has-event\s*\{[\s\S]*?background:\s*rgba\(225,48,108/);
  assert.match(html, /予定あり/);
});

test('personal schedule has calendar tab, dismiss confirm, and opens project management directly', () => {
  assert.match(html, /id="schedTabCalendar"/);
  assert.match(html, /id="scheduleDismissModal"/);
  assert.match(html, /dismissedScheduleKinds/);
  assert.match(html, /openProjectModal\(a\.id\)/);
  assert.match(html, /deadline-missing/);
});

test('project card manage button opens project management modal', () => {
  assert.match(html, /data-aid-more[\s\S]{0,220}openProjectModal\(aid\)/);
});

test('editing an account preserves an existing project when only metadata changes', () => {
  assert.match(html, /S\.editingAccountId && hadProjectBefore/);
});
