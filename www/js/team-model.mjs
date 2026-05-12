export function cleanString(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

export function normalizeMemberRecord(input, ctx) {
  const now = Number(ctx?.now || Date.now());
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
  if (value === 'self' || value === 'self_plus_total' || value === 'admin_only') return 'admin_only';
  return 'admin_only';
}

export function buildActivityText({ actorName, action, targetName }) {
  const actor = cleanString(actorName, 'メンバー');
  const target = cleanString(targetName, 'データ');
  if (action === 'createTeam') return `${actor}さんがチーム「${target}」を作成しました`;
  if (action === 'joinTeam') return `${actor}さんがチームに参加しました`;
  if (action === 'updateRecord') return `${actor}さんが「${target}」を更新しました`;
  if (action === 'deleteRecord') return `${actor}さんが「${target}」を削除しました`;
  return `${actor}さんが「${target}」を変更しました`;
}

export function currentUserLabel(user) {
  return cleanString(user?.displayName, cleanString(user?.email, 'メンバー'));
}
