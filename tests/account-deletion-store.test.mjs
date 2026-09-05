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
  reverifyDeletionBeforeAuthDelete,
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
    settings: {
      assignOwnerUids: ['deleted'], assignedUids: ['deleted'], assigneeUids: ['deleted'],
      assignPermission: 'owner_set',
    },
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
  await db.doc(`teams/${teamId}/memberEmails/deleted`).set({ uid: 'deleted', email: 'deleted@example.com' });
  await db.doc(`teams/${teamId}/memberNotes/deleted`).set({ uid: 'deleted', note: 'secret' });
  await db.doc(`teams/${teamId}/payouts/deleted`).set({ uid: 'deleted', payoutAccount: 'secret' });
  await db.doc(`teams/${teamId}/projects/project-1`).set({
    id: 'project-1', name: 'Shared project', assignedUids: ['deleted'],
    updatedBy: 'deleted', createdBy: 'admin',
  });
  await db.doc(`teams/${teamId}/settings/main`).set({
    assignOwnerUids: ['deleted', 'admin'],
    assignedUids: ['deleted'],
    assignPermission: 'owner_set',
  });
  await db.doc(`teams/${teamId}/projectRewardShares/project-1_deleted`).set({
    projectId: 'project-1', memberUid: 'deleted', amountYen: 5000,
  });
  await db.doc(`teams/${teamId}/projectRewardTotals/project-1`).set({ projectId: 'project-1', totalYen: 10000 });
  await db.doc(`teams/${teamId}/activity/activity-1`).set({
    actorUid: 'deleted', actorName: '山田', actorEmail: 'deleted@example.com',
    action: 'updateRecord', projectName: 'Shared project', targetName: 'Shared project',
    coreText: '「Shared project」を更新しました', text: '山田さんが「Shared project」を更新しました', createdAt: 123,
  });
  await db.doc(`teams/${teamId}/operations/op-deleted`).set({ actorUid: 'deleted' });
  await db.doc(`teams/${teamId}/invites/invite-deleted`).set({ createdBy: 'deleted', code: `${teamId}-code` });
  await db.doc(`teamInviteCodes/${teamId}-code`).set({ createdBy: 'deleted', teamId });
}

function context(overrides = {}) {
  return { requestId, planHash, verifiedEmail: 'deleted@example.com', ...overrides };
}

async function begin(decisions, overrides = {}) {
  const ctx = context(overrides);
  await beginAccountDeletionJob(db, 'deleted', ctx.requestId, ctx.planHash, decisions);
  return ctx;
}

before(() => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Firestore emulator is required');
  app = initializeApp({ projectId }, `account-deletion-store-${Date.now()}`);
  db = getFirestore(app);
});

beforeEach(async () => {
  await Promise.all([
    'teams', 'users', 'accountDeletionJobs', 'accountDeletionLocks', 'teamInviteCodes',
  ].map(clearCollection));
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
  const decisions = [{ teamId: 'team-a', action: 'leave' }];
  const first = await beginAccountDeletionJob(db, 'deleted', requestId, planHash, decisions);
  const retry = await beginAccountDeletionJob(db, 'deleted', requestId, planHash, decisions);
  assert.equal(first.path, retry.path);
  await assert.rejects(
    () => beginAccountDeletionJob(db, 'deleted', requestId, 'different-plan', decisions),
    /plan-hash-mismatch/,
  );
  await assert.rejects(
    () => beginAccountDeletionJob(
      db,
      'deleted',
      'request_223456789012345678901234',
      'another-plan',
      decisions,
    ),
    /account-deletion-in-progress/,
  );
  const lock = (await db.doc('accountDeletionLocks/deleted').get()).data();
  assert.equal(lock.requestId, requestId);
  assert.equal(lock.planHash, planHash);
});

test('member leave preserves shared records and removes identity only from its team', async () => {
  await seedLeaveTeam('team-a');
  await seedLeaveTeam('team-b');
  const ctx = await begin([{ teamId: 'team-a', action: 'leave' }]);

  await assert.rejects(
    () => applyTeamDecision(db, 'deleted', { teamId: 'team-b', action: 'leave' }, ctx),
    /unexpected-team-decision/,
  );
  await applyTeamDecision(db, 'deleted', { teamId: 'team-a', action: 'leave' }, ctx);
  await removeUserIdentityFromTeam(db, 'deleted', 'team-a', ctx);
  await removeUserIdentityFromTeam(db, 'deleted', 'team-a', ctx);

  const teamA = (await db.doc('teams/team-a').get()).data();
  const project = (await db.doc('teams/team-a/projects/project-1').get()).data();
  const activity = (await db.doc('teams/team-a/activity/activity-1').get()).data();
  assert.deepEqual(teamA.memberUids, ['admin']);
  assert.deepEqual(teamA.settings.assignOwnerUids, []);
  assert.deepEqual(teamA.settings.assignedUids, []);
  assert.deepEqual(teamA.settings.assigneeUids, []);
  assert.deepEqual(project.assignedUids, []);
  assert.equal(Object.hasOwn(project, 'assigneeUids'), false);
  assert.deepEqual((await db.doc('teams/team-a/settings/main').get()).data().assignOwnerUids, ['admin']);
  assert.deepEqual((await db.doc('teams/team-a/settings/main').get()).data().assignedUids, []);
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
  assert.deepEqual((await db.doc('teams/team-b/projects/project-1').get()).data().assignedUids, ['deleted']);
});

test('team cleanup pages through more than 200 invite codes created by the deleted member', async () => {
  await seedLeaveTeam('team-a');
  const batch = db.batch();
  for (let index = 0; index < 205; index += 1) {
    batch.set(db.doc(`teamInviteCodes/created-${String(index).padStart(3, '0')}`), {
      createdBy: 'deleted', teamId: 'team-a',
    });
  }
  batch.set(db.doc('teamInviteCodes/other-team-created'), {
    createdBy: 'deleted', teamId: 'other-team',
  });
  await batch.commit();
  const ctx = await begin([{ teamId: 'team-a', action: 'leave' }]);
  await applyTeamDecision(db, 'deleted', { teamId: 'team-a', action: 'leave' }, ctx);
  await removeUserIdentityFromTeam(db, 'deleted', 'team-a', ctx);

  const remaining = await db.collection('teamInviteCodes')
    .where('createdBy', '==', 'deleted').where('teamId', '==', 'team-a').get();
  assert.equal(remaining.empty, true);
  assert.equal((await db.doc('teamInviteCodes/other-team-created').get()).exists, true);
});

test('admin transfer atomically aligns creator, roles, membership and permissions', async () => {
  await db.doc('teams/transfer-team').set(team({
    createdBy: 'deleted', memberUids: ['deleted', 'successor'],
    settings: { assignOwnerUids: ['deleted'], adminUids: ['deleted'], assignPermission: 'owner_set' },
  }));
  await db.doc('teams/transfer-team/members/deleted').set(member('deleted', 'admin'));
  await db.doc('teams/transfer-team/members/successor').set(member('successor'));
  await db.doc('teams/transfer-team/settings/main').set({
    ownerUid: 'deleted', assignOwnerUids: ['deleted'], adminUids: ['deleted'],
  });
  const ctx = await begin([{ teamId: 'transfer-team', action: 'transfer', transferToUid: 'successor' }]);

  await applyTeamDecision(db, 'deleted', {
    teamId: 'transfer-team', action: 'transfer', transferToUid: 'successor',
  }, ctx);

  const transferred = (await db.doc('teams/transfer-team').get()).data();
  assert.equal(transferred.createdBy, 'successor');
  assert.deepEqual(transferred.memberUids, ['successor']);
  assert.deepEqual(transferred.settings.assignOwnerUids, ['successor']);
  assert.deepEqual(transferred.settings.adminUids, ['successor']);
  const transferredSettings = (await db.doc('teams/transfer-team/settings/main').get()).data();
  assert.equal(transferredSettings.ownerUid, 'successor');
  assert.deepEqual(transferredSettings.assignOwnerUids, ['successor']);
  assert.deepEqual(transferredSettings.adminUids, ['successor']);
  assert.equal((await db.doc('teams/transfer-team/members/successor').get()).data().role, 'admin');
  assert.equal((await db.doc('teams/transfer-team/members/deleted').get()).exists, false);
});

test('jobs never persist display names or verified email identifiers', async () => {
  await seedLeaveTeam();
  await db.doc('teams/team-a/members/deleted').update({ displayName: '山田花子' });
  const ctx = await begin([{ teamId: 'team-a', action: 'leave' }]);
  await applyTeamDecision(db, 'deleted', { teamId: 'team-a', action: 'leave' }, ctx);
  const serialized = JSON.stringify((await db.doc(`accountDeletionJobs/deleted_${requestId}`).get()).data());
  assert.doesNotMatch(serialized, /山田花子|deleted@example\.com|knownIdentifiers/);
});

test('identity arrays fail closed and legacy project alias is changed only when present', async () => {
  await seedLeaveTeam();
  await db.doc('teams/team-a/projects/legacy').set({
    id: 'legacy', assignedUids: ['admin'], assigneeUids: ['deleted', 'admin'],
  });
  const ctx = await begin([{ teamId: 'team-a', action: 'leave' }]);
  await applyTeamDecision(db, 'deleted', { teamId: 'team-a', action: 'leave' }, ctx);
  await removeUserIdentityFromTeam(db, 'deleted', 'team-a', ctx);
  const legacy = (await db.doc('teams/team-a/projects/legacy').get()).data();
  assert.deepEqual(legacy.assignedUids, ['admin']);
  assert.deepEqual(legacy.assigneeUids, ['admin']);

  await db.doc('teams/broken').set(team({
    createdBy: 'admin', memberUids: ['admin', 'broken-user'],
    settings: { assignOwnerUids: 'broken-user' },
  }));
  await db.doc('teams/broken/members/admin').set(member('admin', 'admin'));
  await db.doc('teams/broken/members/broken-user').set(member('broken-user'));
  const brokenContext = context({ requestId: 'request_323456789012345678901234' });
  await beginAccountDeletionJob(db, 'broken-user', brokenContext.requestId, planHash, [{ teamId: 'broken', action: 'leave' }]);
  await assert.rejects(
    () => applyTeamDecision(db, 'broken-user', { teamId: 'broken', action: 'leave' }, brokenContext),
    /invalid-identity-array/,
  );
});

test('transfer rejects malformed management arrays without partially changing ownership', async () => {
  await db.doc('teams/broken-transfer').set(team({
    createdBy: 'deleted', memberUids: ['deleted', 'successor'],
    settings: { assignOwnerUids: ['deleted'], adminUids: 'deleted' },
  }));
  await db.doc('teams/broken-transfer/members/deleted').set(member('deleted', 'admin'));
  await db.doc('teams/broken-transfer/members/successor').set(member('successor'));
  await db.doc('teams/broken-transfer/settings/main').set({ ownerUid: 'deleted', assignOwnerUids: ['deleted'] });
  const untouchedActivity = {
    actorUid: 'deleted', actorName: 'Deleted Admin', action: 'leaveTeam',
    text: 'Deleted Adminさんがチームから退出しました', createdAt: 1,
  };
  await db.doc('teams/broken-transfer/activity/untouched').set(untouchedActivity);
  const ctx = await begin([{ teamId: 'broken-transfer', action: 'transfer', transferToUid: 'successor' }]);
  await assert.rejects(() => applyTeamDecision(db, 'deleted', {
    teamId: 'broken-transfer', action: 'transfer', transferToUid: 'successor',
  }, ctx), /invalid-identity-array/);
  assert.equal((await db.doc('teams/broken-transfer').get()).data().createdBy, 'deleted');
  assert.equal((await db.doc('teams/broken-transfer/members/deleted').get()).exists, true);
  assert.deepEqual((await db.doc('teams/broken-transfer/activity/untouched').get()).data(), untouchedActivity);
});

test('invalid successor is rejected before activity anonymization starts', async () => {
  await db.doc('teams/invalid-successor').set(team({
    createdBy: 'deleted', memberUids: ['deleted'],
  }));
  await db.doc('teams/invalid-successor/members/deleted').set(member('deleted', 'admin'));
  const untouchedActivity = {
    actorUid: 'deleted', actorName: 'Deleted Admin', action: 'leaveTeam',
    text: 'Deleted Adminさんがチームから退出しました', createdAt: 1,
  };
  await db.doc('teams/invalid-successor/activity/untouched').set(untouchedActivity);
  const ctx = await begin([{ teamId: 'invalid-successor', action: 'transfer', transferToUid: 'missing' }]);
  await assert.rejects(() => applyTeamDecision(db, 'deleted', {
    teamId: 'invalid-successor', action: 'transfer', transferToUid: 'missing',
  }, ctx), /invalid-successor/);
  assert.deepEqual((await db.doc('teams/invalid-successor/activity/untouched').get()).data(), untouchedActivity);
});

test('dissolve requires a sole effective admin and deletes only that team subtree', async () => {
  await db.doc('teams/solo').set(team({ createdBy: 'deleted', memberUids: ['deleted'] }));
  await db.doc('teams/solo/members/deleted').set(member('deleted', 'admin'));
  await db.doc('teams/solo/projects/p1').set({ name: 'delete me' });
  await db.doc('teams/control').set(team({ createdBy: 'other', memberUids: ['other'] }));
  await db.doc('teams/control/members/other').set(member('other', 'admin'));
  const ctx = await begin([{ teamId: 'solo', action: 'dissolve' }]);
  await assert.rejects(
    () => applyTeamDecision(db, 'deleted', { teamId: 'solo', action: 'dissolve' }, {
      ...ctx,
      recursiveDelete: async (ref) => {
        await db.doc(`${ref.path}/members/deleted`).delete();
        throw new Error('injected-recursive-delete-failure');
      },
    }),
    /injected-recursive-delete-failure/,
  );
  await applyTeamDecision(db, 'deleted', { teamId: 'solo', action: 'dissolve' }, ctx);
  assert.equal((await db.doc('teams/solo').get()).exists, false);
  assert.equal((await db.doc('teams/control').get()).exists, true);

  const request2 = 'request_223456789012345678901234';
  await db.doc('teams/not-solo').set(team({ createdBy: 'deleted2', memberUids: ['deleted2', 'other'] }));
  await db.doc('teams/not-solo/members/deleted2').set(member('deleted2', 'admin'));
  await db.doc('teams/not-solo/members/other').set(member('other'));
  const context2 = context({ requestId: request2 });
  await beginAccountDeletionJob(db, 'deleted2', request2, planHash, [{ teamId: 'not-solo', action: 'dissolve' }]);
  await assert.rejects(
    () => applyTeamDecision(db, 'deleted2', { teamId: 'not-solo', action: 'dissolve' }, context2),
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
  const ctx = await begin([]);
  await deletePersonalCloudData(db, 'deleted', ctx);
  assert.equal((await db.doc('users/deleted').get()).exists, false);
  assert.equal((await db.doc('users/other/projects/one').get()).exists, true);
});

test('ready and complete checkpoints require protected-reference verification', async () => {
  await seedLeaveTeam();
  const ctx = await begin([{ teamId: 'team-a', action: 'leave' }]);
  await assert.rejects(() => verifyNoProtectedReferences(db, 'deleted', ctx), /protected-references-remain/);
  await assert.rejects(() => markDeletionJobReadyForAuthDelete(db, 'deleted', ctx), /team-cleanup-incomplete/);

  await applyTeamDecision(db, 'deleted', { teamId: 'team-a', action: 'leave' }, ctx);
  await assert.rejects(() => markDeletionJobReadyForAuthDelete(db, 'deleted', ctx), /team-cleanup-incomplete/);
  await removeUserIdentityFromTeam(db, 'deleted', 'team-a', ctx);
  await assert.rejects(() => markDeletionJobReadyForAuthDelete(db, 'deleted', ctx), /personal-cleanup-incomplete/);
  await deletePersonalCloudData(db, 'deleted', ctx);
  await db.doc('teams/team-a/memberEmails/deleted').set({ uid: 'deleted', email: 'deleted@example.com' });
  await db.doc('teams/team-a/projects/project-1').update({ assignedUids: ['deleted'] });
  await reverifyDeletionBeforeAuthDelete(db, 'deleted', ctx);
  await markDeletionJobReadyForAuthDelete(db, 'deleted', ctx);
  assert.equal((await db.doc('teams/team-a/memberEmails/deleted').get()).exists, false);
  assert.deepEqual((await db.doc('teams/team-a/projects/project-1').get()).data().assignedUids, []);
  await assert.rejects(() => markDeletionJobComplete(db, 'deleted', ctx), /auth-deletion-required/);
  await markDeletionJobComplete(db, 'deleted', { ...ctx, authDeletionSucceeded: true });
  assert.equal((await db.doc(`accountDeletionJobs/deleted_${requestId}`).get()).data().phase, 'complete');
});

test('activity cleanup anonymizes a deleted target while preserving another actor and project facts', async () => {
  await seedLeaveTeam();
  await db.doc('teams/team-a/members/deleted').update({ displayName: '山田花子' });
  await db.doc('teams/team-a/activity/approval').set({
    actorUid: 'admin', actorName: '管理者', targetUid: 'deleted', targetName: '山田花子',
    action: 'approveMember', projectName: '共有案件', text: '管理者が山田花子（deleted@example.com）を承認', createdAt: 456,
    audit: { memberUid: 'deleted', email: 'deleted@example.com', safeFact: '承認済み' },
    unknownPrivate: { raw: 'uid=deleted' },
  });
  await db.doc('teams/team-a/activity/unstructured').set({
    actorUid: 'admin', actorName: '山田花子', action: 'updateRecord',
    targetName: '山田花子', coreText: '「山田花子」を更新しました',
    text: '山田花子さんが「山田花子」を更新しました', createdAt: 457,
    legacyNote: 'deleted@example.com was shown historically',
  });
  await db.doc('teams/team-a/activity/legacy-join').set({
    action: 'joinTeam', actorUid: 'admin', actorName: '管理者', targetName: '山田花子',
    coreText: 'チームに参加しました', text: '管理者さんが山田花子さんの参加を承認しました',
    contactEmail: 'deleted@example.com', createdAt: 458,
  });
  const ctx = await begin([{ teamId: 'team-a', action: 'leave' }]);
  await applyTeamDecision(db, 'deleted', { teamId: 'team-a', action: 'leave' }, ctx);
  await removeUserIdentityFromTeam(db, 'deleted', 'team-a', ctx);

  const activity = (await db.doc('teams/team-a/activity/approval').get()).data();
  assert.equal(activity.actorUid, 'admin');
  assert.equal(activity.actorName, '管理者');
  assert.equal(activity.targetUid, 'deleted-user');
  assert.equal(activity.targetName, '削除済みユーザー');
  assert.equal(activity.projectName, '共有案件');
  assert.equal(activity.createdAt, 456);
  assert.doesNotMatch(JSON.stringify(activity), /deleted@example\.com|uid=deleted|"deleted"/);
  const unstructured = (await db.doc('teams/team-a/activity/unstructured').get()).data();
  assert.equal(unstructured.actorName, '山田花子');
  assert.equal(unstructured.targetName, '山田花子');
  assert.equal(unstructured.legacyNote, undefined);
  const legacyJoin = (await db.doc('teams/team-a/activity/legacy-join').get()).data();
  assert.equal(legacyJoin.actorUid, 'admin');
  assert.equal(legacyJoin.actorName, '管理者');
  assert.equal(legacyJoin.targetName, '削除済みユーザー');
  assert.equal(legacyJoin.contactEmail, undefined);
  assert.equal(legacyJoin.text, '管理者さんがチームに参加しました');
});

test('non-member pending requests and UID or verified-email invitations are deleted globally', async () => {
  await db.doc('teams/pending-team').set({ createdBy: 'owner', memberUids: ['owner'] });
  await db.doc('teams/pending-team/joinRequests/deleted').set({ uid: 'deleted', email: 'deleted@example.com', status: 'pending' });
  await db.doc('teams/pending-team/joinRequests/other').set({ uid: 'other', email: 'other@example.com', status: 'pending' });
  await db.doc('teams/pending-team/invites/by-uid').set({ invitedUid: 'deleted', code: 'UIDCODE' });
  await db.doc('teams/pending-team/invites/by-email').set({ email: 'deleted@example.com', code: 'EMAILCODE' });
  await db.doc('teams/pending-team/invites/other').set({ invitedUid: 'other', email: 'other@example.com', code: 'OTHERCODE' });
  for (const [code, inviteId] of [['UIDCODE', 'by-uid'], ['EMAILCODE', 'by-email'], ['OTHERCODE', 'other']]) {
    await db.doc(`teamInviteCodes/${code}`).set({ teamId: 'pending-team', inviteId: inviteId });
  }
  const ctx = await begin([]);
  await deletePersonalCloudData(db, 'deleted', ctx);
  assert.equal((await db.doc('teams/pending-team/joinRequests/deleted').get()).exists, false);
  assert.equal((await db.doc('teams/pending-team/invites/by-uid').get()).exists, false);
  assert.equal((await db.doc('teams/pending-team/invites/by-email').get()).exists, false);
  assert.equal((await db.doc('teams/pending-team/joinRequests/other').get()).exists, true);
  assert.equal((await db.doc('teams/pending-team/invites/other').get()).exists, true);
  assert.equal((await db.doc('teamInviteCodes/OTHERCODE').get()).exists, true);
});

test('ready reruns personal and pending identity cleanup instead of trusting a boolean checkpoint', async () => {
  const ctx = await begin([]);
  await deletePersonalCloudData(db, 'deleted', ctx);
  await db.doc('users/deleted/projects/late').set({ ownerUid: 'deleted' });
  await db.doc('teams/pending/invites/late').set({ invitedUid: 'deleted' });
  await markDeletionJobReadyForAuthDelete(db, 'deleted', ctx);
  assert.equal((await db.doc('users/deleted/projects/late').get()).exists, false);
  assert.equal((await db.doc('teams/pending/invites/late').get()).exists, false);
});

test('identity query pagination streams 450 matches without skipping duplicate document IDs', async () => {
  const writes = [];
  for (let index = 0; index < 450; index += 1) {
    writes.push(db.doc(`teams/pending-${index}/invites/shared`).set({ invitedUid: 'deleted' }));
  }
  await Promise.all(writes);
  const ctx = await begin([]);
  await deletePersonalCloudData(db, 'deleted', ctx);
  const remaining = await db.collectionGroup('invites').where('invitedUid', '==', 'deleted').get();
  assert.equal(remaining.empty, true);
});
