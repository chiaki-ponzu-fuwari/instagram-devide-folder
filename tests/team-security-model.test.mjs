import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TEAM_SECURITY_SCHEMA_VERSION,
  buildMemberEmailRecord,
  buildMemberNoteRecord,
  buildPublicMemberRecord,
  normalizeTeamSecuritySettings,
  resolveTeamSecurityState,
  resolveTeamWorkspaceAccess,
} from '../www/js/team-security-model.mjs';

test('team security state is locked when the migration state is missing', () => {
  assert.equal(TEAM_SECURITY_SCHEMA_VERSION, 2);
  assert.equal(resolveTeamSecurityState({}), 'locked');
});

test('team security state is ready only after the required migration', () => {
  assert.equal(resolveTeamSecurityState({
    securitySchemaVersion: 2,
    securityMigrationState: 'ready',
  }), 'ready');
});

test('team security state reports an in-progress migration without granting access', () => {
  assert.equal(resolveTeamSecurityState({
    securitySchemaVersion: 2,
    securityMigrationState: 'migrating',
  }), 'migrating');
  assert.equal(resolveTeamSecurityState({
    securitySchemaVersion: 1,
    securityMigrationState: 'ready',
  }), 'locked');
});

test('unknown security settings normalize to restrictive canonical values', () => {
  assert.deepEqual(normalizeTeamSecuritySettings({
    settings: {
      rewardVisibility: 'unexpected',
      assignPermission: 'unexpected',
      assignOwners: ['member-1', '', 'member-1', 42],
      deletePermission: 'unexpected',
      memberEmailVisibility: 'unexpected',
      memberNoteVisibility: 'unexpected',
      memberPayoutVisibility: 'unexpected',
    },
  }), {
    rewardVisibility: 'self',
    assignPermission: 'admin_only',
    assignOwnerUids: ['member-1'],
    deletePermission: 'admin_only',
    memberEmailVisibility: 'admin_only',
    memberNoteVisibility: 'admin_only',
    memberPayoutVisibility: 'admin_only',
  });
});

test('member projection keeps email and note out of the public document', () => {
  const source = {
    uid: 'member-1',
    role: 'member',
    status: 'active',
    displayName: 'メンバー',
    photoURL: 'https://example.com/member.png',
    email: 'member@example.com',
    note: 'private note',
    payoutAccount: 'private payout',
  };
  const context = { uid: 'member-1', updatedBy: 'admin-1', now: 100 };

  assert.deepEqual(buildPublicMemberRecord(source, context), {
    uid: 'member-1',
    role: 'member',
    status: 'active',
    displayName: 'メンバー',
    photoURL: 'https://example.com/member.png',
    updatedAt: 100,
    updatedBy: 'admin-1',
  });
  assert.deepEqual(buildMemberEmailRecord(source, context), {
    uid: 'member-1',
    email: 'member@example.com',
    updatedAt: 100,
    updatedBy: 'admin-1',
  });
  assert.deepEqual(buildMemberNoteRecord(source, context), {
    uid: 'member-1',
    note: 'private note',
    updatedAt: 100,
    updatedBy: 'admin-1',
  });
});

test('team creator retains migration access before a member document exists', () => {
  assert.equal(resolveTeamWorkspaceAccess({
    team: { createdBy: 'creator-1' },
    member: null,
    uid: 'creator-1',
  }), 'admin');
});

test('active normal members remain locked before the migration is ready', () => {
  assert.equal(resolveTeamWorkspaceAccess({
    team: {},
    member: { uid: 'member-1', role: 'member', status: 'active' },
    uid: 'member-1',
  }), 'locked');
});

test('active admins can access a locked team workspace', () => {
  assert.equal(resolveTeamWorkspaceAccess({
    team: {},
    member: { uid: 'admin-1', role: 'admin', status: 'active' },
    uid: 'admin-1',
  }), 'admin');
});

test('migration in progress blocks workspace writes for admins too', () => {
  assert.equal(resolveTeamWorkspaceAccess({
    team: { securitySchemaVersion: 2, securityMigrationState: 'migrating' },
    member: { uid: 'admin-1', role: 'admin', status: 'active' },
    uid: 'admin-1',
  }), 'locked');
});

test('active normal members can access a ready team workspace', () => {
  assert.equal(resolveTeamWorkspaceAccess({
    team: { securitySchemaVersion: 2, securityMigrationState: 'ready' },
    member: { uid: 'member-1', role: 'member', status: 'active' },
    uid: 'member-1',
  }), 'member');
});

test('workspace access is denied when the caller UID is missing', () => {
  assert.equal(resolveTeamWorkspaceAccess({
    team: {},
    member: { uid: 'member-1', role: 'member', status: 'active' },
  }), 'denied');
});

test('workspace access is denied when the member UID is missing', () => {
  assert.equal(resolveTeamWorkspaceAccess({
    team: {},
    member: { role: 'admin', status: 'active' },
  }), 'denied');
});
