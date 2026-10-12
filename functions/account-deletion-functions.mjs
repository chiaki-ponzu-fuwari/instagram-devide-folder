import { createHash } from 'node:crypto';

import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import {
  AccountDeletionError,
  assertRecentAuthentication,
  buildAccountDeletionPlan,
  normalizeDeletionRequest,
  validateTeamDecisions,
} from './account-deletion-core.mjs';
import {
  AccountDeletionStoreError,
  abortPendingAccountDeletionJob,
  applyTeamDecision,
  beginAccountDeletionJob,
  deletePersonalCloudData,
  loadActiveAccountDeletionJob,
  loadAccountDeletionJob,
  loadAccountDeletionSnapshot,
  markDeletionJobComplete,
  markDeletionJobReadyForAuthDelete,
  preflightAccountDeletionDecisions,
  requestAuthDeletion,
  removeUserIdentityFromTeam,
  reverifyDeletionBeforeAuthDelete,
} from './account-deletion-store.mjs';

const INVALID_ARGUMENT_CODES = new Set([
  'invalid-request', 'invalid-request-id', 'invalid-team-decision',
  'invalid-team-decisions', 'duplicate-team-decision', 'unknown-field',
]);
const ABORTED_CODES = new Set([
  'account-deletion-in-progress', 'deletion-job-mismatch', 'deletion-lock-not-found',
  'plan-hash-mismatch', 'team-plan-mismatch',
]);
const PERMISSION_DENIED_CODES = new Set(['permission-denied', 'admin-required']);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashPlan(plan) {
  return createHash('sha256').update(canonicalJson(plan), 'utf8').digest('hex');
}

function publicPlan(plan, snapshot) {
  const memberNames = new Map();
  for (const membership of snapshot.memberships) {
    if (membership.status !== 'active') continue;
    const key = `${membership.teamId}\n${membership.uid}`;
    memberNames.set(key, typeof membership.displayName === 'string' ? membership.displayName : '');
  }
  return plan.teams.map((team) => ({
    teamId: team.teamId,
    teamName: team.teamName,
    requiredAction: team.requiredAction,
    eligibleSuccessors: team.eligibleSuccessorUids.map((uid) => ({
      uid,
      displayName: memberNames.get(`${team.teamId}\n${uid}`) ?? '',
    })),
  }));
}

function errorCode(error) {
  return typeof error?.code === 'string' ? error.code : 'internal';
}

function mapError(error, deps) {
  if (error instanceof deps.HttpsError) return error;
  const code = errorCode(error);
  let httpsCode = 'internal';
  if (INVALID_ARGUMENT_CODES.has(code)) httpsCode = 'invalid-argument';
  else if (ABORTED_CODES.has(code)) httpsCode = 'aborted';
  else if (PERMISSION_DENIED_CODES.has(code)) httpsCode = 'permission-denied';
  else if (error instanceof AccountDeletionError || error instanceof AccountDeletionStoreError) {
    httpsCode = 'failed-precondition';
  }
  return new deps.HttpsError(httpsCode, 'Account deletion request could not be completed.', {
    reason: code,
  });
}

function requireAuthenticatedCaller(request, deps) {
  if (!request?.auth?.uid) {
    throw new deps.HttpsError('unauthenticated', 'Authentication is required.', {
      reason: 'authentication-required',
    });
  }
  return request.auth.uid;
}

function requireCaller(request, deps) {
  const uid = requireAuthenticatedCaller(request, deps);
  const authTime = request.auth.token?.auth_time;
  const now = deps.nowSeconds();
  assertRecentAuthentication(authTime, now);
  if (authTime > now) {
    throw new AccountDeletionError('invalid-auth-time', 'Authentication time cannot be in the future.');
  }
  return uid;
}

function verifiedEmail(request) {
  const token = request.auth?.token;
  return token?.email_verified === true && typeof token.email === 'string' && token.email
    ? token.email
    : undefined;
}

function validatePlanRequest(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new AccountDeletionError('invalid-request', 'Plan request must be an object.');
  }
  const field = Object.keys(data)[0];
  if (field !== undefined) {
    throw new AccountDeletionError('unknown-field', 'Plan request contains an unknown field.', { field });
  }
}

function defaults() {
  return {
    HttpsError,
    db: undefined,
    nowSeconds: () => Date.now() / 1000,
    deleteAuthUser: (uid) => getAuth().deleteUser(uid),
    abortPendingAccountDeletionJob,
    applyTeamDecision,
    beginAccountDeletionJob,
    deletePersonalCloudData,
    loadActiveAccountDeletionJob,
    loadAccountDeletionJob,
    loadAccountDeletionSnapshot,
    markDeletionJobComplete,
    markDeletionJobReadyForAuthDelete,
    preflightAccountDeletionDecisions,
    requestAuthDeletion,
    removeUserIdentityFromTeam,
    reverifyDeletionBeforeAuthDelete,
  };
}

function dependencies(overrides) {
  return { ...defaults(), ...overrides };
}

export function createGetAccountDeletionPlanHandler(overrides = {}) {
  const deps = dependencies(overrides);
  return async function getAccountDeletionPlanHandler(request) {
    try {
      const uid = requireAuthenticatedCaller(request, deps);
      validatePlanRequest(request.data);
      const db = deps.db ?? getFirestore();
      const activeJob = await deps.loadActiveAccountDeletionJob(db, uid);
      if (activeJob) {
        return {
          teams: [],
          planHash: activeJob.planHash,
          resumeRequestId: activeJob.requestId,
          teamDecisions: operationalDecisions(canonicalDecisions(activeJob.expectedTeams)),
        };
      }
      const snapshot = await deps.loadAccountDeletionSnapshot(db, uid);
      const plan = buildAccountDeletionPlan(snapshot);
      return { teams: publicPlan(plan, snapshot), planHash: hashPlan(plan) };
    } catch (error) {
      throw mapError(error, deps);
    }
  };
}

export function createDeleteAccountHandler(overrides = {}) {
  const deps = dependencies(overrides);
  return async function deleteAccountHandler(request) {
    let requestId;
    let deletionContext;
    let jobBegan = false;
    try {
      const uid = requireCaller(request, deps);
      const normalized = normalizeDeletionRequest(request.data);
      requestId = normalized.requestId;
      const db = deps.db ?? getFirestore();
      const existingJob = await deps.loadAccountDeletionJob(db, uid, requestId);
      let decisions;
      let planHash;
      if (existingJob) {
        const requestedDecisions = canonicalDecisions(normalized.teamDecisions);
        const storedDecisions = canonicalDecisions(existingJob.expectedTeams);
        if (canonicalJson(requestedDecisions) !== canonicalJson(storedDecisions)) {
          throw new AccountDeletionStoreError('team-plan-mismatch');
        }
        decisions = operationalDecisions(storedDecisions);
        planHash = existingJob.planHash;
      } else {
        const snapshot = await deps.loadAccountDeletionSnapshot(db, uid);
        const plan = buildAccountDeletionPlan(snapshot);
        decisions = validateTeamDecisions(plan, normalized.teamDecisions);
        planHash = hashPlan(plan);
        await deps.preflightAccountDeletionDecisions(
          db, uid, decisions, verifiedEmail(request),
        );
      }
      const context = { requestId, planHash, verifiedEmail: verifiedEmail(request) };
      deletionContext = { db, uid, context };

      await deps.beginAccountDeletionJob(db, uid, requestId, planHash, decisions);
      jobBegan = true;
      for (const decision of decisions) {
        await deps.applyTeamDecision(db, uid, decision, context);
        if (decision.action !== 'dissolve') {
          await deps.removeUserIdentityFromTeam(db, uid, decision.teamId, context);
        }
      }
      await deps.deletePersonalCloudData(db, uid, context);
      await deps.markDeletionJobReadyForAuthDelete(db, uid, context);
      await deps.requestAuthDeletion(db, uid, context);
      try {
        await (deps.finalizeRequestedAccountDeletion || finalizeRequestedAccountDeletion)(
          { uid, requestId }, deps,
        );
      } catch (error) {
        throw new deps.HttpsError('unavailable', 'Account deletion is still being finalized.', {
          reason: 'auth-deletion-pending',
        });
      }
      return { deleted: true, requestId };
    } catch (error) {
      if (jobBegan && deletionContext) {
        try {
          await deps.abortPendingAccountDeletionJob(
            deletionContext.db, deletionContext.uid, deletionContext.context,
          );
        } catch {
          // A job with any durable progress must remain locked and recoverable.
        }
      }
      throw mapError(error, deps);
    }
  };
}

export async function finalizeRequestedAccountDeletion({ uid, requestId }, overrides = {}) {
  const deps = dependencies(overrides);
  const db = deps.db ?? getFirestore();
  const job = await deps.loadAccountDeletionJob(db, uid, requestId);
  if (!job) throw new AccountDeletionStoreError('deletion-job-not-found');
  if (job.phase === 'complete') return { completed: true };
  if (job.phase !== 'auth-delete-requested') {
    throw new AccountDeletionStoreError('verification-required');
  }
  const context = { requestId, planHash: job.planHash };
  await deps.reverifyDeletionBeforeAuthDelete(db, uid, context);
  try {
    await deps.deleteAuthUser(uid);
  } catch (error) {
    if (errorCode(error) !== 'auth/user-not-found') throw error;
  }
  await deps.markDeletionJobComplete(db, uid, {
    ...context, authDeletionSucceeded: true,
  });
  return { completed: true };
}

export function createAccountDeletionJobUpdatedHandler(overrides = {}) {
  const finalize = overrides.finalizeRequestedAccountDeletion || finalizeRequestedAccountDeletion;
  return async function accountDeletionJobUpdatedHandler(event) {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (
      after?.phase !== 'auth-delete-requested'
      || before?.phase === 'auth-delete-requested'
    ) return;
    await finalize({ uid: after.uid, requestId: after.requestId });
  };
}

function canonicalDecisions(decisions) {
  if (!Array.isArray(decisions)) throw new AccountDeletionStoreError('team-plan-mismatch');
  const normalized = decisions.map((decision) => ({
    teamId: decision?.teamId,
    action: decision?.action,
    transferToUid: decision?.action === 'transfer' ? decision?.transferToUid : null,
  }));
  if (normalized.some((decision) => (
    typeof decision.teamId !== 'string'
    || !['leave', 'transfer', 'dissolve'].includes(decision.action)
    || (decision.action === 'transfer' && typeof decision.transferToUid !== 'string')
  ))) throw new AccountDeletionStoreError('team-plan-mismatch');
  return normalized.sort((left, right) => left.teamId.localeCompare(right.teamId));
}

function operationalDecisions(decisions) {
  return decisions.map((decision) => (
    decision.action === 'transfer'
      ? { teamId: decision.teamId, action: decision.action, transferToUid: decision.transferToUid }
      : { teamId: decision.teamId, action: decision.action }
  ));
}

export { canonicalJson, hashPlan };
