(function exposeProjectListSort(root) {
  const LEGACY_STATUS_MAP = { 決定済み: '契約中', 保留中: '納品済', 終了済: '終了' };
  const STATUS_GRP_ORDER = ['相談中', '契約中', '納品済', '終了'];
  const PRI_ORDER = { 高: 0, 中: 1, 低: 2 };

  function normalizeStatus(status) {
    const value = String(status ?? '').trim();
    if (!value) return null;
    return LEGACY_STATUS_MAP[value] || value;
  }

  function isDoneAccount(account) {
    return normalizeStatus(account?.project?.status) === '終了';
  }

  function comparePinFirst(a, b) {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return 0;
  }

  function compareCreatedDesc(a, b) {
    return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
  }

  function parseProjectDate(value) {
    if (value == null) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number') {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof value === 'object') {
      if (typeof value.toDate === 'function') {
        try {
          const date = value.toDate();
          return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
        } catch {
          return null;
        }
      }
      const sec = value.seconds ?? value._seconds;
      if (typeof sec === 'number' && Number.isFinite(sec)) {
        const date = new Date(sec * 1000);
        return Number.isNaN(date.getTime()) ? null : date;
      }
    }
    const text = String(value).trim();
    if (!text) return null;
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (iso) {
      const date = new Date(
        Number(iso[1]),
        Number(iso[2]) - 1,
        Number(iso[3]),
        Number(iso[4]),
        Number(iso[5]),
        iso[6] ? Number(iso[6]) : 0,
      );
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) {
      const date = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 12, 0, 0);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const slash = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?/);
    if (slash) {
      const date = new Date(
        Number(slash[1]),
        Number(slash[2]) - 1,
        Number(slash[3]),
        slash[4] ? Number(slash[4]) : 12,
        slash[5] ? Number(slash[5]) : 0,
        0,
      );
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function rewardSortValue(project) {
    const raw = project?.rewardYen;
    if (raw == null || raw === '') return -1;
    const normalized = typeof raw === 'string' ? raw.replace(/[^\d.-]/g, '') : raw;
    const value = Number(normalized);
    return Number.isFinite(value) ? Math.max(0, value) : -1;
  }

  function compareByDateField(field, a, b) {
    const da = parseProjectDate(a?.project?.[field]);
    const db = parseProjectDate(b?.project?.[field]);
    if (!da && !db) return compareCreatedDesc(a, b);
    if (!da) return 1;
    if (!db) return -1;
    const diff = da.getTime() - db.getTime();
    if (diff !== 0) return diff;
    return String(a.username || '').localeCompare(String(b.username || ''), 'ja');
  }

  function compareWithinPartition(a, b, mode) {
    const pin = comparePinFirst(a, b);
    if (pin) return pin;

    switch (String(mode || 'priority').trim()) {
      case 'reward': {
        const diff = rewardSortValue(b?.project) - rewardSortValue(a?.project);
        return diff !== 0 ? diff : compareCreatedDesc(a, b);
      }
      case 'newest':
        return compareCreatedDesc(a, b);
      case 'shoot':
        return compareByDateField('shootDate', a, b);
      case 'deadline':
        return compareByDateField('deadline', a, b);
      case 'status': {
        const sa = normalizeStatus(a?.project?.status) ?? '';
        const sb = normalizeStatus(b?.project?.status) ?? '';
        const oa = STATUS_GRP_ORDER.indexOf(sa);
        const ob = STATUS_GRP_ORDER.indexOf(sb);
        const ra = oa === -1 ? STATUS_GRP_ORDER.length : oa;
        const rb = ob === -1 ? STATUS_GRP_ORDER.length : ob;
        if (ra !== rb) return ra - rb;
        return compareCreatedDesc(a, b);
      }
      case 'priority':
      default: {
        const pa = PRI_ORDER[a?.priority] ?? 3;
        const pb = PRI_ORDER[b?.priority] ?? 3;
        if (pa !== pb) return pa - pb;
        return compareCreatedDesc(a, b);
      }
    }
  }

  function partitionOpenAndDone(accounts) {
    const open = [];
    const done = [];
    (Array.isArray(accounts) ? accounts : []).forEach((account) => {
      if (isDoneAccount(account)) done.push(account);
      else open.push(account);
    });
    return { open, done };
  }

  function sortPartition(accounts, mode) {
    return [...(Array.isArray(accounts) ? accounts : [])].sort((a, b) => compareWithinPartition(a, b, mode));
  }

  function sortAccountsForDisplay(accounts, mode) {
    const { open, done } = partitionOpenAndDone(accounts);
    const sortedOpen = sortPartition(open, mode);
    const sortedDone = sortPartition(done, mode);
    return {
      open: sortedOpen,
      done: sortedDone,
      ordered: [...sortedOpen, ...sortedDone],
    };
  }

  function sortAccountsByReward(accounts) {
    return sortAccountsForDisplay(accounts, 'reward').ordered;
  }

  const api = {
    normalizeStatus,
    isDoneAccount,
    parseProjectDate,
    rewardSortValue,
    sortAccountsByReward,
    sortAccountsForDisplay,
    sortPartition,
    partitionOpenAndDone,
    STATUS_GRP_ORDER,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DMProjectListSort = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
