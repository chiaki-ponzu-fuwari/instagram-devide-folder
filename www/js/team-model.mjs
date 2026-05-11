export function cleanString(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
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
