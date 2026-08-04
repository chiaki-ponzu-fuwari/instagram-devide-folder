# V2 Sync, Migration, and Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** V2移行後もチーム案件が安全に保存・再送できる状態を先に作り、既存チームをバックアップ付きで移行し、監査で確認した誤表示・規約・UI不整合を解消する。

**Architecture:** 公開/非公開Firestore文書への投影を純粋関数へ集約し、V2保存は永続operation queueから案件単位transactionへ適用する。移行スクリプトも同じ投影関数を使い、検証成功時だけチームを`ready`にする。UI集計は`assigneeUids`とJSTの`completedAt`を正本にする。

**Tech Stack:** Vanilla HTML/CSS/JavaScript, Firebase Web SDK, Firebase Admin SDK, Firestore Emulator, Node.js test runner

---

### Task 1: Audit regression tests

**Files:**
- Create: `tests/team-v2-projection.test.mjs`
- Create: `tests/team-persistent-queue.test.mjs`
- Create: `tests/team-member-monthly-stats.test.mjs`
- Create: `tests/legal-cloud-copy.test.mjs`
- Modify: `tests/personal-team-reward-scope.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing UI and legal tests**

Assert exact reward labels `個人の報酬` and `チーム報酬も含む`, `grid-template-columns:1fr 1fr`, no fixed `前月比 -30%`, settings navigation rows rendered as buttons, and no Japanese/English claims that sign-in or cloud transmission do not exist.

- [ ] **Step 2: Write failing V2 projection tests**

Use one legacy account/project containing `ownerUid`, `collection`, `rewardYen`, `rewardAllocations`, `expenses`, and `project`. Assert the public account/project projections contain only Rules-approved fields and that total/share/cost documents contain the separated amounts.

- [ ] **Step 3: Write failing persistent queue tests**

Create an in-memory storage adapter, enqueue an operation, reconstruct the queue, and assert the operation remains. Apply the same `operationId` twice and assert only one logical activity remains. Assert a stale update cannot replace a newer tombstone.

- [ ] **Step 4: Write failing member stats tests**

Assert an `assigneeUids` member without reward allocation is counted as in-progress, an unassigned reward recipient is not counted, and only JST-current-month `completedAt` contributes to `今月終了`.

- [ ] **Step 5: Run tests and confirm RED**

Run:

```bash
node --test tests/team-v2-projection.test.mjs tests/team-persistent-queue.test.mjs tests/team-member-monthly-stats.test.mjs tests/legal-cloud-copy.test.mjs tests/personal-team-reward-scope.test.mjs
```

Expected: FAIL for missing projectors/queue/stats and old UI/legal strings.

### Task 2: V2 document projections

**Files:**
- Create: `www/js/team-v2-records.mjs`
- Modify: `www/js/team-workspace-store.mjs`
- Test: `tests/team-v2-projection.test.mjs`

- [ ] **Step 1: Implement explicit allowlist projectors**

Export `buildV2Folder`, `buildV2Account`, `buildV2Project`, `buildV2Template`, `buildV2Settings`, `buildRewardTotal`, `buildRewardShares`, and `buildProjectCost`. Every public builder stamps matching `teamId`, `scope: 'team'`, `schemaVersion: 2`, `revision`, and `updatedBy`, while omitting unknown and financial fields.

- [ ] **Step 2: Implement one normalized project bundle**

Export:

```js
export function buildV2ProjectBundle({ teamId, account, actorUid, now }) {
  const project = account.project || {};
  return {
    account: buildV2Account({ teamId, account, actorUid, now }),
    project: buildV2Project({ teamId, accountId: account.id, project, actorUid, now }),
    rewardTotal: buildRewardTotal({ projectId: account.id, project, actorUid, now }),
    rewardShares: buildRewardShares({ projectId: account.id, project, actorUid, now }),
    projectCost: buildProjectCost({ projectId: account.id, project, actorUid, now }),
  };
}
```

Validate project/account IDs, team IDs, assignee UIDs, repeat parent IDs, and non-negative integer yen amounts before returning.

- [ ] **Step 3: Replace ready-state snapshot writes with projections**

Keep the legacy writer only for `admin` access on locked teams. For ready teams, pass all records through V2 builders and overwrite `settings/main` with the exact V2 allowlist instead of `{ merge: true }`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --test tests/team-v2-projection.test.mjs tests/team-security-boundary.test.mjs
```

Expected: PASS.

### Task 3: Persistent mutation queue and tombstone precedence

**Files:**
- Create: `www/js/team-mutation-queue.mjs`
- Modify: `www/js/team-workspace-store.mjs`
- Modify: `www/index.html`
- Modify: `firestore.rules`
- Test: `tests/team-persistent-queue.test.mjs`
- Test: `tests/firestore-rules.test.mjs`

- [ ] **Step 1: Implement storage-backed queue**

Store JSON under `dm-team-mutations-v2:<uid>`. Each record contains:

```js
{
  operationId,
  teamId,
  type,
  projectId,
  baseRevision,
  actorUid,
  createdAt,
  payload,
  activity
}
```

Provide `enqueue`, `list`, `remove`, and `replace` using a supplied storage adapter so Node tests can use memory and the app can use `localStorage`.

- [ ] **Step 2: Apply project mutations transactionally**

For create/update/delete/undo, read the current project in a Firestore transaction. Reject `actorUid !== request user`, skip an already applied `operationId`, reject `baseRevision` older than the current revision, and reject a normal update when the current project is tombstoned. Write the project, associated account/reward documents, operation receipt, and activity in the same transaction.

- [ ] **Step 3: Make delete and repeat-parent detach atomic**

Delete writes a tombstone and detaches direct children in the same transaction. Undo is accepted only for the deleting actor within six seconds and only after current membership/delete permission checks. Rules validate actor identity, revision increment, tombstone transition, allowed fields, and operation receipt ID.

- [ ] **Step 4: Preserve and expose failures**

Remove an operation only after transaction success. On failure, retain it, update the existing sync status to `pending` or `error`, and retry after the next online/auth-ready event. Activity stays inside the queued operation and cannot be lost separately.

- [ ] **Step 5: Verify RED/GREEN with Emulator Rules**

Run:

```bash
node --test tests/team-persistent-queue.test.mjs
JAVA_HOME="$PWD/.tools/temurin-21-jre/Contents/Home" PATH="$PWD/.tools/temurin-21-jre/Contents/Home/bin:$PATH" npm run test:rules
```

Expected: queue tests PASS and Rules 0 failures.

### Task 4: Idempotent V2 migration tool

**Files:**
- Create: `scripts/team-v2-migration-core.mjs`
- Create: `scripts/migrate-team-v2.mjs`
- Create: `tests/team-v2-migration.test.mjs`
- Modify: `.gitignore`
- Modify: `package.json`

- [ ] **Step 1: Add Firebase Admin dependency and commands**

Add `firebase-admin` and scripts `migrate:team-v2:dry` / `migrate:team-v2:apply`. Ignore `.migration-backups/`.

- [ ] **Step 2: Write failing migration tests**

Cover dry-run no-write, locked legacy migration, partially migrated rerun, ready no-op, cross-team ID rejection, forbidden public fields, backup failure abort, and validation failure leaving the team non-ready.

- [ ] **Step 3: Implement shared migration core**

Use `team-v2-records.mjs` builders. Return a deterministic plan per team, split writes below 400 operations, and validate exact path/data pairs before apply.

- [ ] **Step 4: Implement backup and CLI guards**

Require `--project`, exactly one of `--dry-run`/`--apply`, and `--confirm-project <same-id>` for apply. Before apply, recursively read known team collections and write timestamped JSON. Abort if backup write fails.

- [ ] **Step 5: Implement verification checkpoint**

After writes, reread every output collection, verify counts/IDs/teamId/schema/forbidden fields/repeat links/reward share IDs, then set `securitySchemaVersion: 2` and `securityMigrationState: 'ready'`. Never expose a force-ready flag.

- [ ] **Step 6: Verify with Emulator**

Run:

```bash
node --test tests/team-v2-migration.test.mjs
```

Expected: PASS including repeat execution with zero additional logical changes.

### Task 5: Reward tabs, monthly member stats, and misleading metrics

**Files:**
- Create: `www/js/team-member-stats.mjs`
- Modify: `www/index.html`
- Modify: `www/i18n.js`
- Test: `tests/personal-team-reward-scope.test.mjs`
- Test: `tests/team-member-monthly-stats.test.mjs`

- [ ] **Step 1: Implement the approved equal reward tabs**

Change only the two labels and `.personal-reward-scope` layout to a two-column grid. Preserve the enclosing width, cards, spacing, saved values, and aggregation behavior.

- [ ] **Step 2: Implement canonical member stats**

Export `getTeamMemberProjectStats(records, { monthKey, timeZone: 'Asia/Tokyo' })`. Count non-ended projects from `assigneeUids`; count ended projects only when `completedAt` belongs to the selected JST month.

- [ ] **Step 3: Remove fake comparison text**

Rename the member header to `今月終了`. Replace fixed `前月比 -30%` with a truthful count subtitle and do not infer dates for legacy completed projects.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --test tests/personal-team-reward-scope.test.mjs tests/team-member-monthly-stats.test.mjs tests/team-workspace-display.test.mjs
```

Expected: PASS.

### Task 6: Legal copy and settings accessibility

**Files:**
- Modify: `www/index.html`
- Modify: `docs/privacy.html`
- Test: `tests/legal-cloud-copy.test.mjs`

- [ ] **Step 1: Correct Japanese and English legal copy**

State optional Google/Apple sign-in, Firebase Authentication identifiers, personal cloud backup, approved-team sharing, retention/deletion method, and contact. Remove all claims that the app has no sign-in, no account, or no cloud/server transmission.

- [ ] **Step 2: Convert settings navigation rows to buttons**

Use native `<button type="button">` for templates, revenue, closed-project settings, and support. Preserve existing IDs, classes, visual layout, and click handlers.

- [ ] **Step 3: Verify GREEN**

Run:

```bash
node --test tests/legal-cloud-copy.test.mjs tests/settings-done-list-copy.test.mjs
```

Expected: PASS.

### Task 7: Full verification and real Firestore migration

**Files:**
- Generated but ignored: `.migration-backups/<projectId>/<timestamp>/backup.json`
- Generated but ignored: `.migration-backups/<projectId>/<timestamp>/report.json`

- [ ] **Step 1: Run full local verification**

Run `npm test`, `npm run check:js`, `npm run check:html`, `npm run test:rules`, and `git diff --check`.

- [ ] **Step 2: Browser verification**

Verify 320/375/390/430px reward tabs, settings navigation, Japanese/English legal pages, team locked notice, ready team create/edit/delete/Undo/activity, and no console errors.

- [ ] **Step 3: Run real dry-run**

Authenticate with Application Default Credentials, list the exact project ID, run dry-run, and save the report. Do not apply if any team fails validation.

- [ ] **Step 4: Backup and apply**

Run apply with matching `--project` and `--confirm-project`. Confirm backup exists before the first Firestore write.

- [ ] **Step 5: Re-run dry-run and read back**

Require zero pending changes, every migrated team `ready`, no forbidden public fields, and all expected private/reward documents present.

- [ ] **Step 6: Request code review**

Review against both approved specs. Resolve every Critical or Important finding, rerun full verification, and report any environment-only validation that remains.
