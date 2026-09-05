import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getLoginAccountLabel,
  getLoginRowUiState,
  getLoginUiState,
  shouldOpenLogoutSheet,
} from '../www/js/auth-state.mjs';
import { selectReauthenticationProvider } from '../www/js/account-deletion-core.mjs';

test('signed-out user shows no login badge and no logout sheet', () => {
  const state = getLoginUiState({ currentUser: null, lastLoginProvider: '' });
  assert.equal(state.signedIn, false);
  assert.equal(state.badgeText, '');
  assert.equal(state.providerId, '');
  assert.equal(shouldOpenLogoutSheet({ currentUser: null }), false);
});

test('signed-in google user shows login badge on google row only', () => {
  const state = getLoginUiState({
    currentUser: { uid: 'u1' },
    lastLoginProvider: 'google.com',
  });
  assert.equal(state.signedIn, true);
  assert.equal(state.providerId, 'google.com');
  assert.equal(state.badgeText, 'ログイン中');
  assert.equal(shouldOpenLogoutSheet({ currentUser: { uid: 'u1' }, lastLoginProvider: 'google.com', rowProviderId: 'google.com' }), true);
  assert.equal(shouldOpenLogoutSheet({ currentUser: { uid: 'u1' }, lastLoginProvider: 'google.com', rowProviderId: 'apple.com' }), false);
});

test('signed-in user shows logout action only on the active provider row', () => {
  const googleRow = getLoginRowUiState({
    currentUser: { uid: 'u1' },
    lastLoginProvider: 'google.com',
    rowProviderId: 'google.com',
  });
  const appleRow = getLoginRowUiState({
    currentUser: { uid: 'u1' },
    lastLoginProvider: 'google.com',
    rowProviderId: 'apple.com',
  });

  assert.equal(googleRow.isActive, true);
  assert.equal(googleRow.badgeText, 'ログイン中');
  assert.equal(googleRow.action, 'logout-sheet');
  assert.equal(appleRow.isActive, false);
  assert.equal(appleRow.badgeText, '');
  assert.equal(appleRow.action, 'login');
});

test('logout sheet can show the signed-in account email', () => {
  assert.equal(getLoginAccountLabel({
    currentUser: {
      uid: 'u1',
      email: 'owner@example.com',
      displayName: 'Owner',
    },
  }), 'owner@example.com');

  assert.equal(getLoginAccountLabel({
    currentUser: {
      uid: 'u2',
      providerData: [{ email: 'provider@example.com' }],
    },
  }), 'provider@example.com');
});

test('account deletion selects the last linked provider without trusting an unrelated provider', () => {
  const linkedUser = {
    uid: 'u3',
    providerData: [{ providerId: 'google.com' }, { providerId: 'apple.com' }],
  };
  assert.equal(selectReauthenticationProvider(linkedUser, 'apple.com'), 'apple.com');
  assert.equal(selectReauthenticationProvider(
    { uid: 'u4', providerData: [{ providerId: 'google.com' }] },
    'password',
  ), 'google.com');
});
