import { anonymizeActivityRecord } from './account-deletion-core.mjs';

const DELETED_UID = 'deleted-user';
const DELETED_LABEL = '削除済みユーザー';
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
const UID_FIELDS = new Set([
  'uid', 'actorUid', 'targetUid', 'memberUid', 'createdBy', 'updatedBy',
  'deletedBy', 'ownerUid', 'approvedBy', 'invitedUid',
]);
const UID_ARRAY_FIELDS = new Set([
  'assignedUids', 'assigneeUids', 'memberUids', 'assignOwnerUids',
]);
const DROP = Symbol('drop');
const MANAGEMENT_UID_ARRAY_FIELDS = ['assignOwnerUids', 'adminUids', 'ownerUids', 'managerUids'];
const SETTINGS_UID_ARRAY_FIELDS = [...MANAGEMENT_UID_ARRAY_FIELDS, 'assignedUids', 'assigneeUids'];
const PERSON_TARGET_ACTIONS = new Set(['removeMember', 'approveMember', 'rejectMember']);
const PERSON_SHARED_FIELDS = new Set([
  'id', 'type', 'action', 'projectId', 'projectName', 'coreText', 'text',
  'createdAt', 'updatedAt', 'occurredAt',
  ...UID_FIELDS, 'name', 'displayName', 'memberName', 'actorName', 'targetName',
  'target', 'member', 'person',
]);

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
    typeof value !== 'string' || value.length < 1 || value.length > 128
    || value === '.' || value === '..' || /[\/\u0000-\u001f\u007f]/u.test(value)
  ) fail(`invalid-${label}`);
  return value;
}

function jobRef(db, uid, requestId) {
  requireId(uid, 'uid');
  requireId(requestId, 'request-id');
  return db.doc(`accountDeletionJobs/${uid}_${requestId}`);
}

function lockRef(db, uid) {
  requireId(uid, 'uid');
  return db.doc(`accountDeletionLocks/${uid}`);
}

function checkpointKey(teamId) {
  return Buffer.from(teamId, 'utf8').toString('base64url');
}

function checkpointFor(job, teamId) {
  return job?.teamCheckpoints?.[checkpointKey(teamId)];
}

function assertJob(job, uid, requestId, planHash) {
  if (!job || job.uid !== uid || job.requestId !== requestId) fail('deletion-job-mismatch');
  if (job.planHash !== planHash) fail('plan-hash-mismatch');
}

function contextIds(context) {
  if (!context || typeof context !== 'object') fail('deletion-job-context-required');
  return {
    requestId: requireId(context.requestId, 'request-id'),
    planHash: requireId(context.planHash, 'plan-hash'),
  };
}

function identityArray(data, field) {
  if (!Object.hasOwn(data || {}, field)) return [];
  const values = data[field];
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
    fail('invalid-identity-array', { field });
  }
  return [...new Set(values)];
}

function withoutUid(data, field, uid) {
  return identityArray(data, field).filter((value) => value !== uid);
}

function replaceUid(data, field, uid, successorUid) {
  return [...new Set(identityArray(data, field).map((value) => (value === uid ? successorUid : value)))];
}

function sanitizedMetadata(data, uid) {
  const next = { ...(data || {}) };
  for (const field of IDENTITY_METADATA_FIELDS) {
    if (next[field] === uid) next[field] = DELETED_UID;
  }
  return next;
}

function teamPatchWithoutUid(team, uid) {
  if (team?.settings !== undefined && (!team.settings || typeof team.settings !== 'object' || Array.isArray(team.settings))) {
    fail('invalid-team-settings');
  }
  const settings = team?.settings || {};
  const nextSettings = { ...settings };
  for (const field of SETTINGS_UID_ARRAY_FIELDS) {
    if (Object.hasOwn(settings, field)) nextSettings[field] = withoutUid(settings, field, uid);
  }
  const patch = {
    memberUids: withoutUid(team, 'memberUids', uid),
    settings: nextSettings,
    updatedAt: Date.now(),
  };
  if (team?.updatedBy === uid) patch.updatedBy = DELETED_UID;
  return patch;
}

function transferManagementFields(data, uid, successorUid) {
  const next = { ...(data || {}) };
  for (const field of MANAGEMENT_UID_ARRAY_FIELDS) {
    if (Object.hasOwn(next, field)) next[field] = replaceUid(next, field, uid, successorUid);
  }
  if (Object.hasOwn(next, 'ownerUid')) {
    if (typeof next.ownerUid !== 'string') fail('invalid-management-uid', { field: 'ownerUid' });
    if (next.ownerUid === uid) next.ownerUid = successorUid;
  }
  return next;
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

function normalizedDecisions(decisions) {
  if (!Array.isArray(decisions)) fail('invalid-team-decisions');
  const seen = new Set();
  return decisions.map((decision) => {
    validateDecision(decision);
    if (seen.has(decision.teamId)) fail('duplicate-team-decision');
    seen.add(decision.teamId);
    return {
      teamId: decision.teamId,
      action: decision.action,
      transferToUid: decision.transferToUid || null,
    };
  }).sort((left, right) => left.teamId.localeCompare(right.teamId));
}

function decisionsEqual(left, right) {
  return JSON.stringify(left || []) === JSON.stringify(right || []);
}

async function getBoundJob(db, uid, context) {
  const { requestId, planHash } = contextIds(context);
  const [jobSnapshot, lockSnapshot] = await Promise.all([
    jobRef(db, uid, requestId).get(), lockRef(db, uid).get(),
  ]);
  if (!jobSnapshot.exists) fail('deletion-job-not-found');
  assertJob(jobSnapshot.data(), uid, requestId, planHash);
  if (!lockSnapshot.exists) fail('deletion-lock-not-found');
  assertJob(lockSnapshot.data(), uid, requestId, planHash);
  return { ref: jobSnapshot.ref, data: jobSnapshot.data(), requestId, planHash };
}

async function pagedCollection(collectionRef, visit) {
  let lastDocument = null;
  while (true) {
    let query = collectionRef.orderBy('__name__').limit(PAGE_SIZE);
    if (lastDocument !== null) query = query.startAfter(lastDocument);
    const snapshot = await query.get();
    if (snapshot.empty) return;
    await visit(snapshot.docs);
    lastDocument = snapshot.docs.at(-1);
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

function canonicalMembershipTeam(team, memberDocuments) {
  const activeUids = [];
  for (const snapshot of memberDocuments) {
    const data = snapshot.data();
    if (
      data.uid !== snapshot.id || !['admin', 'member'].includes(data.role)
      || !['active', 'pending', 'blocked'].includes(data.status)
    ) fail('inconsistent-membership');
    if (data.status === 'active') activeUids.push(snapshot.id);
  }
  if (team?.memberUids !== undefined && (
    !Array.isArray(team.memberUids)
    || new Set(team.memberUids).size !== team.memberUids.length
    || [...team.memberUids].sort().join('\n') !== [...activeUids].sort().join('\n')
  )) {
    fail('inconsistent-membership');
  }
  const creator = memberDocuments.find((snapshot) => snapshot.id === team.createdBy);
  if (!creator || creator.data().status !== 'active' || creator.data().role !== 'admin') {
    fail('inconsistent-admin-state');
  }
  return { ...team, memberUids: activeUids };
}

function assertMembershipConsistency(team, memberDocuments) {
  canonicalMembershipTeam(team, memberDocuments);
}

async function readCandidateTeam(db, teamId, uid) {
  const teamSnapshot = await db.doc(`teams/${teamId}`).get();
  if (!teamSnapshot.exists) fail('orphan-membership', { teamId });
  const membersSnapshot = await db.collection(`teams/${teamId}/members`).get();
  const own = membersSnapshot.docs.find((row) => row.id === uid);
  const team = canonicalMembershipTeam({ id: teamId, ...teamSnapshot.data() }, membersSnapshot.docs);
  if (
    !own || own.data().uid !== uid || own.data().status !== 'active'
    || !['admin', 'member'].includes(own.data().role) || !team.memberUids.includes(uid)
    || (team.createdBy === uid && own.data().role !== 'admin')
  ) fail('inconsistent-membership', { teamId });
  return {
    team,
    memberships: membersSnapshot.docs.map((row) => ({ teamId, uid: row.data().uid || row.id, ...row.data() })),
  };
}

export async function loadAccountDeletionSnapshot(db, uid) {
  requireId(uid, 'uid');
  const [listedTeams, createdTeams, ownMemberships] = await Promise.all([
    db.collection('teams').where('memberUids', 'array-contains', uid).get(),
    db.collection('teams').where('createdBy', '==', uid).get(),
    db.collectionGroup('members').where('uid', '==', uid).get(),
  ]);
  const teamIds = new Set([
    ...listedTeams.docs.map((row) => row.id), ...createdTeams.docs.map((row) => row.id),
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

function resumableExpectedTeams(expectedTeams) {
  if (!Array.isArray(expectedTeams)) fail('invalid-deletion-job');
  const seen = new Set();
  const normalized = expectedTeams.map((decision) => {
    if (
      !decision || typeof decision !== 'object' || Array.isArray(decision)
      || Object.keys(decision).some((field) => !['teamId', 'action', 'transferToUid'].includes(field))
    ) fail('invalid-deletion-job');
    requireId(decision.teamId, 'team-id');
    if (seen.has(decision.teamId)) fail('invalid-deletion-job');
    seen.add(decision.teamId);
    if (!['leave', 'transfer', 'dissolve'].includes(decision.action)) fail('invalid-deletion-job');
    if (decision.action === 'transfer') requireId(decision.transferToUid, 'successor-uid');
    else if (decision.transferToUid !== null) fail('invalid-deletion-job');
    return {
      teamId: decision.teamId,
      action: decision.action,
      transferToUid: decision.action === 'transfer' ? decision.transferToUid : null,
    };
  });
  const sorted = [...normalized].sort((left, right) => left.teamId.localeCompare(right.teamId));
  if (JSON.stringify(normalized) !== JSON.stringify(sorted)) fail('invalid-deletion-job');
  return normalized;
}

export async function loadAccountDeletionJob(db, uid, requestId) {
  requireId(uid, 'uid');
  requireId(requestId, 'request-id');
  const ref = jobRef(db, uid, requestId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return null;
  const data = snapshot.data();
  const planHash = requireId(data?.planHash, 'plan-hash');
  assertJob(data, uid, requestId, planHash);
  if (typeof data.phase !== 'string' || !data.phase) fail('invalid-deletion-job');
  const lockSnapshot = await lockRef(db, uid).get();
  if (!lockSnapshot.exists) fail('deletion-lock-not-found');
  assertJob(lockSnapshot.data(), uid, requestId, planHash);
  return {
    requestId,
    planHash,
    phase: data.phase,
    expectedTeams: resumableExpectedTeams(data.expectedTeams),
  };
}

export async function loadActiveAccountDeletionJob(db, uid) {
  requireId(uid, 'uid');
  const lockSnapshot = await lockRef(db, uid).get();
  if (!lockSnapshot.exists) return null;
  const lock = lockSnapshot.data();
  const requestId = requireId(lock?.requestId, 'request-id');
  const job = await loadAccountDeletionJob(db, uid, requestId);
  if (!job || ['aborted', 'complete'].includes(job.phase)) return null;
  return job;
}

export async function preflightAccountDeletionDecisions(db, uid, decisions, verifiedEmail = undefined) {
  requireId(uid, 'uid');
  void verifiedEmail;
  const expectedTeams = normalizedDecisions(decisions);
  for (const storedDecision of expectedTeams) {
    const decision = storedDecision.action === 'transfer'
      ? storedDecision
      : { teamId: storedDecision.teamId, action: storedDecision.action };
    const { teamId, action } = decision;
    const team = db.doc(`teams/${teamId}`);
    const ownMember = db.doc(`teams/${teamId}/members/${uid}`);
    const settingsRef = db.doc(`teams/${teamId}/settings/main`);
    const membersQuery = db.collection(`teams/${teamId}/members`);
    const successorRef = action === 'transfer'
      ? db.doc(`teams/${teamId}/members/${decision.transferToUid}`)
      : null;
    const [teamSnapshot, ownSnapshot, settingsSnapshot, members, successorSnapshot] = await Promise.all([
      team.get(), ownMember.get(), settingsRef.get(), membersQuery.get(),
      successorRef ? successorRef.get() : Promise.resolve(null),
    ]);
    validateTeamDecisionState(uid, decision, {
      teamSnapshot, ownSnapshot, settingsSnapshot, members, successorSnapshot,
    });
  }
  return { verified: true };
}

export async function beginAccountDeletionJob(db, uid, requestId, planHash, decisions = []) {
  requireId(planHash, 'plan-hash');
  const expectedTeams = normalizedDecisions(decisions);
  const ref = jobRef(db, uid, requestId);
  const lock = lockRef(db, uid);
  await db.runTransaction(async (transaction) => {
    const [lockSnapshot, jobSnapshot] = await Promise.all([
      transaction.get(lock), transaction.get(ref),
    ]);
    if (lockSnapshot.exists) {
      const lockData = lockSnapshot.data();
      if (lockData.requestId !== requestId) fail('account-deletion-in-progress');
      if (lockData.planHash !== planHash) fail('plan-hash-mismatch');
    }
    if (jobSnapshot.exists) {
      const data = jobSnapshot.data();
      assertJob(data, uid, requestId, planHash);
      if (!decisionsEqual(data.expectedTeams, expectedTeams)) fail('team-plan-mismatch');
      if (!lockSnapshot.exists) transaction.create(lock, { uid, requestId, planHash, phase: data.phase });
      return;
    }
    const teamCheckpoints = {};
    for (const decision of expectedTeams) {
      teamCheckpoints[checkpointKey(decision.teamId)] = {
        ...decision, decisionApplied: false, identityRemoved: false, status: 'pending',
      };
    }
    const now = Date.now();
    transaction.create(ref, {
      uid, requestId, planHash, phase: 'started', expectedTeams, teamCheckpoints,
      personalDataDeleted: false, verificationPassed: false, createdAt: now, updatedAt: now,
    });
    if (!lockSnapshot.exists) transaction.create(lock, { uid, requestId, planHash, phase: 'started', updatedAt: now });
  });
  return ref;
}

export async function abortPendingAccountDeletionJob(db, uid, context = {}) {
  requireId(uid, 'uid');
  const { requestId, planHash } = contextIds(context);
  const job = jobRef(db, uid, requestId);
  const lock = lockRef(db, uid);
  return db.runTransaction(async (transaction) => {
    const [jobSnapshot, lockSnapshot] = await Promise.all([
      transaction.get(job), transaction.get(lock),
    ]);
    if (!jobSnapshot.exists) return { aborted: false };
    const data = jobSnapshot.data();
    assertJob(data, uid, requestId, planHash);
    if (!lockSnapshot.exists) {
      if (data.phase === 'aborted') return { aborted: true };
      fail('deletion-lock-not-found');
    }
    assertJob(lockSnapshot.data(), uid, requestId, planHash);
    const checkpoints = Object.values(data.teamCheckpoints || {});
    const untouched = checkpoints.every((checkpoint) => (
      checkpoint.status === 'pending'
      && checkpoint.decisionApplied === false
      && checkpoint.identityRemoved === false
    ));
    if (data.phase !== 'started' || data.personalDataDeleted !== false || !untouched) {
      fail('deletion-job-not-abortable');
    }
    const now = Date.now();
    transaction.update(job, { phase: 'aborted', abortedAt: now, updatedAt: now });
    transaction.delete(lock);
    return { aborted: true };
  });
}

function assertCheckpointDecision(jobData, teamId, decision) {
  const previous = checkpointFor(jobData, teamId);
  if (!previous) fail('unexpected-team-decision', { teamId });
  if (previous.action !== decision.action || previous.transferToUid !== (decision.transferToUid || null)) {
    fail('team-decision-mismatch', { teamId });
  }
  return previous;
}

function validateTeamDecisionState(uid, decision, snapshots) {
  const { teamId, action } = decision;
  const { teamSnapshot, ownSnapshot, settingsSnapshot, members, successorSnapshot } = snapshots;
  if (!teamSnapshot.exists) fail('team-not-found', { teamId });
  if (!ownSnapshot.exists) fail('membership-not-found', { teamId });
  const teamData = canonicalMembershipTeam(teamSnapshot.data(), members.docs);
  const ownData = ownSnapshot.data();
  if (
    ownData.uid !== uid || ownData.status !== 'active' || !['admin', 'member'].includes(ownData.role)
    || !teamData.memberUids.includes(uid)
  ) fail('inconsistent-membership', { teamId });
  const effectiveAdmin = ownData.role === 'admin' || teamData.createdBy === uid;
  if (teamData.createdBy === uid && ownData.role !== 'admin') fail('inconsistent-admin-state', { teamId });
  const removalPatch = teamPatchWithoutUid(teamData, uid);

  if (action === 'leave') {
    if (effectiveAdmin || ownData.role !== 'member') fail('admin-cannot-leave', { teamId });
    return { teamPatch: removalPatch, ownData };
  }
  if (action === 'transfer') {
    if (!effectiveAdmin) fail('admin-required', { teamId });
    if (decision.transferToUid === uid) fail('invalid-successor', { teamId });
    if (
      !successorSnapshot?.exists || successorSnapshot.data().uid !== decision.transferToUid
      || successorSnapshot.data().status !== 'active'
      || !['admin', 'member'].includes(successorSnapshot.data().role)
      || !teamData.memberUids.includes(decision.transferToUid)
    ) fail('invalid-successor', { teamId });
    const transferredSettings = transferManagementFields(teamData.settings || {}, uid, decision.transferToUid);
    const transferredTeam = transferManagementFields(teamData, uid, decision.transferToUid);
    const settingsPatch = settingsSnapshot.exists
      ? transferManagementFields(settingsSnapshot.data(), uid, decision.transferToUid)
      : null;
    return {
      ownData,
      settingsPatch,
      teamPatch: {
        ...transferredTeam,
        memberUids: withoutUid(teamData, 'memberUids', uid),
        settings: transferredSettings,
        createdBy: teamData.createdBy === uid ? decision.transferToUid : teamData.createdBy,
        updatedAt: Date.now(),
      },
    };
  }
  if (!effectiveAdmin) fail('admin-required', { teamId });
  return { ownData };
}

export async function applyTeamDecision(db, uid, decision, context = {}) {
  requireId(uid, 'uid');
  validateDecision(decision);
  const { requestId, planHash } = contextIds(context);
  const { teamId, action } = decision;
  const job = jobRef(db, uid, requestId);
  const lock = lockRef(db, uid);
  const team = db.doc(`teams/${teamId}`);
  const ownMember = db.doc(`teams/${teamId}/members/${uid}`);
  const settingsRef = db.doc(`teams/${teamId}/settings/main`);
  const membersQuery = db.collection(`teams/${teamId}/members`);
  const successorRef = action === 'transfer'
    ? db.doc(`teams/${teamId}/members/${decision.transferToUid}`)
    : null;

  const applied = await db.runTransaction(async (transaction) => {
    const [jobSnapshot, lockSnapshot] = await Promise.all([
      transaction.get(job), transaction.get(lock),
    ]);
    if (!jobSnapshot.exists || !lockSnapshot.exists) fail('deletion-job-not-found');
    const jobData = jobSnapshot.data();
    assertJob(jobData, uid, requestId, planHash);
    assertJob(lockSnapshot.data(), uid, requestId, planHash);
    const previous = assertCheckpointDecision(jobData, teamId, decision);
    if (previous.status === 'complete' || previous.decisionApplied) {
      return { decisionApplied: true, identityNames: [] };
    }
    // A recursive team delete may have removed part of the tree before a retry.
    // `processing` proves the original transaction validated the whole decision,
    // so a dissolve retry must resume deletion instead of requiring those docs.
    if (action === 'dissolve' && previous.status === 'processing') {
      return { decisionApplied: false, identityNames: [] };
    }

    const [teamSnapshot, ownSnapshot, settingsSnapshot, members, successorSnapshot] = await Promise.all([
      transaction.get(team), transaction.get(ownMember), transaction.get(settingsRef), transaction.get(membersQuery),
      successorRef ? transaction.get(successorRef) : Promise.resolve(null),
    ]);
    const state = validateTeamDecisionState(uid, decision, {
      teamSnapshot, ownSnapshot, settingsSnapshot, members, successorSnapshot,
    });
    const identityNames = [state.ownData?.displayName, state.ownData?.name]
      .filter((value) => typeof value === 'string' && value.trim());
    const checkpoints = { ...(jobData.teamCheckpoints || {}) };
    if (action === 'dissolve') {
      checkpoints[checkpointKey(teamId)] = {
        ...previous,
        status: 'processing',
        processingAction: action,
        processingTransferToUid: null,
      };
      transaction.update(job, { teamCheckpoints: checkpoints, updatedAt: Date.now() });
      return { decisionApplied: false, identityNames: [...new Set(identityNames)] };
    }
    if (action === 'transfer') {
      transaction.update(successorRef, {
        role: 'admin', updatedAt: Date.now(), updatedBy: decision.transferToUid,
      });
      if (state.settingsPatch) transaction.set(settingsRef, state.settingsPatch);
    }
    transaction.update(team, state.teamPatch);
    transaction.delete(ownMember);
    checkpoints[checkpointKey(teamId)] = {
      ...previous, decisionApplied: true, status: 'decision-applied',
    };
    transaction.update(job, { teamCheckpoints: checkpoints, updatedAt: Date.now() });
    return { decisionApplied: true, identityNames: [...new Set(identityNames)] };
  });

  if (action !== 'dissolve') {
    const sanitize = context.sanitizeActivities || sanitizeIndexedActivities;
    await sanitize(db, uid, {
      teamId,
      names: applied.identityNames,
      verifiedEmail: context.verifiedEmail,
    });
    return;
  }

  const recursiveDelete = context.recursiveDelete || ((reference) => db.recursiveDelete(reference));
  await recursiveDelete(team);
  await db.runTransaction(async (transaction) => {
    const [snapshot, lockSnapshot] = await Promise.all([
      transaction.get(job), transaction.get(lock),
    ]);
    if (!snapshot.exists || !lockSnapshot.exists) fail('deletion-job-not-found');
    const data = snapshot.data();
    assertJob(data, uid, requestId, planHash);
    assertJob(lockSnapshot.data(), uid, requestId, planHash);
    const current = checkpointFor(data, teamId);
    if (!current || current.action !== 'dissolve') fail('unexpected-team-decision', { teamId });
    const checkpoints = { ...(data.teamCheckpoints || {}) };
    checkpoints[checkpointKey(teamId)] = {
      ...current, decisionApplied: true, identityRemoved: true, status: 'complete',
    };
    transaction.update(job, { teamCheckpoints: checkpoints, updatedAt: Date.now() });
  });
}

function sanitizeActivityValue(value, uid, identity, field = '', personContext = false) {
  if (Array.isArray(value)) {
    if (UID_ARRAY_FIELDS.has(field)) return value.filter((item) => item !== uid);
    return value.map((item) => sanitizeActivityValue(item, uid, identity, '', personContext)).filter((item) => item !== DROP);
  }
  if (value && typeof value === 'object') {
    const matchingUidFields = [...UID_FIELDS].filter((key) => value[key] === uid);
    const localPerson = personContext || matchingUidFields.length > 0;
    const deletedActor = value.actorUid === uid;
    const deletedTarget = matchingUidFields.some((key) => key !== 'actorUid');
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      if (localPerson && !PERSON_SHARED_FIELDS.has(key)) continue;
      if (localPerson && /email|photo|avatar|phone|contact|profile|notes?/i.test(key)) continue;
      if (deletedActor && key === 'actorName') {
        output[key] = DELETED_LABEL;
        continue;
      }
      if (deletedTarget && ['name', 'displayName', 'memberName', 'targetName'].includes(key)) {
        output[key] = DELETED_LABEL;
        continue;
      }
      const sanitized = sanitizeActivityValue(item, uid, identity, key, localPerson);
      if (sanitized !== DROP) output[key] = sanitized;
    }
    return output;
  }
  if (typeof value !== 'string') return value;
  if (identity.verifiedEmail && value.includes(identity.verifiedEmail)) return DROP;
  if (UID_FIELDS.has(field) && value === uid) return DELETED_UID;
  if (personContext && ['displayName', 'memberName'].includes(field)) return DELETED_LABEL;
  if (value === uid || value.includes(`uid=${uid}`)) return DROP;
  return value;
}

function targetCoreText(action) {
  if (action === 'joinTeam') return 'チームに参加しました';
  if (action === 'leaveTeam') return 'チームから退出しました';
  if (action === 'removeMember') return `${DELETED_LABEL}さんを外しました`;
  if (action === 'approveMember') return `${DELETED_LABEL}さんを承認しました`;
  if (action === 'rejectMember') return `${DELETED_LABEL}さんの申請を却下しました`;
  return null;
}

function sanitizeActivity(data, uid, identity = {}) {
  const names = new Set((identity.names || []).filter((value) => typeof value === 'string' && value));
  const isKnownName = (value) => typeof value === 'string' && names.has(value);
  const actorPersonAction = data?.action === 'joinTeam' || data?.action === 'leaveTeam';
  const actorWasDeleted = data?.actorUid === uid;
  const targetWasDeleted = data?.targetUid === uid || data?.memberUid === uid
    || (PERSON_TARGET_ACTIONS.has(data?.action) && (isKnownName(data?.targetName) || isKnownName(data?.memberName)))
    || (actorPersonAction && isKnownName(data?.targetName));
  let next = actorWasDeleted ? anonymizeActivityRecord(data, uid) : { ...(data || {}) };
  next = sanitizeActivityValue(next, uid, identity);
  const explicitTargetWasDeleted = data?.targetUid === uid || data?.memberUid === uid;
  if (explicitTargetWasDeleted) {
    for (const field of ['text', 'coreText']) {
      if (typeof next[field] === 'string' && [...names].some((name) => next[field].includes(name))) {
        delete next[field];
      }
    }
  }
  if (actorWasDeleted && data?.actorUid !== uid) next.actorName = DELETED_LABEL;
  if (targetWasDeleted) {
    if (next.targetUid === uid) next.targetUid = DELETED_UID;
    if (next.memberUid === uid) next.memberUid = DELETED_UID;
    if (PERSON_TARGET_ACTIONS.has(next.action) || actorPersonAction) {
      next.targetName = DELETED_LABEL;
      const coreText = targetCoreText(next.action);
      if (coreText) {
        next.coreText = coreText;
        const actorName = actorWasDeleted ? DELETED_LABEL : next.actorName;
        if (typeof actorName === 'string' && actorName) next.text = `${actorName}さんが${coreText}`;
      }
    }
  }
  if (actorWasDeleted && actorPersonAction) {
    const coreText = targetCoreText(next.action);
    if (coreText) {
      next.coreText = coreText;
      next.text = `${DELETED_LABEL}さんが${coreText}`;
    }
  }
  next.identityUids = [...new Set(['actorUid', 'targetUid', 'memberUid']
    .map((field) => next[field])
    .filter((value) => typeof value === 'string' && value && value !== DELETED_UID))]
    .sort((left, right) => left.localeCompare(right));
  return next;
}

function activityIdentityQueries(db, uid) {
  return [
    db.collectionGroup('activity').where('identityUids', 'array-contains', uid),
    db.collectionGroup('activity').where('actorUid', '==', uid),
    db.collectionGroup('activity').where('targetUid', '==', uid),
    db.collectionGroup('activity').where('memberUid', '==', uid),
  ];
}

async function sanitizeIndexedActivities(db, uid, identity = {}) {
  const sanitizedPaths = new Set();
  for (const query of activityIdentityQueries(db, uid)) {
    await pagedCollection(query, async (documents) => {
      const unseen = documents.filter((snapshot) => !sanitizedPaths.has(snapshot.ref.path));
      for (const snapshot of unseen) sanitizedPaths.add(snapshot.ref.path);
      await commitMutations(db, unseen, (batch, snapshot) => {
        batch.set(snapshot.ref, sanitizeActivity(snapshot.data(), uid, identity));
      });
    });
  }
  const names = [...new Set((identity.names || []).filter((value) => (
    typeof value === 'string' && value.trim()
  )))];
  if (!identity.teamId || names.length === 0) return;
  for (const name of names) {
    const query = db.collection(`teams/${identity.teamId}/activity`).where('targetName', '==', name);
    await pagedCollection(query, async (documents) => {
      const matching = documents.filter((snapshot) => (
        !sanitizedPaths.has(snapshot.ref.path)
        && (PERSON_TARGET_ACTIONS.has(snapshot.data()?.action)
          || ['joinTeam', 'leaveTeam'].includes(snapshot.data()?.action))
      ));
      for (const snapshot of matching) sanitizedPaths.add(snapshot.ref.path);
      await commitMutations(db, matching, (batch, snapshot) => {
        batch.set(snapshot.ref, sanitizeActivity(snapshot.data(), uid, identity));
      });
    });
  }
}

async function updateBoundCheckpoint(db, uid, context, teamId, update) {
  const { requestId, planHash } = contextIds(context);
  const ref = jobRef(db, uid, requestId);
  const lock = lockRef(db, uid);
  await db.runTransaction(async (transaction) => {
    const [snapshot, lockSnapshot] = await Promise.all([transaction.get(ref), transaction.get(lock)]);
    if (!snapshot.exists || !lockSnapshot.exists) fail('deletion-job-not-found');
    const data = snapshot.data();
    assertJob(data, uid, requestId, planHash);
    assertJob(lockSnapshot.data(), uid, requestId, planHash);
    const current = checkpointFor(data, teamId);
    if (!current) fail('unexpected-team-decision', { teamId });
    const checkpoints = { ...(data.teamCheckpoints || {}) };
    checkpoints[checkpointKey(teamId)] = { ...current, ...update };
    transaction.update(ref, { teamCheckpoints: checkpoints, updatedAt: Date.now() });
  });
}

export async function removeUserIdentityFromTeam(db, uid, teamId, context = {}) {
  requireId(uid, 'uid');
  requireId(teamId, 'team-id');
  const bound = await getBoundJob(db, uid, context);
  const checkpoint = checkpointFor(bound.data, teamId);
  if (!checkpoint) fail('unexpected-team-decision', { teamId });
  if (checkpoint.action === 'dissolve') {
    if (checkpoint.status !== 'complete') fail('team-decision-incomplete', { teamId });
    return;
  }
  if (!checkpoint.decisionApplied) fail('team-decision-incomplete', { teamId });
  if (checkpoint.identityRemoved && context.forceIdentityCleanup !== true) return;
  const team = db.doc(`teams/${teamId}`);
  const teamSnapshot = await team.get();
  if (!teamSnapshot.exists) fail('team-not-found', { teamId });
  if (teamSnapshot.data().createdBy === uid) fail('admin-transfer-required', { teamId });
  await team.update(teamPatchWithoutUid(teamSnapshot.data(), uid));

  for (const collectionName of SHARED_RECORD_COLLECTIONS) {
    await pagedCollection(db.collection(`teams/${teamId}/${collectionName}`), async (documents) => {
      await commitMutations(db, documents, (batch, snapshot) => {
        const data = sanitizedMetadata(snapshot.data(), uid);
        if (collectionName === 'projects') {
          data.assignedUids = withoutUid(data, 'assignedUids', uid);
          if (Object.hasOwn(data, 'assigneeUids')) data.assigneeUids = withoutUid(data, 'assigneeUids', uid);
        }
        if (collectionName === 'settings') {
          for (const field of SETTINGS_UID_ARRAY_FIELDS) {
            if (Object.hasOwn(data, field)) data[field] = withoutUid(data, field, uid);
          }
        }
        batch.set(snapshot.ref, data);
      });
    });
  }

  for (const collectionName of [
    'members', 'memberEmails', 'memberNotes', 'payouts',
    'projectRewardShares', 'operations', 'joinRequests', 'invites',
  ]) {
    await pagedCollection(db.collection(`teams/${teamId}/${collectionName}`), async (documents) => {
      await commitMutations(db, documents, (batch, snapshot) => {
        const data = snapshot.data();
        const belongsToUser = (
          data.uid === uid || data.memberUid === uid || data.actorUid === uid
          || data.invitedUid === uid || data.createdBy === uid || snapshot.id === uid
          || (context.verifiedEmail && data.email === context.verifiedEmail)
        );
        if (belongsToUser) batch.delete(snapshot.ref);
        else batch.set(snapshot.ref, sanitizedMetadata(data, uid));
      });
    });
  }

  const directPrivateRefs = ['members', 'memberEmails', 'memberNotes', 'payouts']
    .map((name) => db.doc(`teams/${teamId}/${name}/${uid}`));
  const directBatch = db.batch();
  for (const ref of directPrivateRefs) directBatch.delete(ref);
  await directBatch.commit();

  await pagedCollection(
    db.collection('teamInviteCodes').where('createdBy', '==', uid),
    async (page) => {
      const matchingCodes = page.filter((snapshot) => snapshot.data().teamId === teamId);
      await commitMutations(db, matchingCodes, (batch, snapshot) => batch.delete(snapshot.ref));
    },
  );
  await updateBoundCheckpoint(db, uid, context, teamId, { identityRemoved: true, status: 'complete' });
}

function identityQueries(db, uid, verifiedEmail) {
  const queries = [
    db.collectionGroup('joinRequests').where('uid', '==', uid),
    db.collectionGroup('joinRequests').where('createdBy', '==', uid),
    db.collectionGroup('invites').where('uid', '==', uid),
    db.collectionGroup('invites').where('invitedUid', '==', uid),
    db.collectionGroup('invites').where('createdBy', '==', uid),
    db.collection('teamInviteCodes').where('uid', '==', uid),
    db.collection('teamInviteCodes').where('invitedUid', '==', uid),
    db.collection('teamInviteCodes').where('createdBy', '==', uid),
  ];
  if (verifiedEmail) {
    queries.push(
      db.collectionGroup('joinRequests').where('email', '==', verifiedEmail),
      db.collectionGroup('invites').where('email', '==', verifiedEmail),
      db.collection('teamInviteCodes').where('email', '==', verifiedEmail),
    );
  }
  return queries;
}

async function deletePendingIdentityReferences(db, uid, verifiedEmail) {
  for (const query of identityQueries(db, uid, verifiedEmail)) {
    await pagedCollection(query, async (page) => {
      const pageDocuments = new Map(page.map((document) => [document.ref.path, document]));
      const inviteTeams = new Map();
      for (const document of page) {
        if (document.ref.parent.id !== 'invites') continue;
        const code = document.data().code;
        if (typeof code === 'string' && code) {
          const ref = db.doc(`teamInviteCodes/${code}`);
          pageDocuments.set(ref.path, { ref });
        }
        const teamId = document.ref.parent.parent?.id;
        if (!teamId) continue;
        const teamIds = inviteTeams.get(document.id) || new Set();
        teamIds.add(teamId);
        inviteTeams.set(document.id, teamIds);
      }
      const inviteIds = [...inviteTeams.keys()];
      for (let start = 0; start < inviteIds.length; start += 10) {
        const ids = inviteIds.slice(start, start + 10);
        const linkedQuery = db.collection('teamInviteCodes').where('inviteId', 'in', ids);
        await pagedCollection(linkedQuery, async (linkedPage) => {
          const matching = linkedPage.filter((candidate) => (
            inviteTeams.get(candidate.data().inviteId)?.has(candidate.data().teamId)
          ));
          await commitMutations(db, matching, (batch, document) => batch.delete(document.ref));
        });
      }
      await commitMutations(db, [...pageDocuments.values()], (batch, document) => batch.delete(document.ref));
    });
  }
}

export async function deletePersonalCloudData(db, uid, context = {}) {
  requireId(uid, 'uid');
  await getBoundJob(db, uid, context);
  await deletePendingIdentityReferences(db, uid, context.verifiedEmail);
  const recursiveDelete = context.recursiveDelete || ((reference) => db.recursiveDelete(reference));
  await recursiveDelete(db.doc(`users/${uid}`));
  const current = await getBoundJob(db, uid, context);
  await current.ref.update({ personalDataDeleted: true, updatedAt: Date.now() });
}

async function queryHasDocument(query) {
  return !(await query.limit(1).get()).empty;
}

async function hasPendingIdentityReferences(db, uid, verifiedEmail) {
  for (const query of identityQueries(db, uid, verifiedEmail)) {
    if (await queryHasDocument(query)) return true;
  }
  return false;
}

export async function verifyNoProtectedReferences(db, uid, context = {}) {
  requireId(uid, 'uid');
  await getBoundJob(db, uid, context);
  const checks = [
    db.collection('teams').where('memberUids', 'array-contains', uid),
    db.collection('teams').where('createdBy', '==', uid),
    db.collection('teams').where('settings.assignOwnerUids', 'array-contains', uid),
    db.collection('teams').where('settings.assignedUids', 'array-contains', uid),
    db.collectionGroup('members').where('uid', '==', uid),
    db.collectionGroup('memberEmails').where('uid', '==', uid),
    db.collectionGroup('memberNotes').where('uid', '==', uid),
    db.collectionGroup('payouts').where('uid', '==', uid),
    db.collectionGroup('projectRewardShares').where('memberUid', '==', uid),
    db.collectionGroup('projectRewardShares').where('uid', '==', uid),
    db.collectionGroup('projects').where('assignedUids', 'array-contains', uid),
    db.collectionGroup('projects').where('assigneeUids', 'array-contains', uid),
    db.collectionGroup('settings').where('assignOwnerUids', 'array-contains', uid),
    db.collectionGroup('settings').where('assignedUids', 'array-contains', uid),
    db.collectionGroup('settings').where('assigneeUids', 'array-contains', uid),
    db.collectionGroup('operations').where('actorUid', '==', uid),
    db.collection('teamInviteCodes').where('createdBy', '==', uid),
  ];
  for (const field of ['updatedBy', 'deletedBy', 'ownerUid']) checks.push(db.collection('teams').where(field, '==', uid));
  for (const collectionName of SHARED_RECORD_COLLECTIONS) {
    for (const field of IDENTITY_METADATA_FIELDS) checks.push(db.collectionGroup(collectionName).where(field, '==', uid));
  }
  for (const collectionName of ['members', 'memberEmails', 'memberNotes', 'payouts', 'projectRewardShares', 'joinRequests', 'invites']) {
    for (const field of IDENTITY_METADATA_FIELDS) checks.push(db.collectionGroup(collectionName).where(field, '==', uid));
  }
  for (const query of checks) if (await queryHasDocument(query)) fail('protected-references-remain');
  if (await hasPendingIdentityReferences(db, uid, context.verifiedEmail)) fail('protected-references-remain');
  for (const query of activityIdentityQueries(db, uid)) {
    if (await queryHasDocument(query)) fail('protected-references-remain');
  }
  const userRef = db.doc(`users/${uid}`);
  if ((await userRef.get()).exists) fail('protected-references-remain');
  for (const collectionName of PERSONAL_COLLECTIONS) {
    if (!(await userRef.collection(collectionName).limit(1).get()).empty) fail('protected-references-remain');
  }
  for (const collection of await userRef.listCollections()) {
    if (!(await collection.limit(1).get()).empty) fail('protected-references-remain');
  }
  return { verified: true };
}

export async function reverifyDeletionBeforeAuthDelete(db, uid, context = {}) {
  const bound = await getBoundJob(db, uid, context);
  const checkpoints = Object.values(bound.data.teamCheckpoints || {});
  const incomplete = checkpoints.some((checkpoint) => (
    checkpoint.status !== 'complete' || !checkpoint.decisionApplied || !checkpoint.identityRemoved
  ));
  if (incomplete) fail('team-cleanup-incomplete');
  if (!bound.data.personalDataDeleted) fail('personal-cleanup-incomplete');
  await sanitizeIndexedActivities(db, uid, {
    names: context.identityNames || [], verifiedEmail: context.verifiedEmail,
  });
  for (const checkpoint of checkpoints) {
    if (checkpoint.action === 'dissolve') continue;
    await removeUserIdentityFromTeam(db, uid, checkpoint.teamId, {
      ...context,
      forceIdentityCleanup: true,
    });
  }
  await deletePersonalCloudData(db, uid, context);
  return verifyNoProtectedReferences(db, uid, context);
}

export async function markDeletionJobReadyForAuthDelete(db, uid, context = {}) {
  const current = await getBoundJob(db, uid, context);
  const checkpoints = Object.values(current.data.teamCheckpoints || {});
  const incomplete = checkpoints.some((checkpoint) => (
    checkpoint.status !== 'complete' || !checkpoint.decisionApplied || !checkpoint.identityRemoved
  ));
  if (incomplete) fail('team-cleanup-incomplete');
  if (!current.data.personalDataDeleted) fail('personal-cleanup-incomplete');
  await current.ref.update({
    phase: 'ready-for-auth-delete', updatedAt: Date.now(),
  });
  await lockRef(db, uid).update({ phase: 'ready-for-auth-delete', updatedAt: Date.now() });
}

export async function requestAuthDeletion(db, uid, context = {}) {
  requireId(uid, 'uid');
  const { requestId, planHash } = contextIds(context);
  const job = jobRef(db, uid, requestId);
  const lock = lockRef(db, uid);
  await db.runTransaction(async (transaction) => {
    const [jobSnapshot, lockSnapshot] = await Promise.all([
      transaction.get(job), transaction.get(lock),
    ]);
    if (!jobSnapshot.exists || !lockSnapshot.exists) fail('deletion-job-not-found');
    const data = jobSnapshot.data();
    assertJob(data, uid, requestId, planHash);
    assertJob(lockSnapshot.data(), uid, requestId, planHash);
    if (data.phase === 'auth-delete-requested') return;
    if (data.phase !== 'ready-for-auth-delete') fail('verification-required');
    const now = Date.now();
    transaction.update(job, { phase: 'auth-delete-requested', updatedAt: now });
    transaction.update(lock, { phase: 'auth-delete-requested', updatedAt: now });
  });
}

export async function markDeletionJobComplete(db, uid, context = {}) {
  if (context.authDeletionSucceeded !== true) fail('auth-deletion-required');
  const { requestId, planHash } = contextIds(context);
  const ref = jobRef(db, uid, requestId);
  const lock = lockRef(db, uid);
  await db.runTransaction(async (transaction) => {
    const [snapshot, lockSnapshot] = await Promise.all([transaction.get(ref), transaction.get(lock)]);
    if (!snapshot.exists || !lockSnapshot.exists) fail('deletion-job-not-found');
    const data = snapshot.data();
    assertJob(data, uid, requestId, planHash);
    assertJob(lockSnapshot.data(), uid, requestId, planHash);
    if (!['auth-delete-requested', 'complete'].includes(data.phase)) {
      fail('verification-required');
    }
    const checkpoints = Object.fromEntries(Object.entries(data.teamCheckpoints || {}).map(([key, value]) => {
      const { knownIdentifiers, ...safe } = value;
      return [key, safe];
    }));
    const now = Date.now();
    transaction.update(ref, { phase: 'complete', teamCheckpoints: checkpoints, completedAt: now, updatedAt: now });
    transaction.update(lock, { phase: 'complete', updatedAt: now });
  });
}

export { PERSONAL_COLLECTIONS, TEAM_COLLECTIONS };
