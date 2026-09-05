import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../www/index.html', import.meta.url), 'utf8');

function styleBlock(selector, nextSelector) {
  const start = html.indexOf(selector);
  assert.notEqual(start, -1, `${selector} should exist`);
  const end = html.indexOf(nextSelector, start + selector.length);
  assert.notEqual(end, -1, `${nextSelector} should exist after ${selector}`);
  return html.slice(start, end);
}

function sliceFunction(name, nextName) {
  const start = html.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const end = nextName ? html.indexOf(`function ${nextName}`, start + 1) : html.length;
  assert.notEqual(end, -1, `${nextName} should exist after ${name}`);
  return html.slice(start, end);
}

test('sidebar stays above the overlay so the team button remains clickable', () => {
  const sidebar = styleBlock('.sidebar {', '@media (max-width:768px)');
  const overlay = styleBlock('.overlay {', '.overlay.show');

  assert.match(sidebar, /position:\s*relative/);
  assert.match(sidebar, /z-index:\s*9[0-9]/);
  assert.match(overlay, /z-index:\s*85/);
});

test('logout sheet title includes the signed-in account label', () => {
  const initModals = sliceFunction('initModals', 'showSortPicker');

  assert.match(initModals, /getLoginAccountLabel/);
  assert.match(initModals, /\$\{tt\('settings_login'\)\}\\n\$\{accountLabel\}/);
});

test('team management button has a delegated click fallback', () => {
  const initModals = sliceFunction('initModals', 'showSortPicker');

  assert.match(initModals, /closest\('#teamBtn'\)/);
  assert.match(initModals, /openTeam\(\)/);
  assert.match(initModals, /defaultPrevented/);
});
