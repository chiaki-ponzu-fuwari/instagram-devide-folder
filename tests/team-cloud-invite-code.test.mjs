import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../www/js/team-cloud.mjs', import.meta.url), 'utf8');

function sliceFunction(name, nextName) {
  const start = source.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const end = nextName ? source.indexOf(`export async function ${nextName}`, start + 1) : source.length;
  assert.notEqual(end, -1, `${nextName} should exist after ${name}`);
  return source.slice(start, end);
}

test('createInvite writes an invite-code lookup document', () => {
  const fn = sliceFunction('createInvite', 'requestJoinTeam');

  assert.match(fn, /doc\(db,\s*'teamInviteCodes',\s*code\)/);
  assert.match(fn, /inviteId:\s*inviteDoc\.id/);
  assert.match(fn, /teamId/);
  assert.match(fn, /teamName/);
});

test('requestJoinTeamByCode resolves code before creating a join request', () => {
  const fn = sliceFunction('requestJoinTeamByCode', 'approveJoinRequest');

  assert.match(fn, /doc\(db,\s*'teamInviteCodes',\s*normalizedCode\)/);
  assert.match(fn, /getDoc\(codeRef\)/);
  assert.match(fn, /requestJoinTeam\(\{/);
  assert.match(fn, /inviteId:\s*invite\.inviteId/);
});
