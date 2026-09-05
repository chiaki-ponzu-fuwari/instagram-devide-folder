# Personal and Team Reward Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 個人報酬ページ上部の1つの切替で、今月の報酬と分析全体を「個人のみ」または「個人＋全所属チームの自分の配分」に統一する。

**Architecture:** `personalRewardAnalysisScope` を唯一の保存値として正規化し、個人設定画面の旧UIを削除する。ログインUIDに一致し `assigned` が真の `rewardAllocations` だけを、全所属チームの同期済みワークスペースから収集する。キャッシュしかないチームはキャッシュ値を使い、未同期チームがある場合は報酬ページへ状態を明示する。

**Tech Stack:** Vanilla HTML/CSS/JavaScript, Firebase Auth/Firestore, Node.js test runner

---

### Task 1: Reward scope model and regression tests

**Files:**
- Create: `tests/personal-team-reward-scope.test.mjs`
- Modify: `www/index.html`
- Modify: `package.json`

- [ ] 現在UIDの割当だけを返し、他メンバー・未割当・0円を除外する失敗テストを書く。
- [ ] `node --test tests/personal-team-reward-scope.test.mjs` を実行し、未実装理由で失敗することを確認する。
- [ ] `getTeamRevenueMemberRewardAmount` と同じUID一致規則を使う純粋ヘルパーを最小実装する。
- [ ] 全所属チームを `cloudTeams` から列挙し、ライブ/キャッシュの重複をチームID＋案件IDで除くテストを追加する。
- [ ] 対象状態・月・継続親除外を既存集計関数へ通し、月次と分析が同じレコード集合を使うよう実装する。
- [ ] 専用テストを再実行して通過を確認する。

### Task 2: Reward page control and narrow iPhone layout

**Files:**
- Modify: `www/index.html`
- Modify: `www/i18n.js`
- Test: `tests/personal-team-reward-scope.test.mjs`

- [ ] 報酬ページ上部に2択コントロールがあり、設定画面の旧カードがない失敗テストを書く。
- [ ] `personalRewardAnalysisScope` の未知値を `personal_only` に正規化し、既存の `personal_plus_team_share` はそのまま移行する。
- [ ] 切替時に保存・月次・分析を同時再描画する。
- [ ] 補足文を「契約中・納品済み・終了の合計」にし、2列カード幅は維持したまま、補足だけ `white-space: nowrap` と可変文字サイズ・最小字間で1行にする。
- [ ] 320/375/390/430px向けCSS回帰テストを通す。

### Task 3: All-team synchronization state

**Files:**
- Modify: `www/index.html`
- Modify: `www/js/team-workspace-store.mjs`
- Test: `tests/personal-team-reward-scope.test.mjs`

- [ ] ON時に全アクティブ所属チームを一度ずつ同期する失敗テストを書く。
- [ ] チーム単位の購読を増やさず、報酬表示時にFirestoreスナップショットを取得しローカルキャッシュへ保存する読込関数を実装する。
- [ ] オフライン/失敗時は既存キャッシュを使い、キャッシュがないチームがあれば「一部未同期」を表示する。
- [ ] OFF時は追加読込を行わないことをテストする。

### Task 4: Verification

**Files:**
- Test: `tests/personal-team-reward-scope.test.mjs`

- [ ] `node --test tests/personal-team-reward-scope.test.mjs tests/personal-cloud-store.test.mjs` を実行する。
- [ ] `npm test`、`npm run check:js`、`npm run check:html` を実行する。
- [ ] ブラウザで320/375/390/430px、OFF/ON、他メンバー配分除外、オフライン表示を確認する。
