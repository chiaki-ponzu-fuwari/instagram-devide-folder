import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import './personal-page-guide-ui.test.mjs';

const html = readFileSync(new URL('../www/index.html', import.meta.url), 'utf8');

function sliceFunction(name, nextName) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);
  const end = html.indexOf(`function ${nextName}(`, start + 1);
  assert.notEqual(end, -1, `${nextName} should follow ${name}`);
  return html.slice(start, end);
}

test('member reward helper returns only the authenticated assigned allocation', () => {
  const source = sliceFunction('getTeamRewardAmountForUser', 'getPersonalAnalysisRecords');
  const factory = new Function(`${source}; return getTeamRewardAmountForUser;`);
  const getAmount = factory();
  const project = {
    rewardAllocations: [
      { uid: 'me', amountYen: 12000, assigned: true },
      { uid: 'other', amountYen: 99000, assigned: true },
      { uid: 'me', amountYen: 8000, assigned: false },
    ],
  };
  assert.equal(getAmount(project, 'me'), 12000);
  assert.equal(getAmount(project, 'other'), 99000);
  assert.equal(getAmount(project, ''), 0);
});

test('personal analysis records collect every active team cache without duplicate projects', () => {
  const source = sliceFunction('getPersonalAnalysisRecords', 'getTeamAnalysisRecords');
  assert.match(source, /getPersonalRewardTeamIds\(\)/);
  assert.match(source, /getTeamAnalysisRecords\(teamId\)/);
  assert.match(source, /getTeamRewardAmountForUser\(a\.project, currentUid\)/);
  assert.match(source, /teamId[\s\S]*a\.id/);
});

test('reward scope control is on the reward page and removed from personal settings', () => {
  const revenue = html.match(/<!-- Revenue View -->([\s\S]*?)<!-- Team View -->/)?.[1] || '';
  const settings = html.match(/<div class="settings-pane" id="paneRevenue">([\s\S]*?)<div class="settings-pane" id="paneDoneList">/)?.[1] || '';
  assert.match(revenue, /id="personalRewardScopeControl"/);
  assert.match(revenue, /id="personalAnaSelf"[\s\S]*個人の報酬/);
  assert.match(revenue, /id="personalAnaSelfTeam"[\s\S]*チーム報酬も含む/);
  assert.match(html, /\.personal-reward-scope\s*\{[^}]*display:grid[^}]*grid-template-columns:1fr 1fr/);
  assert.doesNotMatch(settings, /個人の分析範囲|personalAnalysisCard|personalAnaSelf/);
});

test('first release hides the team reward switch without removing its saved scope support', () => {
  const revenue = html.match(/<!-- Revenue View -->([\s\S]*?)<!-- Team View -->/)?.[1] || '';
  assert.match(html, /const TEAM_REWARD_SCOPE_RELEASED = false;/);
  assert.match(revenue, /id="personalRewardScopeControl"[\s\S]*?hidden/);
  assert.match(revenue, /id="personalTeamRewardSyncNote"[\s\S]*?hidden/);
  assert.match(html, /\.personal-reward-scope\[hidden\],\s*\.personal-reward-sync-note\[hidden\]\s*\{\s*display:none !important;/);
  assert.match(html, /setPersonalRewardAnalysisScope\('personal_plus_team_share'\)/);
});

test('expected reward copy stays one line without changing the two-column card width', () => {
  assert.match(html, /id="revExpectedSub">契約中・納品済み・終了の合計<\/div>/);
  assert.match(html, /class="rev-kpi-item rev-kpi-expected"/);
  assert.match(html, /\.rev-kpi-expected \.rev-kpi-s\s*\{[^}]*white-space:nowrap[^}]*font-size:clamp\(7px, 2\.3vw, 11px\)[^}]*letter-spacing:-\.04em/);
  assert.doesNotMatch(html, /\.rev-kpi-expected\s*\{[^}]*grid-column/);
});

test('team reward sync has explicit loading, cached offline, and partial states', () => {
  assert.match(html, /personalTeamRewardSyncState/);
  assert.match(html, /チーム報酬を同期中/);
  assert.match(html, /保存済みのチーム報酬/);
  assert.match(html, /一部のチーム報酬は未同期/);
  assert.match(html, /loadTeamWorkspaceFromFirestore/);
});
