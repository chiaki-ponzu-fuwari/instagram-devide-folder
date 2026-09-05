import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../www/index.html', import.meta.url), 'utf8');

function sliceFunction(name, nextName) {
  const pattern = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = pattern.exec(html);
  const start = match ? match.index : -1;
  assert.notEqual(start, -1, `${name} should exist`);
  const end = nextName ? html.indexOf(`${nextName}`, start + 1) : html.length;
  assert.notEqual(end, -1, `${nextName} should exist after ${name}`);
  return html.slice(start, end);
}

function styleBlock(selector, nextSelector) {
  const start = html.indexOf(selector);
  assert.notEqual(start, -1, `${selector} should exist`);
  const end = html.indexOf(nextSelector, start + selector.length);
  assert.notEqual(end, -1, `${nextSelector} should exist after ${selector}`);
  return html.slice(start, end);
}

test('join request closes the request sheet before showing the done sheet', () => {
  const requestJoinTeam = sliceFunction('requestJoinTeam', 'function openTeamEdit');

  const closeIndex = requestJoinTeam.indexOf("hideModal('teamJoinModal')");
  const showIndex = requestJoinTeam.indexOf("showModal('teamJoinDoneModal')");

  assert.notEqual(closeIndex, -1);
  assert.notEqual(showIndex, -1);
  assert.ok(closeIndex < showIndex);
});

test('team join modal buttons use a non-sticky action area to avoid invisible overlap', () => {
  const actions = styleBlock('.team-join-actions{', '.team-join-actions .btn-row');

  assert.match(html, /<div class="modal-actions team-join-actions">\s*<button type="button" class="btn-row btn-cancel" id="teamJoinCancel"/);
  assert.match(html, /<div class="modal-actions team-join-actions">\s*<button type="button" class="btn-row btn-primary" id="teamJoinDoneClose"/);
  assert.match(actions, /position:\s*relative/);
  assert.match(actions, /bottom:\s*auto/);
  assert.match(actions, /z-index:\s*2/);
});

test('team list exposes invite code entry for joining after app install', () => {
  assert.match(html, /id="teamJoinCodeBtn"/);
  assert.match(html, /id="teamJoinCodeModal"/);
  assert.match(html, /id="teamJoinCodeInput"/);
  assert.match(html, /async function requestJoinTeamByCode/);
  assert.match(html, /api\.requestJoinTeamByCode/);
});
