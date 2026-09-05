import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('www/index.html', root), 'utf8');
const appDelegate = readFileSync(new URL('ios/App/App/AppDelegate.swift', root), 'utf8');
const entitlements = readFileSync(new URL('ios/App/App/App.entitlements', root), 'utf8');
const infoPlist = readFileSync(new URL('ios/App/App/Info.plist', root), 'utf8');
const firebaseConfig = JSON.parse(readFileSync(new URL('firebase.json', root), 'utf8'));

test('team invite links are configured as iOS Universal Links', () => {
  const association = JSON.parse(readFileSync(new URL('www/.well-known/apple-app-site-association', root), 'utf8'));
  const details = association?.applinks?.details || [];

  assert.match(entitlements, /applinks:dm-management-ecc1f\.web\.app/);
  assert.ok(JSON.stringify(details).includes('5H25CFKC7N.com.chiaki.dmmanager'));
  assert.ok(JSON.stringify(details).includes('team_join'));
});

test('firebase hosting deploys the Apple association file with a JSON content type', () => {
  const ignore = firebaseConfig.hosting.ignore || [];
  const headers = firebaseConfig.hosting.headers || [];
  const associationHeader = headers.find((entry) => entry.source === '/.well-known/apple-app-site-association');

  assert.equal(ignore.includes('**/.*'), false, 'blanket hidden-file ignore would skip .well-known');
  assert.ok(associationHeader, 'Apple association file should have an explicit hosting header');
  assert.ok((associationHeader.headers || []).some((h) => h.key === 'Content-Type' && h.value === 'application/json'));
});

test('iOS app can receive invite links without losing the app login session', () => {
  assert.match(infoPlist, /<string>dmmanager<\/string>/);
  assert.match(appDelegate, /@objc\(DeepLink\)/);
  assert.match(appDelegate, /consumePendingUrl/);
  assert.match(appDelegate, /NSUserActivityTypeBrowsingWeb/);
  assert.match(html, /consumePendingTeamInviteUrl/);
  assert.match(html, /handleTeamJoinUrl/);
});

test('team invite web links include an iOS app fallback for LINE browsers', () => {
  assert.match(infoPlist, /<string>dmmanager<\/string>/);
  assert.match(html, /function buildTeamInviteAppUrl/);
  assert.match(html, /dmmanager:\/\/invite/);
  assert.match(html, /function openNativeTeamInviteApp/);
  assert.match(html, /openNativeTeamInviteApp\(invite\)/);
});

test('team invite web links auto-open the native app from LINE on iOS', () => {
  assert.match(html, /function isLineIosBrowser/);
  assert.match(html, /Line\\\//);
  assert.match(html, /shouldAutoOpenNativeInviteApp/);
  assert.match(html, /isLineIosBrowser\(\)/);
});
