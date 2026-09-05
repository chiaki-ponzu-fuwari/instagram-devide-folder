import test from 'node:test';
import assert from 'node:assert/strict';
import * as teamModel from '../www/js/team-model.mjs';
import {
  normalizeMemberRecord,
  normalizeTeamRecord,
  isActiveMember,
  isTeamAdmin,
  canReadTeam,
  canApproveJoinRequest,
  resolveRewardVisibility,
  canUseTeamRecord,
  buildActivityText,
  currentUserLabel,
} from '../www/js/team-model.mjs';

test('team project record is routed through the shared team account store', () => {
  assert.equal(typeof teamModel.buildTeamAccountRecord, 'function');
  assert.equal(typeof teamModel.mergeTeamAccounts, 'function');

  const shared = teamModel.buildTeamAccountRecord({
    id: 'a1',
    username: '@client',
    ownerUid: 'admin',
    project: { name: '案件A', scope: 'team', teamId: 't1' },
  }, { teamId: 't1', updatedBy: 'admin', now: 100 });

  assert.equal(shared.ownerUid, undefined);
  assert.equal(shared.project.teamId, 't1');
  const memberAccounts = teamModel.mergeTeamAccounts([
    { id: 'personal', project: { name: '個人案件', scope: 'personal' } },
    { id: 'other-team', project: { name: '別チーム案件', scope: 'team', teamId: 't2' } },
  ], [
    shared,
    { id: 'wrong-team', project: { name: '混入禁止', scope: 'team', teamId: 't2' } },
  ], 't1');

  assert.deepEqual(memberAccounts.map((account) => account.id), [
    'personal',
    'other-team',
    'a1',
  ]);
  assert.equal(memberAccounts[2].project.name, '案件A');
});

test('only local team accounts missing from the shared store are migrated', () => {
  assert.equal(typeof teamModel.findMissingTeamAccounts, 'function');
  const missing = teamModel.findMissingTeamAccounts([
    { id: 'personal', project: { scope: 'personal' } },
    { id: 'already-shared', project: { scope: 'team', teamId: 't1' } },
    { id: 'needs-migration', project: { scope: 'team', teamId: 't1' } },
    { id: 'other-team', project: { scope: 'team', teamId: 't2' } },
  ], [
    { id: 'already-shared', project: { scope: 'team', teamId: 't1' } },
  ], 't1');

  assert.deepEqual(missing.map((account) => account.id), ['needs-migration']);
});

test('local team accounts migrate only after an authoritative server snapshot', () => {
  assert.equal(typeof teamModel.shouldMigrateTeamAccounts, 'function');
  assert.equal(teamModel.shouldMigrateTeamAccounts({
    isAdmin: true,
    fromCache: true,
    alreadyMigrated: false,
  }), false);
  assert.equal(teamModel.shouldMigrateTeamAccounts({
    isAdmin: true,
    fromCache: false,
    alreadyMigrated: false,
  }), true);
  assert.equal(teamModel.shouldMigrateTeamAccounts({
    isAdmin: true,
    fromCache: false,
    alreadyMigrated: true,
  }), false);
  assert.equal(teamModel.shouldMigrateTeamAccounts({
    isAdmin: false,
    fromCache: false,
    alreadyMigrated: false,
  }), false);
});

test('normalizeMemberRecord fills defaults for a new admin', () => {
  const now = 1778493600000;
  const rec = normalizeMemberRecord({
    uid: 'u1',
    role: 'admin',
    status: 'active',
    displayName: '  Chiaki  ',
  }, { uid: 'u1', now });

  assert.equal(rec.uid, 'u1');
  assert.equal(rec.role, 'admin');
  assert.equal(rec.status, 'active');
  assert.equal(rec.displayName, 'Chiaki');
  assert.equal(rec.joinedAt, now);
  assert.equal(rec.updatedAt, now);
});

test('permission helpers distinguish active members from pending users', () => {
  const admin = { uid: 'u1', role: 'admin', status: 'active' };
  const member = { uid: 'u2', role: 'member', status: 'active' };
  const pending = { uid: 'u3', role: 'member', status: 'pending' };

  assert.equal(isActiveMember(admin), true);
  assert.equal(isTeamAdmin(admin), true);
  assert.equal(isActiveMember(member), true);
  assert.equal(isTeamAdmin(member), false);
  assert.equal(isActiveMember(pending), false);
  assert.equal(canReadTeam(member), true);
  assert.equal(canReadTeam(pending), false);
  assert.equal(canApproveJoinRequest(admin), true);
  assert.equal(canApproveJoinRequest(member), false);
});

test('resolveRewardVisibility returns the admin-controlled scope', () => {
  assert.equal(resolveRewardVisibility({ rewardVisibility: 'admin_only' }), 'admin_only');
  assert.equal(resolveRewardVisibility({ rewardVisibility: 'all_members' }), 'all_members');
  assert.equal(resolveRewardVisibility({ rewardVisibility: 'selected_members' }), 'selected_members');
  assert.equal(resolveRewardVisibility({ rewardVisibility: 'all' }), 'all_members');
  assert.equal(resolveRewardVisibility({ rewardVisibility: 'self' }), 'admin_only');
  assert.equal(resolveRewardVisibility({ rewardVisibility: 'self_plus_total' }), 'admin_only');
  assert.equal(resolveRewardVisibility({ rewardVisibility: 'unexpected-value' }), 'admin_only');
});

test('normalizeTeamRecord keeps safe fields and fills metadata', () => {
  const now = 1778493600000;
  const team = normalizeTeamRecord({
    id: 't1',
    name: '  HERAC  ',
    createdBy: 'u1',
  }, { uid: 'u1', now });

  assert.equal(team.id, 't1');
  assert.equal(team.name, 'HERAC');
  assert.equal(team.createdBy, 'u1');
  assert.equal(team.updatedBy, 'u1');
  assert.equal(team.createdAt, now);
  assert.equal(team.updatedAt, now);
  assert.equal(team.deletedAt, null);
});

test('canUseTeamRecord hides soft-deleted records', () => {
  assert.equal(canUseTeamRecord({ id: 'a1', deletedAt: null }), true);
  assert.equal(canUseTeamRecord({ id: 'a1', deletedAt: 1778493600000 }), false);
});

test('buildActivityText creates a short Japanese message', () => {
  assert.equal(
    buildActivityText({ actorName: '山田', action: 'createTeam', targetName: 'HERAC' }),
    '山田さんがチーム「HERAC」を作成しました',
  );
  assert.equal(
    buildActivityText({ actorName: '', action: 'somethingElse', targetName: '' }),
    'メンバーさんが「データ」を変更しました',
  );
});

test('currentUserLabel falls back cleanly', () => {
  assert.equal(currentUserLabel({ displayName: '  ' , email: 'chiaki@example.com' }), 'chiaki@example.com');
  assert.equal(currentUserLabel({ displayName: '  ' , email: '  ' }), 'メンバー');
});
