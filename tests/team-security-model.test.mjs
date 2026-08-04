import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TEAM_SECURITY_SCHEMA_VERSION,
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
