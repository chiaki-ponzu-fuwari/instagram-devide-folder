import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const iosConfig = JSON.parse(readFileSync(new URL('../ios/App/App/capacitor.config.json', import.meta.url), 'utf8'));
const appDelegate = readFileSync(new URL('../ios/App/App/AppDelegate.swift', import.meta.url), 'utf8');
const packageSwift = readFileSync(new URL('../ios/App/CapApp-SPM/Package.swift', import.meta.url), 'utf8');
const ensureScript = readFileSync(new URL('../scripts/ensure-ios-capacitor-plugins.mjs', import.meta.url), 'utf8');

test('iOS Capacitor config registers custom native plugins used by the web app', () => {
  const packageClassList = Array.isArray(iosConfig.packageClassList) ? iosConfig.packageClassList : [];

  assert.ok(packageClassList.includes('SignInWithApple'), 'SignInWithApple should be registered for Apple login');
  assert.ok(packageClassList.includes('AppReview'), 'AppReview should be registered for in-app review requests');
  assert.ok(packageClassList.includes('DeepLink'), 'DeepLink should be registered for app invite links');
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
