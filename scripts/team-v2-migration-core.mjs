import {
  buildProjectCost,
  buildRewardShares,
  buildRewardTotal,
  buildV2Account,
  buildV2Folder,
  buildV2Project,
  buildV2Settings,
  buildV2Template,
} from '../www/js/team-v2-records.mjs';
import {
  buildMemberEmailRecord,
  buildMemberNoteRecord,
  buildPublicMemberRecord,
} from '../www/js/team-security-model.mjs';

const clean = (value) => String(value ?? '').trim();
const rows = (collections, name) => Array.isArray(collections?.[name]) ? collections[name] : [];
const dataOf = (row) => ({ ...(row?.data || {}), id: clean(row?.data?.id || row?.id) });
const pathFor = (teamId, name, id) => `teams/${teamId}/${name}/${id}`;

function addWrite(writes, path, data) {
  writes.set(path, { path, data });
}

function addFinancialWriteIfNewer(writes, path, data) {
  const current = writes.get(path)?.data;
  if (!current || Number(data?.updatedAt || 0) >= Number(current?.updatedAt || 0)) addWrite(writes, path, data);
}

function payoutRecord(source, uid, actorUid, now) {
  const keys = [
    'payoutName', 'payoutAccount', 'payoutBankCode', 'payoutBankName',
    'payoutBranchName', 'payoutBranchCode', 'payoutAccountType', 'payoutAccountNumber',
  ];
  const data = { uid };
  for (const key of keys) data[key] = clean(source?.[key]);
  data.updatedAt = Number(source?.updatedAt || now) || now;
  data.updatedBy = actorUid;
  return data;
}

export function planTeamV2Migration({ teamId, team = {}, collections = {}, actorUid, now = Date.now() }) {
  const targetTeamId = clean(teamId);
  const actor = clean(actorUid);
  if (!targetTeamId) throw new Error('team-id-required');
  if (!actor) throw new Error('actor-uid-required');
  if (clean(team.id) && clean(team.id) !== targetTeamId) throw new Error('team-id-mismatch');
  const writes = new Map();

  for (const row of rows(collections, 'members')) {
    const source = dataOf(row);
    const uid = clean(source.uid || row.id);
    if (!uid) throw new Error('member-uid-required');
    const publicMember = buildPublicMemberRecord(source, { uid, updatedBy: actor, now });
    if (source.status === 'blocked') publicMember.status = 'blocked';
    publicMember.createdAt = Number(source.createdAt || now) || now;
    addWrite(writes, pathFor(targetTeamId, 'members', uid), publicMember);
    if (clean(source.email)) {
      addWrite(writes, pathFor(targetTeamId, 'memberEmails', uid), {
        ...buildMemberEmailRecord(source, { uid, updatedBy: actor, now }),
        createdAt: Number(source.createdAt || now) || now,
      });
    }
    if (clean(source.note)) {
      addWrite(writes, pathFor(targetTeamId, 'memberNotes', uid), {
        ...buildMemberNoteRecord(source, { uid, updatedBy: actor, now }),
        createdAt: Number(source.createdAt || now) || now,
      });
    }
    if (['payoutName', 'payoutAccount', 'payoutAccountNumber'].some((key) => clean(source[key]))) {
      addWrite(writes, pathFor(targetTeamId, 'payouts', uid), payoutRecord(source, uid, actor, now));
    }
  }

  for (const row of rows(collections, 'memberEmails')) {
    const source = dataOf(row); const uid = clean(source.uid || row.id);
    addWrite(writes, pathFor(targetTeamId, 'memberEmails', uid), {
      ...buildMemberEmailRecord(source, { uid, updatedBy: actor, now }),
      createdAt: Number(source.createdAt || now) || now,
    });
  }
  for (const row of rows(collections, 'memberNotes')) {
    const source = dataOf(row); const uid = clean(source.uid || row.id);
    addWrite(writes, pathFor(targetTeamId, 'memberNotes', uid), {
      ...buildMemberNoteRecord(source, { uid, updatedBy: actor, now }),
      createdAt: Number(source.createdAt || now) || now,
    });
  }
  for (const row of rows(collections, 'payouts')) {
    const source = dataOf(row); const uid = clean(source.uid || row.id);
    addWrite(writes, pathFor(targetTeamId, 'payouts', uid), payoutRecord(source, uid, actor, now));
  }

  for (const row of rows(collections, 'projectRewardTotals')) {
    const source = dataOf(row); const projectId = clean(source.projectId || row.id);
    addWrite(writes, pathFor(targetTeamId, 'projectRewardTotals', projectId),
      buildRewardTotal({ projectId, project: source, actorUid: actor, now }));
  }
  for (const row of rows(collections, 'projectRewardShares')) {
    const source = dataOf(row);
    const projectId = clean(source.projectId);
    const memberUid = clean(source.memberUid);
    if (!projectId || !memberUid) throw new Error('reward-share-identity-required');
    addWrite(writes, pathFor(targetTeamId, 'projectRewardShares', `${projectId}_${memberUid}`), {
      projectId, memberUid,
      amountYen: Math.max(0, Math.round(Number(source.amountYen || 0) || 0)),
      assigned: !!source.assigned,
      createdAt: Number(source.createdAt || now) || now,
      updatedAt: Number(source.updatedAt || now) || now,
      updatedBy: actor,
    });
  }
  for (const row of rows(collections, 'projectCosts')) {
    const source = dataOf(row); const projectId = clean(source.projectId || row.id);
    addWrite(writes, pathFor(targetTeamId, 'projectCosts', projectId),
      buildProjectCost({ projectId, project: source, actorUid: actor, now }));
  }

  for (const row of rows(collections, 'folders')) {
    const source = dataOf(row);
    addWrite(writes, pathFor(targetTeamId, 'folders', source.id),
      buildV2Folder({ teamId: targetTeamId, folder: source, actorUid: actor, now }));
  }
  for (const row of rows(collections, 'templates')) {
    const source = dataOf(row);
    addWrite(writes, pathFor(targetTeamId, 'templates', source.id),
      buildV2Template({ teamId: targetTeamId, template: source, actorUid: actor, now }));
  }

  const projects = new Map(rows(collections, 'projects').map((row) => {
    const source = dataOf(row);
    return [source.id, source];
  }));
  for (const row of rows(collections, 'accounts')) {
    const source = dataOf(row);
    addWrite(writes, pathFor(targetTeamId, 'accounts', source.id),
      buildV2Account({ teamId: targetTeamId, account: source, actorUid: actor, now }));
    if (source.project && typeof source.project === 'object') {
      const nested = { ...source.project, id: clean(source.project.id || source.id), accountId: source.id };
      const existing = projects.get(nested.id);
      if (!existing || Number(nested.updatedAt || 0) >= Number(existing.updatedAt || 0)) projects.set(nested.id, nested);
    }
  }

  for (const source of projects.values()) {
    const projectId = clean(source.id);
    const accountId = clean(source.accountId || projectId);
    addWrite(writes, pathFor(targetTeamId, 'projects', projectId),
      buildV2Project({ teamId: targetTeamId, accountId, project: source, actorUid: actor, now }));
    if (Object.hasOwn(source, 'rewardYen') || Object.hasOwn(source, 'totalYen')) {
      const path = pathFor(targetTeamId, 'projectRewardTotals', projectId);
      addFinancialWriteIfNewer(writes, path,
        buildRewardTotal({ projectId, project: source, actorUid: actor, now }));
    }
    if (Object.hasOwn(source, 'expenses') || Object.hasOwn(source, 'costYen') || Object.hasOwn(source, 'cost')) {
      const path = pathFor(targetTeamId, 'projectCosts', projectId);
      addFinancialWriteIfNewer(writes, path,
        buildProjectCost({ projectId, project: source, actorUid: actor, now }));
    }
    if (Array.isArray(source.rewardAllocations)) {
      const nextShareIds = new Set();
      for (const share of buildRewardShares({ projectId, project: source, actorUid: actor, now })) {
        const { id, ...data } = share;
        nextShareIds.add(id);
        addFinancialWriteIfNewer(writes, pathFor(targetTeamId, 'projectRewardShares', id), data);
      }
      for (const current of writes.values()) {
        if (!current.path.includes(`/projectRewardShares/${projectId}_`) || nextShareIds.has(current.path.split('/').pop())) continue;
        if (Number(source.updatedAt || 0) < Number(current.data.updatedAt || 0)) continue;
        current.data = {
          ...current.data,
          amountYen: 0,
          assigned: false,
          updatedAt: Number(source.updatedAt || now) || now,
          updatedBy: actor,
        };
      }
    }
  }

  const settingsRow = rows(collections, 'settings').find((row) => clean(row.id) === 'main');
  addWrite(writes, pathFor(targetTeamId, 'settings', 'main'), buildV2Settings({
    teamId: targetTeamId,
    settings: settingsRow?.data || {},
    actorUid: actor,
    now,
  }));

  return {
    teamId: targetTeamId,
    alreadyReady: Number(team.securitySchemaVersion || 0) === 2 && team.securityMigrationState === 'ready',
    writes: [...writes.values()].sort((a, b) => a.path.localeCompare(b.path)),
  };
}

export function validateMigrationPlan(plan) {
  const errors = [];
  const teamId = clean(plan?.teamId);
  const seen = new Set();
  const forbiddenPublic = ['ownerUid', 'collection', 'syncMeta', 'rewardYen', 'rewardAllocations', 'expenses', 'costYen', 'email', 'note', 'project'];
  const allowedByCollection = {
    members: ['uid', 'role', 'status', 'displayName', 'photoURL', 'createdAt', 'updatedAt', 'updatedBy'],
    memberEmails: ['uid', 'email', 'createdAt', 'updatedAt', 'updatedBy'],
    memberNotes: ['uid', 'note', 'createdAt', 'updatedAt', 'updatedBy'],
    payouts: ['uid', 'payoutName', 'payoutAccount', 'payoutBankCode', 'payoutBankName', 'payoutBranchName', 'payoutBranchCode', 'payoutAccountType', 'payoutAccountNumber', 'updatedAt', 'updatedBy'],
    projectRewardTotals: ['projectId', 'totalYen', 'createdAt', 'updatedAt', 'updatedBy'],
    projectRewardShares: ['projectId', 'memberUid', 'amountYen', 'assigned', 'createdAt', 'updatedAt', 'updatedBy'],
    projectCosts: ['projectId', 'costYen', 'expenses', 'createdAt', 'updatedAt', 'updatedBy'],
  };
  for (const write of plan?.writes || []) {
    if (!write?.path?.startsWith(`teams/${teamId}/`)) errors.push(`cross-team-path:${write?.path}`);
    if (seen.has(write.path)) errors.push(`duplicate-path:${write.path}`);
    seen.add(write.path);
    if (/\/(accounts|projects|folders|templates|settings)\//.test(write.path)) {
      for (const key of forbiddenPublic) if (Object.hasOwn(write.data || {}, key)) errors.push(`forbidden:${write.path}:${key}`);
      if (write.data?.teamId !== teamId || write.data?.schemaVersion !== 2) errors.push(`invalid-v2:${write.path}`);
    }
    if (/\/projectRewardShares\//.test(write.path)) {
      const id = write.path.split('/').pop();
      if (id !== `${write.data?.projectId}_${write.data?.memberUid}`) errors.push(`invalid-share-id:${write.path}`);
    }
    const collectionName = write.path.split('/')[2];
    const allowed = allowedByCollection[collectionName];
    if (allowed) {
      for (const key of Object.keys(write.data || {})) {
        if (!allowed.includes(key)) errors.push(`unknown-field:${write.path}:${key}`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}
