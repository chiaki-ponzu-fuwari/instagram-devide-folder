# Team Security Boundary Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** チームの公開情報と機密情報を分離し、v2移行完了まで一般メンバーをfail-closedにして、Firestoreルールでも公開・編集権限を強制する。

**Architecture:** `team-security-model.mjs` を権限状態の唯一の純粋判定元にする。Firestoreの公開文書と機密文書を分け、ルールとクライアントの両方で `securitySchemaVersion=2` かつ `securityMigrationState=ready` でない一般メンバーを案件ワークスペースから遮断する。移行機能、mutation queue、削除同期は後続フェーズで実装する。

**Tech Stack:** Vanilla JavaScript ES modules, Firebase Firestore, Firebase Emulator, Node test runner.

---

## File structure

- Create: `www/js/team-security-model.mjs` — v2設定、移行状態、ワークスペース権限の純粋関数。
- Create: `tests/team-security-model.test.mjs` — fail-closed状態の単体回帰テスト。
- Modify: `firestore.rules` — v2の文書境界とロール/設定別の読書き制限。
- Modify: `tests/firestore-rules.test.mjs` — legacy lockedとready v2のEmulator回帰テスト。
- Modify: `www/js/team-cloud.mjs` — membersとメール/メモを別文書に保存・購読。
- Modify: `www/js/team-workspace-store.mjs` — lockedユーザーがworkspaceを読取・書込・キャッシュ適用しない入口。
- Modify: `www/index.html` — locked状態の案内と、案件/機密値をDOMへ入れないガード。
- Modify: `www/i18n.js` — 移行中案内の日英コピー。
- Create: `tests/team-security-boundary.test.mjs` — UI/DOM境界の静的回帰テスト。
- Modify: `package.json` — 新しいNodeテストを通常スイートへ登録。

### Task 1: Security model and fail-closed unit tests

**Files:**
- Create: `tests/team-security-model.test.mjs`
- Create: `www/js/team-security-model.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveTeamSecurityState,
  resolveTeamWorkspaceAccess,
} from '../www/js/team-security-model.mjs';

test('team workspace fails closed until schema v2 migration is ready', () => {
  const member = { uid: 'u2', role: 'member', status: 'active' };
  const admin = { uid: 'u1', role: 'admin', status: 'active' };
  assert.equal(resolveTeamSecurityState({}), 'locked');
  assert.equal(resolveTeamSecurityState({ securitySchemaVersion: 2, securityMigrationState: 'ready' }), 'ready');
  assert.equal(resolveTeamWorkspaceAccess({ team: { createdBy: 'u1' }, member, uid: 'u2' }), 'locked');
  assert.equal(resolveTeamWorkspaceAccess({ team: { createdBy: 'u1' }, member: admin, uid: 'u1' }), 'admin');
  assert.equal(resolveTeamWorkspaceAccess({
    team: { createdBy: 'u1', securitySchemaVersion: 2, securityMigrationState: 'ready' },
    member,
    uid: 'u2',
  }), 'member');
});
```

- [ ] **Step 2: Run the test to verify RED**

Run: `node --test tests/team-security-model.test.mjs`
Expected: `ERR_MODULE_NOT_FOUND` for `team-security-model.mjs`.

- [ ] **Step 3: Implement the minimal security model**

```js
export const TEAM_SECURITY_SCHEMA_VERSION = 2;

export function resolveTeamSecurityState(team = {}) {
  return team.securitySchemaVersion === TEAM_SECURITY_SCHEMA_VERSION
    && team.securityMigrationState === 'ready' ? 'ready' : 'locked';
}

export function resolveTeamWorkspaceAccess({ team = {}, member, uid }) {
  if (!member || member.uid !== uid || member.status !== 'active') return 'denied';
  if (member.role === 'admin' || team.createdBy === uid) return 'admin';
  return resolveTeamSecurityState(team) === 'ready' ? 'member' : 'locked';
}
```

Add the test file to the existing `npm test` script without removing existing test files.

- [ ] **Step 4: Run the focused tests**

Run: `node --test tests/team-model.test.mjs tests/team-security-model.test.mjs`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add www/js/team-security-model.mjs tests/team-security-model.test.mjs package.json
git commit -m "feat: add fail-closed team security model"
```

### Task 2: Firestore v2 document boundaries and rules

**Files:**
- Modify: `tests/firestore-rules.test.mjs`
- Modify: `firestore.rules`

- [ ] **Step 1: Write legacy and v2 authorization tests**

Add `seedLegacyTeamData` with `tLegacy`, admin `u1`, active member `u2`, and a legacy account that embeds project reward/cost data. Add a test asserting:

```js
await assertSucceeds(getDoc(adminDb, 'teams/tLegacy/accounts/a1'));
await assertSucceeds(getDoc(memberDb, 'teams/tLegacy'));
await assertFails(getDoc(memberDb, 'teams/tLegacy/members/u1'));
await assertFails(getDoc(memberDb, 'teams/tLegacy/accounts/a1'));
await assertFails(updateDoc(memberDb, 'teams/tLegacy/settings/main', { any: 'value' }));
```

Add a ready-v2 fixture that verifies public `members`/`projects` can be read by active members, while `memberEmails`, `memberNotes`, `projectCosts`, and other members’ reward shares are denied unless the matching setting and role allow access. Add rejection cases for email/note/reward/cost fields in public documents and a forged `updatedBy`.

- [ ] **Step 2: Run the focused emulator test to verify RED**

Run: `./node_modules/.bin/firebase emulators:exec --only firestore "node --test --test-name-pattern='legacy teams fail closed' tests/firestore-rules.test.mjs"`
Expected: failure because the current active member can read and write legacy workspace data.

- [ ] **Step 3: Implement v2 rule helpers and match blocks**

In `firestore.rules`, add canonical helpers for `isActiveMember`, `isAdmin`, `isMigrationReady`, and the configured email/note/reward/assignment/deletion permissions. Enforce the following shape boundaries:

```rules
match /teams/{teamId}/members/{uid} {
  allow read: if canReadReadyPublicTeam(teamId);
  allow write: if validPublicMemberPayload(uid);
}
match /teams/{teamId}/memberEmails/{uid} {
  allow read, write: if canReadOrWriteMemberEmail(teamId, uid);
}
match /teams/{teamId}/projectCosts/{projectId} {
  allow read, write: if isAdmin(teamId);
}
```

Require `keys().hasOnly(...)`, document ID/UID consistency, `updatedBy == request.auth.uid`, and v2 ready state for general-member workspace access. Missing or unknown migration state and unknown setting values must deny by default. Keep creator/admin migration access while locked.

- [ ] **Step 4: Run the focused emulator test to verify GREEN**

Run: same command as Step 2.
Expected: selected legacy and ready-state authorization assertions pass.

- [ ] **Step 5: Commit**

```bash
git add firestore.rules tests/firestore-rules.test.mjs
git commit -m "feat: enforce team security schema boundaries"
```

### Task 3: Public/private member persistence and subscriptions

**Files:**
- Modify: `www/js/team-cloud.mjs`
- Modify: `www/js/team-model.mjs`
- Modify: `tests/team-model.test.mjs`

- [ ] **Step 1: Add a failing public member DTO test**

Add a test that passes `{ uid, displayName, email, note }` to the public member normalizer and expects only `{ uid, displayName, role, status, photoURL }` fields. Add settings normalization tests: unknown reward visibility becomes `self`, unknown assignment/deletion options become `admin_only`.

- [ ] **Step 2: Run to verify RED**

Run: `node --test tests/team-model.test.mjs tests/team-security-model.test.mjs`
Expected: public DTO test fails because `normalizeMemberRecord` preserves `email` and `note`.

- [ ] **Step 3: Split persistence and subscription paths**

Make `createTeam`, `approveJoinRequest`, and `updateMemberProfile` write public member data to `members/{uid}` and sensitive values to `memberEmails/{uid}` / `memberNotes/{uid}` in one batch. Make `removeTeamMember` remove both private documents. Change `subscribeTeam` to always subscribe only public members; subscribe private documents only when the current user is self, an admin, or the ready-v2 team setting allows it.

- [ ] **Step 4: Run focused Node tests**

Run: `node --test tests/team-model.test.mjs tests/team-security-model.test.mjs`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add www/js/team-cloud.mjs www/js/team-model.mjs tests/team-model.test.mjs
git commit -m "feat: separate team member private data"
```

### Task 4: Fail-closed workspace and UI gates

**Files:**
- Modify: `www/js/team-workspace-store.mjs`
- Modify: `www/index.html`
- Modify: `www/i18n.js`
- Create: `tests/team-security-boundary.test.mjs`

- [ ] **Step 1: Write the failing UI boundary tests**

Create assertions that the source includes a security access check before `bootstrapTeamWorkspace`, `subscribeTeamWorkspace`, `queueTeamWorkspaceWrite`, `syncTeamWorkspaceForTeam`, and `openTeamProjectsExpanded`; that locked access clears/does not apply team workspace cache; and that the i18n key `team_security_migration_required` exists in Japanese and English.

- [ ] **Step 2: Run to verify RED**

Run: `node --test tests/team-security-boundary.test.mjs`
Expected: fails because the access guards and migration copy are absent.

- [ ] **Step 3: Implement the locked-state behavior**

Pass the current user into workspace bootstrap and subscriptions. Resolve access through `resolveTeamWorkspaceAccess`; for `locked`, do not read/write workspace subcollections, do not replay cached writes, and render only a migration notice. For `denied`, retain the existing no-access behavior. In `renderTeam`, `openTeamDetail`, `openTeamProjectsExpanded`, `openTeamEdit`, and member-detail paths, return before injecting projects, reports, or private member values into the DOM.

Use the new translations:

```js
team_security_migration_required: 'セキュリティ更新中です。管理者の更新完了後に利用できます。'
```

- [ ] **Step 4: Run focused UI tests**

Run: `node --test tests/team-security-boundary.test.mjs tests/team-security-model.test.mjs`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add www/js/team-workspace-store.mjs www/index.html www/i18n.js tests/team-security-boundary.test.mjs
git commit -m "feat: gate locked team workspaces"
```

### Task 5: Phase 1 integration verification

**Files:**
- Modify only if verification exposes a defect in files listed above.

- [ ] **Step 1: Run all rules tests**

Run: `npm run test:rules`
Expected: all Firestore Emulator rule tests pass. If Java cannot start the Emulator, install/configure a Java Runtime before treating the phase as complete.

- [ ] **Step 2: Run the full regression suite**

Run: `npm test && npm run check:js && npm run check:html && git diff --check`
Expected: every command exits 0.

- [ ] **Step 3: Browser verification**

Verify at 320, 375, 390, and 430px:

1. A locked active member sees the migration notice and no project/private values.
2. A ready active member can see public team data, but cannot see denied private values.
3. An admin retains migration access.
4. No horizontal overflow or console error appears.

- [ ] **Step 4: Commit any narrowly necessary verification fixes**

```bash
git add firestore.rules www/js/team-security-model.mjs www/js/team-cloud.mjs www/js/team-workspace-store.mjs www/index.html www/i18n.js tests package.json
git commit -m "test: verify team security boundary"
```

Do not include unrelated pre-existing changes in this commit.
