import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const iosConfig = JSON.parse(readFileSync(new URL('../ios/App/App/capacitor.config.json', import.meta.url), 'utf8'));
const appDelegate = readFileSync(new URL('../ios/App/App/AppDelegate.swift', import.meta.url), 'utf8');
const packageSwift = readFileSync(new URL('../ios/App/CapApp-SPM/Package.swift', import.meta.url), 'utf8');
const ensureScript = readFileSync(new URL('../scripts/ensure-ios-capacitor-plugins.mjs', import.meta.url), 'utf8');
const privacyManifestUrl = new URL('../ios/App/App/PrivacyInfo.xcprivacy', import.meta.url);
const xcodeProject = readFileSync(new URL('../ios/App/App.xcodeproj/project.pbxproj', import.meta.url), 'utf8');
const packageResolved = JSON.parse(readFileSync(new URL('../ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved', import.meta.url), 'utf8'));
const appEntitlements = readFileSync(new URL('../ios/App/App/App.entitlements', import.meta.url), 'utf8');

function loadPrivacyManifest() {
  const json = execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', fileURLToPath(privacyManifestUrl)], {
    encoding: 'utf8',
  });
  return JSON.parse(json);
}

test('iOS Capacitor config registers custom native plugins used by the web app', () => {
  const packageClassList = Array.isArray(iosConfig.packageClassList) ? iosConfig.packageClassList : [];

  assert.ok(packageClassList.includes('SignInWithApple'), 'SignInWithApple should be registered for Apple login');
  assert.ok(packageClassList.includes('AppReview'), 'AppReview should be registered for in-app review requests');
  assert.ok(packageClassList.includes('DeepLink'), 'DeepLink should be registered for app invite links');
});

test('first personal-only release keeps Apple sign-in but omits team invite domains', () => {
  assert.match(appEntitlements, /com\.apple\.developer\.applesignin/);
  assert.doesNotMatch(appEntitlements, /com\.apple\.developer\.associated-domains/);
});

test('iOS app initializes Firebase once and exposes safe Apple token revocation', () => {
  assert.match(appDelegate, /import FirebaseCore/);
  assert.match(appDelegate, /import FirebaseAuth/);
  assert.match(appDelegate, /FirebaseApp\.app\(\)\s*==\s*nil/);
  assert.match(appDelegate, /FirebaseApp\.configure\(\)/);
  assert.match(appDelegate, /CAPPluginMethod\(name:\s*"revokeAuthorizationCode"/);
  assert.match(appDelegate, /CAPPluginMethod\(name:\s*"prepareAuthorizationRevocation"/);
  assert.match(appDelegate, /OAuthProvider\.credential\(\s*providerID:\s*\.apple,/);
  assert.match(appDelegate, /Auth\.auth\(\)\.signIn\(with:\s*credential\)/);
  assert.match(appDelegate, /guard let currentUser = Auth\.auth\(\)\.currentUser/);
  assert.match(appDelegate, /Auth\.auth\(\)\.revokeToken\(withAuthorizationCode:\s*authorizationCode\)/);
  assert.doesNotMatch(appDelegate, /print\([^\n]*authorizationCode/);
  assert.doesNotMatch(appDelegate, /call\.reject\([^\n]*authorizationCode/);
});

test('Capacitor SPM package pins stable Firebase Core and Auth products', () => {
  assert.match(packageSwift, /firebase-ios-sdk\.git", exact:\s*"12\.18\.0"/);
  assert.match(packageSwift, /\.product\(name:\s*"FirebaseCore", package:\s*"firebase-ios-sdk"\)/);
  assert.match(packageSwift, /\.product\(name:\s*"FirebaseAuth", package:\s*"firebase-ios-sdk"\)/);
});

test('post-copy script preserves Firebase package products and Apple revoke method idempotently', () => {
  assert.match(ensureScript, /CapApp-SPM\/Package\.swift/);
  assert.match(ensureScript, /firebase-ios-sdk\.git/);
  assert.match(ensureScript, /FirebaseCore/);
  assert.match(ensureScript, /FirebaseAuth/);
  assert.match(ensureScript, /revokeAuthorizationCode/);
});

test('app privacy manifest declares only the approved required-reason API uses', () => {
  const manifest = loadPrivacyManifest();
  const accessedApiReasons = Object.fromEntries(
    manifest.NSPrivacyAccessedAPITypes.map((entry) => [
      entry.NSPrivacyAccessedAPIType,
      entry.NSPrivacyAccessedAPITypeReasons,
    ]),
  );

  assert.deepEqual(accessedApiReasons, {
    NSPrivacyAccessedAPICategoryFileTimestamp: ['3B52.1', 'C617.1'],
    NSPrivacyAccessedAPICategoryUserDefaults: ['CA92.1'],
  });
  assert.equal(manifest.NSPrivacyTracking, false);
  assert.deepEqual(manifest.NSPrivacyTrackingDomains, []);
});

test('app privacy manifest matches the linked app-functionality data stored by the app', () => {
  const manifest = loadPrivacyManifest();
  const expectedTypes = [
    'NSPrivacyCollectedDataTypeEmailAddress',
    'NSPrivacyCollectedDataTypeName',
    'NSPrivacyCollectedDataTypeOtherDiagnosticData',
    'NSPrivacyCollectedDataTypeOtherFinancialInfo',
    'NSPrivacyCollectedDataTypeOtherUserContent',
    'NSPrivacyCollectedDataTypePaymentInfo',
    'NSPrivacyCollectedDataTypePhotosorVideos',
    'NSPrivacyCollectedDataTypeUserID',
  ];
  const collectedTypes = manifest.NSPrivacyCollectedDataTypes
    .map((entry) => entry.NSPrivacyCollectedDataType)
    .sort();

  assert.deepEqual(collectedTypes, expectedTypes);
  for (const entry of manifest.NSPrivacyCollectedDataTypes) {
    assert.equal(entry.NSPrivacyCollectedDataTypeTracking, false);
    if (entry.NSPrivacyCollectedDataType === 'NSPrivacyCollectedDataTypeOtherDiagnosticData') {
      assert.equal(entry.NSPrivacyCollectedDataTypeLinked, false);
      assert.deepEqual(entry.NSPrivacyCollectedDataTypePurposes, [
        'NSPrivacyCollectedDataTypePurposeAnalytics',
        'NSPrivacyCollectedDataTypePurposeAppFunctionality',
      ]);
    } else {
      assert.equal(entry.NSPrivacyCollectedDataTypeLinked, true);
      assert.deepEqual(entry.NSPrivacyCollectedDataTypePurposes, ['NSPrivacyCollectedDataTypePurposeAppFunctionality']);
    }
  }
});

test('Xcode App target copies PrivacyInfo.xcprivacy into the application resources', () => {
  assert.match(xcodeProject, /PrivacyInfo\.xcprivacy \*\/ = \{isa = PBXFileReference;/);
  assert.match(xcodeProject, /PrivacyInfo\.xcprivacy in Resources \*\/ = \{isa = PBXBuildFile;/);
  assert.match(xcodeProject, /PBXResourcesBuildPhase[\s\S]*PrivacyInfo\.xcprivacy in Resources/);
});

test('the next App Store upload uses a new build number', () => {
  assert.match(xcodeProject, /CURRENT_PROJECT_VERSION = 8;/);
});

test('Release target requests an App Store distribution signature', () => {
  const releaseTarget = xcodeProject
    .split('504EC3181FED79650016851F /* Release */ = {')[1]
    ?.split('/* End XCBuildConfiguration section */')[0] || '';
  assert.match(releaseTarget, /CODE_SIGN_STYLE = Manual;/);
  assert.match(releaseTarget, /CODE_SIGN_IDENTITY = "Apple Distribution";/);
  assert.match(releaseTarget, /PROVISIONING_PROFILE_SPECIFIER = "DMManager App Store Distribution 2026-09";/);
});

test('App Store disclosure documents cover collected data, review, and future monetization boundaries', () => {
  const dataMap = readFileSync(new URL('../docs/app-store/privacy-data-map.md', import.meta.url), 'utf8');
  const reviewNotes = readFileSync(new URL('../docs/app-store/review-notes.md', import.meta.url), 'utf8');
  const monetization = readFileSync(new URL('../docs/app-store/monetization-checklist.md', import.meta.url), 'utf8');

  for (const required of ['メールアドレス', 'ユーザーID', 'その他のユーザーコンテンツ', 'その他の財務情報', '写真またはビデオ', 'その他の診断データ']) {
    assert.match(dataMap, new RegExp(required));
  }
  assert.match(dataMap, /追跡[^\n]*いいえ/);
  assert.match(dataMap, /Firebase Authentication/);
  assert.match(dataMap, /Cloud Firestore/);
  assert.match(reviewNotes, /個人機能[^\n]*ログイン不要/);
  assert.match(reviewNotes, /アカウントを削除/);
  assert.match(reviewNotes, /デモアカウント/);
  assert.match(monetization, /現在[^\n]*(広告|課金)[^\n]*(未導入|ありません)/);
  assert.match(monetization, /ATT/);
  assert.match(monetization, /StoreKit 2/);
  assert.match(monetization, /購入を復元/);
  assert.match(monetization, /利用規約/);
});

test('privacy map separates stored bank details as linked payment information', () => {
  const dataMap = readFileSync(new URL('../docs/app-store/privacy-data-map.md', import.meta.url), 'utf8');

  assert.match(dataMap, /支払情報[^\n]*銀行名[^\n]*支店[^\n]*口座番号/);
  assert.match(dataMap, /支払情報[^\n]*はい[^\n]*いいえ[^\n]*Appの機能/);
  assert.doesNotMatch(dataMap, /支払情報・購入履歴[^\n]*カード番号や購入決済は扱いません/);
});

test('privacy map records the exact Google Sign-In 8.0.0 bundle disclosures used by the Release app', () => {
  const googleSignIn = packageResolved.pins.find((pin) => pin.identity === 'googlesignin-ios');
  const dataMap = readFileSync(new URL('../docs/app-store/privacy-data-map.md', import.meta.url), 'utf8');
  const declarations = [
    ['NSPrivacyCollectedDataTypeName', 'はい', 'Appの機能'],
    ['NSPrivacyCollectedDataTypeEmailAddress', 'はい', 'Appの機能'],
    ['NSPrivacyCollectedDataTypePhoneNumber', 'はい', 'Appの機能'],
    ['NSPrivacyCollectedDataTypeOtherDataTypes', 'はい', 'Appの機能、分析'],
    ['NSPrivacyCollectedDataTypeCoarseLocation', 'はい', 'Appの機能'],
    ['NSPrivacyCollectedDataTypeUserID', 'はい', 'Appの機能、分析'],
    ['NSPrivacyCollectedDataTypeDeviceID', 'はい', '分析'],
    ['NSPrivacyCollectedDataTypeOtherUsageData', 'はい', '分析'],
  ];

  assert.equal(googleSignIn?.state?.version, '8.0.0');
  for (const [type, linked, purposes] of declarations) {
    assert.ok(
      dataMap.includes(`| \`${type}\` | ${linked} | いいえ | ${purposes} |`),
      `${type} should match the Release SDK manifest`,
    );
  }
  assert.match(dataMap, /Xcode[^\n]*自動[^\n]*集約/);
  assert.match(dataMap, /App側のmanifest[^\n]*重複[^\n]*不要/);
  assert.doesNotMatch(dataMap, /デバイスID、位置情報[^\n]*取得しません/);
});
