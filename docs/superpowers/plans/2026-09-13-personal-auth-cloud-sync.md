# Personal Auth and Cloud Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure personal data follows the signed-in Google/Apple account across devices without leaking or losing data during login, logout, or account deletion.

**Architecture:** Keep Firebase `users/{uid}` as the cloud source of truth. Add a user-scoped durable pending-workspace cache on each device, restore it only for the same UID, and gate application state changes until cloud bootstrap completes. Keep account deletion server-authoritative and make client errors explicit.

**Tech Stack:** Capacitor iOS, Firebase Auth, Cloud Firestore, Cloud Functions, Node test runner.

---

### Task 1: User-scoped pending sync cache

**Files:**
- Modify: `www/js/personal-cloud-store.mjs`
- Modify: `tests/personal-cloud-store.test.mjs`

- [ ] Write failing tests for a UID-scoped pending snapshot being restored only for the matching UID and removed after successful write.
- [ ] Run `node --test tests/personal-cloud-store.test.mjs` and confirm failure.
- [ ] Add `loadPendingWorkspace`, `savePendingWorkspace`, and `clearPendingWorkspace` using `localStorage` key `dm-personal-cloud-pending-v1:{uid}`. Queue writes persist before network write and clear only after success.
- [ ] Run `node --test tests/personal-cloud-store.test.mjs` and confirm pass.

### Task 2: Safe personal bootstrap and cross-device subscription

**Files:**
- Modify: `www/js/personal-cloud-store.mjs`
- Modify: `www/index.html`
- Modify: `tests/personal-cloud-store.test.mjs`

- [ ] Write failing tests that require bootstrap to merge only the same user’s durable pending snapshot and subscription updates to apply server-confirmed records.
- [ ] Run focused tests and confirm failure.
- [ ] On login, restore only the matching UID pending snapshot, bootstrap against cloud, subscribe after bootstrap, and apply the resulting snapshot without creating a cloud write loop.
- [ ] On cloud update, merge records by revision/updatedAt and persist the current UID cache only.
- [ ] Run focused tests and confirm pass.

### Task 3: Login/logout account separation

**Files:**
- Modify: `www/index.html`
- Modify: `tests/personal-cloud-store.test.mjs`
- Modify: `tests/auth-state.test.mjs`

- [ ] Write failing tests that require logout to wait briefly for pending writes, unsubscribe the previous UID, and prevent the previous UID snapshot from being used by the next UID.
- [ ] Run focused tests and confirm failure.
- [ ] Store the active signed-in workspace under `dm-personal-workspace-v1:{uid}`; on logout, persist it and reset the displayed workspace to anonymous data rather than leaving account-scoped content active.
- [ ] Keep anonymous data migration one-time and only when the destination cloud is empty.
- [ ] Run focused tests and confirm pass.

### Task 4: Account deletion and re-registration lifecycle

**Files:**
- Modify: `www/js/account-deletion-core.mjs`
- Modify: `www/index.html`
- Modify: `tests/account-deletion-client.test.mjs`
- Modify: `tests/account-deletion-ui.test.mjs`
- Modify: `functions/account-deletion-store.mjs` only if tests prove lock cleanup is required
- Modify: `tests/account-deletion-functions.test.mjs` only if server lifecycle changes

- [ ] Write failing tests for a successful Google deletion followed by a fresh account with no old deletion lock or personal cloud state, and for Apple revocation errors being explicit and non-destructive.
- [ ] Run `npm run test:account-deletion` and confirm failure.
- [ ] Make the minimum client/server lifecycle change proven by the tests. Do not bypass Apple token revocation; preserve the existing cloud-first deletion order.
- [ ] Run `npm run test:account-deletion` and confirm pass.

### Task 5: Firestore and two-client verification

**Files:**
- Modify: `tests/firestore-rules.test.mjs` only if new Firestore fields require rules validation
- Modify: `tests/personal-cloud-store.test.mjs`

- [ ] Add tests for same-UID two-device propagation, stale pending snapshot non-deletion, logout UID isolation, and account deletion/re-login data isolation.
- [ ] Run focused tests, then `npm test`, `npm run test:rules`, `npm run check:js`, `npm run check:html`, and `git diff --check`.
- [ ] Build and install the verified iOS build on iPhone 16 Pro Max, preserving installed data.
