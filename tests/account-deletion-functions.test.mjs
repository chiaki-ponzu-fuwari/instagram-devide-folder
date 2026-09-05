import assert from 'node:assert/strict';
import test from 'node:test';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

import {
  createDeleteAccountHandler,
  createGetAccountDeletionPlanHandler,
} from '../functions/account-deletion-functions.mjs';
import {
  applyTeamDecision,
  beginAccountDeletionJob,
  removeUserIdentityFromTeam,
} from '../functions/account-deletion-store.mjs';

const REQUEST_ID = 'request_123456789012345678901234';

class TestHttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function auth(overrides = {}) {
  return {
    uid: 'user-a',
    token: {
      auth_time: 1_000,
      email: 'private@example.com',
      email_verified: true,
      ...overrides,
    },
  };
}

function snapshot(overrides = {}) {
  return {
    uid: 'user-a',
    teams: [{
      id: 'team-a', name: '安全なチーム名', createdBy: 'user-a',
      memberUids: ['user-a', 'successor'], privateNote: 'do not return',
    }],
    memberships: [
      { teamId: 'team-a', uid: 'user-a', role: 'admin', status: 'active', displayName: '本人' },
      {
        teamId: 'team-a', uid: 'successor', role: 'member', status: 'active',
        displayName: '引継ぎ先', email: 'successor@example.com',
      },
    ],
    ...overrides,
  };
}

function baseDeps(overrides = {}) {
  return {
    HttpsError: TestHttpsError,
    db: {},
    nowSeconds: () => 1_100,
    loadAccountDeletionJob: async () => null,
    loadAccountDeletionSnapshot: async () => snapshot(),
    ...overrides,
  };
}

test('callable handlers reject unauthenticated and stale authentication with machine-safe details', async () => {
  const getPlan = createGetAccountDeletionPlanHandler(baseDeps());
  await assert.rejects(() => getPlan({ data: {}, auth: null }), (error) => (
    error.code === 'unauthenticated' && error.details.reason === 'authentication-required'
  ));
  await assert.rejects(
    () => getPlan({ data: {}, auth: auth({ auth_time: 799 }) }),
    (error) => error.code === 'failed-precondition'
      && error.details.reason === 'recent-authentication-required'
      && !JSON.stringify(error).includes('private@example.com'),
  );
});

test('callable handlers reject missing and future auth_time claims', async () => {
  const getPlan = createGetAccountDeletionPlanHandler(baseDeps());
  await assert.rejects(
    () => getPlan({ data: {}, auth: auth({ auth_time: undefined }) }),
    (error) => error.code === 'failed-precondition' && error.details.reason === 'invalid-auth-time',
  );
  await assert.rejects(
    () => getPlan({ data: {}, auth: auth({ auth_time: 1_101 }) }),
    (error) => error.code === 'failed-precondition' && error.details.reason === 'invalid-auth-time',
  );
});

test('plan response is a safe projection with a deterministic SHA-256 hash', async () => {
  const getPlan = createGetAccountDeletionPlanHandler(baseDeps());
  const first = await getPlan({ data: {}, auth: auth() });
  const second = await getPlan({ data: {}, auth: auth() });
  assert.deepEqual(first, second);
  assert.match(first.planHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(first.teams, [{
    teamId: 'team-a',
    teamName: '安全なチーム名',
    requiredAction: 'transfer',
    eligibleSuccessors: [{ uid: 'successor', displayName: '引継ぎ先' }],
  }]);
  assert.doesNotMatch(JSON.stringify(first), /privateNote|successor@example\.com|role/);
});

test('plan rejects unknown request input', async () => {
  const getPlan = createGetAccountDeletionPlanHandler(baseDeps());
  await assert.rejects(
    () => getPlan({ data: { unexpected: true }, auth: auth() }),
    (error) => error.code === 'invalid-argument' && error.details.reason === 'unknown-field',
  );
});

test('delete validates decisions and runs cleanup in stable order with Auth deletion last', async () => {
  const calls = [];
  const deps = baseDeps({
    beginAccountDeletionJob: async (_db, _uid, requestId, planHash, decisions) => {
      calls.push(['begin', requestId, planHash, decisions]);
    },
    applyTeamDecision: async (_db, _uid, decision) => calls.push(['apply', decision.teamId]),
    removeUserIdentityFromTeam: async (_db, _uid, teamId) => calls.push(['remove', teamId]),
    deletePersonalCloudData: async () => calls.push(['personal']),
    markDeletionJobReadyForAuthDelete: async () => calls.push(['ready']),
    reverifyDeletionBeforeAuthDelete: async () => calls.push(['reverify']),
    deleteAuthUser: async () => calls.push(['auth-delete']),
    markDeletionJobComplete: async () => calls.push(['complete']),
    sleep: async () => {},
  });
  const handler = createDeleteAccountHandler(deps);
  const result = await handler({
    auth: auth(),
    data: {
      requestId: REQUEST_ID,
      teamDecisions: [{ teamId: 'team-a', action: 'transfer', transferToUid: 'successor' }],
    },
  });
  assert.deepEqual(result, { deleted: true, requestId: REQUEST_ID });
  assert.deepEqual(calls.map((entry) => entry[0]), [
    'begin', 'apply', 'remove', 'personal', 'ready', 'reverify', 'auth-delete', 'complete',
  ]);
  assert.equal(calls[0][3][0].teamId, 'team-a');
});

test('delete resumes from the saved plan without loading a changed snapshot', async () => {
  const calls = [];
  const storedDecisions = [
    { teamId: 'team-a', action: 'leave', transferToUid: null },
    { teamId: 'team-b', action: 'transfer', transferToUid: 'successor' },
  ];
  const handler = createDeleteAccountHandler(baseDeps({
    loadAccountDeletionJob: async (_db, uid, requestId) => {
      calls.push(['load-job', uid, requestId]);
      return {
        requestId,
        planHash: 'saved-plan-hash',
        phase: 'started',
        expectedTeams: storedDecisions,
      };
    },
    loadAccountDeletionSnapshot: async () => {
      throw new Error('changed snapshot must not be loaded');
    },
    beginAccountDeletionJob: async (_db, _uid, requestId, planHash, decisions) => {
      calls.push(['begin', requestId, planHash, decisions]);
    },
    applyTeamDecision: async (_db, _uid, decision) => calls.push(['apply', decision.teamId]),
    removeUserIdentityFromTeam: async (_db, _uid, teamId) => calls.push(['remove', teamId]),
    deletePersonalCloudData: async () => calls.push(['personal']),
    markDeletionJobReadyForAuthDelete: async () => calls.push(['ready']),
    reverifyDeletionBeforeAuthDelete: async () => calls.push(['reverify']),
    deleteAuthUser: async () => calls.push(['auth-delete']),
    markDeletionJobComplete: async () => calls.push(['complete']),
    sleep: async () => {},
  }));

  const result = await handler({
    auth: auth(),
    data: {
      requestId: REQUEST_ID,
      teamDecisions: [
        { teamId: 'team-b', action: 'transfer', transferToUid: 'successor' },
        { teamId: 'team-a', action: 'leave' },
      ],
    },
  });

  assert.deepEqual(result, { deleted: true, requestId: REQUEST_ID });
  assert.deepEqual(calls[0], ['load-job', 'user-a', REQUEST_ID]);
  assert.deepEqual(calls[1], ['begin', REQUEST_ID, 'saved-plan-hash', [
    { teamId: 'team-a', action: 'leave' },
    { teamId: 'team-b', action: 'transfer', transferToUid: 'successor' },
  ]]);
  assert.deepEqual(calls.filter(([name]) => name === 'apply').map(([, teamId]) => teamId), [
    'team-a', 'team-b',
  ]);
});

test('delete rejects changed decisions when resuming a saved job', async () => {
  let began = false;
  const handler = createDeleteAccountHandler(baseDeps({
    loadAccountDeletionJob: async () => ({
      requestId: REQUEST_ID,
      planHash: 'saved-plan-hash',
      phase: 'started',
      expectedTeams: [{ teamId: 'team-a', action: 'leave', transferToUid: null }],
    }),
    loadAccountDeletionSnapshot: async () => {
      throw new Error('snapshot must not be loaded');
    },
    beginAccountDeletionJob: async () => { began = true; },
  }));
  await assert.rejects(() => handler({
    auth: auth(),
    data: {
      requestId: REQUEST_ID,
      teamDecisions: [{ teamId: 'team-a', action: 'transfer', transferToUid: 'successor' }],
    },
  }), (error) => error.code === 'aborted' && error.details.reason === 'team-plan-mismatch');
  assert.equal(began, false);
});

test('delete rejects a mismatched decision before creating a job or deleting Auth', async () => {
  let began = false;
  let authDeleted = false;
  const handler = createDeleteAccountHandler(baseDeps({
    beginAccountDeletionJob: async () => { began = true; },
    deleteAuthUser: async () => { authDeleted = true; },
  }));
  await assert.rejects(() => handler({
    auth: auth(), data: { requestId: REQUEST_ID, teamDecisions: [] },
  }), (error) => error.code === 'failed-precondition');
  assert.equal(began, false);
  assert.equal(authDeleted, false);
});

test('a cleanup failure never deletes the Auth user', async () => {
  let authDeleted = false;
  const handler = createDeleteAccountHandler(baseDeps({
    beginAccountDeletionJob: async () => {},
    applyTeamDecision: async () => { throw new Error('cleanup failed'); },
    deleteAuthUser: async () => { authDeleted = true; },
  }));
  await assert.rejects(() => handler({
    auth: auth(),
    data: {
      requestId: REQUEST_ID,
      teamDecisions: [{ teamId: 'team-a', action: 'transfer', transferToUid: 'successor' }],
    },
  }), (error) => error.code === 'internal');
  assert.equal(authDeleted, false);
});

test('mark-complete retries three times but returns deletion success without logging PII', async () => {
  let attempts = 0;
  const logs = [];
  const handler = createDeleteAccountHandler(baseDeps({
    beginAccountDeletionJob: async () => {},
    applyTeamDecision: async () => {},
    removeUserIdentityFromTeam: async () => {},
    deletePersonalCloudData: async () => {},
    markDeletionJobReadyForAuthDelete: async () => {},
    reverifyDeletionBeforeAuthDelete: async () => {},
    deleteAuthUser: async () => {},
    markDeletionJobComplete: async () => {
      attempts += 1;
      throw new Error('private@example.com 安全なチーム名');
    },
    sleep: async () => {},
    logError: (event) => logs.push(event),
  }));
  assert.deepEqual(await handler({
    auth: auth(),
    data: {
      requestId: REQUEST_ID,
      teamDecisions: [{ teamId: 'team-a', action: 'transfer', transferToUid: 'successor' }],
    },
  }), { deleted: true, requestId: REQUEST_ID });
  assert.equal(attempts, 3);
  assert.doesNotMatch(JSON.stringify(logs), /private@example\.com|安全なチーム名|user-a/);
});

test('Auth user-not-found is idempotent success for the same ready job', async () => {
  let completed = false;
  const handler = createDeleteAccountHandler(baseDeps({
    loadAccountDeletionJob: async () => ({
      requestId: REQUEST_ID,
      planHash: 'saved-plan-hash',
      phase: 'complete',
      expectedTeams: [{ teamId: 'team-a', action: 'transfer', transferToUid: 'successor' }],
    }),
    loadAccountDeletionSnapshot: async () => {
      throw new Error('complete job must not rebuild its plan');
    },
    beginAccountDeletionJob: async () => {},
    applyTeamDecision: async () => {},
    removeUserIdentityFromTeam: async () => {},
    deletePersonalCloudData: async () => {},
    markDeletionJobReadyForAuthDelete: async () => {},
    reverifyDeletionBeforeAuthDelete: async () => {},
    deleteAuthUser: async () => { throw Object.assign(new Error('missing'), { code: 'auth/user-not-found' }); },
    markDeletionJobComplete: async () => { completed = true; },
    sleep: async () => {},
  }));
  const result = await handler({
    auth: auth(),
    data: {
      requestId: REQUEST_ID,
      teamDecisions: [{ teamId: 'team-a', action: 'transfer', transferToUid: 'successor' }],
    },
  });
  assert.equal(result.deleted, true);
  assert.equal(completed, true);
});

test('unverified email is never passed to cleanup while UID-only deletion remains possible', async () => {
  const contexts = [];
  const handler = createDeleteAccountHandler(baseDeps({
    loadAccountDeletionSnapshot: async () => snapshot({ teams: [], memberships: [] }),
    beginAccountDeletionJob: async () => {},
    deletePersonalCloudData: async (_db, _uid, context) => contexts.push(context),
    markDeletionJobReadyForAuthDelete: async () => {},
    reverifyDeletionBeforeAuthDelete: async () => {},
    deleteAuthUser: async () => {},
    markDeletionJobComplete: async () => {},
    sleep: async () => {},
  }));
  await handler({
    auth: auth({ email_verified: false }),
    data: { requestId: REQUEST_ID, teamDecisions: [] },
  });
  assert.equal(contexts[0].verifiedEmail, undefined);
});

test('index exports both v2 callables with bounded production options', async () => {
  const entrypoint = await import('../functions/index.mjs');
  for (const name of ['getAccountDeletionPlan', 'deleteAccount']) {
    const callable = entrypoint[name];
    assert.equal(typeof callable, 'function', name);
    assert.equal(callable.__endpoint.platform, 'gcfv2');
    assert.deepEqual(callable.__endpoint.region, ['asia-northeast1']);
    assert.equal(callable.__endpoint.timeoutSeconds, 540);
    assert.equal(callable.__endpoint.availableMemoryMb, 512);
    assert.equal(callable.__endpoint.maxInstances, 5);
    assert.notEqual(callable.__endpoint.callableTrigger.enforceAppCheck, true);
  }
});

const emulatorAvailable = Boolean(
  process.env.FIREBASE_AUTH_EMULATOR_HOST
  && process.env.FIRESTORE_EMULATOR_HOST,
);

test('emulator callable completes fresh and partially-applied account deletion jobs', {
  skip: !emulatorAvailable,
}, async () => {
  await import('../functions/index.mjs');
  const projectId = process.env.GCLOUD_PROJECT || 'demo-no-project';
  const adminApp = initializeApp({ projectId }, `account-deletion-functions-${Date.now()}`);
  const db = getFirestore(adminApp);
  const adminAuth = getAuth(adminApp);
  await Promise.all([
    'teams', 'users', 'accountDeletionJobs', 'accountDeletionLocks', 'teamInviteCodes',
  ].map((name) => db.recursiveDelete(db.collection(name))));

  const authBase = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
  const signupResponse = await fetch(`${authBase}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'callable-test@example.com', password: 'password123', returnSecureToken: true }),
  });
  assert.equal(signupResponse.ok, true, await signupResponse.clone().text());
  const signedUp = await signupResponse.json();
  const uid = signedUp.localId;
  const successor = 'successor-user';

  const activeMember = (memberUid, role, displayName) => ({
    uid: memberUid, role, status: 'active', displayName,
  });
  await Promise.all([
    db.doc('teams/transfer').set({
      name: '引継ぎ', createdBy: uid, memberUids: [uid, successor], settings: {},
    }),
    db.doc(`teams/transfer/members/${uid}`).set(activeMember(uid, 'admin', '削除本人')),
    db.doc(`teams/transfer/members/${successor}`).set(activeMember(successor, 'member', '引継ぎ先')),
    db.doc('teams/leave').set({
      name: '退会', createdBy: successor, memberUids: [successor, uid], settings: {},
    }),
    db.doc(`teams/leave/members/${successor}`).set(activeMember(successor, 'admin', '管理者')),
    db.doc(`teams/leave/members/${uid}`).set(activeMember(uid, 'member', '削除本人')),
    db.doc('teams/dissolve').set({
      name: '解散', createdBy: uid, memberUids: [uid], settings: {},
    }),
    db.doc(`teams/dissolve/members/${uid}`).set(activeMember(uid, 'admin', '削除本人')),
    db.doc(`users/${uid}`).set({ displayName: '削除本人' }),
    db.doc(`users/${uid}/projects/private`).set({ name: '個人案件' }),
  ]);

  const callableBase = `http://127.0.0.1:5001/${projectId}/asia-northeast1`;
  const invoke = (name, data, token = signedUp.idToken) => fetch(`${callableBase}/${name}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ data }),
  });

  const unauthenticated = await invoke('getAccountDeletionPlan', {}, null);
  assert.equal((await unauthenticated.json()).error.status, 'UNAUTHENTICATED');

  const planResponse = await invoke('getAccountDeletionPlan', {});
  assert.equal(planResponse.ok, true, await planResponse.clone().text());
  const plan = (await planResponse.json()).result;
  assert.deepEqual(plan.teams.map((team) => [team.teamId, team.requiredAction]), [
    ['dissolve', 'dissolve'], ['leave', 'leave'], ['transfer', 'transfer'],
  ]);
  assert.deepEqual(plan.teams[2].eligibleSuccessors, [{ uid: successor, displayName: '引継ぎ先' }]);

  const deleteResponse = await invoke('deleteAccount', {
    requestId: 'emulator_request_12345678901234567',
    teamDecisions: [
      { teamId: 'transfer', action: 'transfer', transferToUid: successor },
      { teamId: 'leave', action: 'leave' },
      { teamId: 'dissolve', action: 'dissolve' },
    ],
  });
  assert.equal(deleteResponse.ok, true, await deleteResponse.clone().text());
  assert.equal((await deleteResponse.json()).result.deleted, true);
  assert.equal((await db.doc('teams/dissolve').get()).exists, false);
  assert.equal((await db.doc(`teams/leave/members/${uid}`).get()).exists, false);
  assert.equal((await db.doc('teams/transfer').get()).data().createdBy, successor);
  assert.equal((await db.doc(`users/${uid}`).get()).exists, false);
  await assert.rejects(
    () => adminAuth.getUser(uid),
    (error) => error.code === 'auth/user-not-found',
  );

  const protectedRead = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${projectId}/databases/(default)/documents/teams/leave`,
    { headers: { authorization: `Bearer ${signedUp.idToken}` } },
  );
  assert.equal(protectedRead.ok, false);

  const resumeSignupResponse = await fetch(`${authBase}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'resume-test@example.com', password: 'password123', returnSecureToken: true }),
  });
  assert.equal(resumeSignupResponse.ok, true, await resumeSignupResponse.clone().text());
  const resumeUser = await resumeSignupResponse.json();
  const resumeUid = resumeUser.localId;
  const resumeRequestId = 'resume_request_123456789012345678';
  const resumePlanHash = 'saved-resume-plan-hash';
  const resumeDecisions = [
    { teamId: 'resume-a', action: 'leave' },
    { teamId: 'resume-b', action: 'leave' },
  ];
  for (const teamId of ['resume-a', 'resume-b']) {
    await db.doc(`teams/${teamId}`).set({
      name: teamId, createdBy: successor, memberUids: [successor, resumeUid], settings: {},
    });
    await db.doc(`teams/${teamId}/members/${successor}`).set(activeMember(successor, 'admin', '管理者'));
    await db.doc(`teams/${teamId}/members/${resumeUid}`).set(activeMember(resumeUid, 'member', '再開対象'));
  }
  await db.doc(`users/${resumeUid}/projects/private`).set({ name: '削除対象' });
  await beginAccountDeletionJob(
    db, resumeUid, resumeRequestId, resumePlanHash, resumeDecisions,
  );
  const resumeContext = { requestId: resumeRequestId, planHash: resumePlanHash };
  await applyTeamDecision(db, resumeUid, resumeDecisions[0], resumeContext);
  await removeUserIdentityFromTeam(db, resumeUid, 'resume-a', resumeContext);
  assert.equal((await db.doc(`teams/resume-a/members/${resumeUid}`).get()).exists, false);

  const resumedResponse = await invoke('deleteAccount', {
    requestId: resumeRequestId,
    teamDecisions: [...resumeDecisions].reverse(),
  }, resumeUser.idToken);
  assert.equal(resumedResponse.ok, true, await resumedResponse.clone().text());
  assert.deepEqual((await resumedResponse.json()).result, {
    deleted: true, requestId: resumeRequestId,
  });
  assert.equal((await db.doc(`teams/resume-b/members/${resumeUid}`).get()).exists, false);
  assert.equal((await db.doc(`users/${resumeUid}`).get()).exists, false);
  assert.equal(
    (await db.doc(`accountDeletionJobs/${resumeUid}_${resumeRequestId}`).get()).data().phase,
    'complete',
  );
  await assert.rejects(
    () => adminAuth.getUser(resumeUid),
    (error) => error.code === 'auth/user-not-found',
  );
});
