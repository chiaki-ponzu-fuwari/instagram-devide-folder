import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { deriveActivityIdentityUids } from '../www/js/activity-identity.mjs';
import { planActivityIdentityMigration } from '../scripts/activity-identity-migration-core.mjs';

const deletionStore = readFileSync(new URL('../functions/account-deletion-store.mjs', import.meta.url), 'utf8');
const teamCloud = readFileSync(new URL('../www/js/team-cloud.mjs', import.meta.url), 'utf8');

test('activity identity index contains unique structured person UIDs only', () => {
  assert.deepEqual(deriveActivityIdentityUids({
    actorUid: 'actor', targetUid: 'target', memberUid: 'target', ownerUid: 'not-a-person-field',
  }), ['actor', 'target']);
});

test('account deletion uses bounded activity identity queries without a collection scan', () => {
  assert.match(deletionStore, /collectionGroup\('activity'\)\.where\('identityUids', 'array-contains', uid\)/);
  for (const field of ['actorUid', 'targetUid', 'memberUid']) {
    assert.match(deletionStore, new RegExp(`collectionGroup\\('activity'\\)\\.where\\('${field}', '==', uid\\)`));
  }
  assert.doesNotMatch(deletionStore, /pagedCollection\(db\.collectionGroup\('activity'\)/);
});

test('team membership activity writes persist indexed person identities', () => {
  assert.match(teamCloud, /deriveActivityIdentityUids/);
  assert.match(teamCloud, /targetUid:\s*memberId/);
  assert.match(teamCloud, /memberUid:\s*requestUid/);
});

test('migration backfills structured identities and is idempotent', () => {
  const first = planActivityIdentityMigration({
    teamId: 'team-a', members: [],
    activities: [{ id: 'a1', data: { action: 'leaveTeam', actorUid: 'member-a', actorName: 'A' } }],
  });
  assert.deepEqual(first.writes, [{
    path: 'teams/team-a/activity/a1', data: { identityUids: ['member-a'] },
  }]);
  const second = planActivityIdentityMigration({
    teamId: 'team-a', members: [],
    activities: [{ id: 'a1', data: {
      action: 'leaveTeam', actorUid: 'member-a', actorName: 'A', identityUids: ['member-a'],
    } }],
  });
  assert.deepEqual(second.writes, []);
});

test('migration infers a missing removal target only from a unique member display name', () => {
  const unique = planActivityIdentityMigration({
    teamId: 'team-a',
    members: [{ id: 'member-a', data: { uid: 'member-a', displayName: '同じ名前ではない' } }],
    activities: [{ id: 'a1', data: { action: 'removeMember', actorUid: 'admin', targetName: '同じ名前ではない' } }],
  });
  assert.deepEqual(unique.writes[0], {
    path: 'teams/team-a/activity/a1',
    data: { targetUid: 'member-a', identityUids: ['admin', 'member-a'] },
  });

  const ambiguous = planActivityIdentityMigration({
    teamId: 'team-a',
    members: [
      { id: 'member-a', data: { uid: 'member-a', displayName: '同名' } },
      { id: 'member-b', data: { uid: 'member-b', displayName: '同名' } },
    ],
    activities: [{ id: 'a2', data: { action: 'removeMember', actorUid: 'admin', targetName: '同名' } }],
  });
  assert.deepEqual(ambiguous.writes, [{
    path: 'teams/team-a/activity/a2', data: { identityUids: ['admin'] },
  }]);
  assert.deepEqual(ambiguous.report.ambiguous, ['teams/team-a/activity/a2']);
});
