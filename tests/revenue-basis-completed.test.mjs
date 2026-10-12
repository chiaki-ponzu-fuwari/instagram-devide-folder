import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../www/index.html', import.meta.url), 'utf8');
const i18n = readFileSync(new URL('../www/i18n.js', import.meta.url), 'utf8');

function sliceFunction(name, nextName) {
  const pattern = new RegExp(`function\\s+${name}\\s*\\(`);
  const match = pattern.exec(html);
  const start = match ? match.index : -1;
  assert.notEqual(start, -1, `${name} should exist`);
  const end = nextName ? html.indexOf(`function ${nextName}`, start + 1) : html.length;
  assert.notEqual(end, -1, `${nextName} should exist after ${name}`);
  return html.slice(start, end);
}

test('settings expose completed-month as a fourth revenue basis option with help copy', () => {
  assert.match(html, /id="revBasisCompleted"/);
  assert.match(html, /終了月/);
  assert.match(html, /id="revBasisHelp"/);
  assert.match(html, /設定/);
  assert.match(i18n, /rev_basis_completed:\s*'終了月'/);
  assert.match(i18n, /rev_basis_help:/);
});

test('revenue page shows the active basis and points users to settings', () => {
  assert.match(html, /id="revBasisNote"/);
  const render = sliceFunction('renderRevenue', 'copyField');
  assert.match(render, /revBasisNote/);
  assert.match(html, /function labelRevenueBasis\(/);
  assert.match(html, /function describeRevenueBasis\(/);
});

test('projectMonthKey supports completed basis using completedAt', () => {
  const fn = sliceFunction('projectMonthKey', 'getRevenueBudgets');
  assert.match(fn, /basis === 'completed'/);
  assert.match(fn, /completedAt/);
});

test('saving a finished project stamps completedAt and keeps it while finished', () => {
  assert.match(html, /completedAt/);
  assert.match(html, /prevProject\.completedAt/);
  assert.match(html, /statusFinal === '終了'/);
});

test('setRevenueBasis and getRevenueBasis accept completed', () => {
  const setFn = sliceFunction('setRevenueBasis', 'openRevenue');
  const getFn = sliceFunction('getRevenueBasis', 'getProjectScope');
  assert.match(setFn, /'completed'/);
  assert.match(getFn, /'completed'/);
});

test('revenue guide explains completed-month and settings location', () => {
  const guide = html.match(/revenue:\s*\{[\s\S]*?body:\s*`([\s\S]*?)`,\n  \}/)?.[1] || '';
  assert.match(guide, /終了月/);
  assert.match(guide, /設定/);
  assert.match(guide, /報酬に関する設定/);
});
