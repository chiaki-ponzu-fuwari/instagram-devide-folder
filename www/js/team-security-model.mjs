export const TEAM_SECURITY_SCHEMA_VERSION = 2;

export function resolveTeamSecurityState(team = {}) {
  return team?.securitySchemaVersion === TEAM_SECURITY_SCHEMA_VERSION
    && team?.securityMigrationState === 'ready'
    ? 'ready'
    : 'locked';
}

export function resolveTeamWorkspaceAccess({ team = {}, member, uid } = {}) {
  if (!uid || !member?.uid || member.uid !== uid || member.status !== 'active') {
    return 'denied';
  }

  if (member.role === 'admin' || team?.createdBy === uid) {
    return 'admin';
  }

  return resolveTeamSecurityState(team) === 'ready' ? 'member' : 'locked';
}
