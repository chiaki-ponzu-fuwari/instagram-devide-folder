import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cli = readFileSync(new URL('../scripts/migrate-team-v2.mjs', import.meta.url), 'utf8');

test('apply locks teams before reading data and backs up the locked snapshot', () => {
  const apply = cli.slice(cli.indexOf('for (const initialTeamDoc of teamDocs)'));
  const lock = apply.indexOf("securityMigrationState: 'migrating'");
  const read = apply.indexOf('readTeam(db');
  const backup = apply.indexOf('writeBackup(');
  assert.ok(lock >= 0 && read > lock && backup > read);
});

test('post-write verification compares exact normalized data, not only shape', () => {
  assert.match(cli, /stableJson/);
  assert.match(cli, /expected\.data/);
  assert.match(cli, /data-mismatch/);
});

test('production migration accepts an explicit Firebase CLI credential mode', () => {
  assert.match(cli, /--auth/);
  assert.match(cli, /firebase-cli/);
  assert.match(cli, /prepareFirebaseCliApplicationDefault/);
});
