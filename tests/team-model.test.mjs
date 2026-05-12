import test from 'node:test';
import assert from 'node:assert/strict';
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
} from '../www/js/team-model.mjs';

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
});
