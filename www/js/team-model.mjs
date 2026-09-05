export function cleanString(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function cloneRecord(value) {
  if (value == null) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function buildTeamAccountRecord(account, { teamId, updatedBy, now = Date.now() } = {}) {
  const source = cloneRecord(account || {});
  const id = cleanString(source.id);
  const targetTeamId = cleanString(teamId, cleanString(source?.project?.teamId));
  if (!id || !targetTeamId || !source.project) throw new Error('invalid-team-account');
  delete source.ownerUid;
  return {
    ...source,
    id,
    teamId: targetTeamId,
    project: {
      ...source.project,
      scope: 'team',
      teamId: targetTeamId,
    },
    updatedAt: Number(now) || Date.now(),
    updatedBy: cleanString(updatedBy),
  };
}

export function mergeTeamAccounts(localAccounts = [], cloudAccounts = [], teamId = '') {
  const targetTeamId = cleanString(teamId);
  const result = (Array.isArray(localAccounts) ? localAccounts : []).map(cloneRecord);
  if (!targetTeamId) return result;

  const indexes = new Map();
  result.forEach((record, index) => {
    if (cleanString(record?.project?.scope, 'personal') !== 'team') return;
    if (cleanString(record?.project?.teamId) !== targetTeamId) return;
    const id = cleanString(record?.id);
    if (id) indexes.set(id, index);
  });

  (Array.isArray(cloudAccounts) ? cloudAccounts : []).forEach((record) => {
    if (cleanString(record?.project?.scope) !== 'team') return;
    if (cleanString(record?.project?.teamId) !== targetTeamId) return;
    const id = cleanString(record?.id);
    if (!id) return;
    const index = indexes.get(id);
    if (index == null) {
      indexes.set(id, result.length);
      result.push(cloneRecord(record));
      return;
    }
    const localUpdatedAt = Number(result[index]?.updatedAt || 0) || 0;
    const cloudUpdatedAt = Number(record?.updatedAt || 0) || 0;
    if (cloudUpdatedAt >= localUpdatedAt) result[index] = cloneRecord(record);
  });
  return result;
}

export function findMissingTeamAccounts(localAccounts = [], cloudAccounts = [], teamId = '') {
  const targetTeamId = cleanString(teamId);
  if (!targetTeamId) return [];
  const cloudIds = new Set(
    (Array.isArray(cloudAccounts) ? cloudAccounts : [])
      .filter((record) => (
        cleanString(record?.project?.scope) === 'team'
        && cleanString(record?.project?.teamId) === targetTeamId
      ))
      .map((record) => cleanString(record?.id))
      .filter(Boolean),
  );
  return (Array.isArray(localAccounts) ? localAccounts : [])
    .filter((record) => (
      cleanString(record?.project?.scope) === 'team'
      && cleanString(record?.project?.teamId) === targetTeamId
      && !!cleanString(record?.id)
      && !cloudIds.has(cleanString(record.id))
    ))
    .map(cloneRecord);
}

export function shouldMigrateTeamAccounts({ isAdmin, fromCache, alreadyMigrated } = {}) {
  return !!isAdmin && fromCache === false && !alreadyMigrated;
}

export function normalizeMemberRecord(input, ctx) {
  const now = Number(ctx?.now || 0);
  const uid = cleanString(input?.uid, cleanString(ctx?.uid));
  const role = cleanString(input?.role, 'member');
  const status = cleanString(input?.status, 'pending');
  const displayName = cleanString(input?.displayName, cleanString(input?.email, 'メンバー'));
  const joinedAt = Number(input?.joinedAt || input?.createdAt || now);

  return {
    ...input,
    uid,
    role,
    status,
    displayName,
    joinedAt,
    updatedAt: Number(input?.updatedAt || now),
  };
}

export function normalizeTeamRecord(input, ctx) {
  const now = Number(ctx?.now || Date.now());
  const uid = cleanString(ctx?.uid);
  const id = cleanString(input?.id);
  const name = cleanString(input?.name, 'チーム');
  const createdBy = cleanString(input?.createdBy, uid);

  return {
    ...input,
    id,
    name,
    createdBy,
    updatedBy: uid || cleanString(input?.updatedBy, createdBy),
    createdAt: Number(input?.createdAt || now),
    updatedAt: now,
    deletedAt: input?.deletedAt ?? null,
    deletedBy: input?.deletedBy ?? null,
  };
}

export function canUseTeamRecord(record) {
  return !!record && record.deletedAt == null;
}

export function isActiveMember(member) {
  return member?.status === 'active';
}

export function isTeamAdmin(member) {
  return isActiveMember(member) && member?.role === 'admin';
}

export function canReadTeam(member) {
  return isActiveMember(member);
}

export function canApproveJoinRequest(member) {
  return isTeamAdmin(member);
}

export function resolveRewardVisibility(team) {
  const value = cleanString(team?.rewardVisibility, 'admin_only');
  if (value === 'selected_members') return 'selected_members';
  if (value === 'all_members') return 'all_members';
  if (value === 'all') return 'all_members';
  if (value === 'self' || value === 'self_plus_total') return 'admin_only';
  if (value === 'admin_only') return 'admin_only';
  return 'admin_only';
}

export function buildActivityText({ actorName, action, targetName }) {
  const actor = cleanString(actorName, 'メンバー');
  const target = cleanString(targetName, 'データ');
  if (action === 'createTeam') return `${actor}さんがチーム「${target}」を作成しました`;
  if (action === 'joinTeam') return `${actor}さんがチームに参加しました`;
  if (action === 'createProject') return `${actor}さんが「${target}」を追加しました`;
  if (action === 'markDelivered') return `${actor}さんが「${target}」を納品済みに変更しました`;
  if (action === 'markCompleted') return `${actor}さんが「${target}」を終了済みに変更しました`;
  if (action === 'deleteProject') return `${actor}さんが「${target}」を削除しました`;
  if (action === 'updateRecord') return `${actor}さんが「${target}」を更新しました`;
  if (action === 'deleteRecord') return `${actor}さんが「${target}」を削除しました`;
  return `${actor}さんが「${target}」を変更しました`;
}

export function currentUserLabel(user) {
  return cleanString(user?.displayName, cleanString(user?.email, 'メンバー'));
}
