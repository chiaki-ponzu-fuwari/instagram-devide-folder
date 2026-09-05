# App Store プライバシー申告データマップ

最終確認日: 2026-09-06

この文書は、App Store Connect の「Appのプライバシー」回答と `PrivacyInfo.xcprivacy` を、現在の実装に合わせるための正本です。公開前に Release Archive の Privacy Report と Firebase の設定をもう一度照合します。

## 現在の前提

- 個人機能はログインせず端末内だけで利用できます。端末内だけで処理される情報は Apple の「収集」には含めません。
- Google / Apple ログイン、個人クラウドバックアップ、チーム機能を使うと、下表の情報を Firebase Authentication、Cloud Firestore、Cloud Functions へ送信・保存します。
- 広告SDK、アプリ内課金、Firebase Analytics、Crashlytics、横断追跡は現在導入していません。
- 追跡: **いいえ**。アプリ本体と同梱SDKのRelease manifestは、すべて `NSPrivacyCollectedDataTypeTracking = false` です。

## App Store Connect で選ぶデータ型

| Apple のデータ型 | 実際の内容 | 本人に関連付け | 追跡 | 利用目的 | 収集元・保存先 | ポリシー対応 |
|---|---|---:|---:|---|---|---|
| 名前 | Google / Apple の表示名、チーム内表示名 | はい | いいえ | Appの機能 | Firebase Authentication / Cloud Firestore | 取得情報、利用目的、チーム共有 |
| メールアドレス | Google / Apple のメールアドレス（Appleの非公開転送アドレスを含む） | はい | いいえ | Appの機能 | Firebase Authentication / Cloud Firestore | 取得情報、利用目的、外部サービス |
| ユーザーID | Firebase UID、認証プロバイダが返すアカウント識別子 | はい | いいえ | Appの機能 | Firebase Authentication / Cloud Firestore | 取得情報、認証、安全管理 |
| 写真またはビデオ | Googleログイン由来のプロフィール画像URLと表示用プロフィール画像 | はい | いいえ | Appの機能 | Firebase Authentication / Cloud Firestore | 取得情報、チーム共有 |
| その他のユーザーコンテンツ | 案件名、クライアント・アカウント名、説明、メモ、タグ、期限・予定、担当、フォルダ・ファイルの名前や紐付け、テンプレート、チーム履歴 | はい | いいえ | Appの機能 | Cloud Firestore | 入力情報、クラウド送信、チーム共有 |
| その他の財務情報 | 想定・確定報酬、報酬分配、経費、入金状態 | はい | いいえ | Appの機能 | Cloud Firestore | 入力情報、利用目的、チーム権限 |
| 支払情報 | 報酬振込先の銀行名、支店名・支店コード、口座種別、口座番号、口座名義 | はい | いいえ | Appの機能 | Cloud Firestore `teams/{teamId}/payouts/{uid}` | 入力情報、利用目的、チーム権限 |
| その他の診断データ | Firebase SDKのユーザーエージェント、Functionsの呼出関数名・IPアドレス等のサービス運用メタデータ | いいえ | いいえ | 分析、Appの機能 | Firebase / Google Cloud のサービスログ | 外部サービス、安全管理 |

## Google Sign-In 8.0.0 のRelease SDK宣言

Release `.app` に含まれる `GoogleSignIn_GoogleSignIn.bundle/PrivacyInfo.xcprivacy` の宣言です。AppleはXcodeで、アプリ本体と各SDKのmanifestを**自動的に集約**してPrivacy Reportを生成します。そのため、SDKが自身のmanifestで宣言した型はApp側のmanifestへの重複追加が不要です。ただし、App Store Connectの回答には第三者SDKの収集も含める必要があるため、次の全項目を回答表へ反映します。

| SDK manifestのデータ型 | 本人に関連付け | 追跡 | 利用目的 | App Store Connect上の名称 |
|---|---:|---:|---|---|
| `NSPrivacyCollectedDataTypeName` | はい | いいえ | Appの機能 | 名前 |
| `NSPrivacyCollectedDataTypeEmailAddress` | はい | いいえ | Appの機能 | メールアドレス |
| `NSPrivacyCollectedDataTypePhoneNumber` | はい | いいえ | Appの機能 | 電話番号 |
| `NSPrivacyCollectedDataTypeOtherDataTypes` | はい | いいえ | Appの機能、分析 | その他のデータタイプ |
| `NSPrivacyCollectedDataTypeCoarseLocation` | はい | いいえ | Appの機能 | おおよその位置情報 |
| `NSPrivacyCollectedDataTypeUserID` | はい | いいえ | Appの機能、分析 | ユーザーID |
| `NSPrivacyCollectedDataTypeDeviceID` | はい | いいえ | 分析 | デバイスID |
| `NSPrivacyCollectedDataTypeOtherUsageData` | はい | いいえ | 分析 | その他の使用状況データ |

Googleの公式説明では、OAuth同意に基づく認可を記録するユーザー識別子と、不正防止のため概略位置の推定に使う場合があるIPアドレスをGoogle Sign-In SDKが収集する可能性があります。上表は、利用中の8.0.0がRelease成果物で宣言する、より広い収集可能範囲を保守的に記録しています。

### 現在選ばないデータ型

- 購入履歴: アプリ内課金や商品購入を現在扱いません。銀行口座は上表の「支払情報」として申告します。
- 検索履歴: 検索語は端末上の絞り込みにだけ使い、サーバーへ保存しません。
- 製品操作、クラッシュデータ、性能データ: Firebase Analytics / Crashlytics / Performance SDK は導入していません。Google Sign-Inが宣言する「その他の使用状況データ」は別途申告します。
- 正確な位置情報: GPS等の正確な位置情報は取得しません。Google Sign-InがIPから推定する場合がある「おおよその位置情報」は申告します。
- 写真・動画ファイル本体: 現在は案件に紐づく名前・メタデータを管理し、ユーザーの写真・動画本体をFirebaseへアップロードしません。プロフィール画像URLは上表の「写真またはビデオ」として保守的に申告します。

## Required Reason API

| APIカテゴリ | 理由コード | 実装上の理由 |
|---|---|---|
| UserDefaults | `CA92.1` | アプリ自身のディープリンク待機値、Appleログインの一時的なコール識別子等をアプリ領域で読み書きする |
| File Timestamp | `C617.1` | Capacitor Filesystem がアプリのDocuments領域にあるデータ・自動バックアップのメタデータを扱う |
| File Timestamp | `3B52.1` | 同梱の File Picker が、利用者が明示的に選んだファイルの更新日時・サイズを読む |

`0A2A.1` 等、現在のアプリに該当しない理由は宣言しません。

## SDK・サーバー照合

| コンポーネント | 現在の用途 | 公開前確認 |
|---|---|---|
| Firebase Authentication | Google / Apple ログイン、UID、名前、メール、プロフィール画像 | SDK版のFirebase公式データ収集説明とPrivacy Reportを照合 |
| Cloud Firestore | 個人バックアップ、チーム案件・メンバー・報酬・予定・履歴 | Security Rules と App Store申告が同じ公開範囲か確認 |
| Cloud Functions | アカウント削除等のサーバー処理 | 関数ログに案件名・メール等を出していないことを確認 |
| Google Sign-In / Sign in with Apple | 本人認証 | 取得scopeと、Releaseに同梱された各SDK manifestの全項目を確認 |
| Capacitor Filesystem / File Picker | 端末バックアップ、利用者選択ファイル | Release Archive に各SDKのmanifestが含まれることを確認 |

## App Store Connect 入力時の最終チェック

1. アプリ本体の表とGoogle Sign-In 8.0.0の表を合算し、重複する型は目的の和集合として入力します。
2. Privacy Policy URL に公開済み `/privacy.html` を設定します。
3. User Privacy Choices URL には、削除方法を案内する `/support.html` またはプライバシーページを設定できます。
4. Archive Organizer の Privacy Report が上記と一致することを確認します。追加のSDK収集・Required Reason APIが出た場合は、先にこの文書、App Store Connect回答、必要に応じてアプリ本体のmanifestと公開ポリシーを更新します。

参考: [Apple App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/)、[Apple: Describing data use in privacy manifests](https://developer.apple.com/documentation/bundleresources/describing-data-use-in-privacy-manifests)、[Google Sign-InのApp Storeデータ開示ガイド](https://developers.google.com/identity/sign-in/ios/app-privacy)、[FirebaseのApp Storeデータ開示ガイド](https://firebase.google.com/docs/ios/app-store-data-collection)
