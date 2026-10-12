import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import * as accountDeletionUi from '../www/js/account-deletion-ui.mjs';
import * as authState from '../www/js/auth-state.mjs';

const {
  AccountDeletionUiError,
  buildDeletionRequest,
  clearTeamDecision,
  clearScopedLocalData,
  createAccountDeletionFlow,
  createDeletionFormState,
  setTeamDecision,
} = accountDeletionUi;

const html = readFileSync(new URL('../www/index.html', import.meta.url), 'utf8');
const i18n = readFileSync(new URL('../www/i18n.js', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const plan = {
  teams: [
    { teamId: 'member-team', teamName: '通常チーム', requiredAction: 'leave', eligibleSuccessors: [] },
    { teamId: 'admin-team', teamName: '管理チーム', requiredAction: 'admin-choice', eligibleSuccessors: [{ uid: 'active-user', displayName: '引継ぎ先' }] },
    { teamId: 'solo-team', teamName: 'ひとりチーム', requiredAction: 'dissolve', eligibleSuccessors: [] },
  ],
};

test('settings exposes a signed-in-only danger action and an accessible deletion dialog', () => {
  assert.match(html, /id="settingsAccountDeletion"[^>]*hidden/);
  assert.match(html, /id="settingsDeleteAccountBtn"[^>]*type="button"/);
  assert.match(html, /id="accountDeletionModal"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /id="accountDeletionModalTitle"/);
  assert.match(html, /id="accountDeletionTeamList"/);
  assert.match(html, /id="accountDeletionConfirmInput"/);
  assert.match(html, /id="accountDeletionSubmit"[^>]*type="button"[^>]*disabled/);
  assert.match(html, /account-deletion-danger/);
  assert.match(html, /account-deletion-safe-bottom/);
});

test('settings keeps account deletion outside the collapsible login choices', () => {
  const loginChoicesStart = html.indexOf('id="settingsLoginChoices"');
  const deletionRowStart = html.indexOf('id="settingsAccountDeletionRow"');
  assert.ok(loginChoicesStart >= 0);
  assert.ok(deletionRowStart > loginChoicesStart);
  assert.doesNotMatch(html.slice(loginChoicesStart, deletionRowStart), /id="settingsAccountDeletion"/);
});

test('account deletion visibility uses Firebase signed-in state without requiring a session provider key', () => {
  assert.equal(typeof authState.getLoginRowUiState, 'function');
  assert.equal(typeof authState.getAccountDeletionUiState, 'function');
  assert.deepEqual(authState.getAccountDeletionUiState({
    currentUser: { uid: 'u1', providerData: [{ providerId: 'google.com' }] },
    lastLoginProvider: '',
  }), { signedIn: true, providerId: 'google.com' });
  assert.deepEqual(authState.getAccountDeletionUiState({
    currentUser: { uid: 'u2', providerData: [] }, lastLoginProvider: '',
  }), { signedIn: true, providerId: '' });
  assert.match(html, /const deletionUi = authState\.getAccountDeletionUiState/);
  assert.match(html, /deletionDanger\.hidden = !deletionUi\.signedIn/);
  assert.match(html, /activeLoginProviderId = deletionUi\.providerId/);
});

test('Japanese and English copy covers cloud, team, device, resume, providers, and safe errors', () => {
  for (const key of [
    'account_delete_action', 'account_delete_cloud_impact', 'account_delete_team_impact',
    'account_delete_device_separate', 'account_delete_keep_local', 'account_delete_erase_local',
    'account_delete_resume', 'account_delete_reauth_google', 'account_delete_reauth_apple',
    'account_delete_error_reauth', 'account_delete_error_cancelled',
    'account_delete_error_network', 'account_delete_error_in_progress',
    'account_delete_error_signout', 'account_delete_dissolve_impact',
    'account_delete_cloud_complete', 'account_delete_local_confirm',
  ]) assert.equal((i18n.match(new RegExp(`\\b${key}:`, 'g')) || []).length, 2, key);
  assert.match(i18n, /account_delete_phrase:\s*'削除'/);
  assert.match(i18n, /account_delete_phrase:\s*'DELETE'/);
});

test('Apple token revocation failures have a dedicated safe message instead of the generic deletion error', () => {
  assert.match(html, /apple-revoke-failed[\s\S]{0,180}account_delete_error_apple_revoke/);
  assert.equal((i18n.match(/\baccount_delete_error_apple_revoke:/g) || []).length, 2);
});

test('member leave is read-only and every admin choice is required', () => {
  let state = createDeletionFormState({ plan, language: 'ja' });
  assert.deepEqual(state.teamDecisions, [{ teamId: 'member-team', action: 'leave' }]);
  assert.equal(state.choicesComplete, false);
  state = setTeamDecision(state, 'admin-team', 'transfer', 'active-user');
  assert.equal(state.choicesComplete, false);
  state = setTeamDecision(state, 'solo-team', 'dissolve');
  assert.equal(state.choicesComplete, true);
  assert.throws(() => setTeamDecision(state, 'admin-team', 'transfer', 'outsider'),
    (error) => error instanceof AccountDeletionUiError && error.code === 'invalid-successor');
});

test('shared-team admins can explicitly choose transfer or dissolve', () => {
  assert.match(html, /team\.requiredAction === 'admin-choice'/);
  assert.match(html, /setTeamDecision\(accountDeletionState, team\.teamId, 'dissolve'\)/);
  assert.match(html, /setTeamDecision\(accountDeletionState, team\.teamId, 'transfer'/);
  let state = createDeletionFormState({ plan, language: 'ja' });
  state = setTeamDecision(state, 'admin-team', 'dissolve');
  assert.deepEqual(state.teamDecisions.find((entry) => entry.teamId === 'admin-team'), {
    teamId: 'admin-team', action: 'dissolve',
  });
  state = setTeamDecision(state, 'admin-team', 'transfer', 'active-user');
  assert.deepEqual(state.teamDecisions.find((entry) => entry.teamId === 'admin-team'), {
    teamId: 'admin-team', action: 'transfer', transferToUid: 'active-user',
  });
});

test('clearing a transfer removes the stale decision and makes choices incomplete', () => {
  assert.equal(typeof clearTeamDecision, 'function');
  let state = createDeletionFormState({ plan, language: 'ja' });
  state = setTeamDecision(state, 'admin-team', 'transfer', 'active-user');
  state = setTeamDecision(state, 'solo-team', 'dissolve');
  assert.equal(state.choicesComplete, true);
  state = clearTeamDecision(state, 'admin-team');
  assert.equal(state.teamDecisions.some((entry) => entry.teamId === 'admin-team'), false);
  assert.equal(state.choicesComplete, false);

  assert.match(html, /if \(!select\.value\) \{\s*accountDeletionState = uiModule\.clearTeamDecision\(accountDeletionState, team\.teamId\)/);
  assert.match(html, /dissolveCheckbox\.checked = false/);
  assert.match(html, /select\.value = ''/);
});

test('dissolve confirmation names the team and active members affected', () => {
  assert.match(html, /tt\('account_delete_dissolve_impact', \{\s*team: team\.teamName \|\| '',\s*count: \(team\.eligibleSuccessors \|\| \[\]\)\.length/);
  assert.match(i18n, /account_delete_dissolve_impact:\s*'「\{team\}」.*影響するほかのメンバー：\{count\}人/);
  assert.match(i18n, /account_delete_dissolve_impact:\s*'.*\{team\}.*other active team members affected: \{count\}/);
});

test('typed confirmation is exact and local data defaults to keep', () => {
  let state = createDeletionFormState({ plan: { teams: [] }, language: 'ja' });
  assert.equal(state.localDataChoice, 'keep');
  assert.throws(() => buildDeletionRequest({ ...state, typedConfirmation: 'DELETE' }), /confirmation-required/);
  assert.doesNotThrow(() => buildDeletionRequest({ ...state, typedConfirmation: '削除' }));
  state = createDeletionFormState({ plan: { teams: [] }, language: 'en' });
  assert.throws(() => buildDeletionRequest({ ...state, typedConfirmation: 'delete' }), /confirmation-required/);
  assert.doesNotThrow(() => buildDeletionRequest({ ...state, typedConfirmation: 'DELETE' }));
});

test('device data choice is a separate step after cloud deletion', () => {
  const cloudForm = html.indexOf('id="accountDeletionForm"');
  const localStep = html.indexOf('id="accountDeletionLocalStep"');
  assert.ok(cloudForm >= 0 && localStep > cloudForm);
  assert.match(html, /id="accountDeletionCloudStep"/);
  assert.match(html, /cloudStep\.hidden = true/);
  assert.match(html, /id="accountDeletionLocalStep"[^>]*hidden/);
  assert.match(html, /id="accountDeletionLocalConfirm"[^>]*type="button"/);
  assert.match(html, /accountDeletionFlow\.finalizeLocalData\(localChoice\)/);
});

test('account deletion keeps the selected device-data choice separate from the sign-out workspace reset', () => {
  const sync = html.match(/async function syncPersonalWorkspaceForUser\(user\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(sync, /!accountDeletionBusy && !accountDeletionAwaitingLocalChoice/);
});

test('active jobs retain expected decisions and reuse the resume request ID', () => {
  const state = createDeletionFormState({ plan: {
    teams: [], resumeRequestId: 'resume_request_123456789012345678',
    teamDecisions: [{ teamId: 'existing-team', action: 'leave' }],
  }, language: 'ja' });
  assert.equal(state.isResume, true);
  assert.equal(state.requestId, 'resume_request_123456789012345678');
  assert.deepEqual(state.teamDecisions, [{ teamId: 'existing-team', action: 'leave' }]);
  assert.equal(state.choicesComplete, true);
});

test('flow retries a stale plan after reauth and deletes only after form validation', async () => {
  const calls = [];
  let planAttempts = 0;
  const flow = createAccountDeletionFlow({
    fetchPlan: async () => { calls.push('plan'); if (++planAttempts === 1) throw Object.assign(new Error('safe'), { code: 'reauthentication-required' }); return { teams: [] }; },
    reauthenticate: async () => { calls.push('reauth'); return { providerId: 'google.com' }; },
    deleteAccount: async (request) => { calls.push(['delete', request]); return { deleted: true }; },
    signOut: async () => { calls.push('signout'); },
    clearLocalData: async () => { calls.push('clear'); },
    createRequestId: () => 'request_123456789012345678901234',
  });
  const loaded = await flow.load('ja');
  assert.deepEqual(calls, ['plan', 'reauth', 'plan']);
  await assert.rejects(flow.execute({ ...loaded, typedConfirmation: 'wrong' }), /confirmation-required/);
  assert.equal(calls.some((call) => Array.isArray(call) && call[0] === 'delete'), false);
  const result = await flow.execute({ ...loaded, typedConfirmation: '削除' });
  assert.deepEqual(calls.slice(3).map((call) => Array.isArray(call) ? call[0] : call), ['reauth', 'delete', 'signout']);
  assert.deepEqual(result, { cloudDeleted: true, providerId: 'google.com' });
  assert.equal(calls.includes('clear'), false);
  assert.deepEqual(await flow.finalizeLocalData('keep'), { localData: 'kept' });
});

test('erase is scoped, deletes listed native files one by one, and preserves settings', async () => {
  const values = new Map([
    ['ig_dm_mgr_v1', 'personal'], ['dm-manager-team-workspace-cache-v1', 'teams'],
    ['ig_dm_personal_reward_teams_v1:user-1', 'rewards'], ['dm-team-mutations-v2:user-1', 'queue'],
    ['dm_manager_ui_lang', 'en'], ['dm-sort-mode', 'newest'], ['other-app', 'keep'],
  ]);
  const deletedFiles = [];
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const filesystem = {
    readdir: async () => ({ files: [{ name: 'one.json' }, { name: 'two.json' }, { name: 'note.txt' }] }),
    deleteFile: async ({ path }) => { deletedFiles.push(path); },
  };
  await clearScopedLocalData({ storage, filesystem, uid: 'user-1' });
  for (const key of ['ig_dm_mgr_v1', 'dm-manager-team-workspace-cache-v1', 'ig_dm_personal_reward_teams_v1:user-1', 'dm-team-mutations-v2:user-1']) assert.equal(values.has(key), false);
  assert.equal(values.get('dm_manager_ui_lang'), 'en');
  assert.equal(values.get('dm-sort-mode'), 'newest');
  assert.equal(values.get('other-app'), 'keep');
  assert.deepEqual(deletedFiles, ['dm-manager-data.json', 'backups/one.json', 'backups/two.json']);
});

test('local erase failure does not undo cloud deletion', async () => {
  const calls = [];
  const flow = createAccountDeletionFlow({
    fetchPlan: async () => ({ teams: [] }),
    reauthenticate: async () => { calls.push('reauth'); return { providerId: 'apple.com' }; },
    deleteAccount: async () => { calls.push('delete'); return { deleted: true }; },
    signOut: async () => { calls.push('signout'); },
    clearLocalData: async () => { calls.push('clear'); throw new Error('private path'); },
    createRequestId: () => 'request_123456789012345678901234',
  });
  const state = await flow.load('ja');
  const result = await flow.execute({ ...state, typedConfirmation: '削除', localDataChoice: 'erase' });
  assert.deepEqual(calls, ['reauth', 'delete', 'signout']);
  assert.deepEqual(result, { cloudDeleted: true, providerId: 'apple.com' });
  assert.deepEqual(await flow.finalizeLocalData('erase'), { localData: 'erase-failed' });
  assert.deepEqual(calls, ['reauth', 'delete', 'signout', 'clear']);
});

test('sign-out failure is reported instead of returning deletion success', async () => {
  const flow = createAccountDeletionFlow({
    fetchPlan: async () => ({ teams: [] }),
    reauthenticate: async () => ({ providerId: 'google.com' }),
    deleteAccount: async () => ({ deleted: true }),
    signOut: async () => { throw new Error('private auth detail'); },
    clearLocalData: async () => {},
    createRequestId: () => 'request_123456789012345678901234',
  });
  const state = { ...(await flow.load('ja')), typedConfirmation: '削除' };
  await assert.rejects(flow.execute(state), (error) => (
    error instanceof AccountDeletionUiError
    && error.code === 'sign-out-failed'
    && error.cloudDeleted === true
    && !error.message.includes('private auth detail')
  ));
  assert.deepEqual(await flow.finalizeLocalData('keep'), { localData: 'kept' });
});

test('local data cannot be changed before cloud deletion completes', async () => {
  const flow = createAccountDeletionFlow({
    fetchPlan: async () => ({ teams: [] }), reauthenticate: async () => ({}),
    deleteAccount: async () => ({}), signOut: async () => {}, clearLocalData: async () => {},
  });
  await assert.rejects(flow.finalizeLocalData('erase'), /cloud-deletion-required/);
});

test('failed deletion can retry, reauthenticates again, and blocks double submission', async () => {
  let attempts = 0;
  let reauths = 0;
  const flow = createAccountDeletionFlow({
    fetchPlan: async () => ({ teams: [] }),
    reauthenticate: async () => { reauths += 1; return { providerId: 'google.com' }; },
    deleteAccount: async () => { if (++attempts === 1) throw Object.assign(new Error('internal secret'), { code: 'temporarily-unavailable' }); return { deleted: true }; },
    signOut: async () => {}, clearLocalData: async () => {},
    createRequestId: () => 'request_123456789012345678901234',
  });
  const state = { ...(await flow.load('ja')), typedConfirmation: '削除' };
  const first = flow.execute(state);
  await assert.rejects(flow.execute(state), /deletion-in-progress/);
  await assert.rejects(first, (error) => error.code === 'temporarily-unavailable');
  await flow.execute(state);
  assert.equal(reauths, 2);
  assert.equal(attempts, 2);
});

test('root scripts register and syntax-check the account deletion UI', () => {
  assert.match(pkg.scripts.test, /tests\/account-deletion-ui\.test\.mjs/);
  assert.match(pkg.scripts['test:account-deletion'], /tests\/account-deletion-ui\.test\.mjs/);
  assert.match(pkg.scripts['check:js'], /www\/js\/account-deletion-ui\.mjs/);
});
