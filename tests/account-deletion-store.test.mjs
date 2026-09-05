import assert from 'node:assert/strict';
import test, { before, beforeEach, after } from 'node:test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import {
  applyTeamDecision,
  beginAccountDeletionJob,
  deletePersonalCloudData,
  loadAccountDeletionSnapshot,
  markDeletionJobComplete,
  markDeletionJobReadyForAuthDelete,
  removeUserIdentityFromTeam,
  verifyNoProtectedReferences,
} from '../functions/account-deletion-store.mjs';

const projectId = 'dm-manager-account-deletion';
const requestId = 'request_123456789012345678901234';
const planHash = 'plan-hash-1';
let app;
let db;

function team(overrides = {}) {
  return {
    name: 'Team', createdBy: 'admin', memberUids: ['admin', 'deleted'],
    settings: { assignOwnerUids: ['deleted'], assignPermission: 'owner_set' },
    ...overrides,
  };
}

function member(uid, role = 'member', overrides = {}) {
  return { uid, role, status: 'active', displayName: uid, ...overrides };
}

async function clearCollection(name) {
  await db.recursiveDelete(db.collection(name));
}

async function seedLeaveTeam(teamId = 'team-a') {
  await db.doc(`teams/${teamId}`).set(team());
  await db.doc(`teams/${teamId}/members/admin`).set(member('admin', 'admin', { updatedBy: 'deleted' }));
  await db.doc(`teams/${teamId}/members/deleted`).set(member('deleted'));
  await db.doc(`teams/${teamId}/memberEmails/deleted`).set({ uid: 'deleted', email: 'secret@example.com' });
  await db.doc(`teams/${teamId}/memberNotes/deleted`).set({ uid: 'deleted', note: 'secret' });
  await db.doc(`teams/${teamId}/payouts/deleted`).set({ uid: 'deleted', payoutAccount: 'secret' });
  await db.doc(`teams/${teamId}/projects/project-1`).set({
    id: 'project-1', name: 'Shared project', assigneeUids: ['deleted'],
    updatedBy: 'deleted', createdBy: 'admin',
  });
  await db.doc(`teams/${teamId}/projectRewardShares/project-1_deleted`).set({
    projectId: 'project-1', memberUid: 'deleted', amountYen: 5000,
  });
  await db.doc(`teams/${teamId}/projectRewardTotals/project-1`).set({ projectId: 'project-1', totalYen: 10000 });
  await db.doc(`teams/${teamId}/activity/activity-1`).set({
    actorUid: 'deleted', actorName: '山田', actorEmail: 'secret@example.com',
    action: 'updateRecord', projectName: 'Shared project', targetName: 'Shared project',
    coreText: '「Shared project」を更新しました', text: '山田さんが「Shared project」を更新しました', createdAt: 123,
  });
  await db.doc(`teams/${teamId}/operations/op-deleted`).set({ actorUid: 'deleted' });
  await db.doc(`teams/${teamId}/invites/invite-deleted`).set({ createdBy: 'deleted', code: `${teamId}-code` });
  await db.doc(`teamInviteCodes/${teamId}-code`).set({ createdBy: 'deleted', teamId });
}

before(() => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Firestore emulator is required');
  app = initializeApp({ projectId }, `account-deletion-store-${Date.now()}`);
  db = getFirestore(app);
});

beforeEach(async () => {
  await Promise.all(['teams', 'users', 'accountDeletionJobs', 'teamInviteCodes'].map(clearCollection));
});

after(async () => { await deleteApp(app); });

test('snapshot uses actual team and member paths and rejects orphan memberships', async () => {
  await seedLeaveTeam();
  const snapshot = await loadAccountDeletionSnapshot(db, 'deleted');
  assert.deepEqual(snapshot.teams.map((row) => row.id), ['team-a']);
  assert.ok(snapshot.memberships.some((row) => row.teamId === 'team-a' && row.uid === 'deleted'));

  await db.doc('teams/missing/members/deleted').set(member('deleted'));
  await assert.rejects(() => loadAccountDeletionSnapshot(db, 'deleted'), /orphan-membership/);
});

test('job creation is idempotent and rejects a changed plan hash', async () => {
  const first = await beginAccountDeletionJob(db, 'deleted', requestId, planHash);
  const retry = await beginAccountDeletionJob(db, 'deleted', requestId, planHash);
  assert.equal(first.path, retry.path);
  await assert.rejects(
    () => beginAccountDeletionJob(db, 'deleted', requestId, 'different-plan'),
    /plan-hash-mismatch/,
  );
});

test('member leave preserves shared records and removes identity only from its team', async () => {
  await seedLeaveTeam('team-a');
  await seedLeaveTeam('team-b');
  await beginAccountDeletionJob(db, 'deleted', requestId, planHash);

  await applyTeamDecision(db, 'deleted', { teamId: 'team-a', action: 'leave' }, { requestId, planHash });
  await removeUserIdentityFromTeam(db, 'deleted', 'team-a');
  await removeUserIdentityFromTeam(db, 'deleted', 'team-a');

  const teamA = (await db.doc('teams/team-a').get()).data();
  const project = (await db.doc('teams/team-a/projects/project-1').get()).data();
  const activity = (await db.doc('teams/team-a/activity/activity-1').get()).data();
  assert.deepEqual(teamA.memberUids, ['admin']);
  assert.deepEqual(teamA.settings.assignOwnerUids, []);
  assert.deepEqual(project.assigneeUids, []);
  assert.equal(project.updatedBy, 'deleted-user');
  assert.equal(activity.actorUid, 'deleted-user');
  assert.equal(activity.actorName, '削除済みユーザー');
  assert.equal(activity.actorEmail, undefined);
  assert.equal(activity.projectName, 'Shared project');
  assert.equal(activity.createdAt, 123);
  assert.equal((await db.doc('teams/team-a/projectRewardTotals/project-1').get()).exists, true);
  assert.equal((await db.doc('teams/team-a/members/admin').get()).data().updatedBy, 'deleted-user');
  assert.equal((await db.doc('teamInviteCodes/team-a-code').get()).exists, false);
  assert.equal((await db.doc('teamInviteCodes/team-b-code').get()).exists, true);
  for (const path of [
    'members/deleted', 'memberEmails/deleted', 'memberNotes/deleted',
    'payouts/deleted', 'projectRewardShares/project-1_deleted', 'operations/op-deleted',
  ]) assert.equal((await db.doc(`teams/team-a/${path}`).get()).exists, false, path);
  assert.equal((await db.doc('teams/team-b/members/deleted').get()).exists, true);
  assert.deepEqual((await db.doc('teams/team-b/projects/project-1').get()).data().assigneeUids, ['deleted']);
});

test('admin transfer atomically aligns creator, roles, membership and permissions', async () => {
  await db.doc('teams/transfer-team').set(team({
    createdBy: 'deleted', memberUids: ['deleted', 'successor'],
    settings: { assignOwnerUids: ['deleted'], assignPermission: 'owner_set' },
  }));
  await db.doc('teams/transfer-team/members/deleted').set(member('deleted', 'admin'));
  await db.doc('teams/transfer-team/members/successor').set(member('successor'));
  await beginAccountDeletionJob(db, 'deleted', requestId, planHash);

  await applyTeamDecision(db, 'deleted', {
    teamId: 'transfer-team', action: 'transfer', transferToUid: 'successor',
  }, { requestId, planHash });

  const transferred = (await db.doc('teams/transfer-team').get()).data();
  assert.equal(transferred.createdBy, 'successor');
  assert.deepEqual(transferred.memberUids, ['successor']);
  assert.deepEqual(transferred.settings.assignOwnerUids, []);
  assert.equal((await db.doc('teams/transfer-team/members/successor').get()).data().role, 'admin');
  assert.equal((await db.doc('teams/transfer-team/members/deleted').get()).exists, false);
});

test('dissolve requires a sole effective admin and deletes only that team subtree', async () => {
  await db.doc('teams/solo').set(team({ createdBy: 'deleted', memberUids: ['deleted'] }));
  await db.doc('teams/solo/members/deleted').set(member('deleted', 'admin'));
  await db.doc('teams/solo/projects/p1').set({ name: 'delete me' });
  await db.doc('teams/control').set(team({ createdBy: 'other', memberUids: ['other'] }));
  await db.doc('teams/control/members/other').set(member('other', 'admin'));
  await beginAccountDeletionJob(db, 'deleted', requestId, planHash);
  await applyTeamDecision(db, 'deleted', { teamId: 'solo', action: 'dissolve' }, { requestId, planHash });
  assert.equal((await db.doc('teams/solo').get()).exists, false);
  assert.equal((await db.doc('teams/control').get()).exists, true);

  const request2 = 'request_223456789012345678901234';
  await db.doc('teams/not-solo').set(team({ createdBy: 'deleted', memberUids: ['deleted', 'other'] }));
  await db.doc('teams/not-solo/members/deleted').set(member('deleted', 'admin'));
  await db.doc('teams/not-solo/members/other').set(member('other'));
  await beginAccountDeletionJob(db, 'deleted', request2, planHash);
  await assert.rejects(
    () => applyTeamDecision(db, 'deleted', { teamId: 'not-solo', action: 'dissolve' }, { requestId: request2, planHash }),
    /active-members-remain/,
  );
  assert.equal((await db.doc('teams/not-solo').get()).exists, true);
});

test('personal cloud deletion removes the user document and every nested document', async () => {
  await db.doc('users/deleted').set({ email: 'secret@example.com' });
  for (const name of ['folders', 'accounts', 'projects', 'templates', 'settings']) {
    await db.doc(`users/deleted/${name}/one`).set({ ownerUid: 'deleted' });
  }
  await db.doc('users/other/projects/one').set({ ownerUid: 'other' });
  await deletePersonalCloudData(db, 'deleted');
  assert.equal((await db.doc('users/deleted').get()).exists, false);
  assert.equal((await db.doc('users/other/projects/one').get()).exists, true);
});

test('ready and complete checkpoints require protected-reference verification', async () => {
  await seedLeaveTeam();
  await beginAccountDeletionJob(db, 'deleted', requestId, planHash);
  await assert.rejects(() => verifyNoProtectedReferences(db, 'deleted'), /protected-references-remain/);
  await assert.rejects(() => markDeletionJobReadyForAuthDelete(db, 'deleted', requestId), /protected-references-remain/);

  await applyTeamDecision(db, 'deleted', { teamId: 'team-a', action: 'leave' }, { requestId, planHash });
  await removeUserIdentityFromTeam(db, 'deleted', 'team-a');
  await deletePersonalCloudData(db, 'deleted');
  await markDeletionJobReadyForAuthDelete(db, 'deleted', requestId);
  await markDeletionJobComplete(db, 'deleted', requestId);
  assert.equal((await db.doc(`accountDeletionJobs/deleted_${requestId}`).get()).data().phase, 'complete');
});
