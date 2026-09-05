# Equal Two-Option Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ログイン後の終了済み案件空状態を短い2行にし、既存の2択セグメントをすべて左右50%ずつへ統一する。

**Architecture:** `www/index.html` の既存セグメントへ明示的な共通クラス `equal-two-option-tabs` を付け、CSS Gridの2等分だけを共通化する。空状態のDOM構造と処理は維持し、`www/i18n.js` の文言だけを短くする。

**Tech Stack:** HTML/CSS/JavaScript、Node.js built-in test runner、Capacitor、Xcode

---

### Task 1: ログイン後の空状態を短い2行にする

**Files:**
- Modify: `tests/top-empty-state.test.mjs`
- Modify: `www/i18n.js:238`

- [ ] **Step 1: 承認済み文言を確認する失敗テストを書く**

`tests/top-empty-state.test.mjs` で `www/i18n.js` を読み、次を追加する。

```js
const i18nJs = readFileSync(new URL('../www/i18n.js', import.meta.url), 'utf8');

test('logged-in hidden closed-project empty state uses the approved short two-line copy', () => {
  assert.match(
    i18nJs,
    /list_done_hidden_empty_sub: '終了済み案件は非表示になっています。\\n設定から一覧に表示できます。'/,
  );
});
```

- [ ] **Step 2: テストが旧文言のため失敗することを確認する**

Run: `node --test tests/top-empty-state.test.mjs`

Expected: 新しい文言に一致せず1件失敗する。

- [ ] **Step 3: 日本語と英語の文言を最小変更する**

`www/i18n.js` を次へ変更する。

```js
list_done_hidden_empty_sub: '終了済み案件は非表示になっています。\n設定から一覧に表示できます。',
```

英語も同じ2行構造を維持する。

```js
list_done_hidden_empty_sub: 'Closed projects are hidden.\nShow them from Settings.',
```

- [ ] **Step 4: 対象テストが通ることを確認する**

Run: `node --test tests/top-empty-state.test.mjs`

Expected: 全件PASS。

### Task 2: 2択セグメントへ共通の均等幅を適用する

**Files:**
- Create: `tests/equal-two-option-tabs.test.mjs`
- Modify: `www/index.html:954-970,2973-2975,3136-3138,3221-3233,3491-3532,3732-3773,3920-3922,13183-13185`
- Modify: `package.json`

- [ ] **Step 1: 対象と除外対象を固定する失敗テストを書く**

`tests/equal-two-option-tabs.test.mjs` を作成する。

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../www/index.html', import.meta.url), 'utf8');

const equalTwoOptionIds = [
  'settingsLangSwitch',
  'doneListGroup',
  'repeatClosedListGroup',
  'schedTabs',
  'teamSchedTabs',
  'personalRewardScopeControl',
  'revTabs',
  'teamRevTabs',
  'teamPaneSchedTabs',
];

test('every identified two-option segment uses the shared equal-width class', () => {
  for (const id of equalTwoOptionIds) {
    const tag = html.match(new RegExp(`<div[^>]*id="${id}"[^>]*>`))?.[0];
    assert.ok(tag, `${id} should exist`);
    assert.match(tag, /\bequal-two-option-tabs\b/, `${id} should be equal width`);
  }

  assert.match(html, /class="settings-lang proj-contract-tabs equal-two-option-tabs"/);

  for (const label of [
    'メールアドレスの公開範囲',
    'その他情報の公開範囲',
    '割り振り権限',
    '削除権限',
  ]) {
    const tag = html.match(new RegExp(`<div[^>]*aria-label="${label}"[^>]*>`))?.[0];
    assert.ok(tag, `${label} should exist`);
    assert.match(tag, /\bequal-two-option-tabs\b/);
  }
});

test('the shared class makes exactly two equal columns', () => {
  assert.match(
    html,
    /\.equal-two-option-tabs\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
  );
  assert.match(
    html,
    /\.equal-two-option-tabs\s*>\s*\.settings-lang-btn\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0/,
  );
});

test('three- and four-option segments are not marked as two-option controls', () => {
  for (const label of ['報酬換算の基準', '報酬の閲覧権限', '投稿プラットフォーム']) {
    const tag = html.match(new RegExp(`<div[^>]*aria-label="${label}"[^>]*>`))?.[0];
    assert.ok(tag, `${label} should exist`);
    assert.doesNotMatch(tag, /\bequal-two-option-tabs\b/);
  }
  assert.doesNotMatch(html.match(/<div class="team-tabs"[^>]*>/)?.[0] || '', /equal-two-option-tabs/);
});
```

`package.json` の `test` コマンドへ `tests/equal-two-option-tabs.test.mjs` を追加する。

- [ ] **Step 2: 対象クラスとCSSが未実装のため失敗することを確認する**

Run: `node --test tests/equal-two-option-tabs.test.mjs`

Expected: `equal-two-option-tabs` が存在せず失敗する。

- [ ] **Step 3: 共通CSSを追加する**

`www/index.html` の `.settings-lang` 付近へ追加する。

```css
.equal-two-option-tabs {
  display:grid;
  grid-template-columns:repeat(2, minmax(0, 1fr));
}
.equal-two-option-tabs > .settings-lang-btn {
  width:100%;
  min-width:0;
}
```

- [ ] **Step 4: 設計書で指定した2択グループだけへクラスを付ける**

対象コンテナの既存 `class` に `equal-two-option-tabs` を追加する。例:

```html
<div class="settings-lang wrap equal-two-option-tabs" id="doneListGroup" role="group" style="width:max-content;margin:0">
```

3択の報酬換算基準・報酬閲覧権限、4択の投稿プラットフォーム、4つのチーム管理タブには追加しない。

- [ ] **Step 5: 対象テストが通ることを確認する**

Run: `node --test tests/equal-two-option-tabs.test.mjs tests/top-empty-state.test.mjs`

Expected: 全件PASS。

### Task 3: 全体検証とiOS反映

**Files:**
- Verify: `www/index.html`
- Verify: `www/i18n.js`
- Generated copy: `ios/App/App/public/`

- [ ] **Step 1: 構文検査と全自動テストを実行する**

Run: `npm run check:html && npm run check:js && npm test`

Expected: exit code 0、失敗0件。

- [ ] **Step 2: ブラウザで狭幅とiPhone 15相当幅を確認する**

ローカル版を開き、幅320pxと390pxで次を確認する。

- 終了済み案件だけの空状態が短い2行になる。
- 「表示する案件がありません」が1行のままになる。
- 2択タブが各50%で、文字切れ・重なりがない。
- 3択・4択の見た目が変わらない。

- [ ] **Step 3: iOSへ最新Web資産をコピーする**

Run: `npm run copy:ios`

Expected: `Copying web assets from www to ios/App/App/public` が成功する。

- [ ] **Step 4: 接続中のiPhone 15向けにビルドする**

Run:

```bash
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -destination 'platform=iOS,id=00008120-00020CC13CE8201E' -derivedDataPath /private/tmp/DMManagerDerivedData build
```

Expected: `** BUILD SUCCEEDED **`。

- [ ] **Step 5: 実機へ上書きインストールして起動する**

Run:

```bash
xcrun devicectl device install app --device 00008120-00020CC13CE8201E /private/tmp/DMManagerDerivedData/Build/Products/Debug-iphoneos/App.app
xcrun devicectl device process launch --terminate-existing --device 00008120-00020CC13CE8201E com.chiaki.dmmanager
```

Expected: `App installed` と `Launched application`。

- [ ] **Step 6: 本番HostingへWeb版を反映する**

Run: `npx firebase deploy --only hosting --project dm-management-ecc1f`

Expected: `Deploy complete!`。

## 変更の分離

`www/index.html`、`www/i18n.js`、`package.json` には既存の未コミット変更がある。今回の作業では対象行だけを `apply_patch` で変更し、既存差分をステージ・巻き戻し・上書きしない。今回の実装コミットは、既存差分を巻き込まない安全な方法がないため作成しない。
