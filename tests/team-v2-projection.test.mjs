import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildV2ProjectBundle,
  buildV2Folder,
  buildV2Settings,
} from '../www/js/team-v2-records.mjs';

test('legacy project bundle separates public, reward, share, and cost data', () => {
  const bundle = buildV2ProjectBundle({
    teamId: 'team-a',
    actorUid: 'admin-1',
    now: 1000,
    account: {
      id: 'project-1', teamId: 'team-a', username: '@client', memo: 'memo', ownerUid: 'legacy', collection: 'accounts',
      project: {
        id: 'project-1', name: '春案件', status: '契約中', rewardYen: 20000,
        rewardAllocations: [
          { uid: 'member-1', amountYen: 12000, assigned: true },
          { uid: 'member-2', amountYen: 5000, assigned: false },
        ],
        expenses: [{ id: 'e1', label: '交通費', amountYen: 3000 }],
        assigneeUids: ['member-1'], ownerUid: 'legacy', collection: 'projects',
      },
    },
  });

  assert.deepEqual(Object.keys(bundle.account).sort(), [
    'createdAt', 'deletedAt', 'deletedBy', 'folderId', 'id', 'memo', 'newDM', 'revision',
    'schemaVersion', 'scope', 'teamId', 'updatedAt', 'updatedBy', 'url', 'username',
  ].sort());
  assert.equal('project' in bundle.account, false);
  assert.equal('rewardYen' in bundle.project, false);
  assert.equal('rewardAllocations' in bundle.project, false);
  assert.equal('expenses' in bundle.project, false);
  assert.equal(bundle.rewardTotal.totalYen, 20000);
  assert.deepEqual(bundle.rewardShares.map((row) => [row.memberUid, row.amountYen, row.assigned]), [
    ['member-1', 12000, true],
    ['member-2', 5000, false],
  ]);
  assert.equal(bundle.projectCost.costYen, 3000);
  assert.equal(bundle.project.teamId, 'team-a');
  assert.deepEqual(bundle.project.assigneeUids, ['member-1']);
});

test('v2 public builders reject cross-team records and omit unknown fields', () => {
  assert.throws(() => buildV2Folder({
    teamId: 'team-a', actorUid: 'admin-1', now: 1,
    folder: { id: 'f1', teamId: 'team-b', name: '混線' },
  }), /team-id-mismatch/);
  const settings = buildV2Settings({
    teamId: 'team-a', actorUid: 'admin-1', now: 1,
    settings: { hideDoneProjectsInList: true, costYen: 9999, ownerUid: 'legacy' },
  });
  assert.equal(settings.hideDoneProjectsInList, true);
  assert.equal('costYen' in settings, false);
  assert.equal('ownerUid' in settings, false);
});
