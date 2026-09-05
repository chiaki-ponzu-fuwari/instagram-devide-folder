import assert from 'node:assert/strict';
import test from 'node:test';
import { planTeamV2Migration, validateMigrationPlan } from '../scripts/team-v2-migration-core.mjs';

test('migration splits legacy public, profile, reward, and cost data without changing team IDs', () => {
  const plan = planTeamV2Migration({
    teamId: 't1', actorUid: 'admin', now: 1000,
    team: { id: 't1', createdBy: 'admin', securityMigrationState: 'locked' },
    collections: {
      members: [{ id: 'u1', data: { uid: 'u1', role: 'member', status: 'active', displayName: 'A', email: 'a@example.com', note: 'private' } }],
      accounts: [{ id: 'a1', data: { id: 'a1', teamId: 't1', username: '@a', project: {
        id: 'p1', accountId: 'a1', teamId: 't1', name: '案件', rewardYen: 10000,
        rewardAllocations: [{ uid: 'u1', amountYen: 7000, assigned: true }],
        expenses: [{ label: '交通費', amountYen: 1000 }],
      } } }],
    },
  });
  assert.equal(validateMigrationPlan(plan).valid, true);
  const byPath = new Map(plan.writes.map((row) => [row.path, row.data]));
  assert.equal(byPath.get('teams/t1/members/u1').email, undefined);
  assert.equal(byPath.get('teams/t1/memberEmails/u1').email, 'a@example.com');
  assert.equal(byPath.get('teams/t1/memberNotes/u1').note, 'private');
  assert.equal(byPath.get('teams/t1/accounts/a1').project, undefined);
  assert.equal(byPath.get('teams/t1/projects/p1').rewardYen, undefined);
  assert.equal(byPath.get('teams/t1/projectRewardTotals/p1').totalYen, 10000);
  assert.equal(byPath.get('teams/t1/projectRewardShares/p1_u1').amountYen, 7000);
  assert.equal(byPath.get('teams/t1/projectCosts/p1').costYen, 1000);
});

test('migration rejects a record embedded with another team ID', () => {
  assert.throws(() => planTeamV2Migration({
    teamId: 't1', actorUid: 'admin',
    team: { id: 't1' },
    collections: { accounts: [{ id: 'a1', data: { id: 'a1', teamId: 't2' } }] },
  }), /team-id-mismatch/);
});

test('ready migration with no legacy fields is reported as an idempotent verification', () => {
  const plan = planTeamV2Migration({
    teamId: 't1', actorUid: 'admin',
    team: { id: 't1', securitySchemaVersion: 2, securityMigrationState: 'ready' },
    collections: {},
  });
  assert.equal(plan.alreadyReady, true);
  assert.equal(validateMigrationPlan(plan).valid, true);
});

test('newer separated rewards win over older embedded legacy rewards', () => {
  const plan = planTeamV2Migration({
    teamId: 't1', actorUid: 'admin', now: 1000, team: { id: 't1' },
    collections: {
      projectRewardTotals: [{ id: 'p1', data: { projectId: 'p1', totalYen: 15000, updatedAt: 900 } }],
      projectRewardShares: [{ id: 'p1_u1', data: { projectId: 'p1', memberUid: 'u1', amountYen: 12000, assigned: true, updatedAt: 900 } }],
      projects: [{ id: 'p1', data: { id: 'p1', teamId: 't1', accountId: 'a1', updatedAt: 800, rewardYen: 10000,
        rewardAllocations: [{ uid: 'u1', amountYen: 7000, assigned: true }] } }],
    },
  });
  const byPath = new Map(plan.writes.map((row) => [row.path, row.data]));
  assert.equal(byPath.get('teams/t1/projectRewardTotals/p1').totalYen, 15000);
  assert.equal(byPath.get('teams/t1/projectRewardShares/p1_u1').amountYen, 12000);
});

test('newer embedded allocation clears an omitted old separated share', () => {
  const plan = planTeamV2Migration({
    teamId: 't1', actorUid: 'admin', now: 1000, team: { id: 't1' },
    collections: {
      projectRewardShares: [{ id: 'p1_u2', data: { projectId: 'p1', memberUid: 'u2', amountYen: 5000, assigned: true, updatedAt: 700 } }],
      projects: [{ id: 'p1', data: { id: 'p1', teamId: 't1', updatedAt: 800, rewardAllocations: [] } }],
    },
  });
  const cleared = plan.writes.find((row) => row.path === 'teams/t1/projectRewardShares/p1_u2')?.data;
  assert.equal(cleared.amountYen, 0);
  assert.equal(cleared.assigned, false);
});
