export const TEAM_SECURITY_SCHEMA_VERSION = 2;

function cleanString(value) {
  return String(value ?? '').trim();
}

function normalizeVisibility(value, allowed, fallback) {
  const normalized = cleanString(value);
  return allowed.includes(normalized) ? normalized : fallback;
}

export function normalizeTeamSecuritySettings(team = {}) {
  const settings = team?.settings && typeof team.settings === 'object' ? team.settings : {};
  const rewardRaw = cleanString(settings.rewardVisibility || team?.rewardVisibility);
  const rewardVisibility = rewardRaw === 'all' || rewardRaw === 'all_members'
    ? 'all'
    : rewardRaw === 'self_plus_total'
      ? 'self_plus_total'
      : 'self';
  const assignSource = Array.isArray(settings.assignOwnerUids)
    ? settings.assignOwnerUids
    : (Array.isArray(settings.assignOwners) ? settings.assignOwners : []);
  const assignOwnerUids = [...new Set(
    assignSource
      .filter((uid) => typeof uid === 'string')
      .map(cleanString)
      .filter(Boolean),
  )];

  return {
    rewardVisibility,
    assignPermission: normalizeVisibility(settings.assignPermission, ['admin_only', 'owner_set'], 'admin_only'),
    assignOwnerUids,
    deletePermission: normalizeVisibility(settings.deletePermission, ['admin_only', 'all_edit'], 'admin_only'),
    memberEmailVisibility: normalizeVisibility(settings.memberEmailVisibility, ['admin_only', 'all_members'], 'admin_only'),
    memberNoteVisibility: normalizeVisibility(settings.memberNoteVisibility, ['admin_only', 'all_members'], 'admin_only'),
    memberPayoutVisibility: normalizeVisibility(settings.memberPayoutVisibility, ['admin_only', 'all_members'], 'admin_only'),
  };
}

export function resolveTeamSecurityState(team = {}) {
  const state = cleanString(team?.securityMigrationState);
  if (Number(team?.securitySchemaVersion || 0) === TEAM_SECURITY_SCHEMA_VERSION && state === 'ready') {
    return 'ready';
  }
  if (state === 'migrating') return 'migrating';
  return 'locked';
}

export function resolveTeamWorkspaceAccess({ team, member, uid } = {}) {
  const currentUid = cleanString(uid);
  if (!team || !currentUid) return 'denied';
  const isCreator = cleanString(team.createdBy) === currentUid;
  const isActive = cleanString(member?.uid) === currentUid && member?.status === 'active';
  const isAdmin = isActive && member?.role === 'admin';
  if (resolveTeamSecurityState(team) === 'migrating') return 'locked';
  if (isCreator || isAdmin) return 'admin';
  if (!isActive) return 'denied';
  return resolveTeamSecurityState(team) === 'ready' ? 'member' : 'locked';
}

export function buildPublicMemberRecord(input = {}, { uid, updatedBy, now = Date.now() } = {}) {
  const targetUid = cleanString(input.uid || uid);
  return {
    uid: targetUid,
    role: input.role === 'admin' ? 'admin' : 'member',
    status: input.status === 'active' ? 'active' : 'pending',
    displayName: cleanString(input.displayName) || 'メンバー',
    photoURL: cleanString(input.photoURL),
    updatedAt: Number(now) || Date.now(),
    updatedBy: cleanString(updatedBy || targetUid),
  };
}

export function buildMemberEmailRecord(input = {}, { uid, updatedBy, now = Date.now() } = {}) {
  const targetUid = cleanString(input.uid || uid);
  return {
    uid: targetUid,
    email: cleanString(input.email),
    updatedAt: Number(now) || Date.now(),
    updatedBy: cleanString(updatedBy || targetUid),
  };
}

export function buildMemberNoteRecord(input = {}, { uid, updatedBy, now = Date.now() } = {}) {
  const targetUid = cleanString(input.uid || uid);
  return {
    uid: targetUid,
    note: cleanString(input.note),
    updatedAt: Number(now) || Date.now(),
    updatedBy: cleanString(updatedBy || targetUid),
  };
}
