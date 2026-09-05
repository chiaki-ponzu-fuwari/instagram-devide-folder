# Team Security Boundary Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 未移行・移行中のチームを fail-closed にし、公開情報とメール・補足・振込先・報酬・経費の Firestore 読取境界をサーバー側で強制する。

**Architecture:** `teams/{teamId}` の `securitySchemaVersion` と `securityMigrationState` をアクセス判定の正本にする。一般メンバーは `securitySchemaVersion == 2 && securityMigrationState == 'ready'` のときだけ共有ワークスペースを読め、管理者・作成者は移行用に旧データへアクセスできる。メール、補足、報酬、経費は公開文書から分離し、UI は権限のない値を取得してから隠すのではなく、Firestore から取得しない。

**Tech Stack:** Vanilla HTML/CSS/JavaScript, Firebase Auth, Cloud Firestore Security Rules, Firebase Emulator Suite, Node.js test runner

---

## Scope and file responsibilities

- Create `www/js/team-security-model.mjs`: migration state, restrictive setting normalization, public/private member projections.
- Create `tests/team-security-model.test.mjs`: pure security-policy regression tests that do not need Java.
- Create `tests/team-security-boundary.test.mjs`: source-level UI/store wiring regressions.
- Modify `www/js/team-cloud.mjs`: split member profile writes and subscribe only to authorized private collections.
- Modify `www/js/team-workspace-store.mjs`: resolve the authenticated user's workspace access before reading, writing, or subscribing.
- Modify `www/index.html`: block cached workspace application and editing while locked; merge separately subscribed private profile data.
- Modify `www/i18n.js`: short migration-state messages.
- Modify `firestore.rules`: fail-closed state and public/private collection enforcement.
- Modify `tests/firestore-rules.test.mjs`: emulator matrix for legacy, migrating, ready, roles, and sensitive collections.
- Modify `package.json`: include the new tests and module in normal verification.

Phase 1 does not migrate legacy documents, replace snapshot writes with mutation writes, implement tombstone Undo, or calculate rewards/completed counts. Those remain in later phase plans. Phase 1 may define the protected v2 collection paths, but no existing team is marked `ready` until Phase 2 verifies its migration.

## Preconditions

- Preserve all current unstaged and untracked user changes. Do not run reset, checkout, clean, or bulk formatting.
- Run `git status --short` before every task and stage only the files listed by that task.
- Several listed files already contain user changes. For modified existing files, use `git add -p` and stage only Phase 1 hunks. If a hunk mixes prior work with Phase 1 and cannot be separated safely, do not commit that file; leave it unstaged and report the overlap. New Phase 1 files can be staged normally.
- Firestore Emulator in `firebase-tools@15.17.0` requires JDK 21 or newer. Before Task 3, run:

```bash
java -version
```

Expected: a Java 21-or-newer runtime. If the command reports that no runtime exists, install the already-approved Java 21 runtime and repeat the command before running Rules tests.

### Task 1: Pure fail-closed policy model

**Files:**
- Create: `www/js/team-security-model.mjs`
- Create: `tests/team-security-model.test.mjs`
- Modify: `package.json:8-10`

- [ ] **Step 1: Write the failing security-state test**

Create `tests/team-security-model.test.mjs` with:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TEAM_SECURITY_SCHEMA_VERSION,
  buildMemberEmailRecord,
  buildMemberNoteRecord,
  buildPublicMemberRecord,
  normalizeTeamSecuritySettings,
  resolveTeamSecurityState,
  resolveTeamWorkspaceAccess,
} from '../www/js/team-security-model.mjs';

test('team workspace fails closed until schema v2 migration is ready', () => {
  const member = { uid: 'u2', role: 'member', status: 'active' };
  const admin = { uid: 'u1', role: 'admin', status: 'active' };

  assert.equal(TEAM_SECURITY_SCHEMA_VERSION, 2);
  assert.equal(resolveTeamSecurityState({}), 'locked');
  assert.equal(resolveTeamSecurityState({ securityMigrationState: 'migrating' }), 'migrating');
  assert.equal(resolveTeamSecurityState({
    securitySchemaVersion: 2,
    securityMigrationState: 'ready',
  }), 'ready');
  assert.equal(resolveTeamSecurityState({
    securitySchemaVersion: 1,
    securityMigrationState: 'ready',
  }), 'locked');

  assert.equal(resolveTeamWorkspaceAccess({
    team: { createdBy: 'u1' },
    member,
    uid: 'u2',
  }), 'locked');
  assert.equal(resolveTeamWorkspaceAccess({
    team: { createdBy: 'u1' },
    member: admin,
    uid: 'u1',
  }), 'admin');
  assert.equal(resolveTeamWorkspaceAccess({
    team: {
      createdBy: 'u1',
      securitySchemaVersion: 2,
      securityMigrationState: 'ready',
    },
    member,
    uid: 'u2',
  }), 'member');
  assert.equal(resolveTeamWorkspaceAccess({
    team: {
      createdBy: 'u1',
      securitySchemaVersion: 2,
      securityMigrationState: 'ready',
    },
    member: { uid: 'u3', role: 'member', status: 'pending' },
    uid: 'u3',
  }), 'denied');
});

test('unknown team settings normalize to the most restrictive values', () => {
  assert.deepEqual(normalizeTeamSecuritySettings({ settings: {
    rewardVisibility: 'unexpected',
    assignPermission: 'unexpected',
    assignOwnerUids: ['u2', '', 'u2', 42],
    deletePermission: 'unexpected',
    memberEmailVisibility: 'unexpected',
    memberNoteVisibility: 'unexpected',
    memberPayoutVisibility: 'unexpected',
  } }), {
    rewardVisibility: 'self',
    assignPermission: 'admin_only',
    assignOwnerUids: ['u2'],
    deletePermission: 'admin_only',
    memberEmailVisibility: 'admin_only',
    memberNoteVisibility: 'admin_only',
    memberPayoutVisibility: 'admin_only',
  });
});

test('member projection never puts private profile fields in the public document', () => {
  const input = {
    uid: 'u2',
    role: 'member',
    status: 'active',
    displayName: 'メンバー',
    photoURL: 'https://example.com/photo.png',
    email: 'member@example.com',
    note: 'private note',
    payoutAccount: 'private payout',
  };
  const context = { uid: 'u2', updatedBy: 'u2', now: 100 };
  const publicRecord = buildPublicMemberRecord(input, context);

  assert.deepEqual(publicRecord, {
    uid: 'u2',
    role: 'member',
    status: 'active',
    displayName: 'メンバー',
    photoURL: 'https://example.com/photo.png',
    updatedAt: 100,
    updatedBy: 'u2',
  });
  assert.deepEqual(buildMemberEmailRecord(input, context), {
    uid: 'u2',
    email: 'member@example.com',
    updatedAt: 100,
    updatedBy: 'u2',
  });
  assert.deepEqual(buildMemberNoteRecord(input, context), {
    uid: 'u2',
    note: 'private note',
    updatedAt: 100,
    updatedBy: 'u2',
  });
});
```

- [ ] **Step 2: Run the test and verify the expected failure**

Run:

```bash
node --test tests/team-security-model.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `www/js/team-security-model.mjs`.

- [ ] **Step 3: Implement the pure security model**

Create `www/js/team-security-model.mjs` with:

```js
export const TEAM_SECURITY_SCHEMA_VERSION = 2;

function cleanString(value) {
  return String(value ?? '').trim();
}

function normalizeVisibility(value, allowed, fallback) {
  const normalized = cleanString(value);
  return allowed.includes(normalized) ? normalized : fallback;
}

export function normalizeTeamSecuritySettings(team = {}) {
  const settings = team?.settings && typeof team.settings === 'object' ? team.settings : {};
  const rewardRaw = cleanString(settings.rewardVisibility || team?.rewardVisibility);
  const rewardVisibility = rewardRaw === 'all' || rewardRaw === 'all_members'
    ? 'all'
    : rewardRaw === 'self_plus_total'
      ? 'self_plus_total'
      : 'self';
  const assignOwnerUids = [...new Set(
    (Array.isArray(settings.assignOwnerUids) ? settings.assignOwnerUids : [])
      .filter((uid) => typeof uid === 'string')
      .map(cleanString)
      .filter(Boolean),
  )];

  return {
    rewardVisibility,
    assignPermission: normalizeVisibility(settings.assignPermission, ['admin_only', 'owner_set'], 'admin_only'),
    assignOwnerUids,
    deletePermission: normalizeVisibility(settings.deletePermission, ['admin_only', 'all_edit'], 'admin_only'),
    memberEmailVisibility: normalizeVisibility(settings.memberEmailVisibility, ['admin_only', 'all_members'], 'admin_only'),
    memberNoteVisibility: normalizeVisibility(settings.memberNoteVisibility, ['admin_only', 'all_members'], 'admin_only'),
    memberPayoutVisibility: normalizeVisibility(settings.memberPayoutVisibility, ['admin_only', 'all_members'], 'admin_only'),
  };
}

export function resolveTeamSecurityState(team = {}) {
  const state = cleanString(team?.securityMigrationState);
  if (Number(team?.securitySchemaVersion || 0) === TEAM_SECURITY_SCHEMA_VERSION && state === 'ready') return 'ready';
  if (state === 'migrating') return 'migrating';
  return 'locked';
}

export function resolveTeamWorkspaceAccess({ team, member, uid } = {}) {
  const currentUid = cleanString(uid);
  if (!team || !currentUid) return 'denied';
  const isCreator = cleanString(team.createdBy) === currentUid;
  const isActive = cleanString(member?.uid) === currentUid && member?.status === 'active';
  const isAdmin = isActive && member?.role === 'admin';
  if (isCreator || isAdmin) return 'admin';
  if (!isActive) return 'denied';
  return resolveTeamSecurityState(team) === 'ready' ? 'member' : 'locked';
}

export function buildPublicMemberRecord(input = {}, { uid, updatedBy, now = Date.now() } = {}) {
  const targetUid = cleanString(input.uid || uid);
  return {
    uid: targetUid,
    role: input.role === 'admin' ? 'admin' : 'member',
    status: input.status === 'active' ? 'active' : 'pending',
    displayName: cleanString(input.displayName) || 'メンバー',
    photoURL: cleanString(input.photoURL),
    updatedAt: Number(now) || Date.now(),
    updatedBy: cleanString(updatedBy || targetUid),
  };
}

export function buildMemberEmailRecord(input = {}, { uid, updatedBy, now = Date.now() } = {}) {
  const targetUid = cleanString(input.uid || uid);
  return {
    uid: targetUid,
    email: cleanString(input.email),
    updatedAt: Number(now) || Date.now(),
    updatedBy: cleanString(updatedBy || targetUid),
  };
}

export function buildMemberNoteRecord(input = {}, { uid, updatedBy, now = Date.now() } = {}) {
  const targetUid = cleanString(input.uid || uid);
  return {
    uid: targetUid,
    note: cleanString(input.note),
    updatedAt: Number(now) || Date.now(),
    updatedBy: cleanString(updatedBy || targetUid),
  };
}
```

- [ ] **Step 4: Add the test and module to normal verification**

Append `tests/team-security-model.test.mjs` to the `test` script and append `node --check www/js/team-security-model.mjs` to `check:js` in `package.json`.

- [ ] **Step 5: Run the narrow tests**

Run:

```bash
node --test tests/team-model.test.mjs tests/team-security-model.test.mjs
npm run check:js
```

Expected: both commands PASS.

- [ ] **Step 6: Commit the isolated model change**

```bash
git add tests/team-security-model.test.mjs www/js/team-security-model.mjs
git add -p package.json
git commit -m "feat: add fail-closed team security model"
```

### Task 2: Split new member profile writes into public and private documents

**Files:**
- Modify: `www/js/team-cloud.mjs:21-39,78-114,302-338,350-377,452-522`
- Create: `tests/team-security-boundary.test.mjs`
- Modify: `package.json:8`

- [ ] **Step 1: Write the failing source-boundary tests**

Create `tests/team-security-boundary.test.mjs` with:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cloud = readFileSync(new URL('../www/js/team-cloud.mjs', import.meta.url), 'utf8');
const store = readFileSync(new URL('../www/js/team-workspace-store.mjs', import.meta.url), 'utf8');
const html = readFileSync(new URL('../www/index.html', import.meta.url), 'utf8');

function slice(source, startText, endText) {
  const start = source.indexOf(startText);
  assert.notEqual(start, -1, `${startText} should exist`);
  const end = source.indexOf(endText, start + startText.length);
  assert.notEqual(end, -1, `${endText} should follow ${startText}`);
  return source.slice(start, end);
}

test('member profile writes public email and note documents separately', () => {
  const createTeam = slice(cloud, 'export async function createTeam(', 'export async function listMyTeams(');
  const approve = slice(cloud, 'export async function approveJoinRequest(', 'export async function updateTeamName(');
  const update = slice(cloud, 'export async function updateMemberProfile(', 'export async function updateMemberPayout(');

  assert.match(cloud, /function memberEmailRef\(/);
  assert.match(cloud, /function memberNoteRef\(/);
  assert.match(createTeam, /buildPublicMemberRecord/);
  assert.match(createTeam, /memberEmailRef/);
  assert.doesNotMatch(createTeam, /memberRef[\s\S]*?email:/);
  assert.match(approve, /memberEmailRef/);
  assert.doesNotMatch(approve, /memberRef[\s\S]*?email:/);
  assert.match(update, /displayName:/);
  assert.match(update, /memberEmailRef/);
  assert.match(update, /memberNoteRef/);
  assert.doesNotMatch(update, /memberRef[\s\S]*?email:/);
  assert.doesNotMatch(update, /memberRef[\s\S]*?note:/);
});

test('team subscription reads private profile collections only when requested', () => {
  const subscribe = slice(cloud, 'export function subscribeTeam(', '\n}');
  assert.match(subscribe, /canReadAllMemberEmails/);
  assert.match(subscribe, /canReadAllMemberNotes/);
  assert.match(subscribe, /memberEmails/);
  assert.match(subscribe, /memberNotes/);
  assert.match(subscribe, /userUid/);
});

test('locked team workspaces are gated before bootstrap, cache application, and writes', () => {
  const sync = slice(html, 'async function syncTeamWorkspaceForTeam(', 'function _ensureTeamSettings(');
  const openProjects = slice(html, 'async function openTeamProjectsExpanded(', 'function closeTeamProjectsExpanded(');
  const queueSave = slice(html, 'function queueTeamWorkspaceSave(', 'function save(');
  assert.match(sync, /resolveTeamWorkspaceAccessFromFirestore/);
  assert.match(sync, /teamSecurityAccessById/);
  assert.match(openProjects, /locked/);
  assert.match(queueSave, /teamSecurityAccessById/);
  assert.match(store, /export async function resolveTeamWorkspaceAccessFromFirestore/);
});
```

- [ ] **Step 2: Run the test and verify the expected failure**

```bash
node --test tests/team-security-boundary.test.mjs
```

Expected: FAIL because `memberEmailRef`, `memberNoteRef`, and the access gates do not exist.

- [ ] **Step 3: Add private references and model imports**

In `www/js/team-cloud.mjs`, replace the `team-model.mjs` import with both model imports:

```js
import { buildActivityText, currentUserLabel, normalizeTeamRecord } from './team-model.mjs';
import {
  buildMemberEmailRecord,
  buildMemberNoteRecord,
  buildPublicMemberRecord,
  normalizeTeamSecuritySettings,
} from './team-security-model.mjs';
```

Add beside `memberRef` and `payoutRef`:

```js
function memberEmailRef(db, teamId, uid) {
  return doc(db, 'teams', teamId, 'memberEmails', uid);
}

function memberNoteRef(db, teamId, uid) {
  return doc(db, 'teams', teamId, 'memberNotes', uid);
}
```

- [ ] **Step 4: Make new teams locked with restrictive canonical settings**

In `createTeam`, construct the team with:

```js
const settings = normalizeTeamSecuritySettings({ settings: {} });
const team = normalizeTeamRecord({
  id: teamDoc.id,
  name,
  createdBy: user.uid,
  securitySchemaVersion: 1,
  securityMigrationState: 'locked',
  settings,
}, { uid: user.uid, now });
const member = buildPublicMemberRecord({
  uid: user.uid,
  role: 'admin',
  status: 'active',
  displayName: currentUserLabel(user),
  photoURL: user.photoURL || '',
}, { uid: user.uid, updatedBy: user.uid, now });
const email = buildMemberEmailRecord({ uid: user.uid, email: user.email || '' }, {
  uid: user.uid,
  updatedBy: user.uid,
  now,
});
```

Use one `writeBatch` for the team, public member, and private email documents. Convert `createdAt` and `updatedAt` to `serverTimestamp()` in the Firestore payloads. Keep `writeActivity` after the batch commit so existing activity compatibility remains unchanged.

- [ ] **Step 5: Split approval and profile update writes**

In `approveJoinRequest`, remove `email` from the `members/{uid}` payload and add this to the existing batch:

```js
batch.set(memberEmailRef(db, teamId, requestUid), {
  uid: requestUid,
  email: String(data.email || '').trim(),
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  updatedBy: user.uid,
});
```

Replace `updateMemberProfile` with this partial-update batch. Do not use `buildPublicMemberRecord` here because a profile edit must not overwrite the existing role or status:

```js
export async function updateMemberProfile({ user, teamId, profile }) {
  requireUser(user);
  const { db } = await getFirebaseCore();
  const batch = writeBatch(db);
  batch.set(memberRef(db, teamId, user.uid), {
    uid: user.uid,
    displayName: String(profile?.displayName || '').trim(),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  }, { merge: true });
  batch.set(memberEmailRef(db, teamId, user.uid), {
    uid: user.uid,
    email: String(profile?.email || '').trim(),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  }, { merge: true });
  batch.set(memberNoteRef(db, teamId, user.uid), {
    uid: user.uid,
    note: String(profile?.note || '').trim(),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  }, { merge: true });
  await batch.commit();
}
```

- [ ] **Step 6: Delete private profile documents when a member is removed**

Change `removeTeamMember` to use one batch containing:

```js
batch.delete(memberRef(db, teamId, memberId));
batch.delete(memberEmailRef(db, teamId, memberId));
batch.delete(memberNoteRef(db, teamId, memberId));
batch.delete(payoutRef(db, teamId, memberId));
batch.update(teamRef(db, teamId), {
  memberUids: arrayRemove(memberId),
  updatedAt: serverTimestamp(),
  updatedBy: user.uid,
});
```

Keep the existing post-commit `leaveTeam` or `removeMember` activity write.

- [ ] **Step 7: Subscribe to public and private profiles separately**

Change the signature to:

```js
export function subscribeTeam({
  teamId,
  workspaceAccess = 'denied',
  includeJoinRequests = false,
  canReadAllMemberEmails = false,
  canReadAllMemberNotes = false,
  canReadAllPayouts = false,
  userUid = '',
  onChange,
  onError,
}) {
```

Subscribe to the public `members` collection only for `admin` or `member`. For `locked`, subscribe only to `members/{userUid}`. Subscribe to all `memberEmails` or `memberNotes` only when their respective flags are true; otherwise subscribe only to the current user's document. Emit event types `memberEmails` and `memberNotes`.

- [ ] **Step 8: Add the source test to the normal test script and run it**

Append `tests/team-security-boundary.test.mjs` to `package.json`'s `test` script, then run:

```bash
node --test tests/team-security-model.test.mjs tests/team-security-boundary.test.mjs
npm run check:js
```

Expected: PASS.

- [ ] **Step 9: Commit the cloud profile split**

```bash
git add tests/team-security-boundary.test.mjs
git add -p package.json www/js/team-cloud.mjs
git commit -m "feat: split team member private profile data"
```

### Task 3: Enforce fail-closed and sensitive collection access in Firestore Rules

**Files:**
- Modify: `firestore.rules:13-113,151-230`
- Modify: `tests/firestore-rules.test.mjs:21-92,94-244,356-538`

- [ ] **Step 1: Add a dedicated locked-team fixture**

Add `seedLegacyTeamData(env)` after `seedTeamData`. It must seed:

```js
await db.doc('teams/tLegacy').set({
  createdBy: 'u1',
  deletedAt: null,
  name: 'Legacy Team',
  memberUids: ['u1', 'u2'],
  settings: {
    rewardVisibility: 'all',
    memberEmailVisibility: 'all_members',
    memberNoteVisibility: 'all_members',
    memberPayoutVisibility: 'all_members',
    assignPermission: 'owner_set',
    assignOwnerUids: ['u2'],
    deletePermission: 'all_edit',
  },
});
await db.doc('teams/tLegacy/members/u1').set({
  uid: 'u1', role: 'admin', status: 'active', displayName: 'Admin',
  email: 'admin@example.com', note: 'legacy private note',
});
await db.doc('teams/tLegacy/members/u2').set({
  uid: 'u2', role: 'member', status: 'active', displayName: 'Member',
});
await db.doc('teams/tLegacy/accounts/a1').set({
  id: 'a1', username: '@client', project: { name: 'Legacy', rewardYen: 50000, costYen: 10000 },
});
await db.doc('teams/tLegacy/projects/a1').set({
  id: 'a1', name: 'Legacy', rewardYen: 50000, expenses: [{ name: '交通費', amountYen: 10000 }],
});
await db.doc('teams/tLegacy/settings/main').set({ id: 'main', hideDoneProjectsInList: false });
```

- [ ] **Step 2: Write the failing locked-team Rules test**

```js
test('legacy teams fail closed for general members while admins retain migration access', async () => {
  const env = await createEnv();
  try {
    await seedLegacyTeamData(env);
    const admin = env.authenticatedContext('u1').firestore();
    const member = env.authenticatedContext('u2').firestore();

    await assertSucceeds(member.doc('teams/tLegacy').get());
    await assertSucceeds(member.doc('teams/tLegacy/members/u2').get());
    await assertFails(member.doc('teams/tLegacy/members/u1').get());
    await assertFails(member.doc('teams/tLegacy/accounts/a1').get());
    await assertFails(member.doc('teams/tLegacy/projects/a1').get());
    await assertFails(member.doc('teams/tLegacy/settings/main').get());
    await assertFails(member.doc('teams/tLegacy/projects/a2').set({ id: 'a2', name: 'Blocked' }));

    await assertSucceeds(admin.doc('teams/tLegacy/members/u1').get());
    await assertSucceeds(admin.doc('teams/tLegacy/accounts/a1').get());
    await assertSucceeds(admin.doc('teams/tLegacy/projects/a1').get());
    await assertSucceeds(admin.doc('teams/tLegacy/settings/main').get());
  } finally {
    await env.cleanup();
  }
});
```

- [ ] **Step 3: Run only the new Rules test and verify it fails**

```bash
./node_modules/.bin/firebase emulators:exec --only firestore "node --test --test-name-pattern='legacy teams fail closed' tests/firestore-rules.test.mjs"
```

Expected: FAIL because the current Rules allow the active member to read and write the legacy workspace.

- [ ] **Step 4: Add migration and permission helpers to Rules**

Add these helpers after `teamPath` and the existing membership helpers. Missing settings return false through `keys().hasAll`, so unknown or incomplete documents never grant access:

```rules
function teamDoc(teamId) {
  return get(teamPath(teamId));
}

function hasTeamSetting(teamId, key) {
  return teamDoc(teamId).data.keys().hasAll(['settings'])
    && teamDoc(teamId).data.settings.keys().hasAll([key]);
}

function teamSettingEquals(teamId, key, value) {
  return hasTeamSetting(teamId, key)
    && teamDoc(teamId).data.settings[key] == value;
}

function isSecurityReady(teamId) {
  return exists(teamPath(teamId))
    && teamDoc(teamId).data.keys().hasAll(['securitySchemaVersion', 'securityMigrationState'])
    && teamDoc(teamId).data.securitySchemaVersion == 2
    && teamDoc(teamId).data.securityMigrationState == 'ready';
}

function canReadReadyWorkspace(teamId) {
  return canManageTeam(teamId)
    || (isSecurityReady(teamId) && isApprovedMember(teamId));
}

function canWriteReadyWorkspace(teamId) {
  return canManageTeam(teamId)
    || (isSecurityReady(teamId) && isApprovedMember(teamId));
}

function canReadMemberEmail(teamId, uid) {
  return canManageTeam(teamId)
    || (isSecurityReady(teamId)
      && isApprovedMember(teamId)
      && (isSelf(uid) || teamSettingEquals(teamId, 'memberEmailVisibility', 'all_members')));
}

function canReadMemberNote(teamId, uid) {
  return canManageTeam(teamId)
    || (isSecurityReady(teamId)
      && isApprovedMember(teamId)
      && (isSelf(uid) || teamSettingEquals(teamId, 'memberNoteVisibility', 'all_members')));
}

function canReadPayout(teamId, uid) {
  return canManageTeam(teamId)
    || (isSecurityReady(teamId)
      && isApprovedMember(teamId)
      && (isSelf(uid) || teamSettingEquals(teamId, 'memberPayoutVisibility', 'all_members')));
}

function canReadRewardTotal(teamId) {
  return canManageTeam(teamId)
    || (isSecurityReady(teamId)
      && isApprovedMember(teamId)
      && (teamSettingEquals(teamId, 'rewardVisibility', 'self_plus_total')
        || teamSettingEquals(teamId, 'rewardVisibility', 'all')));
}

function canReadRewardShare(teamId, uid) {
  return canManageTeam(teamId)
    || (isSecurityReady(teamId)
      && isApprovedMember(teamId)
      && (isSelf(uid) || teamSettingEquals(teamId, 'rewardVisibility', 'all')));
}

function canReadProjectCost(teamId) {
  return canManageTeam(teamId);
}

function canAssignProjects(teamId) {
  return canManageTeam(teamId)
    || (isSecurityReady(teamId)
      && isApprovedMember(teamId)
      && teamSettingEquals(teamId, 'assignPermission', 'owner_set')
      && hasTeamSetting(teamId, 'assignOwnerUids')
      && teamDoc(teamId).data.settings.assignOwnerUids.hasAny([request.auth.uid]));
}

function canDeleteProjects(teamId) {
  return canManageTeam(teamId)
    || (isSecurityReady(teamId)
      && isApprovedMember(teamId)
      && teamSettingEquals(teamId, 'deletePermission', 'all_edit'));
}
```

- [ ] **Step 5: Restrict legacy and public workspace matches**

Add exact public-document validators:

```rules
function isPublicMemberRecord(data, uid) {
  return data.keys().hasOnly([
      'uid', 'role', 'status', 'displayName', 'photoURL',
      'createdAt', 'updatedAt', 'updatedBy'
    ])
    && data.uid == uid
    && data.role in ['admin', 'member']
    && data.status in ['active', 'pending', 'blocked'];
}

function isPublicAccountRecord(data, accountId) {
  return data.keys().hasOnly([
      'id', 'teamId', 'scope', 'username', 'url', 'memo', 'newDM', 'folderId',
      'createdAt', 'updatedAt', 'updatedBy', 'revision',
      'deletedAt', 'deletedBy', 'schemaVersion'
    ])
    && data.id == accountId
    && data.scope == 'team'
    && data.schemaVersion == 2;
}

function isPublicProjectRecord(data, projectId) {
  return data.keys().hasOnly([
      'id', 'accountId', 'teamId', 'scope', 'contractType',
      'repeatParentId', 'repeatClosedAt', 'status', 'name',
      'shootDate', 'draftAt', 'deadline', 'deliveredAt', 'completedAt',
      'platforms', 'instructions', 'tags', 'mapUrl', 'assigneeUids',
      'createdAt', 'updatedAt', 'updatedBy', 'revision',
      'deletedAt', 'deletedBy', 'schemaVersion'
    ])
    && data.id == projectId
    && data.scope == 'team'
    && data.schemaVersion == 2;
}

function isAuthenticatedUpdate(data) {
  return data.updatedBy == request.auth.uid;
}

function isAllowedProjectUpdate(teamId) {
  let changed = request.resource.data.diff(resource.data).affectedKeys();
  return (!changed.hasAny(['assigneeUids']) || canAssignProjects(teamId))
    && (!changed.hasAny(['deletedAt', 'deletedBy'])
      || (canDeleteProjects(teamId) && request.resource.data.deletedBy == request.auth.uid));
}
```

Then replace the public collection matches with the following policy:

- Managers may read legacy data while locked or migrating.
- Active members may read only when ready.
- A ready member may read another member only if the member document contains only public keys.
- Public `accounts` must reject an embedded `project` field.
- Public `projects` must reject `rewardYen`, `rewardAllocations`, `costYen`, `expenses`, `paidConfirmed`, and `paidConfirmedAt`.
- Ready writes must use `keys().hasOnly(...)`, keep the document ID fields consistent, and set `updatedBy == request.auth.uid`.
- Locked non-manager writes must fail.

Use this concrete pattern for `accounts`; apply the same manager-legacy/ready-validator structure to `projects`, `members`, `folders`, and `templates` with their matching validator:

```rules
match /accounts/{accountId} {
  allow read: if canManageTeam(teamId)
    || (isSecurityReady(teamId)
      && isApprovedMember(teamId)
      && isPublicAccountRecord(resource.data, accountId));
  allow create, update: if (canManageTeam(teamId) && !isSecurityReady(teamId))
    || (canWriteReadyWorkspace(teamId)
      && isPublicAccountRecord(request.resource.data, accountId)
      && isAuthenticatedUpdate(request.resource.data));
  allow delete: if false;
}

match /projects/{projectId} {
  allow read: if canManageTeam(teamId)
    || (isSecurityReady(teamId)
      && isApprovedMember(teamId)
      && isPublicProjectRecord(resource.data, projectId));
  allow create: if (canManageTeam(teamId) && !isSecurityReady(teamId))
    || (canWriteReadyWorkspace(teamId)
      && isPublicProjectRecord(request.resource.data, projectId)
      && isAuthenticatedUpdate(request.resource.data)
      && (request.resource.data.assigneeUids.size() == 0 || canAssignProjects(teamId)));
  allow update: if (canManageTeam(teamId) && !isSecurityReady(teamId))
    || (canWriteReadyWorkspace(teamId)
      && isPublicProjectRecord(request.resource.data, projectId)
      && isAuthenticatedUpdate(request.resource.data)
      && isAllowedProjectUpdate(teamId));
  allow delete: if false;
}
```

- [ ] **Step 6: Add the private collection matches**

Add `memberEmails/{uid}`, `memberNotes/{uid}`, `projectRewardTotals/{projectId}`, `projectRewardShares/{shareId}`, and `projectCosts/{projectId}` with these matches:

```rules
match /memberEmails/{uid} {
  allow read: if canReadMemberEmail(teamId, uid);
  allow create, update: if (canManageTeam(teamId) && !isSecurityReady(teamId))
    || (isSecurityReady(teamId)
      && isApprovedMember(teamId)
      && isSelf(uid)
      && request.resource.data.keys().hasOnly(['uid', 'email', 'createdAt', 'updatedAt', 'updatedBy'])
      && request.resource.data.uid == uid
      && request.resource.data.updatedBy == request.auth.uid);
  allow delete: if canManageTeam(teamId);
}

match /memberNotes/{uid} {
  allow read: if canReadMemberNote(teamId, uid);
  allow create, update: if (canManageTeam(teamId) && !isSecurityReady(teamId))
    || (isSecurityReady(teamId)
      && isApprovedMember(teamId)
      && isSelf(uid)
      && request.resource.data.keys().hasOnly(['uid', 'note', 'createdAt', 'updatedAt', 'updatedBy'])
      && request.resource.data.uid == uid
      && request.resource.data.updatedBy == request.auth.uid);
  allow delete: if canManageTeam(teamId);
}

match /projectRewardTotals/{projectId} {
  allow read: if canReadRewardTotal(teamId);
  allow create, update: if canManageTeam(teamId)
    && request.resource.data.keys().hasOnly(['projectId', 'totalYen', 'createdAt', 'updatedAt', 'updatedBy'])
    && request.resource.data.projectId == projectId
    && request.resource.data.totalYen is number
    && request.resource.data.totalYen >= 0
    && request.resource.data.updatedBy == request.auth.uid;
  allow delete: if false;
}

match /projectRewardShares/{shareId} {
  allow read: if canReadRewardShare(teamId, resource.data.memberUid);
  allow create, update: if canManageTeam(teamId)
    && request.resource.data.keys().hasOnly([
      'projectId', 'memberUid', 'amountYen', 'assigned',
      'createdAt', 'updatedAt', 'updatedBy'
    ])
    && shareId == request.resource.data.projectId + '_' + request.resource.data.memberUid
    && request.resource.data.amountYen is number
    && request.resource.data.amountYen >= 0
    && request.resource.data.assigned is bool
    && request.resource.data.updatedBy == request.auth.uid;
  allow delete: if false;
}

match /projectCosts/{projectId} {
  allow read: if canReadProjectCost(teamId);
  allow create, update: if canManageTeam(teamId)
    && request.resource.data.keys().hasOnly([
      'projectId', 'costYen', 'expenses', 'createdAt', 'updatedAt', 'updatedBy'
    ])
    && request.resource.data.projectId == projectId
    && request.resource.data.costYen is number
    && request.resource.data.costYen >= 0
    && request.resource.data.expenses is list
    && request.resource.data.updatedBy == request.auth.uid;
  allow delete: if false;
}
```

- [ ] **Step 7: Convert the normal fixture to ready v2 and add the sensitive matrix**

Update `seedTeamData`'s `teams/t1` with:

```js
securitySchemaVersion: 2,
securityMigrationState: 'ready',
settings: {
  rewardVisibility: 'self',
  memberEmailVisibility: 'admin_only',
  memberNoteVisibility: 'admin_only',
  memberPayoutVisibility: 'admin_only',
  assignPermission: 'admin_only',
  assignOwnerUids: [],
  deletePermission: 'admin_only',
},
```

Move seeded email and note values to `memberEmails` and `memberNotes`. Add tests proving:

- self reads own email/note/share;
- admin reads every sensitive document;
- `self` mode hides total and other shares;
- `self_plus_total` exposes total but not other shares;
- `all` exposes total and all shares;
- costs remain admin-only in every mode;
- pending users and outsiders read none;
- extra private fields and spoofed `updatedBy` fail;
- all active members still read `activity`.

Use complete tests in this form for the two highest-risk matrices:

```js
test('ready members receive email and note only through their independent settings', async () => {
  const env = await createEnv();
  try {
    await seedTeamData(env);
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.doc('teams/t1/memberEmails/u1').set({ uid: 'u1', email: 'admin@example.com' });
      await db.doc('teams/t1/memberEmails/u2').set({ uid: 'u2', email: 'member@example.com' });
      await db.doc('teams/t1/memberNotes/u1').set({ uid: 'u1', note: 'admin note' });
      await db.doc('teams/t1/memberNotes/u2').set({ uid: 'u2', note: 'member note' });
    });
    const member = env.authenticatedContext('u2').firestore();
    const pending = env.authenticatedContext('u3').firestore();

    await assertSucceeds(member.doc('teams/t1/memberEmails/u2').get());
    await assertSucceeds(member.doc('teams/t1/memberNotes/u2').get());
    await assertFails(member.doc('teams/t1/memberEmails/u1').get());
    await assertFails(member.doc('teams/t1/memberNotes/u1').get());
    await assertFails(pending.doc('teams/t1/memberEmails/u1').get());

    await env.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('teams/t1').update({
        'settings.memberEmailVisibility': 'all_members',
        'settings.memberNoteVisibility': 'all_members',
      });
    });
    await assertSucceeds(member.doc('teams/t1/memberEmails/u1').get());
    await assertSucceeds(member.doc('teams/t1/memberNotes/u1').get());
  } finally {
    await env.cleanup();
  }
});

test('reward modes never expose costs and expose only the approved share scope', async () => {
  const env = await createEnv();
  try {
    await seedTeamData(env);
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.doc('teams/t1/projectRewardTotals/p1').set({ projectId: 'p1', totalYen: 100000 });
      await db.doc('teams/t1/projectRewardShares/p1_u1').set({ projectId: 'p1', memberUid: 'u1', amountYen: 60000, assigned: true });
      await db.doc('teams/t1/projectRewardShares/p1_u2').set({ projectId: 'p1', memberUid: 'u2', amountYen: 40000, assigned: true });
      await db.doc('teams/t1/projectCosts/p1').set({ projectId: 'p1', costYen: 10000, expenses: [] });
    });
    const admin = env.authenticatedContext('u1').firestore();
    const member = env.authenticatedContext('u2').firestore();

    await assertSucceeds(member.doc('teams/t1/projectRewardShares/p1_u2').get());
    await assertFails(member.doc('teams/t1/projectRewardShares/p1_u1').get());
    await assertFails(member.doc('teams/t1/projectRewardTotals/p1').get());
    await assertFails(member.doc('teams/t1/projectCosts/p1').get());
    await assertSucceeds(admin.doc('teams/t1/projectCosts/p1').get());

    await env.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('teams/t1').update({ 'settings.rewardVisibility': 'self_plus_total' });
    });
    await assertSucceeds(member.doc('teams/t1/projectRewardTotals/p1').get());
    await assertFails(member.doc('teams/t1/projectRewardShares/p1_u1').get());
    await assertFails(member.doc('teams/t1/projectCosts/p1').get());

    await env.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('teams/t1').update({ 'settings.rewardVisibility': 'all' });
    });
    await assertSucceeds(member.doc('teams/t1/projectRewardTotals/p1').get());
    await assertSucceeds(member.doc('teams/t1/projectRewardShares/p1_u1').get());
    await assertFails(member.doc('teams/t1/projectCosts/p1').get());
  } finally {
    await env.cleanup();
  }
});
```

- [ ] **Step 8: Update creation and self-profile Rules tests**

Require team creation to include `securitySchemaVersion: 1`, `securityMigrationState: 'locked'`, and every canonical restrictive setting. Replace the existing successful self update that writes email/note into `members/{uid}` with successful writes to `memberEmails/{uid}` and `memberNotes/{uid}`; keep an explicit failure assertion for email or note added to the public member document.

- [ ] **Step 9: Run all Rules tests**

```bash
npm run test:rules
```

Expected: PASS with no emulator warning affecting test execution.

- [ ] **Step 10: Commit the Rules boundary**

```bash
git add -p firestore.rules tests/firestore-rules.test.mjs
git commit -m "feat: enforce fail-closed team data access"
```

### Task 4: Gate workspace load, save, and realtime subscription

**Files:**
- Modify: `www/js/team-workspace-store.mjs:1-20,280-313,315-435,437-487`
- Modify: `www/index.html:4842-4879,5569-5595,9579-9600,9727-9777`
- Test: `tests/team-security-boundary.test.mjs`

- [ ] **Step 1: Run the existing failing wiring test**

```bash
node --test tests/team-security-boundary.test.mjs
```

Expected: FAIL at `resolveTeamWorkspaceAccessFromFirestore` and `teamSecurityAccessById` assertions.

- [ ] **Step 2: Resolve authenticated access before workspace reads**

Import `resolveTeamWorkspaceAccess` in `team-workspace-store.mjs`. Add:

```js
export async function resolveTeamWorkspaceAccessFromFirestore({ user, teamId }) {
  requireUser(user);
  const targetTeamId = String(teamId || '').trim();
  if (!targetTeamId) throw new Error('team-id-required');
  const { db, getDoc } = await getFirebaseCore();
  const [teamSnap, memberSnap] = await Promise.all([
    getDoc(teamRef(db, targetTeamId)),
    getDoc(doc(db, 'teams', targetTeamId, 'members', user.uid)),
  ]);
  const team = teamSnap.exists() ? { id: teamSnap.id, ...cloneRecord(teamSnap.data()) } : null;
  const member = memberSnap.exists() ? { id: memberSnap.id, ...cloneRecord(memberSnap.data()) } : null;
  return {
    team,
    member,
    access: resolveTeamWorkspaceAccess({ team, member, uid: user.uid }),
  };
}
```

- [ ] **Step 3: Guard bootstrap, write, and subscription entry points**

At the start of `bootstrapTeamWorkspace`, resolve access. Throw an error with `code = 'team-migration-required'` for `locked`, and `code = 'permission-denied'` for `denied`. Permit `admin` and `member`.

At the start of `writeTeamWorkspaceToFirestore`, perform the same check. Managers may continue legacy writes while locked; locked non-managers must fail.

Change `subscribeTeamWorkspace` to accept `user`. Resolve access before attaching listeners. Return a no-op unsubscribe after calling `onChange` with `{ access: 'locked', snapshot: null }` for locked users; throw for denied users. Keep the current collection subscriptions only for `admin` or `member`.

- [ ] **Step 4: Add fail-closed UI state**

Near `cloudTeamLoadFailed`, add:

```js
const teamSecurityAccessById = new Map();
```

In `syncTeamWorkspaceForTeam`, call `resolveTeamWorkspaceAccessFromFirestore` before `bootstrapTeamWorkspace`, save the result by team ID, and return `null` without applying local or cached snapshots when access is `locked` or `denied`. Pass `user` to `subscribeTeamWorkspace`.

In `queueTeamWorkspaceSave`, return before taking activity events or caching the snapshot unless the map value is `admin` or `member`. Apply the same guard in the team branch of `save`.

In `openTeamProjectsExpanded`, inspect the access after `syncTeamWorkspaceForTeam`. For `locked`, show the migration notice and return before setting `teamProjectsExpanded = true`. For `denied`, show the existing permission message and return.

- [ ] **Step 5: Run workspace and boundary tests**

```bash
node --test tests/team-security-boundary.test.mjs tests/team-workspace-sync.test.mjs
npm run check:js
```

Expected: PASS.

- [ ] **Step 6: Commit the workspace gate**

```bash
git add -p tests/team-security-boundary.test.mjs www/index.html www/js/team-workspace-store.mjs
git commit -m "feat: gate locked team workspace access"
```

### Task 5: Render the migration notice and merge authorized private subscriptions

**Files:**
- Modify: `www/index.html:9587-9600,9833-10005,11008-11082,11638-11855`
- Modify: `www/i18n.js`
- Modify: `tests/team-security-boundary.test.mjs`

- [ ] **Step 1: Extend the UI regression test**

Add assertions that `www/index.html` contains `cloudTeamMemberEmails`, `cloudTeamMemberNotes`, handles `memberEmails` and `memberNotes` events, and renders an element with `id="teamSecurityMigrationNotice"` before returning from the locked `renderTeam` branch.

- [ ] **Step 2: Run the test and verify it fails**

```bash
node --test tests/team-security-boundary.test.mjs
```

Expected: FAIL because the private maps and migration notice are absent.

- [ ] **Step 3: Add private subscription state and merge only received values**

Add:

```js
let cloudTeamMemberEmails = new Map();
let cloudTeamMemberNotes = new Map();
```

Clear both maps in `stopCloudTeamListener`. In `openTeamDetail`'s subscription callback, replace each map on its respective event. When `renderTeam` maps `cloudTeamMembers`, read email and note only from these maps. Do not fall back to public `member.email` or `member.note` for a ready v2 team.

- [ ] **Step 4: Pass precise subscription permissions**

In `openTeamDetail`, derive `workspaceAccess` from `teamSecurityAccessById`, use `_ensureTeamSettings` only for display-compatible normalized settings, and pass:

```js
workspaceAccess,
userUid: user.uid,
canReadAllMemberEmails: isAdminViewer || settings.memberEmailVisibility === 'all_members',
canReadAllMemberNotes: isAdminViewer || settings.memberNoteVisibility === 'all_members',
canReadAllPayouts: isAdminViewer || settings.memberPayoutVisibility === 'all_members',
```

- [ ] **Step 5: Render a locked-state notice before sensitive UI**

At the start of `renderTeam`, after setting the safe team name and role badge, check the selected team's access. When `locked`, render a notice with `id="teamSecurityMigrationNotice"`, clear member/project/reward containers, disable project and edit entrances for non-admin users, keep the activity entrance available, then return before `getTeamAnalysisDisplayRecords` or cached workspace functions execute.

Add Japanese and English i18n strings equivalent to:

```text
セキュリティ更新中です
管理者の更新が完了すると、チーム案件を再び利用できます。
```

Admins remain able to open the existing team UI because their access is `admin`; the Phase 2 plan adds migration progress controls.

- [ ] **Step 6: Run UI and existing team tests**

```bash
node --test tests/team-security-boundary.test.mjs tests/team-list-ui.test.mjs tests/team-member-edit-save-ui.test.mjs tests/team-workspace-display.test.mjs
npm run check:html
```

Expected: PASS.

- [ ] **Step 7: Commit the UI boundary**

```bash
git add -p tests/team-security-boundary.test.mjs www/i18n.js www/index.html www/js/team-cloud.mjs
git commit -m "feat: show locked team migration state"
```

### Task 6: Full Phase 1 verification

**Files:**
- Modify: none

- [ ] **Step 1: Run focused tests**

```bash
node --test tests/team-security-model.test.mjs tests/team-security-boundary.test.mjs tests/team-model.test.mjs tests/team-workspace-sync.test.mjs tests/team-member-edit-save-ui.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run Firestore Emulator Rules tests**

```bash
npm run test:rules
```

Expected: PASS. Verify that the output includes the locked-team, private-profile, reward visibility, cost admin-only, pending-user, outsider, and spoofed-field cases.

- [ ] **Step 3: Run the complete project suite and syntax checks**

```bash
npm test
npm run check:js
npm run check:html
```

Expected: all commands PASS.

- [ ] **Step 4: Verify in two browser sessions**

Run:

```bash
npm run dev
```

Using an administrator session and an approved general-member session, verify:

1. A locked team remains openable as safe team metadata for the member.
2. The member sees the security-update notice and cannot enter projects, other-member details, rewards, costs, or editing.
3. No cached team project briefly appears before the notice.
4. The administrator can still inspect the legacy workspace for migration preparation.
5. A ready v2 fixture exposes public member names while email and note follow their independent settings.
6. Costs never appear for the member.
7. Activity remains readable to every active member.

- [ ] **Step 5: Review the final diff for scope and secrets**

```bash
git status --short
git diff --check
git diff -- firestore.rules tests/firestore-rules.test.mjs www/js/team-security-model.mjs www/js/team-cloud.mjs www/js/team-workspace-store.mjs www/index.html www/i18n.js package.json
```

Expected: no whitespace errors, no unrelated UI changes, and no email, note, payout, reward, or cost fields in public member/account/project writers.

- [ ] **Step 6: Request code review before Phase 2**

Use `superpowers:requesting-code-review` with the approved Phase 1 design and this plan. Resolve security or data-loss findings before starting the migration implementation plan.
