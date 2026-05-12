# Team Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add approval-based team sharing with admin-controlled invites, member visibility, and Firestore-enforced permissions without breaking the existing local-first personal mode.

**Architecture:** Keep pure permission logic in `www/js/team-model.mjs`, Firestore I/O in `www/js/team-cloud.mjs`, and UI wiring in `www/index.html`. Firestore rules become the source of truth for access control: approved members can read team data, pending users cannot. The existing team screens already exist, so this work is mostly replacing legacy demo behavior with real membership, invite, and approval flows.

**Tech Stack:** Vanilla HTML/CSS/JS, Firebase Auth, Cloud Firestore, Firestore Security Rules, Firebase emulator/rules testing, Capacitor iOS.

---

## File Map

- Modify `www/js/team-model.mjs`: pure membership, role, and reward-scope helpers.
- Modify `tests/team-model.test.mjs`: model tests for member status and permission decisions.
- Modify `www/js/team-cloud.mjs`: create teams, invites, join requests, approvals, member updates, realtime subscription.
- Modify `www/js/firestore-core.mjs` and `www/js/firebase-auth.mjs`: expose any small auth helpers needed by team code.
- Modify `firestore.rules` and `firebase.json`: enforce approved-member access and add rules test wiring.
- Modify `tests/firestore-rules.test.mjs`: emulator-based rule tests.
- Modify `www/index.html`: connect existing team panes to the new cloud APIs and hide admin-only controls.
- Modify `www/i18n.js`: add strings for pending approval, admin/member roles, reward visibility, and join-request states.
- Optional later cleanup: `docs/privacy.html` and `docs/support.html` if the public wording needs to mention team sharing and approval flow.

---

### Task 1: Lock Down The Permission Model In Pure JS

**Files:**
- Modify: `www/js/team-model.mjs`
- Test: `tests/team-model.test.mjs`

- [ ] **Step 1: Write the failing model tests**

Create or extend `tests/team-model.test.mjs` with concrete permission cases:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMemberRecord,
  isActiveMember,
  isTeamAdmin,
  canReadTeam,
  canApproveJoinRequest,
  resolveRewardVisibility,
} from '../www/js/team-model.mjs';

test('normalizeMemberRecord fills defaults for a new admin', () => {
  const rec = normalizeMemberRecord({
    uid: 'u1',
    role: 'admin',
    status: 'active',
    displayName: '  Chiaki  ',
  }, { uid: 'u1', now: 1778493600000 });
  assert.equal(rec.uid, 'u1');
  assert.equal(rec.role, 'admin');
  assert.equal(rec.status, 'active');
  assert.equal(rec.displayName, 'Chiaki');
  assert.equal(rec.joinedAt, 1778493600000);
});

test('permission helpers distinguish active members from pending users', () => {
  const admin = { uid: 'u1', role: 'admin', status: 'active' };
  const member = { uid: 'u2', role: 'member', status: 'active' };
  const pending = { uid: 'u3', role: 'member', status: 'pending' };
  assert.equal(isActiveMember(admin), true);
  assert.equal(isTeamAdmin(admin), true);
  assert.equal(isActiveMember(member), true);
  assert.equal(isTeamAdmin(member), false);
  assert.equal(isActiveMember(pending), false);
  assert.equal(canReadTeam(member), true);
  assert.equal(canReadTeam(pending), false);
  assert.equal(canApproveJoinRequest(admin), true);
  assert.equal(canApproveJoinRequest(member), false);
});

test('resolveRewardVisibility returns the admin-controlled scope', () => {
  assert.equal(resolveRewardVisibility({ rewardVisibility: 'admin_only' }), 'admin_only');
  assert.equal(resolveRewardVisibility({ rewardVisibility: 'all_members' }), 'all_members');
  assert.equal(resolveRewardVisibility({ rewardVisibility: 'selected_members' }), 'selected_members');
});
```

- [ ] **Step 2: Run the test and confirm it fails before implementation**

Run:

```bash
node --test tests/team-model.test.mjs
```

Expected: fail because the new exports do not exist yet.

- [ ] **Step 3: Implement the smallest helper set that makes the tests pass**

Add helpers to `www/js/team-model.mjs` with these exact responsibilities:

```js
export function normalizeMemberRecord(input, ctx) { /* uid, role, status, displayName, joinedAt, updatedAt */ }
export function isActiveMember(member) { return member?.status === 'active'; }
export function isTeamAdmin(member) { return isActiveMember(member) && member?.role === 'admin'; }
export function canReadTeam(member) { return isActiveMember(member); }
export function canApproveJoinRequest(member) { return isTeamAdmin(member); }
export function resolveRewardVisibility(team) {
  return team?.rewardVisibility === 'selected_members'
    ? 'selected_members'
    : (team?.rewardVisibility === 'all_members' ? 'all_members' : 'admin_only');
}
```

Keep this file pure. No Firestore imports here.

- [ ] **Step 4: Run the full JS checks and tests**

Run:

```bash
npm test
npm run check:js
```

Expected: both pass.

- [ ] **Step 5: Commit the model layer**

```bash
git add www/js/team-model.mjs tests/team-model.test.mjs
git commit -m "feat: add team permission helpers"
```

---

### Task 2: Enforce Membership In Firestore Rules

**Files:**
- Modify: `firestore.rules`
- Modify: `firebase.json`
- Modify: `package.json`
- Test: `tests/firestore-rules.test.mjs`

- [ ] **Step 1: Add a rules test harness**

Add a rules test script in `package.json`:

```json
"test:rules": "firebase emulators:exec --only firestore \"node --test tests/firestore-rules.test.mjs\""
```

Add the Firebase emulator test dependency if it is not already present:

```json
"devDependencies": {
  "@firebase/rules-unit-testing": "^4.0.1",
  "firebase-tools": "^13.0.0"
}
```

Create `tests/firestore-rules.test.mjs` with one happy path and two denial cases:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import fs from 'node:fs';

test('active members can read team docs; pending users cannot', async () => {
  const env = await initializeTestEnvironment({
    projectId: 'dm-manager-rules',
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') },
  });
  const admin = env.authenticatedContext('u1').firestore();
  const pending = env.authenticatedContext('u2').firestore();
  await assertSucceeds(admin.doc('teams/t1/members/u1').set({ uid: 'u1', role: 'admin', status: 'active' }));
  await assertSucceeds(admin.doc('teams/t1').set({ createdBy: 'u1', rewardVisibility: 'admin_only' }));
  await assertSucceeds(admin.doc('teams/t1').get());
  await assertFails(pending.doc('teams/t1').get());
  await env.cleanup();
});
```

- [ ] **Step 2: Write the restrictive rules first**

Use this shape in `firestore.rules`:

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() { return request.auth != null; }
    function memberPath(teamId, uid) {
      return /databases/$(database)/documents/teams/$(teamId)/members/$(uid);
    }
    function memberDoc(teamId, uid) {
      return get(memberPath(teamId, uid));
    }
    function isActiveMember(teamId) {
      return signedIn()
        && exists(memberPath(teamId, request.auth.uid))
        && memberDoc(teamId, request.auth.uid).data.status == 'active';
    }
    function isAdmin(teamId) {
      return isActiveMember(teamId)
        && memberDoc(teamId, request.auth.uid).data.role == 'admin';
    }

    match /users/{uid} {
      allow read, write: if signedIn() && request.auth.uid == uid;
    }

    match /teams/{teamId} {
      allow read: if isActiveMember(teamId);
      allow create: if signedIn()
        && request.resource.data.createdBy == request.auth.uid
        && request.resource.data.rewardVisibility in ['admin_only', 'all_members', 'selected_members'];
      allow update: if isAdmin(teamId);
      allow delete: if false;

      match /members/{uid} {
        allow read: if isActiveMember(teamId);
        allow create: if isAdmin(teamId)
          || (signedIn()
            && uid == request.auth.uid
            && get(/databases/$(database)/documents/teams/$(teamId)).data.createdBy == request.auth.uid
            && request.resource.data.role == 'admin'
            && request.resource.data.status == 'active');
        allow update: if isAdmin(teamId)
          || (signedIn() && uid == request.auth.uid && request.resource.data.status == 'pending');
        allow delete: if false;
      }

      match /invites/{inviteId} {
        allow read, create, update: if isAdmin(teamId);
        allow delete: if false;
      }

      match /joinRequests/{requestId} {
        allow create: if signedIn() && request.resource.data.uid == request.auth.uid;
        allow read: if isAdmin(teamId) || (signedIn() && resource.data.uid == request.auth.uid);
        allow update: if isAdmin(teamId);
        allow delete: if false;
      }

      match /folders/{folderId} {
        allow read, create, update: if isActiveMember(teamId);
        allow delete: if false;
      }

      match /accounts/{accountId} {
        allow read, create, update: if isActiveMember(teamId);
        allow delete: if false;
      }

      match /templates/{templateId} {
        allow read, create, update: if isActiveMember(teamId);
        allow delete: if false;
      }

      match /activity/{activityId} {
        allow read, create: if isActiveMember(teamId);
        allow update, delete: if false;
      }
    }
  }
}
```

- [ ] **Step 3: Wire the rules file into Firebase**

Keep `firebase.json` pointing at `firestore.rules` and make sure the generated config does not remove that mapping.

- [ ] **Step 4: Run the rules suite**

Run:

```bash
npm run test:rules
```

Expected: team members can read their team docs, pending users cannot, and only admins can mutate invites and approvals.

- [ ] **Step 5: Commit the rules layer**

```bash
git add firestore.rules firebase.json package.json tests/firestore-rules.test.mjs
git commit -m "feat: add team firestore rules"
```

---

### Task 3: Move Team Operations Onto The Permission Model

**Files:**
- Modify: `www/js/team-cloud.mjs`
- Modify: `www/js/firestore-core.mjs`
- Modify: `www/js/firebase-auth.mjs`

- [ ] **Step 1: Write a small service-level smoke test by fixing the function surface first**

Before wiring UI, make the exported API explicit in `www/js/team-cloud.mjs`:

```js
export async function createTeam({ user, name }) {}
export async function createInvite({ user, teamId }) {}
export async function requestJoinTeam({ user, teamId, inviteCode }) {}
export async function listJoinRequests({ user, teamId }) {}
export async function approveJoinRequest({ user, teamId, requestId }) {}
export async function rejectJoinRequest({ user, teamId, requestId }) {}
export async function updateMemberRole({ user, teamId, uid, role }) {}
export async function updateRewardVisibility({ user, teamId, rewardVisibility }) {}
export function subscribeTeam({ teamId, onChange, onError }) {}
```

The implementation should keep the existing `getFirebaseCore()` path and only add the permission-aware methods above.

- [ ] **Step 2: Replace the legacy demo assumptions**

Update `team-cloud.mjs` so that:

```js
// - join requests are stored in teams/{teamId}/joinRequests/{requestId}
// - approved members are stored in teams/{teamId}/members/{uid}
// - team root docs only keep summary fields
// - writes always set updatedAt / updatedBy
// - invite codes are separate from membership approval
```

Use `serverTimestamp()` for Firestore writes and keep the currently signed-in user as the source of `updatedBy`.

- [ ] **Step 3: Export any auth helper needed for current-user display**

If the UI needs to know the current provider or user label, export it through `www/js/firebase-auth.mjs` rather than reaching into Firestore internals directly.

- [ ] **Step 4: Run the JS checks**

Run:

```bash
npm run check:js
```

Expected: all module entrypoints still parse.

- [ ] **Step 5: Commit the service layer**

```bash
git add www/js/team-cloud.mjs www/js/firestore-core.mjs www/js/firebase-auth.mjs
git commit -m "feat: add team permission-aware cloud service"
```

---

### Task 4: Rewire The Existing Team UI To Show Approved Members And Admin Controls

**Files:**
- Modify: `www/index.html`
- Modify: `www/i18n.js`

- [ ] **Step 1: Update the UI strings first**

Add strings for the new states in `www/i18n.js`:

```js
team_pending: '承認待ち',
team_approved: '参加済み',
team_rejected: '却下',
team_role_admin: '管理者',
team_role_member: 'メンバー',
team_reward_admin_only: '管理者のみ',
team_reward_all_members: '全員',
team_reward_selected_members: '指定メンバーのみ',
team_join_request: '参加を申請',
team_join_pending: '申請中',
team_join_approved: '承認済み',
```

Mirror the same keys in English.

- [ ] **Step 2: Replace the existing legacy team action assumptions**

Update the team panes in `www/index.html` so the visible behavior matches these rules:

```text
- Everyone in the team can see the approved member list.
- Only admins can see pending join requests.
- Only admins can change invite settings, roles, and reward visibility.
- Logged-in users can request to join by invite code or invite link.
- Team members see role badges, not raw permission internals.
```

Use the existing IDs already present in the page:

- `teamEditMembers` for the approved member list.
- `teamReqList` for admin-only pending requests.
- `teamInviteLinkBtn` and the invite section for admin invite creation.
- `teamPermRev...` buttons for reward visibility.
- `teamPermAssign...` buttons for edit permission scope.

- [ ] **Step 3: Make the team overview show the right badges**

In the team list and member list rendering, keep these visible:

```js
// approved member list
// role badge: 管理者 / メンバー
// pending requests: admin only
// reward visibility label: admin only / 全員 / 指定メンバーのみ
```

Do not reintroduce email addresses into the settings or team overview.

- [ ] **Step 4: Run the frontend checks and the simulator**

Run:

```bash
npm run check:html
npm run check:js
npm test
npx cap sync ios
```

Then open the iOS simulator and verify:

- approved members appear in the member list for all members,
- pending requests only appear for admins,
- the join flow blocks non-members from reading team data,
- the UI still renders cleanly on the settings and team screens.

- [ ] **Step 5: Commit the UI layer**

```bash
git add www/index.html www/i18n.js
git commit -m "feat: wire team permissions ui"
```

---

### Task 5: Verify Privacy Copy And Finish

**Files:**
- Modify: `docs/privacy.html`
- Modify: `docs/support.html`

- [ ] **Step 1: Check whether the public docs mention the new team-sharing behavior**

If the docs still say the app has no sign-in or only local storage, update that wording to mention:

```text
- sign-in via Google / Apple
- team data stored in Firestore
- approved members only
- admin approval for team access
```

- [ ] **Step 2: Run the final regression pass**

Run:

```bash
npm test
npm run check:html
npm run check:js
npm run test:rules
npx cap sync ios
```

Expected: all checks pass and the simulator build still succeeds.

- [ ] **Step 3: Commit the docs and final cleanup**

```bash
git add docs/privacy.html docs/support.html
git commit -m "docs: update team sharing copy"
```

---

## Self-Review Notes

- The plan covers the spec requirements for approval-based joining, admin-only invite and permission controls, and member-list visibility.
- The plan keeps the local-first personal mode intact and separates the pure model, Firestore service, rules, and UI into smaller units.
- No placeholder steps remain in the plan.
- Firestore rules are tested with the emulator before UI work is considered done.
