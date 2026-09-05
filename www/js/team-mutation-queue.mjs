const clean = (value) => String(value ?? '').trim();

export function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

export function shouldApplyProjectMutation({ current, mutation }) {
  const type = clean(mutation?.type);
  if (current?.deletedAt != null && type !== 'undo') return { apply: false, reason: 'project-deleted' };
  const currentRevision = Number(current?.revision || 0) || 0;
  const baseRevision = Number(mutation?.baseRevision || 0) || 0;
  if (current && baseRevision < currentRevision) return { apply: false, reason: 'stale-revision' };
  return { apply: true, reason: 'ok' };
}

export function createTeamMutationQueue({ storage, uid }) {
  if (!storage?.getItem || !storage?.setItem) throw new Error('storage-required');
  const ownerUid = clean(uid);
  if (!ownerUid) throw new Error('uid-required');
  const key = `dm-team-mutations-v2:${ownerUid}`;
  const read = () => {
    try {
      const parsed = JSON.parse(storage.getItem(key) || '[]');
      return Array.isArray(parsed) ? parsed.filter((row) => clean(row?.operationId)) : [];
    } catch {
      return [];
    }
  };
  const write = (rows) => storage.setItem(key, JSON.stringify(rows));
  return {
    enqueue(operation) {
      const operationId = clean(operation?.operationId);
      if (!operationId) throw new Error('operation-id-required');
      const rows = read().filter((row) => clean(row.operationId) !== operationId);
      rows.push(JSON.parse(JSON.stringify(operation)));
      write(rows);
      return operation;
    },
    list() {
      return read().map((row) => JSON.parse(JSON.stringify(row)));
    },
    remove(operationId) {
      const id = clean(operationId);
      const rows = read().filter((row) => clean(row.operationId) !== id);
      if (rows.length) write(rows);
      else storage.removeItem(key);
    },
    replace(operations) {
      const byId = new Map();
      for (const operation of Array.isArray(operations) ? operations : []) {
        const id = clean(operation?.operationId);
        if (id) byId.set(id, JSON.parse(JSON.stringify(operation)));
      }
      const rows = [...byId.values()];
      if (rows.length) write(rows);
      else storage.removeItem(key);
    },
  };
}
