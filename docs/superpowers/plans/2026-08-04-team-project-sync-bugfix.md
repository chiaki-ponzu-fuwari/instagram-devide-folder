# Team Project Sync Bugfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 管理者が保存したチーム案件を `teams/{teamId}/accounts` に保存し、承認済みメンバーの画面へリアルタイム反映する。

**Architecture:** 既存の `S.accounts` を画面表示用のローカルキャッシュとして維持し、チーム案件だけを Firestore のチーム配下へ送る。`subscribeTeam` で共有案件を購読し、受信した対象チームの案件だけをローカル一覧へ安全に合流する。管理者端末にだけ残っている既存案件は、クラウドに同じIDがない場合だけ初回共有する。既存の個人データ、権限ルール、画面構成は変えない。

**Tech Stack:** Vanilla JavaScript, Firebase Firestore, Node.js built-in test runner.

---

### Task 1: 共有レコードとメンバー側マージの回帰テスト

**Files:**
- Modify: `tests/team-model.test.mjs`
- Modify: `www/js/team-model.mjs`

- [ ] **Step 1: 管理者の案件が共有レコードになり、メンバーの一覧へ入る失敗テストを書く**

```js
test('team project record is routed through the shared team account store', () => {
  assert.equal(typeof teamModel.buildTeamAccountRecord, 'function');
  assert.equal(typeof teamModel.mergeTeamAccounts, 'function');

  const shared = teamModel.buildTeamAccountRecord({
    id: 'a1',
    username: '@client',
    ownerUid: 'admin',
    project: { name: '案件A', scope: 'team', teamId: 't1' },
  }, { teamId: 't1', updatedBy: 'admin', now: 100 });

  assert.equal(shared.ownerUid, undefined);
  assert.equal(shared.project.teamId, 't1');
  const memberAccounts = teamModel.mergeTeamAccounts([], [shared], 't1');
  assert.equal(memberAccounts[0].project.name, '案件A');
});
```

- [ ] **Step 2: 対象テストを実行し、共有経路が未実装のため失敗することを確認する**

Run: `node --test tests/team-model.test.mjs`
Expected: FAIL at `typeof teamModel.buildTeamAccountRecord`.

- [ ] **Step 3: 個人案件を保持しつつ、対象チームのクラウド案件をID単位で合流する最小モデルを実装する**

```js
export function buildTeamAccountRecord(account, { teamId, updatedBy, now = Date.now() } = {}) {
  const source = cloneRecord(account || {});
  const id = cleanString(source.id);
  const targetTeamId = cleanString(teamId, cleanString(source?.project?.teamId));
  if (!id || !targetTeamId || !source.project) throw new Error('invalid-team-account');
  delete source.ownerUid;
  return {
    ...source,
    id,
    teamId: targetTeamId,
    project: { ...source.project, scope: 'team', teamId: targetTeamId },
    updatedAt: Number(now) || Date.now(),
    updatedBy: cleanString(updatedBy),
  };
}

export function mergeTeamAccounts(localAccounts = [], cloudAccounts = [], teamId = '') {
  const targetTeamId = cleanString(teamId);
  if (!targetTeamId) return (Array.isArray(localAccounts) ? localAccounts : []).map(cloneRecord);
  const result = (Array.isArray(localAccounts) ? localAccounts : []).map(cloneRecord);
  const indexes = new Map();
  result.forEach((record, index) => {
    if (cleanString(record?.project?.scope, 'personal') !== 'team') return;
    if (cleanString(record?.project?.teamId) !== targetTeamId) return;
    indexes.set(cleanString(record?.id), index);
  });
  (Array.isArray(cloudAccounts) ? cloudAccounts : []).forEach((record) => {
    if (cleanString(record?.project?.scope) !== 'team') return;
    if (cleanString(record?.project?.teamId) !== targetTeamId) return;
    const id = cleanString(record?.id);
    if (!id) return;
    const index = indexes.get(id);
    if (index == null) {
      indexes.set(id, result.length);
      result.push(cloneRecord(record));
      return;
    }
    const localUpdatedAt = Number(result[index]?.updatedAt || 0) || 0;
    const cloudUpdatedAt = Number(record?.updatedAt || 0) || 0;
    if (cloudUpdatedAt >= localUpdatedAt) result[index] = cloneRecord(record);
  });
  return result;
}
```

- [ ] **Step 4: 対象テストが通ることを確認する**

Run: `node --test tests/team-model.test.mjs`
Expected: PASS.

### Task 2: Firestore の共有保存と購読を接続

**Files:**
- Modify: `www/js/team-cloud.mjs`

- [ ] **Step 1: チーム案件を `teams/{teamId}/accounts/{accountId}` へ保存するAPIを追加する**

```js
export async function saveTeamAccount({ user, teamId, account }) {
  requireUser(user);
  const { db } = await getFirebaseCore();
  const record = buildTeamAccountRecord(account, {
    teamId,
    updatedBy: user.uid,
    now: Date.now(),
  });
  await setDoc(doc(db, 'teams', teamId, 'accounts', record.id), {
    ...record,
    serverUpdatedAt: serverTimestamp(),
  }, { merge: true });
  return record;
}
```

- [ ] **Step 2: `subscribeTeam` に `accounts` コレクションのリアルタイム購読を追加する**

```js
unsubscribers.push(onSnapshot(collection(db, 'teams', teamId, 'accounts'), (snap) => {
  onChange({ type: 'accounts', data: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
}, onError));
```

- [ ] **Step 3: UIから同じマージ関数を使えるように再エクスポートする**

```js
export { mergeTeamAccounts } from './team-model.mjs';
```

### Task 3: 案件保存とメンバー画面の状態を接続

**Files:**
- Modify: `www/index.html`

- [ ] **Step 1: チーム案件保存後に共有APIへ非同期で送る**

```js
async function syncTeamAccount(record) {
  const user = firebaseAuthMod?.getCurrentUser?.() || await getLoggedInUserOrPrompt();
  const teamId = String(record?.project?.teamId || '').trim();
  if (!user?.uid || !teamId) throw new Error('team-sync-context-missing');
  const api = await getCloudTeamApi();
  await api.saveTeamAccount({ user, teamId, account: record });
}
```

- [ ] **Step 2: `subscribeTeam` の `accounts` イベントを `S.accounts` に合流し、チーム画面を再描画する**

```js
if (event.type === 'accounts') {
  S.accounts = api.mergeTeamAccounts(S.accounts, event.data, cloudSelectedTeam?.id || '');
  save({ syncCloud: false });
}
```

- [ ] **Step 3: 書き込み失敗時は端末保存を維持し、再保存できる案内を出す**

```js
syncTeamAccount(a).catch((error) => {
  console.error('[team] project sync failed', error);
  toast('端末には保存しました。通信後にもう一度保存してください');
});
```

- [ ] **Step 4: 継続案件の自動子作成と契約終了も同じ共有ヘルパーへ送る**

```js
function queueTeamAccountSync(record) {
  if (getProjectScope(record) !== 'team' || !getProjectTeamId(record)) return;
  syncTeamAccount(record).catch((error) => {
    console.error('[team] project sync failed', error);
    toast('端末には保存しました。通信後にもう一度保存してください');
  });
}
```

- [ ] **Step 5: 管理者端末の既存案件は、クラウドに同じIDがない場合だけ初回共有する**

```js
const shouldMigrate = api.shouldMigrateTeamAccounts({
  isAdmin: isAdminViewer,
  fromCache: event.fromCache,
  alreadyMigrated: cloudTeamAccountMigrationDone.has(migrationKey),
});
const missingLocalAccounts = shouldMigrate
  ? api.findMissingTeamAccounts(S.accounts, event.data, selectedTeamId)
  : [];
missingLocalAccounts.forEach(queueTeamAccountSync);
```

### Task 4: 検証

**Files:**
- Modify: none

- [ ] **Step 1: 回帰テストを実行する**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 2: JavaScript構文を確認する**

Run: `npm run check:js && npm run check:html`
Expected: PASS.

- [ ] **Step 3: Firestoreルールテストを実行する**

Run: `npm run test:rules`
Expected: team admin write and active member read of `teams/{teamId}/accounts` PASS.

- [ ] **Step 4: ブラウザで管理者保存→メンバー購読の画面経路を確認する**

Check:
- 管理者がチーム案件を保存すると共有APIが呼ばれる。
- メンバーのチーム画面が `accounts` イベントを受け、件数・予定・分析へ反映する。
- 個人案件と他チーム案件は消えない。
- 通信失敗時も端末内の案件は残る。
