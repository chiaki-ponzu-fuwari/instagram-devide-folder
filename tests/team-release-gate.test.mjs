import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../www/index.html', import.meta.url), 'utf8');

test('first release hides the team management entry without removing its implementation', () => {
  assert.match(html, /const TEAM_MANAGEMENT_RELEASED = false;/);
  assert.match(html, /<button type="button" class="team-btn" id="teamBtn" hidden>/);
  assert.match(html, /async function openTeamProjectsExpanded\(\)/);
  assert.match(html, /async function openTeamDetail\(\)/);
});

test('header visibility logic cannot re-show the unreleased team entry', () => {
  const source = html.match(/function updateHeaderActionVisibility\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(source, /TEAM_MANAGEMENT_RELEASED/);
  assert.match(source, /teamBtn\.hidden = !TEAM_MANAGEMENT_RELEASED/);
});
