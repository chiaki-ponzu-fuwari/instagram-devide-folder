import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../www/index.html', import.meta.url), 'utf8');

function sliceFunction(name, nextName) {
  const start = html.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const end = nextName ? html.indexOf(`function ${nextName}`, start + 1) : html.length;
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

test('all projects empty state uses the unified Japanese copy', () => {
  const emptyHtml = sliceFunction('allProjectsEmptyHTML', 'accListHTML');

  assert.match(emptyHtml, /表示する案件がありません/);
  assert.match(emptyHtml, /案件を追加すると、/);
  assert.match(emptyHtml, /ここに一覧で表示されます。/);
});

test('all projects empty state title is visually stronger than the body', () => {
  const style = styleBlock('.empty-main-ttl{', '.empty-main-sub');

  assert.match(style, /font-size:\s*20px/);
  assert.match(style, /font-weight:\s*1000/);
});
