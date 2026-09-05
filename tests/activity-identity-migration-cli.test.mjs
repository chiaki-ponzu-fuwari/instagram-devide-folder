import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cli = readFileSync(new URL('../scripts/migrate-activity-identity-uids.mjs', import.meta.url), 'utf8');

test('activity identity migration requires an explicit safe mode and project confirmation', () => {
  assert.match(cli, /--dry-run/);
  assert.match(cli, /--apply/);
  assert.match(cli, /--confirm-project/);
  assert.match(cli, /applicationDefault/);
});

test('activity identity migration pages activity and merges only planned patches', () => {
  assert.match(cli, /orderBy\('__name__'\)/);
  assert.match(cli, /startAfter/);
  assert.match(cli, /planActivityIdentityMigration/);
  assert.match(cli, /merge:\s*true/);
  assert.match(cli, /ambiguous/);
  assert.match(cli, /unresolved/);
});
