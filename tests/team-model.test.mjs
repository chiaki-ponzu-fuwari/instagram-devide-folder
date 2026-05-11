import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTeamRecord,
  canUseTeamRecord,
  buildActivityText,
} from '../www/js/team-model.mjs';

test('normalizeTeamRecord keeps safe fields and fills metadata', () => {
  const now = 1778493600000;
  const team = normalizeTeamRecord({
    id: 't1',
    name: '  HERAC  ',
    createdBy: 'u1',
  }, { uid: 'u1', now });

  assert.equal(team.id, 't1');
  assert.equal(team.name, 'HERAC');
  assert.equal(team.createdBy, 'u1');
  assert.equal(team.updatedBy, 'u1');
  assert.equal(team.createdAt, now);
  assert.equal(team.updatedAt, now);
  assert.equal(team.deletedAt, null);
});

test('canUseTeamRecord hides soft-deleted records', () => {
  assert.equal(canUseTeamRecord({ id: 'a1', deletedAt: null }), true);
  assert.equal(canUseTeamRecord({ id: 'a1', deletedAt: 1778493600000 }), false);
});

test('buildActivityText creates a short Japanese message', () => {
  assert.equal(
    buildActivityText({ actorName: '山田', action: 'createTeam', targetName: 'HERAC' }),
    '山田さんがチーム「HERAC」を作成しました',
  );
});
