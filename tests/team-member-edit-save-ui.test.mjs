import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../www/index.html', import.meta.url), 'utf8');

function sliceFunction(name, nextName) {
  const start = html.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const end = html.indexOf(`${nextName}`, start + 1);
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

test('team member edit save button sits at the right edge of the first edit row', () => {
  const overlayStart = html.indexOf('<div class="team-ov" id="teamMemberOv">');
  assert.notEqual(overlayStart, -1);
  const overlayEnd = html.indexOf('<div class="team-ov" id="teamReqOv">', overlayStart);
  assert.notEqual(overlayEnd, -1);
  const overlay = html.slice(overlayStart, overlayEnd);

  assert.doesNotMatch(overlay, /id="teamMemberSaveBtn"/);

  const editRenderer = sliceFunction('renderTeamMemberDetailEdit', 'async function openTeamMemberDetail');
  assert.match(editRenderer, /class="team-member-edit-top-row"/);
  assert.match(editRenderer, /id="teamMemberEditDisplayName"/);
  assert.match(editRenderer, /id="teamMemberInlineSaveBtn"/);

  const nameInputIndex = editRenderer.indexOf('id="teamMemberEditDisplayName"');
  const saveIndex = editRenderer.indexOf('id="teamMemberInlineSaveBtn"');
  assert.ok(nameInputIndex < saveIndex, 'save button should be rendered to the right of the display name input');
});

test('team member edit save button is visually prominent and touch friendly', () => {
  const row = styleBlock('.team-member-edit-top-row{', '.team-member-edit-name{');
  const button = styleBlock('.team-member-inline-save{', '.team-member-inline-save:active');

  assert.match(row, /display:\s*grid/);
  assert.match(row, /grid-template-columns:\s*minmax\(0,1fr\)\s+auto/);
  assert.match(row, /align-items:\s*end/);
  assert.match(button, /min-height:\s*44px/);
  assert.match(button, /padding:\s*0\s+16px/);
  assert.match(button, /background:\s*var\(--ig-grad\)/);
  assert.match(button, /box-shadow:/);
});

test('team member edit save handler is wired to the inline button', () => {
  const opener = sliceFunction('openTeamMemberDetail', 'function openTeamMemberAssignedProjects');

  assert.match(opener, /document\.getElementById\('teamMemberInlineSaveBtn'\)/);
  assert.match(opener, /save\.onclick = async \(\) =>/);
});

test('team member detail body can scroll through long edit forms', () => {
  const body = styleBlock('#teamMemberOv .team-body{', '#teamMemberOv .team-list-card');

  assert.match(body, /flex:\s*1/);
  assert.match(body, /min-height:\s*0/);
  assert.match(body, /overflow-y:\s*auto/);
  assert.match(body, /-webkit-overflow-scrolling:\s*touch/);
  assert.match(body, /padding-bottom:\s*calc\(20px \+ var\(--sb\)\)/);
});

test('team detail no longer exposes payout visibility controls', () => {
  assert.doesNotMatch(html, /id="teamPermPayoutAdmin"/);
  assert.doesNotMatch(html, /id="teamPermPayoutAll"/);
  assert.doesNotMatch(html, /振込先情報の公開範囲/);
});

test('team member detail and edit pages no longer show payout fields', () => {
  const view = sliceFunction('renderTeamMemberDetailView', 'function renderTeamMemberDetailEdit');
  const edit = sliceFunction('renderTeamMemberDetailEdit', 'async function openTeamMemberDetail');
  const opener = sliceFunction('openTeamMemberDetail', 'function openTeamMemberAssignedProjects');

  assert.doesNotMatch(view, /renderPayoutBankViewSection/);
  assert.doesNotMatch(edit, /renderPayoutBankEditHTML/);
  assert.doesNotMatch(edit, /teamMemberEditPayout/);
  assert.doesNotMatch(opener, /updateMemberPayout/);
  assert.doesNotMatch(opener, /payoutPayload/);
});

test('team detail requests only the payout records allowed by the security setting', () => {
  const detail = sliceFunction('openTeamDetail', 'function closeTeam');

  assert.match(detail, /canReadAllPayouts:\s*isAdminViewer \|\| securitySettings\.memberPayoutVisibility === 'all_members'/);
  assert.match(detail, /userUid:\s*String\(user\.uid/);
  assert.doesNotMatch(detail, /event\.type === 'payouts'/);
});
