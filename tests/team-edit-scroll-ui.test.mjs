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

test('team edit overlay body can scroll to the dangerous actions section', () => {
  const body = styleBlock('#teamEditOv .team-body{', '#teamEditOv .team-edit-pane');

  assert.match(body, /flex:\s*1/);
  assert.match(body, /min-height:\s*0/);
  assert.match(body, /overflow-y:\s*auto/);
  assert.match(body, /-webkit-overflow-scrolling:\s*touch/);
  assert.match(html, /<div class="team-edit-title">危険な操作<\/div>/);
});

test('team edit page has a prominent save button before dangerous actions', () => {
  const saveIndex = html.indexOf('id="teamEditSaveBottom"');
  const dangerIndex = html.indexOf('<div class="team-edit-title">危険な操作</div>');

  assert.notEqual(saveIndex, -1, 'bottom save button should exist');
  assert.notEqual(dangerIndex, -1, 'danger section should exist');
  assert.ok(saveIndex < dangerIndex, 'bottom save button should appear above dangerous actions');
  assert.match(html, /id="teamEditSaveBottom"[\s\S]*変更を保存/);
  assert.match(html, /teamEditSaveBottom[\s\S]*saveTeamEdits\(\)/);
});

test('team edit setting option buttons share equal touch-friendly sizing', () => {
  const group = styleBlock('.team-edit-choice-group .settings-lang-btn{', '.team-edit-choice-group .settings-lang-btn.on');

  assert.match(html, /class="settings-lang team-edit-choice-group equal-two-option-tabs" role="group" aria-label="メールアドレスの公開範囲"/);
  assert.match(html, /class="settings-lang team-edit-choice-group" role="group" aria-label="報酬の閲覧権限"/);
  assert.match(html, /class="settings-lang team-edit-choice-group equal-two-option-tabs" role="group" aria-label="削除権限"/);
  assert.match(group, /flex:\s*1 1 0/);
  assert.match(group, /min-width:\s*0/);
  assert.match(group, /min-height:\s*44px/);
  assert.match(group, /white-space:\s*normal/);
});
