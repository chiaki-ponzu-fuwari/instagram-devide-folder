import test from 'node:test';
import assert from 'node:assert/strict';
import { getLoginUiState, shouldOpenLogoutSheet } from '../www/js/auth-state.mjs';

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
  assert.equal(shouldOpenLogoutSheet({ currentUser: { uid: 'u1' } }), true);
});
