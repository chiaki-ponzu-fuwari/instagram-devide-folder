import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../www/index.html', import.meta.url), 'utf8');

const equalTwoOptionIds = [
  'settingsLangSwitch',
  'doneListGroup',
  'repeatClosedListGroup',
  'teamSchedTabs',
  'personalRewardScopeControl',
  'revTabs',
  'teamRevTabs',
  'teamPaneSchedTabs',
];

test('every identified two-option segment uses the shared equal-width class', () => {
  for (const id of equalTwoOptionIds) {
    const tag = html.match(new RegExp(`<div[^>]*id="${id}"[^>]*>`))?.[0];
    assert.ok(tag, `${id} should exist`);
    assert.match(tag, /\bequal-two-option-tabs\b/, `${id} should be equal width`);
  }

  assert.match(html, /class="settings-lang proj-contract-tabs equal-two-option-tabs"/);

  for (const label of [
    'メールアドレスの公開範囲',
    'その他情報の公開範囲',
    '割り振り権限',
    '削除権限',
  ]) {
    const tag = html.match(new RegExp(`<div[^>]*aria-label="${label}"[^>]*>`))?.[0];
    assert.ok(tag, `${label} should exist`);
    assert.match(tag, /\bequal-two-option-tabs\b/);
  }
});

test('the shared class makes exactly two equal columns', () => {
  assert.match(
    html,
    /\.equal-two-option-tabs\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
  );
  assert.match(
    html,
    /\.equal-two-option-tabs\s*>\s*\.settings-lang-btn\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0/,
  );
});

test('personal schedule tabs use a dedicated three-option equal-width layout', () => {
  const tag = html.match(/<div[^>]*id="schedTabs"[^>]*>/)?.[0];
  assert.ok(tag);
  assert.match(tag, /\bequal-three-option-tabs\b/);
  assert.match(
    html,
    /\.equal-three-option-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
  );
});

test('three- and four-option segments are not marked as two-option controls', () => {
  for (const label of ['報酬換算の基準', '報酬の閲覧権限', '投稿プラットフォーム']) {
    const tag = html.match(new RegExp(`<div[^>]*aria-label="${label}"[^>]*>`))?.[0];
    assert.ok(tag, `${label} should exist`);
    assert.doesNotMatch(tag, /\bequal-two-option-tabs\b/);
  }
  assert.doesNotMatch(html.match(/<div class="team-tabs"[^>]*>/)?.[0] || '', /equal-two-option-tabs/);
});
