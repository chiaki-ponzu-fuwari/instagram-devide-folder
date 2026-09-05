# Team Project Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** チーム案件の追加、納品済み、終了済み、削除を、本人性を検証した重複しない履歴として共有する。

**Architecture:** チーム案件は物理削除せず `deletedAt/deletedBy` のtombstoneで同期し、通常の読込・集計から除外する。案件更新とactivity作成を同じFirestore batchへ入れ、クライアント生成の安定したeventIdでオフライン再送を冪等化する。旧activity文書は表示互換を維持する。

**Tech Stack:** Firebase Firestore batches/rules/emulator, Vanilla JavaScript, Node.js test runner

---

### Task 1: Tombstone deletion

**Files:**
- Modify: `www/js/team-workspace-store.mjs`
- Modify: `www/index.html`
- Modify: `firestore.rules`
- Test: `tests/team-workspace-sync.test.mjs`

- [ ] 削除済みレコードがマージ後に復活せず、通常一覧から除外される失敗テストを書く。
- [ ] `deletedAt/deletedBy` を持つaccount/project tombstoneを、既存レコードより新しい更新として保存する。
- [ ] `doDeleteAcc` は削除前の案件名・IDを退避し、チーム案件のみtombstoneを作成する。個人削除は既存挙動を保つ。
- [ ] Undo時は同じIDを新しい更新時刻で復元し、復元前に確定した削除履歴との扱いをテストする。

### Task 2: Atomic idempotent activity writes

**Files:**
- Modify: `www/js/team-workspace-store.mjs`
- Modify: `www/js/team-cloud.mjs`
- Modify: `www/js/team-model.mjs`
- Modify: `www/index.html`
- Test: `tests/team-project-activity.test.mjs`

- [ ] 4 actionの文言、案件名、案件ID、actor、時刻、安定eventIdの失敗テストを書く。
- [ ] `createProject`、`markDelivered`、`markCompleted`、`deleteProject` の文言をモデルへ追加する。
- [ ] workspaceキューがpending eventsを上書きせず結合し、同じeventIdを同じactivity docへ `set` するよう実装する。
- [ ] status保存前後を比較し、最終状態が実際に納品済み/終了へ変わった場合だけeventを追加する。
- [ ] `saveAcc`、案件モーダルでの新規project、継続子案件の追加経路を記録する。

### Task 3: Rules and compatibility

**Files:**
- Modify: `firestore.rules`
- Modify: `tests/firestore-rules.test.mjs`
- Test: `tests/team-project-activity.test.mjs`

- [ ] 新4 actionで `actorUid == request.auth.uid`、固定フィールド、文字数、projectId、server timestampを検証する失敗ルールテストを書く。
- [ ] 既存createTeam/joinTeam/leaveTeam/removeMemberの書込と旧activity読込を壊さない条件を追加する。
- [ ] 部外者、別UID、余分な機密フィールド、更新・削除が拒否されることを確認する。

### Task 4: Verification

**Files:**
- Test: `tests/team-project-activity.test.mjs`

- [ ] 履歴専用テスト、workspace同期テスト、Firestore emulatorテストを実行する。
- [ ] `npm test`、構文検査を実行する。
- [ ] 2ブラウザ相当で追加・状態変更・削除・再読込・オフライン再送の重複なしを確認する。
