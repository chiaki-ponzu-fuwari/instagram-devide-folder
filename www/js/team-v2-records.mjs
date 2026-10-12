const clean = (value) => String(value ?? '').trim();
const finiteInt = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
};
const uniqueStrings = (values) => [...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))];

function assertTeamId(teamId, record) {
  const target = clean(teamId);
  if (!target) throw new Error('team-id-required');
  const embedded = clean(record?.teamId);
  if (embedded && embedded !== target) throw new Error('team-id-mismatch');
  return target;
}

function baseRecord({ id, teamId, source, actorUid, now }) {
  const recordId = clean(id);
  const actor = clean(actorUid);
  if (!recordId) throw new Error('record-id-required');
  if (!actor) throw new Error('actor-uid-required');
  return {
    id: recordId,
    teamId,
    scope: 'team',
    createdAt: Number(source?.createdAt || now) || now,
    updatedAt: Number(source?.updatedAt || now) || now,
    updatedBy: actor,
    revision: Math.max(1, finiteInt(source?.revision, 1)),
    deletedAt: source?.deletedAt == null ? null : Number(source.deletedAt) || now,
    deletedBy: source?.deletedAt == null ? null : clean(source?.deletedBy || actor),
    schemaVersion: 2,
  };
}

export function buildV2Folder({ teamId, folder = {}, actorUid, now = Date.now() }) {
  const target = assertTeamId(teamId, folder);
  return {
    ...baseRecord({ id: folder.id, teamId: target, source: folder, actorUid, now }),
    name: clean(folder.name) || 'フォルダー',
    color: clean(folder.color) || '#2F86D9',
    parentId: clean(folder.parentId) || null,
    order: finiteInt(folder.order),
    collapsed: !!folder.collapsed,
  };
}

export function buildV2Account({ teamId, account = {}, actorUid, now = Date.now() }) {
  const target = assertTeamId(teamId, account);
  return {
    ...baseRecord({ id: account.id, teamId: target, source: account, actorUid, now }),
    username: clean(account.username),
    url: clean(account.url),
    memo: clean(account.memo),
    newDM: !!account.newDM,
    folderId: clean(account.folderId) || null,
  };
}

export function buildV2Project({ teamId, accountId, project = {}, actorUid, now = Date.now() }) {
  const target = assertTeamId(teamId, project);
  const id = clean(project.id || accountId);
  const base = baseRecord({ id, teamId: target, source: project, actorUid, now });
  return {
    ...base,
    accountId: clean(accountId || project.accountId || id),
    contractType: clean(project.contractType) === 'repeat' ? 'repeat' : 'single',
    repeatParentId: clean(project.repeatParentId) || null,
    repeatClosedAt: project.repeatClosedAt == null ? null : Number(project.repeatClosedAt) || null,
    status: clean(project.status) || '相談中',
    name: clean(project.name),
    shootDate: clean(project.shootDate) || null,
    draftAt: clean(project.draftAt) || null,
    deadline: clean(project.deadline) || null,
    deliveredAt: project.deliveredAt == null ? null : project.deliveredAt,
    completedAt: project.completedAt == null ? null : project.completedAt,
    platforms: uniqueStrings(project.platforms),
    instructions: clean(project.instructions),
    tags: clean(project.tags),
    mapUrl: clean(project.mapUrl),
    assigneeUids: uniqueStrings(project.assigneeUids),
  };
}

export function buildV2Template({ teamId, template = {}, actorUid, now = Date.now() }) {
  const target = assertTeamId(teamId, template);
  return {
    ...baseRecord({ id: template.id, teamId: target, source: template, actorUid, now }),
    title: clean(template.title),
    body: clean(template.body),
  };
}

export function buildV2Settings({ teamId, settings = {}, actorUid, now = Date.now() }) {
  const target = assertTeamId(teamId, settings);
  return {
    id: 'main',
    teamId: target,
    scope: 'team',
    hideDoneProjectsInList: !!settings.hideDoneProjectsInList,
    hideRepeatClosedProjectsInRepeatList: !!settings.hideRepeatClosedProjectsInRepeatList,
    revenueBasis: ['shoot', 'deadline', 'deadlineNext', 'completed'].includes(clean(settings.revenueBasis)) ? clean(settings.revenueBasis) : 'deadline',
    createdAt: Number(settings.createdAt || now) || now,
    updatedAt: Number(settings.updatedAt || now) || now,
    updatedBy: clean(actorUid),
    revision: Math.max(1, finiteInt(settings.revision, 1)),
    schemaVersion: 2,
  };
}

export function buildRewardTotal({ projectId, project = {}, actorUid, now = Date.now() }) {
  return {
    projectId: clean(projectId),
    totalYen: finiteInt(project.rewardYen ?? project.totalYen),
    createdAt: Number(project.createdAt || now) || now,
    updatedAt: Number(project.updatedAt || now) || now,
    updatedBy: clean(actorUid),
  };
}

export function buildRewardShares({ projectId, project = {}, actorUid, now = Date.now() }) {
  const rows = Array.isArray(project.rewardAllocations) ? project.rewardAllocations : [];
  const byUid = new Map();
  for (const row of rows) {
    const memberUid = clean(row?.memberUid || row?.uid);
    if (!memberUid) continue;
    byUid.set(memberUid, {
      id: `${clean(projectId)}_${memberUid}`,
      projectId: clean(projectId),
      memberUid,
      amountYen: finiteInt(row?.amountYen ?? row?.rewardYen),
      assigned: !!row?.assigned,
      createdAt: Number(row?.createdAt || project.createdAt || now) || now,
      updatedAt: Number(row?.updatedAt || project.updatedAt || now) || now,
      updatedBy: clean(actorUid),
    });
  }
  return [...byUid.values()];
}

export function buildProjectCost({ projectId, project = {}, actorUid, now = Date.now() }) {
  const expenses = (Array.isArray(project.expenses) ? project.expenses : []).map((row, index) => ({
    id: clean(row?.id) || `expense-${index + 1}`,
    label: clean(row?.label || row?.name) || '経費',
    amountYen: finiteInt(row?.amountYen ?? row?.amount),
  }));
  const listedTotal = expenses.reduce((sum, row) => sum + row.amountYen, 0);
  return {
    projectId: clean(projectId),
    costYen: listedTotal || finiteInt(project.costYen ?? project.cost),
    expenses,
    createdAt: Number(project.createdAt || now) || now,
    updatedAt: Number(project.updatedAt || now) || now,
    updatedBy: clean(actorUid),
  };
}

export function buildV2ProjectBundle({ teamId, account = {}, actorUid, now = Date.now() }) {
  const project = account.project || {};
  const projectId = clean(project.id || account.id);
  return {
    account: buildV2Account({ teamId, account, actorUid, now }),
    project: buildV2Project({ teamId, accountId: account.id, project: { ...project, id: projectId }, actorUid, now }),
    rewardTotal: buildRewardTotal({ projectId, project, actorUid, now }),
    rewardShares: buildRewardShares({ projectId, project, actorUid, now }),
    projectCost: buildProjectCost({ projectId, project, actorUid, now }),
  };
}
