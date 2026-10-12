export const SUPPORT_EMAIL = 'herac.7.app@gmail.com';
export const REVIEW_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
export const UPDATE_SNOOZE_MS = 24 * 60 * 60 * 1000;

const FEEDBACK_CATEGORY_LABELS = {
  bug: '不具合報告',
  request: '機能リクエスト',
  other: 'その他',
};

export function nextReviewRequestAt(now) {
  return Number(now || 0) + REVIEW_RETRY_MS;
}

export function shouldRequestReview({ projectCount, hasCompletedProject, now, state }) {
  const nextAt = Number(state?.nextReviewRequestAt || 0);
  if (nextAt && Number(now || 0) < nextAt) return false;
  return Number(projectCount || 0) >= 3 || !!hasCompletedProject;
}

export function buildFeedbackMail({ category, message, appVersion, platform }) {
  const label = FEEDBACK_CATEGORY_LABELS[category] || FEEDBACK_CATEGORY_LABELS.other;
  const body = [
    `種別: ${label}`,
    `アプリ版: ${String(appVersion || '不明')}`,
    `端末: ${String(platform || '不明')}`,
    '',
    '内容:',
    String(message || '').trim(),
  ].join('\n');
  return {
    to: SUPPORT_EMAIL,
    subject: `【DM管理】${label}`,
    body,
  };
}

function versionParts(value) {
  return String(value || '0').split('.').map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
}

export function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff > 0) return 1;
    if (diff < 0) return -1;
  }
  return 0;
}

export function shouldShowUpdate({ currentVersion, release, now, state }) {
  const latestVersion = String(release?.latestVersion || '').trim();
  const url = String(release?.appStoreUrl || '').trim();
  const snoozedUntil = Number(state?.updateSnoozedUntil || 0);
  if (!latestVersion || !url || Number(now || 0) < snoozedUntil) return false;
  return compareVersions(latestVersion, currentVersion) > 0;
}

export function isRequiredUpdate({ currentVersion, release }) {
  const minimumVersion = String(release?.minimumVersion || '').trim();
  return !!minimumVersion && compareVersions(currentVersion, minimumVersion) < 0;
}
