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

function sliceFunction(name, nextName) {
  const start = html.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const end = nextName ? html.indexOf(`function ${nextName}`, start + 1) : html.length;
  assert.notEqual(end, -1, `${nextName} should exist after ${name}`);
  return html.slice(start, end);
}

test('team list renders each team as a tappable row button', () => {
  const renderTeamList = sliceFunction('renderTeamList', 'openTeam');

  assert.match(renderTeamList, /<button type="button" class="team-row/);
  assert.match(renderTeamList, /data-tid=/);
});

test('team list rows look like separate raised cards', () => {
  const list = styleBlock('#teamList{', '.team-row{');
  const row = styleBlock('.team-row{', '.team-row::before');

  assert.match(list, /display:\s*flex/);
  assert.match(list, /gap:\s*12px/);
  assert.match(row, /background:\s*var\(--card\)/);
  assert.match(row, /border-radius:\s*20px/);
  assert.match(row, /box-shadow:\s*0 12px 28px/);
  assert.match(row, /min-height:\s*76px/);
  assert.match(row, /margin:\s*0/);
});

test('team list rows include a clear secondary label and chevron affordance', () => {
  const renderTeamList = sliceFunction('renderTeamList', 'openTeam');

  assert.match(renderTeamList, /class="sub"/);
  assert.match(renderTeamList, /class="chev"/);
});

test('team list header keeps only refresh on the right edge', () => {
  assert.match(html, /class="team-list-hdr-actions"/);
  const headerStart = html.indexOf('<div class="team-ov" id="teamListOv">');
  const bodyStart = html.indexOf('<div class="team-body">', headerStart);
  const header = html.slice(headerStart, bodyStart);

  assert.match(header, /id="teamListRefresh"/);
  assert.doesNotMatch(header, /id="teamListAdd"/);
  assert.match(html, /\.team-list-hdr-actions\{/);
  assert.match(html, /id="teamListHdrTitle">チーム一覧<\/span>/);
  assert.match(html, /\.team-list-hdr-spacer\{/);
  assert.match(html, /\.team-list-hdr-title\{[\s\S]*text-align:center/);
  assert.match(html, /\.team-list-hdr-actions\{[\s\S]*justify-content:flex-end/);
});

test('team list primary actions are equal size in one row', () => {
  assert.match(html, /class="team-list-actions"/);
  assert.match(html, /class="team-list-action-btn create" id="teamListAdd"/);
  assert.match(html, /class="team-list-action-btn join" id="teamJoinCodeBtn"/);
  assert.match(html, /\.team-list-actions\{[\s\S]*grid-template-columns:1fr 1fr/);
  assert.match(html, /\.team-list-action-btn\{[\s\S]*min-height:48px/);
});
