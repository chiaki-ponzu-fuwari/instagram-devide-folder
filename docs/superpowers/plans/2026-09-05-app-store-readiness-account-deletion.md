# App Store 公開前対応・アカウント削除 実装計画

> **実装時の必須スキル:** `superpowers:executing-plans` を使い、各チェックポイントで結果を確認する。

**目的:** App Store 公開前に必要なアカウント削除、法務表示、Privacy Manifest、セキュリティ境界を追加し、既存の個人・チームデータ同期を壊さず本番へ反映する。

**基本設計:** アカウント削除はクライアントから Firestore を直接削除せず、認証済み callable Cloud Functions が一括処理する。処理は requestId 単位で再実行可能にし、チーム移管・脱退・解散、個人クラウドデータ削除、履歴匿名化、最終検証、Firebase Auth 削除の順に進める。クライアントは直近ログイン、チームごとの選択、文字入力確認、端末ローカルデータの別選択だけを担当する。

**使用技術:** Firebase Authentication / Firestore / Cloud Functions for Firebase v2 / Firebase Emulator Suite / Capacitor 8 / Swift / Node.js test runner

**参照仕様:** `docs/superpowers/specs/2026-09-05-app-store-readiness-account-deletion-design.md`

---

## 作業前の保全ルール

- 現在の未コミット差分はユーザーの既存変更として扱い、巻き戻さない。
- 各タスクでは、対象ファイルの変更前差分を確認する。
- データ削除の本番確認にはテスト専用アカウントだけを使う。
- Firebase Functions の本番反映で Blaze プランや権限が必要になった場合だけ、必要な操作をユーザーへ具体的に案内する。
- Firestore / Hosting / Functions は一括で盲目的に反映せず、テスト後に対象を明示して順番に deploy する。

## Task 1: Cloud Functions と Emulator の土台

**Files:**
- Create: `functions/package.json`
- Create: `functions/index.mjs`
- Create: `tests/account-deletion-config.test.mjs`
- Modify: `firebase.json`
- Modify: `package.json`
- Modify: `package-lock.json`

**Step 1: 失敗する構成テストを書く**

`tests/account-deletion-config.test.mjs` に次を検査するテストを追加する。

- `firebase.json` の Functions source が `functions`
- Functions runtime が Node 22
- Auth / Firestore / Functions Emulator が固定ポートで定義済み
- root の `npm test` と専用 emulator script に新規テストが含まれる
- `functions/package.json` が ESM で、`firebase-admin` と `firebase-functions` を含む

**Step 2: RED を確認する**

Run: `node --test tests/account-deletion-config.test.mjs`

Expected: Functions 設定がまだないため FAIL。

**Step 3: 最小の Functions 構成を追加する**

- `functions/package.json`: Node 22、ESM、`firebase-admin`、`firebase-functions`
- `functions/index.mjs`: 初期化と後続 callable の export だけを置く
- `firebase.json`: Functions source/runtime、Auth と Functions Emulator を追加
- root scripts:
  - `test:account-deletion`
  - `test:account-deletion:emulator`
  - `test:emulators`
  - `check:js` に Functions ソースを追加

**Step 4: 依存関係を固定する**

Run: `npm install --prefix functions`

**Step 5: GREEN を確認する**

Run: `node --test tests/account-deletion-config.test.mjs`

Expected: PASS。

**Step 6: 今回分だけコミットする**

```bash
git add functions/package.json functions/package-lock.json functions/index.mjs firebase.json package.json package-lock.json tests/account-deletion-config.test.mjs
git commit -m "build: add account deletion functions scaffold"
```

## Task 2: 削除計画・入力検証の純粋ロジック

**Files:**
- Create: `functions/account-deletion-core.mjs`
- Create: `tests/account-deletion-core.test.mjs`
- Modify: `package.json`

**Step 1: 失敗テストを書く**

次の関数契約をテストで先に固定する。

- `assertRecentAuthentication(authTime, now, maxAgeSeconds)`
- `normalizeDeletionRequest(input)`
- `buildAccountDeletionPlan({ uid, memberships, teams })`
- `validateTeamDecisions(plan, decisions)`
- `anonymizeActivityRecord(activity, deletedUid)`

最低限のケース:

- 直近 5 分を超える認証は拒否
- requestId 不正・未知フィールドを拒否
- 一般メンバーは `leave`
- 他の承認済みメンバーがいる管理者は `transfer` が必須
- 管理者のみのチームは `dissolve` のみ
- 未承認・別チームの UID を移管先にできない
- 削除対象者の履歴は表示名とメールを消し「削除済みユーザー」にする
- 同じ入力は同じ削除計画になる

**Step 2: RED を確認する**

Run: `node --test tests/account-deletion-core.test.mjs`

Expected: module / functions 未実装で FAIL。

**Step 3: Firestore 非依存の最小実装を書く**

データベース処理を混ぜず、入力と計画だけを決定する。未知フィールドは fail-closed で拒否する。

**Step 4: GREEN を確認する**

Run: `node --test tests/account-deletion-core.test.mjs`

Expected: PASS。

**Step 5: コミットする**

```bash
git add functions/account-deletion-core.mjs tests/account-deletion-core.test.mjs package.json
git commit -m "test: define safe account deletion plan"
```

## Task 3: Firestore 上の再実行可能な削除処理

**Files:**
- Create: `functions/account-deletion-store.mjs`
- Create: `tests/account-deletion-store.test.mjs`
- Modify: `functions/index.mjs`
- Modify: `firestore.rules`
- Modify: `tests/firestore-rules.test.mjs`

**Step 1: 失敗する Store / Rules テストを書く**

Emulator を使い、次を先に再現する。

- 本人以外は削除計画・削除ジョブを読めない
- クライアントは削除ジョブを書けない
- 一般メンバー削除では membership と個人識別情報だけが消え、team/project は残る
- 管理者移管では team admin / member role / 権限が同一 transaction 内で揃う
- 管理者だけの解散では team と team 配下が削除対象になる
- team activity の actorName/email は匿名化され、行為・案件名・時刻は残る
- `/users/{uid}` と個人クラウド配下は削除される
- 同じ requestId の再実行で二重削除・二重履歴・別チーム操作が起きない
- Auth ユーザー削除前に残存参照検査が完了する

**Step 2: RED を確認する**

Run: `npm run test:account-deletion:emulator`

Expected: Store 未実装で FAIL。

**Step 3: Store を段階処理として実装する**

`functions/account-deletion-store.mjs` の責務を次に限定する。

1. `loadAccountDeletionSnapshot(uid)`
2. `beginAccountDeletionJob(uid, requestId, planHash)`
3. `applyTeamDecision(uid, teamDecision)`
4. `removeUserIdentityFromTeam(uid, teamId)`
5. `deletePersonalCloudData(uid)`
6. `verifyNoProtectedReferences(uid)`
7. `markDeletionJobReadyForAuthDelete(uid, requestId)`
8. `markDeletionJobComplete(uid, requestId)`

実装条件:

- job は `accountDeletionJobs/{uid_requestId}`。クライアント読み書きは禁止し Admin SDK のみ。
- 各 team decision は完了済みフラグを持ち、再送時は skip。
- team membership は `collectionGroup('members')` と team の `memberUids` を照合する。
- 移管先は同一チーム・承認済み・削除対象者以外を transaction 内で再確認する。
- team project、reward share、予定、添付ファイル紐付けは保持する。
- `memberEmails`、`memberNotes`、非公開プロフィール、対象者 payout を削除する。
- activity は `actorUid` を削除済み識別子へ置換し、`actorName` を「削除済みユーザー」、メール等を除去する。
- Auth 削除は全 Firestore 処理と残存参照検査の後だけ許可する。

**Step 4: Rules を最小変更する**

- `accountDeletionJobs` はクライアント `allow read, write: if false`
- 既存 team / personal の権限を広げない
- 既存 33 件以上の Rules 回帰テストを維持する

**Step 5: GREEN を確認する**

Run: `npm run test:account-deletion:emulator`

Run: `npm run test:rules`

Expected: 新規ケースと既存 Rules がすべて PASS。

**Step 6: コミットする**

```bash
git add functions/account-deletion-store.mjs functions/index.mjs tests/account-deletion-store.test.mjs firestore.rules tests/firestore-rules.test.mjs
git commit -m "feat: add idempotent account data cleanup"
```

## Task 4: Callable API と Auth ユーザーの最終削除

**Files:**
- Modify: `functions/index.mjs`
- Create: `tests/account-deletion-functions.test.mjs`
- Modify: `tests/account-deletion-store.test.mjs`

**Step 1: 失敗する統合テストを書く**

Functions/Auth/Firestore Emulator を同時起動し、次を検査する。

- 未ログイン呼出しは `unauthenticated`
- `auth_time` が古い呼出しは `failed-precondition`
- `getAccountDeletionPlan` は本人が判断すべきチームだけを返す
- `deleteAccount` は計画と選択が一致しない場合に拒否
- 通信切断を模した再呼出しでも同じ requestId は安全に完了
- Firestore 残存確認後にだけ Firebase Auth ユーザーを削除
- 完了後は旧 ID token で保護データを取得できない

**Step 2: RED を確認する**

Run: `npm run test:account-deletion:emulator`

Expected: callable 未実装で FAIL。

**Step 3: callable を実装する**

- `getAccountDeletionPlan`
- `deleteAccount`
- region: `asia-northeast1`
- request body は `requestId` と仕様で許可した `teamDecisions` だけ
- ログにメール、案件名、自由記述を出さない
- Firebase Auth ユーザー削除は最後に実施
- Auth 削除後に job 更新できない設計を避けるため、完了記録は Auth から独立した Admin-only job とする

**Step 4: GREEN を確認する**

Run: `npm run test:account-deletion:emulator`

Expected: PASS。

**Step 5: コミットする**

```bash
git add functions/index.mjs tests/account-deletion-functions.test.mjs tests/account-deletion-store.test.mjs
git commit -m "feat: expose secure account deletion callable"
```

## Task 5: Apple / Google の直近再認証と Apple 連携解除

**Files:**
- Create: `www/js/account-deletion.mjs`
- Modify: `www/js/firestore-core.mjs`
- Modify: `www/js/firebase-auth.mjs`
- Modify: `ios/App/App/AppDelegate.swift`
- Modify: `ios/App/CapApp-SPM/Package.swift`
- Modify: `scripts/ensure-ios-capacitor-plugins.mjs`
- Modify: `tests/auth-state.test.mjs`
- Modify: `tests/ios-capacitor-config.test.mjs`
- Create: `tests/account-deletion-client.test.mjs`

**Step 1: 失敗する client/native 契約テストを書く**

- Google は新しい credential で `reauthenticateWithCredential` を呼ぶ
- Apple は native authorization code と identity token で Firebase 再認証する
- Apple の authorization code を Firebase iOS SDK の `revokeToken(withAuthorizationCode:)` へ渡す
- Apple revoke が失敗した場合は Auth 削除へ進まない
- Functions client は production と emulator の接続先を取り違えない
- `copy:ios` 後も SignInWithApple revoke method と FirebaseAuth dependency が残る

**Step 2: RED を確認する**

Run: `node --test tests/account-deletion-client.test.mjs tests/auth-state.test.mjs tests/ios-capacitor-config.test.mjs`

Expected: API / native method 未実装で FAIL。

**Step 3: Web 側の最小 API を実装する**

`www/js/account-deletion.mjs` に以下を置く。

- `fetchAccountDeletionPlan()`
- `reauthenticateForAccountDeletion()`
- `deleteCurrentAccount({ requestId, teamDecisions })`
- emulator 接続は既存 Firebase 接続判定に合わせる

**Step 4: native Apple revoke を実装する**

- `CapApp-SPM` に公式 `firebase-ios-sdk` の `FirebaseCore` / `FirebaseAuth` product を追加
- `AppDelegate` 起動時に未初期化の場合だけ `FirebaseApp.configure()`
- SignInWithApple plugin に `revokeAuthorizationCode` を追加
- Apple 再認証後、callable 削除の直前に revoke を実行
- `scripts/ensure-ios-capacitor-plugins.mjs` に `cap copy` 後の依存関係・plugin 登録検査を追加

**Step 5: GREEN と iOS copy を確認する**

Run: `node --test tests/account-deletion-client.test.mjs tests/auth-state.test.mjs tests/ios-capacitor-config.test.mjs`

Run: `npm run copy:ios`

Run: `node --test tests/ios-capacitor-config.test.mjs`

Expected: すべて PASS、copy 後の差分が想定内。

**Step 6: コミットする**

```bash
git add www/js/account-deletion.mjs www/js/firestore-core.mjs www/js/firebase-auth.mjs ios/App/App/AppDelegate.swift ios/App/CapApp-SPM/Package.swift scripts/ensure-ios-capacitor-plugins.mjs tests/account-deletion-client.test.mjs tests/auth-state.test.mjs tests/ios-capacitor-config.test.mjs
git commit -m "feat: reauthenticate and revoke Apple access before deletion"
```

## Task 6: 設定画面のアカウント削除 UI

**Files:**
- Modify: `www/index.html`
- Modify: `www/i18n.js`
- Create: `tests/account-deletion-ui.test.mjs`
- Modify: `tests/equal-two-option-tabs.test.mjs`

**Step 1: 失敗する UI 回帰テストを書く**

- 設定に「アカウントを削除」がある
- 通常設定から区別された危険操作として表示される
- 再認証前に削除 callable を呼ばない
- 管理者チームごとに移管先または解散を選べる
- 文字入力確認が一致しないと確定不可
- 端末データは「残す」が初期値で、「消す」を別に選べる
- 完了後は sign-out 状態へ遷移する
- 既存の 50% / 50% タブ、報酬タブ、終了案件設定を変えない

**Step 2: RED を確認する**

Run: `node --test tests/account-deletion-ui.test.mjs tests/equal-two-option-tabs.test.mjs`

Expected: UI 未実装で FAIL。

**Step 3: UI を最小実装する**

画面順:

1. 影響説明
2. チームごとの移管 / 解散選択
3. Google / Apple の直近再認証
4. 「削除」と入力
5. Cloud Functions 実行と進捗表示
6. 成功後に端末データを残す / 消すの選択を反映

端末データ削除は、既存 localStorage と Documents バックアップの対象を列挙し、Auth のクラウド削除とは別処理にする。失敗時は「どこまで完了したか」と再実行できる案内を表示する。

**Step 4: GREEN を確認する**

Run: `node --test tests/account-deletion-ui.test.mjs tests/equal-two-option-tabs.test.mjs`

Run: `npm run check:js`

Run: `npm run check:html`

Expected: PASS。

**Step 5: ブラウザ表示を確認する**

Run: `npm run dev`

確認:

- 375 / 390 / 430 px の設定画面
- 長文が画面外へはみ出さない
- 削除をキャンセルできる
- 既存設定の配置、色、操作が変わっていない

**Step 6: コミットする**

```bash
git add www/index.html www/i18n.js tests/account-deletion-ui.test.mjs tests/equal-two-option-tabs.test.mjs
git commit -m "feat: add in-app account deletion flow"
```

## Task 7: 利用規約・プライバシーポリシー・サポート導線

**Files:**
- Create: `www/privacy.html`
- Create: `www/terms.html`
- Create: `www/support.html`
- Modify: `docs/privacy.html`
- Create: `docs/terms.html`
- Modify: `docs/support.html`
- Modify: `www/index.html`
- Modify: `www/i18n.js`
- Modify: `tests/legal-cloud-copy.test.mjs`

**Step 1: 失敗する法務表示テストを書く**

- Firebase Auth / Firestore / Functions の利用を明示
- 取得・保存する情報、利用目的、共有範囲、保存期間、削除方法を明示
- ローカル保存だけと誤認させる旧文言がない
- 問い合わせ先と施行日がある
- 将来の広告・課金は「導入時に改定し同意・表示を整備」と明記し、現在導入済みとは書かない
- `/privacy.html`、`/terms.html`、`/support.html` が SPA rewrite ではなく独立 HTML を返す
- アプリ内表示と公開ページの重要事項が矛盾しない

**Step 2: RED を確認する**

Run: `node --test tests/legal-cloud-copy.test.mjs`

Expected: 公開ページ不足・旧文言で FAIL。

**Step 3: 最小限の法務ページと導線を実装する**

- 日本語を正本として、英語表示も既存言語切替に合わせる
- settings から各ページを開ける
- App Store Connect に設定する URL を固定する
- 法務判断ではなく現行実装との技術的一致を保証する

**Step 4: GREEN を確認する**

Run: `node --test tests/legal-cloud-copy.test.mjs`

Run: `npm run check:html`

Expected: PASS。

**Step 5: コミットする**

```bash
git add www/privacy.html www/terms.html www/support.html docs/privacy.html docs/terms.html docs/support.html www/index.html www/i18n.js tests/legal-cloud-copy.test.mjs
git commit -m "docs: align legal pages with cloud data handling"
```

## Task 8: Privacy Manifest と App Store 提出資料

**Files:**
- Create: `ios/App/App/PrivacyInfo.xcprivacy`
- Modify: `ios/App/App.xcodeproj/project.pbxproj`
- Modify: `tests/ios-capacitor-config.test.mjs`
- Create: `docs/app-store/privacy-data-map.md`
- Create: `docs/app-store/review-notes.md`
- Create: `docs/app-store/monetization-checklist.md`

**Step 1: 失敗する manifest 検査を書く**

- `PrivacyInfo.xcprivacy` が plist として妥当
- Xcode Resources に含まれる
- UserDefaults の approved reason を宣言
- user-selected file と app container file の timestamp 利用理由を実装に合わせて宣言
- tracking は false、tracking domain は空
- App Store privacy label 用 data map が Auth、プロフィール、案件、報酬、ファイル metadata を網羅

**Step 2: RED を確認する**

Run: `node --test tests/ios-capacitor-config.test.mjs`

Expected: manifest がないため FAIL。

**Step 3: manifest と提出資料を追加する**

- Apple の approved reason code だけを使用する
- 実装で使っていないデータ収集・広告追跡を宣言しない
- `privacy-data-map.md`: App Store Connect の質問への回答根拠
- `review-notes.md`: ログイン、チーム、削除機能の審査手順
- `monetization-checklist.md`: 広告 SDK / ATT / IAP / Restore / 規約更新を将来導入前の必須条件として整理

**Step 4: GREEN と built app 内配置を確認する**

Run: `plutil -lint ios/App/App/PrivacyInfo.xcprivacy`

Run: `node --test tests/ios-capacitor-config.test.mjs`

Expected: PASS。

**Step 5: コミットする**

```bash
git add ios/App/App/PrivacyInfo.xcprivacy ios/App/App.xcodeproj/project.pbxproj tests/ios-capacitor-config.test.mjs docs/app-store/privacy-data-map.md docs/app-store/review-notes.md docs/app-store/monetization-checklist.md
git commit -m "docs: add iOS privacy manifest and review checklist"
```

## Task 9: 全回帰・実機向け Release 検証

**Files:**
- Verify only unless a failing test identifies a scoped defect

**Step 1: narrow verification**

Run: `npm run test:account-deletion`

Run: `npm run test:account-deletion:emulator`

Run: `npm run test:rules`

**Step 2: 全自動テスト**

Run: `npm test`

Run: `npm run check:js`

Run: `npm run check:html`

Expected: 全件 PASS。

**Step 3: iOS assets を同期する**

Run: `npm run copy:ios`

Run: `git diff -- ios/App/App/public ios/App/App/capacitor.config.json ios/App/CapApp-SPM/Package.swift`

Expected: `www` の変更と必要な plugin/package だけが反映。

**Step 4: Simulator Release build**

Run: `xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build`

Expected: `** BUILD SUCCEEDED **`。

**Step 5: built app を検査する**

- `PrivacyInfo.xcprivacy` が `.app` bundle に存在
- 端末向け公開 URL が開く
- development / emulator host が Release bundle に残っていない

**Step 6: ブラウザの回帰確認**

375 / 390 / 430 px で次を確認する。

- トップ空状態
- 個人報酬タブ
- 終了済み案件設定
- チーム一覧・案件・予定・履歴
- アカウント削除画面
- プライバシー / 利用規約 / サポート

## Task 10: 本番反映と安全な確認

**Files:**
- Deploy only

**Step 1: Firebase project と差分を確認する**

Run: `firebase use`

Run: `firebase deploy --only functions --project dm-management-ecc1f --dry-run`

Blaze プランまたは IAM 権限で止まった場合は、必要な Firebase Console の一手だけをユーザーへ案内する。

**Step 2: Functions を先に反映する**

Run: `firebase deploy --only functions --project dm-management-ecc1f`

Expected: `getAccountDeletionPlan` と `deleteAccount` が `asia-northeast1` に反映。

**Step 3: Rules / indexes を反映する**

Run: `firebase deploy --only firestore:rules,firestore:indexes --project dm-management-ecc1f`

Expected: deploy success。

**Step 4: Hosting を反映する**

Run: `firebase deploy --only hosting --project dm-management-ecc1f`

Expected: deploy success。

**Step 5: 公開ページ smoke test**

- `/privacy.html`
- `/terms.html`
- `/support.html`
- production app entry

各 URL の HTTP 200、タイトル、主要文言、cache 更新を確認する。

**Step 6: テスト専用アカウントで本番 smoke test**

- 一般メンバー削除
- 管理者移管後の削除
- 管理者だけのチーム解散後の削除
- 他メンバーから案件・報酬・非公開情報が漏れない
- 削除後に再ログインできない
- 既存の別ユーザーと別チームのデータが残る

実データのあるアカウントは削除に使わない。

## 完了条件

- アプリ内から Apple / Google 利用者が自分のアカウント削除を完了できる。
- チーム移管・脱退・解散の選択が安全に処理され、他ユーザーのチーム案件を消さない。
- 削除は再実行可能で、途中失敗しても復旧できる。
- Rules / Functions / client / iOS / legal のテストが通る。
- Privacy Manifest が Release app bundle に含まれる。
- 公開法務 URL とアプリ内文言が一致する。
- 本番反映後、テスト専用アカウントで削除の主要 3 経路を確認する。
- 未実施の実機・App Store Connect 操作は、理由とユーザー向け手順を残す。
