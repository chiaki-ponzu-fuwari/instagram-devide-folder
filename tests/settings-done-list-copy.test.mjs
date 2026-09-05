import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const i18nSource = readFileSync(new URL('../www/i18n.js', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../www/index.html', import.meta.url), 'utf8');

test('closed-project setting descriptions use the approved concise two-line copy', () => {
  assert.match(
    i18nSource,
    /settings_done_list_body: '案件一覧だけの表示設定です。\\n報酬・分析の画面集計には影響しません。'/,
  );
  assert.match(
    i18nSource,
    /settings_repeat_closed_list_body: '継続案件リストだけの表示設定です。\\n子案件と報酬データは残ります。'/,
  );
});

test('closed-project setting descriptions preserve explicit line breaks in both cards', () => {
  assert.match(
    indexHtml,
    /id="paneDoneListBody"[^>]*white-space:pre-line/,
  );
  assert.match(
    indexHtml,
    /id="paneRepeatClosedListBody"[^>]*white-space:pre-line/,
  );
});
