import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../www/index.html', import.meta.url), 'utf8');

test('personal templates have horizontal all and add-category tabs without changing cards', () => {
  const pane = html.match(/id="paneTemplates">([\s\S]*?)<div class="settings-pane" id="paneTerms">/)?.[1] || '';
  assert.match(pane, /id="templateCategoryTabs"/);
  assert.match(pane, /data-template-category="all"/);
  assert.match(pane, /id="templateCategoryAddBtn"/);
  assert.match(html, /\.template-category-tabs\s*\{[^}]*overflow-x:auto/);
  assert.match(html, /class="tmpl-card"/);
});

test('template editor has a personal category selection and team templates do not use it', () => {
  assert.match(html, /id="tmplCategoryWrap"/);
  assert.match(html, /id="tmplCategory"/);
  assert.match(html, /origin === 'teamTemplates'/);
});

test('template guide stays below a separately scrollable template list', () => {
  const pane = html.match(/id="paneTemplates">([\s\S]*?)<div class="settings-pane" id="paneTerms">/)?.[1] || '';
  assert.match(pane, /<div class="template-pane-scroll">[\s\S]*id="templateList"[\s\S]*<\/div>\s*<div class="page-guide-bar">/);
  assert.match(html, /\.template-pane-scroll\s*\{[^}]*overflow-y:auto/);
  assert.match(html, /#paneTemplates\.show\s*\{[^}]*display:\s*flex/);
});

test('template guide covers category tabs, renaming, and changing a saved template category', () => {
  assert.match(html, /template:\s*\{/);
  assert.match(html, /カテゴリタブ/);
  assert.match(html, /カテゴリを変更/);
  const templateGuide = html.match(/template:\s*\{[\s\S]*?body:\s*`([\s\S]*?)`,\n  \}/)?.[1] || '';
  assert.match(templateGuide, /名前を変更|名前変更|✏/);
  assert.match(templateGuide, /並び替え|削除/);
});

test('settings guide presents the five personal workflow steps as readable cards', () => {
  const guide = html.match(/id="paneGuideDoc">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*<div class="settings-bottom-links/)?.[1] || '';
  assert.match(guide, /class="guide-step-card"/);
  assert.match(guide, /5\. テンプレートを使う/);
  assert.match(html, /\.guide-step-card\s*\{/);
});
