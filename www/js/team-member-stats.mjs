const clean = (value) => String(value ?? '').trim();

function timestampToDate(value) {
  if (value instanceof Date) return value;
  if (value && typeof value.toDate === 'function') return value.toDate();
  if (value && typeof value.toMillis === 'function') return new Date(value.toMillis());
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string' && value) return new Date(value);
  return null;
}

function monthKeyInTimeZone(value, timeZone) {
  const date = timestampToDate(value);
  if (!date || Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value || '';
  const month = parts.find((part) => part.type === 'month')?.value || '';
  return year && month ? `${year}-${month}` : '';
}

function isCompleted(status) {
  return ['終了', '完了', 'completed', 'done'].includes(clean(status).toLowerCase());
}

export function getTeamMemberProjectStats(records, { monthKey, timeZone = 'Asia/Tokyo' } = {}) {
  const stats = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const project = record?.project || record || {};
    const assignees = [...new Set((Array.isArray(project.assigneeUids) ? project.assigneeUids : []).map(clean).filter(Boolean))];
    if (!assignees.length) continue;
    const completed = isCompleted(project.status);
    const completedThisMonth = completed && monthKeyInTimeZone(project.completedAt, timeZone) === clean(monthKey);
    for (const uid of assignees) {
      const current = stats.get(uid) || { inProgress: 0, completedThisMonth: 0 };
      if (!completed) current.inProgress += 1;
      else if (completedThisMonth) current.completedThisMonth += 1;
      stats.set(uid, current);
    }
  }
  return stats;
}
