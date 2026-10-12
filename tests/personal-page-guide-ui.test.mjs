import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../www/index.html', import.meta.url), 'utf8');

test('personal screens provide compact page guide buttons and a detail sheet', () => {
  assert.match(html, /id="mainPageGuideBtn"[^>]*class="[^"]*page-guide-btn[^"]*"[^>]*data-guide-page="main"/);
  assert.match(html, /id="schedulePageGuideBtn" class="page-guide-btn" data-guide-page="schedule"/);
  assert.match(html, /id="revenuePageGuideBtn" class="page-guide-btn" data-guide-page="revenue"/);
  assert.match(html, /id="pageGuideModal"/);
  assert.match(html, /id="pageGuideTitle"/);
  assert.match(html, /id="pageGuideBody"/);
  const guideCss = html.match(/\.page-guide-btn\s*\{([\s\S]*?)\n    \}/)?.[1] || '';
  assert.match(guideCss, /min-width:72px/);
  assert.match(guideCss, /min-height:28px/);
  assert.match(guideCss, /border:1\.5px solid var\(--accent\)/);
  assert.doesNotMatch(guideCss, /min-width:144px/);
  assert.doesNotMatch(guideCss, /min-height:56px/);
});

test('the whole-app guide and page guides use separate, first-open-only help', () => {
  const guide = html.match(/<div class="settings-pane" id="paneGuide">([\s\S]*?)<\/div>\n  <\/div>\n  <div class="settings-bottom-links"/)?.[1] || '';
  assert.match(guide, /全体の使い方/);
  assert.match(guide, /フォルダーを作る/);
  assert.match(guide, /案件を登録する/);
  assert.match(html, /function openPageGuide\(page\)/);
  assert.match(html, /const key = `dm-manager-page-guide-seen-\$\{page\}`/);
  assert.match(html, /prefers-reduced-motion: reduce/);
});

test('project and repeat-case guides explain sorting, revenue, schedules, and the repeat example', () => {
  assert.match(html, /id="repeatCasesPageGuideBtn" class="page-guide-btn" data-guide-page="repeat"/);
  assert.match(html, /repeat:\s*\{/);
  assert.match(html, /継続案件/);
  assert.match(html, /例：A社から毎月PR依頼が来る場合/);
  const mainGuide = html.match(/main:\s*\{[\s\S]*?body:\s*`([\s\S]*?)`,\n  \}/)?.[1] || '';
  assert.match(mainGuide, /表示順/);
  assert.match(mainGuide, /右上の「¥」/);
  assert.match(mainGuide, /スケジュール/);
  assert.match(mainGuide, /ステータスの進め方/);
  assert.match(mainGuide, /相談中 → 契約中 → 納品済 → 終了/);
  assert.match(mainGuide, /入金確認済/);
  assert.match(mainGuide, /納品済 →「入金確認済」にチェック → 終了/);
  assert.match(mainGuide, /ほかに入力できるもの/);
  assert.match(mainGuide, /案件名・撮影日時・下書き提出日時・投稿日時・報酬額/);
});

test('repeat guide stays below a separately scrollable repeat-project list', () => {
  const repeatSheet = html.match(/<div class="modal-ov" id="repeatCasesOv">([\s\S]*?)<\/div>\n<\/div>\n\n<!-- Settings View -->/)?.[1] || '';
  assert.match(repeatSheet, /<div class="repeat-list-scroll">[\s\S]*id="repeatCasesList"[\s\S]*<\/div>\s*<div class="page-guide-bar">/);
  const repeatScrollCss = html.match(/\.repeat-list-scroll\s*\{([\s\S]*?)\n    \}/)?.[1] || '';
  assert.match(repeatScrollCss, /overflow-y:auto/);
});

test('repeat guide explains how a single project becomes a repeat project', () => {
  const repeatGuide = html.match(/repeat:\s*\{[\s\S]*?body:\s*`([\s\S]*?)`,\n  \}/)?.[1] || '';
  assert.match(repeatGuide, /単発案件が継続になった時/);
  assert.match(repeatGuide, /「継続案件」を選んで保存/);
  assert.match(repeatGuide, /最初の子案件として残/);
  assert.match(repeatGuide, /次回からは、その継続案件内で子案件を追加/);
});

test('revenue guide explains each amount and the personal analysis calculations', () => {
  const revenueGuide = html.match(/revenue:\s*\{[\s\S]*?body:\s*`([\s\S]*?)`,\n  \}/)?.[1] || '';
  assert.match(revenueGuide, /想定報酬額/);
  assert.match(revenueGuide, /契約中・納品済み・終了済み/);
  assert.match(revenueGuide, /確定報酬額/);
  assert.match(revenueGuide, /終了済み案件だけ/);
  assert.match(revenueGuide, /確定利益/);
  assert.match(revenueGuide, /確定報酬額 − 確定経費額/);
  assert.match(revenueGuide, /プラットフォーム別の収益/);
  assert.match(revenueGuide, /平均単価/);
  assert.match(revenueGuide, /月次推移/);
});
