import { anonymizeActivityRecord } from './account-deletion-core.mjs';

const DELETED_UID = 'deleted-user';
const PAGE_SIZE = 200;
const TEAM_COLLECTIONS = [
  'members', 'memberEmails', 'memberNotes', 'payouts',
  'folders', 'accounts', 'projects', 'templates', 'settings',
  'projectRewardTotals', 'projectRewardShares', 'projectCosts',
  'activity', 'operations', 'invites', 'joinRequests',
];
const SHARED_RECORD_COLLECTIONS = [
  'folders', 'accounts', 'projects', 'templates', 'settings',
  'projectRewardTotals', 'projectCosts',
];
const PERSONAL_COLLECTIONS = ['folders', 'accounts', 'projects', 'templates', 'settings'];
const IDENTITY_METADATA_FIELDS = ['createdBy', 'updatedBy', 'deletedBy', 'ownerUid', 'approvedBy'];

export class AccountDeletionStoreError extends Error {
  constructor(code, details = undefined) {
    super(code);
    this.name = 'AccountDeletionStoreError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, details) {
  throw new AccountDeletionStoreError(code, details);
}

function requireId(value, label) {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 128
    || value === '.'
    || value === '..'
    || /[\/\u0000-\u001f\u007f]/u.test(value)
  ) fail(`invalid-${label}`);
  return value;
}

function jobRef(db, uid, requestId) {
  requireId(uid, 'uid');
  requireId(requestId, 'request-id');
  return db.doc(`accountDeletionJobs/${uid}_${requestId}`);
}

function checkpointKey(teamId) {
  return Buffer.from(teamId, 'utf8').toString('base64url');
}

function checkpointFor(job, teamId) {
  return job?.teamCheckpoints?.[checkpointKey(teamId)];
}

function assertJob(job, uid, requestId, planHash) {
  if (!job || job.uid !== uid || job.requestId !== requestId) fail('deletion-job-mismatch');
  if (planHash !== undefined && job.planHash !== planHash) fail('plan-hash-mismatch');
}

function withoutUid(values, uid) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => value !== uid))];
}

function sanitizedMetadata(data, uid) {
  const next = { ...(data || {}) };
  for (const field of IDENTITY_METADATA_FIELDS) {
    if (next[field] === uid) next[field] = DELETED_UID;
  }
  return next;
}

function teamPatchWithoutUid(team, uid) {
  const settings = team?.settings && typeof team.settings === 'object' ? team.settings : {};
  const patch = {
    memberUids: withoutUid(team?.memberUids, uid),
    settings: {
      ...settings,
      assignOwnerUids: withoutUid(settings.assignOwnerUids, uid),
    },
    updatedAt: Date.now(),
  };
  if (team?.updatedBy === uid) patch.updatedBy = DELETED_UID;
  return patch;
}

async function pagedCollection(collectionRef, visit) {
  let lastId = null;
  while (true) {
    let query = collectionRef.orderBy('__name__').limit(PAGE_SIZE);
    if (lastId !== null) query = query.startAfter(lastId);
    const snapshot = await query.get();
    if (snapshot.empty) return;
    await visit(snapshot.docs);
    lastId = snapshot.docs.at(-1).id;
    if (snapshot.size < PAGE_SIZE) return;
  }
}

async function commitMutations(db, documents, mutate) {
  for (let start = 0; start < documents.length; start += 400) {
    const batch = db.batch();
    for (const snapshot of documents.slice(start, start + 400)) mutate(batch, snapshot);
    await batch.commit();
  }
}

async function readCandidateTeam(db, teamId, uid) {
  const teamSnapshot = await db.doc(`teams/${teamId}`).get();
  if (!teamSnapshot.exists) fail('orphan-membership', { teamId });
  const membersSnapshot = await db.collection(`teams/${teamId}/members`).get();
  const own = membersSnapshot.docs.find((row) => row.id === uid);
  const team = { id: teamId, ...teamSnapshot.data() };
  assertMembershipConsistency(team, membersSnapshot.docs);
  const listed = team.memberUids.includes(uid);
  const creator = team.createdBy === uid;
  if (!own || own.data().uid !== uid || own.data().status !== 'active') {
    fail('inconsistent-membership', { teamId });
  }
  if (!['admin', 'member'].includes(own.data().role)) fail('inconsistent-membership', { teamId });
  if (!listed) fail('inconsistent-membership', { teamId });
  if (creator && own.data().role !== 'admin') fail('inconsistent-membership', { teamId });
  return {
    team,
    memberships: membersSnapshot.docs.map((row) => ({
      teamId,
      uid: row.data().uid || row.id,
      ...row.data(),
    })),
  };
}

function assertMembershipConsistency(team, memberDocuments) {
  if (!Array.isArray(team?.memberUids) || new Set(team.memberUids).size !== team.memberUids.length) {
    fail('inconsistent-membership');
  }
  const activeUids = [];
  for (const snapshot of memberDocuments) {
    const data = snapshot.data();
    if (
      data.uid !== snapshot.id
      || !['admin', 'member'].includes(data.role)
      || !['active', 'pending', 'blocked'].includes(data.status)
    ) fail('inconsistent-membership');
    if (data.status === 'active') activeUids.push(snapshot.id);
  }
  const listed = [...team.memberUids].sort();
  if (listed.join('\n') !== activeUids.sort().join('\n')) fail('inconsistent-membership');
  const creator = memberDocuments.find((snapshot) => snapshot.id === team.createdBy);
  if (!creator || creator.data().status !== 'active' || creator.data().role !== 'admin') {
    fail('inconsistent-admin-state');
  }
}

export async function loadAccountDeletionSnapshot(db, uid) {
  requireId(uid, 'uid');
  const [listedTeams, createdTeams, ownMemberships] = await Promise.all([
    db.collection('teams').where('memberUids', 'array-contains', uid).get(),
    db.collection('teams').where('createdBy', '==', uid).get(),
    db.collectionGroup('members').where('uid', '==', uid).get(),
  ]);
  const teamIds = new Set([
    ...listedTeams.docs.map((row) => row.id),
    ...createdTeams.docs.map((row) => row.id),
  ]);
  for (const membership of ownMemberships.docs) {
    const teamId = membership.ref.parent.parent?.id;
    if (!teamId) fail('orphan-membership');
    teamIds.add(teamId);
  }

  const teams = [];
  const memberships = [];
  for (const teamId of [...teamIds].sort()) {
    const candidate = await readCandidateTeam(db, teamId, uid);
    teams.push(candidate.team);
    memberships.push(...candidate.memberships);
  }
  return { uid, teams, memberships };
}

export async function beginAccountDeletionJob(db, uid, requestId, planHash) {
  requireId(planHash, 'plan-hash');
  const ref = jobRef(db, uid, requestId);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) {
      assertJob(snapshot.data(), uid, requestId, planHash);
      return;
    }
    transaction.create(ref, {
      uid,
      requestId,
      planHash,
      phase: 'started',
      teamCheckpoints: {},
      verificationPassed: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
  return ref;
}

function validateDecision(decision) {
  if (!decision || typeof decision !== 'object') fail('invalid-team-decision');
  const allowed = new Set(['teamId', 'action', 'transferToUid']);
  if (Object.keys(decision).some((field) => !allowed.has(field))) fail('invalid-team-decision');
  requireId(decision.teamId, 'team-id');
  if (!['leave', 'transfer', 'dissolve'].includes(decision.action)) fail('invalid-team-decision');
  if (decision.action === 'transfer') requireId(decision.transferToUid, 'successor-uid');
  if (decision.action !== 'transfer' && Object.hasOwn(decision, 'transferToUid')) fail('invalid-team-decision');
}

export async function applyTeamDecision(db, uid, decision, context = {}) {
  requireId(uid, 'uid');
  validateDecision(decision);
  const { teamId, action } = decision;
  const { requestId, planHash } = context;
  const job = jobRef(db, uid, requestId);
  const team = db.doc(`teams/${teamId}`);
  const ownMember = db.doc(`teams/${teamId}/members/${uid}`);
  const membersQuery = db.collection(`teams/${teamId}/members`);

  let shouldRecursiveDelete = false;
  await db.runTransaction(async (transaction) => {
    const jobSnapshot = await transaction.get(job);
    if (!jobSnapshot.exists) fail('deletion-job-not-found');
    const jobData = jobSnapshot.data();
    assertJob(jobData, uid, requestId, planHash);
    const previous = checkpointFor(jobData, teamId);
    if (previous?.decisionApplied) {
      if (previous.action !== action || previous.transferToUid !== (decision.transferToUid || null)) {
        fail('team-decision-mismatch', { teamId });
      }
      return;
    }

    const teamSnapshot = await transaction.get(team);
    if (!teamSnapshot.exists) {
      if (action === 'dissolve' && previous?.status === 'dissolving') {
        const checkpoints = { ...(jobData.teamCheckpoints || {}) };
        checkpoints[checkpointKey(teamId)] = { ...previous, decisionApplied: true, status: 'complete' };
        transaction.update(job, { teamCheckpoints: checkpoints, updatedAt: Date.now() });
        return;
      }
      fail('team-not-found', { teamId });
    }
    const ownSnapshot = await transaction.get(ownMember);
    if (!ownSnapshot.exists) fail('membership-not-found', { teamId });
    const teamData = teamSnapshot.data();
    const ownData = ownSnapshot.data();
    const members = await transaction.get(membersQuery);
    assertMembershipConsistency(teamData, members.docs);
    if (ownData.uid !== uid || ownData.status !== 'active' || !['admin', 'member'].includes(ownData.role)) {
      fail('inconsistent-membership', { teamId });
    }
    if (!Array.isArray(teamData.memberUids) || !teamData.memberUids.includes(uid)) {
      fail('inconsistent-membership', { teamId });
    }
    const effectiveAdmin = ownData.role === 'admin' || teamData.createdBy === uid;
    if (teamData.createdBy === uid && ownData.role !== 'admin') fail('inconsistent-admin-state', { teamId });

    const checkpoints = { ...(jobData.teamCheckpoints || {}) };
    const checkpoint = {
      teamId,
      action,
      transferToUid: decision.transferToUid || null,
      decisionApplied: action !== 'dissolve',
      status: action === 'dissolve' ? 'dissolving' : 'decision-applied',
    };

    if (action === 'leave') {
      if (effectiveAdmin || ownData.role !== 'member') fail('admin-cannot-leave', { teamId });
      transaction.update(team, teamPatchWithoutUid(teamData, uid));
      transaction.delete(ownMember);
    } else if (action === 'transfer') {
      if (!effectiveAdmin) fail('admin-required', { teamId });
      if (decision.transferToUid === uid) fail('invalid-successor', { teamId });
      const successorRef = db.doc(`teams/${teamId}/members/${decision.transferToUid}`);
      const successorSnapshot = await transaction.get(successorRef);
      if (
        !successorSnapshot.exists
        || successorSnapshot.data().uid !== decision.transferToUid
        || successorSnapshot.data().status !== 'active'
        || !['admin', 'member'].includes(successorSnapshot.data().role)
        || !teamData.memberUids.includes(decision.transferToUid)
      ) fail('invalid-successor', { teamId });
      transaction.update(successorRef, {
        role: 'admin',
        updatedAt: Date.now(),
        updatedBy: decision.transferToUid,
      });
      transaction.update(team, {
        ...teamPatchWithoutUid(teamData, uid),
        createdBy: teamData.createdBy === uid ? decision.transferToUid : teamData.createdBy,
      });
      transaction.delete(ownMember);
    } else {
      if (!effectiveAdmin) fail('admin-required', { teamId });
      if (teamData.createdBy !== uid) fail('not-sole-effective-admin', { teamId });
      const otherActive = members.docs.some((row) => row.id !== uid && row.data().status === 'active');
      if (otherActive) fail('active-members-remain', { teamId });
      shouldRecursiveDelete = true;
    }
    checkpoints[checkpointKey(teamId)] = checkpoint;
    transaction.update(job, { teamCheckpoints: checkpoints, updatedAt: Date.now() });
  });

  if (shouldRecursiveDelete) {
    await db.recursiveDelete(team);
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(job);
      if (!snapshot.exists) fail('deletion-job-not-found');
      const data = snapshot.data();
      assertJob(data, uid, requestId, planHash);
      const checkpoints = { ...(data.teamCheckpoints || {}) };
      checkpoints[checkpointKey(teamId)] = {
        ...(checkpoints[checkpointKey(teamId)] || {}),
        decisionApplied: true,
        status: 'complete',
      };
      transaction.update(job, { teamCheckpoints: checkpoints, updatedAt: Date.now() });
    });
  }
}

export async function removeUserIdentityFromTeam(db, uid, teamId) {
  requireId(uid, 'uid');
  requireId(teamId, 'team-id');
  const team = db.doc(`teams/${teamId}`);
  const teamSnapshot = await team.get();
  if (!teamSnapshot.exists) return;
  if (teamSnapshot.data().createdBy === uid) fail('admin-transfer-required', { teamId });
  await team.update(teamPatchWithoutUid(teamSnapshot.data(), uid));

  const directPrivateRefs = ['members', 'memberEmails', 'memberNotes', 'payouts']
    .map((name) => db.doc(`teams/${teamId}/${name}/${uid}`));
  const directBatch = db.batch();
  for (const ref of directPrivateRefs) directBatch.delete(ref);
  await directBatch.commit();

  for (const collectionName of SHARED_RECORD_COLLECTIONS) {
    await pagedCollection(db.collection(`teams/${teamId}/${collectionName}`), async (documents) => {
      await commitMutations(db, documents, (batch, snapshot) => {
        const data = sanitizedMetadata(snapshot.data(), uid);
        if (collectionName === 'projects') data.assigneeUids = withoutUid(data.assigneeUids, uid);
        batch.set(snapshot.ref, data);
      });
    });
  }

  await pagedCollection(db.collection(`teams/${teamId}/activity`), async (documents) => {
    await commitMutations(db, documents, (batch, snapshot) => {
      const data = anonymizeActivityRecord(snapshot.data(), uid);
      if (data !== snapshot.data()) batch.set(snapshot.ref, data);
    });
  });

  for (const collectionName of [
    'members', 'memberEmails', 'memberNotes', 'payouts',
    'projectRewardShares', 'operations', 'joinRequests', 'invites',
  ]) {
    await pagedCollection(db.collection(`teams/${teamId}/${collectionName}`), async (documents) => {
      await commitMutations(db, documents, (batch, snapshot) => {
        const data = snapshot.data();
        const belongsToUser = (
          data.uid === uid
          || data.memberUid === uid
          || data.actorUid === uid
          || data.invitedUid === uid
          || data.createdBy === uid
          || snapshot.id === uid
        );
        if (belongsToUser) {
          batch.delete(snapshot.ref);
        } else {
          batch.set(snapshot.ref, sanitizedMetadata(data, uid));
        }
      });
    });
  }

  const inviteCodes = await db.collection('teamInviteCodes').where('createdBy', '==', uid).get();
  const matchingCodes = inviteCodes.docs.filter((snapshot) => snapshot.data().teamId === teamId);
  if (matchingCodes.length) {
    await commitMutations(db, matchingCodes, (batch, snapshot) => batch.delete(snapshot.ref));
  }

  const jobs = await db.collection('accountDeletionJobs').where('uid', '==', uid).get();
  const applicableJobs = jobs.docs.filter((snapshot) => checkpointFor(snapshot.data(), teamId));
  if (applicableJobs.length) {
    await commitMutations(db, applicableJobs, (batch, snapshot) => {
      const data = snapshot.data();
      const checkpoints = { ...(data.teamCheckpoints || {}) };
      checkpoints[checkpointKey(teamId)] = {
        ...checkpoints[checkpointKey(teamId)],
        identityRemoved: true,
        status: 'identity-removed',
      };
      batch.update(snapshot.ref, { teamCheckpoints: checkpoints, updatedAt: Date.now() });
    });
  }
}

export async function deletePersonalCloudData(db, uid) {
  requireId(uid, 'uid');
  const userRef = db.doc(`users/${uid}`);
  await db.recursiveDelete(userRef);
  const jobs = await db.collection('accountDeletionJobs').where('uid', '==', uid).get();
  if (!jobs.empty) {
    await commitMutations(db, jobs.docs, (batch, snapshot) => batch.update(snapshot.ref, {
      personalDataDeleted: true,
      updatedAt: Date.now(),
    }));
  }
}

async function queryHasDocument(query) {
  return !(await query.limit(1).get()).empty;
}

export async function verifyNoProtectedReferences(db, uid) {
  requireId(uid, 'uid');
  const checks = [
    db.collection('teams').where('memberUids', 'array-contains', uid),
    db.collection('teams').where('createdBy', '==', uid),
    db.collection('teams').where('settings.assignOwnerUids', 'array-contains', uid),
    db.collectionGroup('members').where('uid', '==', uid),
    db.collectionGroup('memberEmails').where('uid', '==', uid),
    db.collectionGroup('memberNotes').where('uid', '==', uid),
    db.collectionGroup('payouts').where('uid', '==', uid),
    db.collectionGroup('projectRewardShares').where('memberUid', '==', uid),
    db.collectionGroup('projectRewardShares').where('uid', '==', uid),
    db.collectionGroup('projects').where('assigneeUids', 'array-contains', uid),
    db.collectionGroup('joinRequests').where('uid', '==', uid),
    db.collectionGroup('operations').where('actorUid', '==', uid),
    db.collectionGroup('activity').where('actorUid', '==', uid),
    db.collection('teamInviteCodes').where('createdBy', '==', uid),
  ];
  for (const field of ['updatedBy', 'deletedBy', 'ownerUid']) {
    checks.push(db.collection('teams').where(field, '==', uid));
  }
  for (const collectionName of SHARED_RECORD_COLLECTIONS) {
    for (const field of IDENTITY_METADATA_FIELDS) {
      checks.push(db.collectionGroup(collectionName).where(field, '==', uid));
    }
  }
  for (const collectionName of [
    'members', 'memberEmails', 'memberNotes', 'payouts',
    'projectRewardShares', 'joinRequests', 'invites',
  ]) {
    for (const field of IDENTITY_METADATA_FIELDS) {
      checks.push(db.collectionGroup(collectionName).where(field, '==', uid));
    }
  }
  for (const query of checks) {
    if (await queryHasDocument(query)) fail('protected-references-remain');
  }

  const userRef = db.doc(`users/${uid}`);
  if ((await userRef.get()).exists) fail('protected-references-remain');
  for (const collectionName of PERSONAL_COLLECTIONS) {
    if (!(await userRef.collection(collectionName).limit(1).get()).empty) {
      fail('protected-references-remain');
    }
  }
  const remainingSubcollections = await userRef.listCollections();
  for (const collection of remainingSubcollections) {
    if (!(await collection.limit(1).get()).empty) fail('protected-references-remain');
  }
  return { verified: true };
}

export async function markDeletionJobReadyForAuthDelete(db, uid, requestId) {
  await verifyNoProtectedReferences(db, uid);
  const ref = jobRef(db, uid, requestId);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) fail('deletion-job-not-found');
    assertJob(snapshot.data(), uid, requestId);
    transaction.update(ref, {
      phase: 'ready-for-auth-delete',
      verificationPassed: true,
      verifiedAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
}

export async function markDeletionJobComplete(db, uid, requestId) {
  const ref = jobRef(db, uid, requestId);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) fail('deletion-job-not-found');
    const data = snapshot.data();
    assertJob(data, uid, requestId);
    if (!data.verificationPassed || !['ready-for-auth-delete', 'complete'].includes(data.phase)) {
      fail('verification-required');
    }
    transaction.update(ref, {
      phase: 'complete',
      completedAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
}

export { PERSONAL_COLLECTIONS, TEAM_COLLECTIONS };
