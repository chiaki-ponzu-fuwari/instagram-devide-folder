import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const indexHtml = readFileSync(new URL('../www/index.html', import.meta.url), 'utf8');
const i18nJs = readFileSync(new URL('../www/i18n.js', import.meta.url), 'utf8');

test('top empty state uses the approved copy without an inline add button', () => {
  assert.match(indexHtml, /class="empty top-empty-state"/);
  assert.match(indexHtml, /<div class="empty-ttl">表示する案件がありません<\/div>/);
  assert.match(
    indexHtml,
    /<div class="empty-sub empty-description">\s*<span>案件を追加すると、<\/span>\s*<span>ここに一覧で表示されます。<\/span>\s*<\/div>/,
  );

  const emptyHelper = indexHtml.match(
    /function allProjectsEmptyHTML\(\) \{([\s\S]*?)\n\}/,
  )?.[1];
  assert.ok(emptyHelper, 'top empty-state helper should exist');
  assert.doesNotMatch(emptyHelper, /<button\b|案件を追加<\/button>/);
});

test('top empty state keeps its heading on one line and uses shared readable copy styles', () => {
  assert.match(
    indexHtml,
    /\.top-empty-state \.empty-ttl\s*\{[^}]*white-space:\s*nowrap[^}]*\}/,
  );
  assert.match(
    indexHtml,
    /\.empty-description\s*\{[^}]*max-width:[^}]*line-height:[^}]*padding-inline:[^}]*\}/,
  );
  assert.match(
    indexHtml,
    /\.empty-description\s*>\s*span\s*\{[^}]*display:\s*block[^}]*\}/,
  );
});

test('logged-in empty state with only hidden closed projects uses the same responsive copy layout', () => {
  const hiddenDoneHelper = indexHtml.match(
    /function listDoneHiddenEmptyHTML\(\) \{([\s\S]*?)\n\}/,
  )?.[1];

  assert.ok(hiddenDoneHelper, 'hidden closed-project empty-state helper should exist');
  assert.match(hiddenDoneHelper, /class="empty top-empty-state"/);
  assert.match(hiddenDoneHelper, /class="empty-sub empty-description"/);
  assert.match(hiddenDoneHelper, /split\('\\n'\)/);
  assert.match(hiddenDoneHelper, /<span>/);
});

test('logged-in hidden closed-project empty state uses the approved short two-line copy', () => {
  assert.match(
    i18nJs,
    /list_done_hidden_empty_sub: '終了済み案件は非表示になっています。\\n設定から一覧に表示できます。'/,
  );
});
