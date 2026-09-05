import { createHash } from 'node:crypto';

import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

import {
  AccountDeletionError,
  assertRecentAuthentication,
  buildAccountDeletionPlan,
  normalizeDeletionRequest,
  validateTeamDecisions,
} from './account-deletion-core.mjs';
import {
  AccountDeletionStoreError,
  applyTeamDecision,
  beginAccountDeletionJob,
  deletePersonalCloudData,
  loadAccountDeletionSnapshot,
  markDeletionJobComplete,
  markDeletionJobReadyForAuthDelete,
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
const TRANSIENT_AUTH_CODES = new Set([
  'auth/internal-error', 'auth/network-request-failed', 'auth/too-many-requests',
  'auth/unavailable', 'unavailable', 'deadline-exceeded',
]);

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

function requireCaller(request, deps) {
  if (!request?.auth?.uid) {
    throw new deps.HttpsError('unauthenticated', 'Authentication is required.', {
      reason: 'authentication-required',
    });
  }
  const authTime = request.auth.token?.auth_time;
  const now = deps.nowSeconds();
  assertRecentAuthentication(authTime, now);
  if (authTime > now) {
    throw new AccountDeletionError('invalid-auth-time', 'Authentication time cannot be in the future.');
  }
  return request.auth.uid;
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
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    logError: (event) => logger.error(event),
    deleteAuthUser: (uid) => getAuth().deleteUser(uid),
    applyTeamDecision,
    beginAccountDeletionJob,
    deletePersonalCloudData,
    loadAccountDeletionSnapshot,
    markDeletionJobComplete,
    markDeletionJobReadyForAuthDelete,
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
      const uid = requireCaller(request, deps);
      validatePlanRequest(request.data);
      const db = deps.db ?? getFirestore();
      const snapshot = await deps.loadAccountDeletionSnapshot(db, uid);
      const plan = buildAccountDeletionPlan(snapshot);
      return { teams: publicPlan(plan, snapshot), planHash: hashPlan(plan) };
    } catch (error) {
      throw mapError(error, deps);
    }
  };
}

async function retry(operation, { attempts, sleep, retryable = () => true }) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1 || !retryable(error)) throw error;
      await sleep(25 * (2 ** attempt));
    }
  }
  throw lastError;
}

export function createDeleteAccountHandler(overrides = {}) {
  const deps = dependencies(overrides);
  return async function deleteAccountHandler(request) {
    let requestId;
    try {
      const uid = requireCaller(request, deps);
      const normalized = normalizeDeletionRequest(request.data);
      requestId = normalized.requestId;
      const db = deps.db ?? getFirestore();
      const snapshot = await deps.loadAccountDeletionSnapshot(db, uid);
      const plan = buildAccountDeletionPlan(snapshot);
      const decisions = validateTeamDecisions(plan, normalized.teamDecisions);
      const planHash = hashPlan(plan);
      const context = { requestId, planHash, verifiedEmail: verifiedEmail(request) };

      await deps.beginAccountDeletionJob(db, uid, requestId, planHash, decisions);
      for (const decision of decisions) {
        await deps.applyTeamDecision(db, uid, decision, context);
        if (decision.action !== 'dissolve') {
          await deps.removeUserIdentityFromTeam(db, uid, decision.teamId, context);
        }
      }
      await deps.deletePersonalCloudData(db, uid, context);
      await deps.markDeletionJobReadyForAuthDelete(db, uid, context);

      await retry(async () => {
        await deps.reverifyDeletionBeforeAuthDelete(db, uid, context);
        try {
          await deps.deleteAuthUser(uid);
        } catch (error) {
          if (errorCode(error) !== 'auth/user-not-found') throw error;
        }
      }, {
        attempts: 3,
        sleep: deps.sleep,
        retryable: (error) => TRANSIENT_AUTH_CODES.has(errorCode(error)),
      });

      try {
        await retry(
          () => deps.markDeletionJobComplete(db, uid, {
            ...context, authDeletionSucceeded: true,
          }),
          { attempts: 3, sleep: deps.sleep },
        );
      } catch (error) {
        deps.logError({
          event: 'account-deletion-completion-checkpoint-failed',
          requestId,
          reason: errorCode(error),
        });
      }
      return { deleted: true, requestId };
    } catch (error) {
      throw mapError(error, deps);
    }
  };
}

export { canonicalJson, hashPlan };
