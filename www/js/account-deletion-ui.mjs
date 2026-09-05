const LOCAL_DATA_KEYS = Object.freeze([
  'ig_dm_mgr_v1',
  'dm-manager-team-workspace-cache-v1',
]);
const USER_DATA_KEY_PREFIXES = Object.freeze([
  'ig_dm_personal_reward_teams_v1:',
  'dm-team-mutations-v2:',
]);
const DATA_FILE = 'dm-manager-data.json';
const BACKUP_DIR = 'backups';

export class AccountDeletionUiError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AccountDeletionUiError';
    this.code = code;
  }
}

function fail(code) {
  throw new AccountDeletionUiError(code);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function confirmPhrase(language) {
  return language === 'en' ? 'DELETE' : '削除';
}

function createRequestId() {
  const random = globalThis.crypto?.randomUUID?.().replaceAll('-', '');
  if (random) return `request_${random}`;
  return `request_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}

function decisionsComplete(teams, decisions) {
  const byTeam = new Map(decisions.map((decision) => [decision.teamId, decision]));
  return teams.every((team) => {
    const decision = byTeam.get(team.teamId);
    if (team.requiredAction === 'leave') return decision?.action === 'leave';
    if (team.requiredAction === 'dissolve') return decision?.action === 'dissolve';
    if (team.requiredAction !== 'admin-choice') return false;
    if (decision?.action === 'dissolve') return true;
    return decision?.action === 'transfer'
      && (team.eligibleSuccessors || []).some((member) => member.uid === decision.transferToUid);
  });
}

export function createDeletionFormState({ plan = {}, language = 'ja', requestIdFactory = createRequestId } = {}) {
  const teams = Array.isArray(plan.teams) ? clone(plan.teams) : [];
  const isResume = typeof plan.resumeRequestId === 'string' && plan.resumeRequestId.length > 0;
  const teamDecisions = isResume
    ? clone(Array.isArray(plan.teamDecisions) ? plan.teamDecisions : [])
    : teams.filter((team) => team.requiredAction === 'leave').map((team) => ({ teamId: team.teamId, action: 'leave' }));
  return {
    language: language === 'en' ? 'en' : 'ja',
    teams,
    teamDecisions,
    choicesComplete: isResume || decisionsComplete(teams, teamDecisions),
    typedConfirmation: '',
    localDataChoice: 'keep',
    requestId: isResume ? plan.resumeRequestId : requestIdFactory(),
    isResume,
  };
}

export function setTeamDecision(state, teamId, action, transferToUid = '') {
  const team = state.teams.find((entry) => entry.teamId === teamId);
  if (!team || team.requiredAction === 'leave') fail('invalid-team-decision');
  let decision;
  if ((team.requiredAction === 'dissolve' || team.requiredAction === 'admin-choice') && action === 'dissolve') {
    decision = { teamId, action };
  } else if (team.requiredAction === 'admin-choice' && action === 'transfer') {
    if (!(team.eligibleSuccessors || []).some((member) => member.uid === transferToUid)) fail('invalid-successor');
    decision = { teamId, action, transferToUid };
  } else {
    fail('invalid-team-decision');
  }
  const teamDecisions = state.teamDecisions.filter((entry) => entry.teamId !== teamId);
  teamDecisions.push(decision);
  return { ...state, teamDecisions, choicesComplete: decisionsComplete(state.teams, teamDecisions) };
}

export function clearTeamDecision(state, teamId) {
  const team = state.teams.find((entry) => entry.teamId === teamId);
  if (!team || team.requiredAction === 'leave') fail('invalid-team-decision');
  const teamDecisions = state.teamDecisions.filter((entry) => entry.teamId !== teamId);
  return { ...state, teamDecisions, choicesComplete: decisionsComplete(state.teams, teamDecisions) };
}

export function buildDeletionRequest(state) {
  if (!state?.choicesComplete) fail('team-decisions-required');
  if (state.typedConfirmation !== confirmPhrase(state.language)) fail('confirmation-required');
  if (!['keep', 'erase'].includes(state.localDataChoice)) fail('local-data-choice-required');
  return { requestId: state.requestId, teamDecisions: clone(state.teamDecisions) };
}

function fileName(entry) {
  return typeof entry === 'string' ? entry : String(entry?.name || entry?.path || '');
}

export async function clearScopedLocalData({ storage, filesystem, uid } = {}) {
  const failures = [];
  for (const key of [...LOCAL_DATA_KEYS, ...USER_DATA_KEY_PREFIXES.map((prefix) => `${prefix}${uid}`)]) {
    try { storage?.removeItem?.(key); } catch { failures.push(key); }
  }
  if (filesystem) {
    try {
      await filesystem.deleteFile({ path: DATA_FILE, directory: 'DOCUMENTS' });
    } catch (error) {
      const text = String(error?.message || error || '').toLowerCase();
      if (!text.includes('not found') && !text.includes('does not exist')) failures.push(DATA_FILE);
    }
    let backups = [];
    try {
      const result = await filesystem.readdir({ path: BACKUP_DIR, directory: 'DOCUMENTS' });
      backups = (result?.files || []).map(fileName).filter((name) => name.toLowerCase().endsWith('.json'));
    } catch (error) {
      const text = String(error?.message || error || '').toLowerCase();
      if (!text.includes('not found') && !text.includes('does not exist')) failures.push(BACKUP_DIR);
    }
    for (const name of backups) {
      try {
        await filesystem.deleteFile({ path: `${BACKUP_DIR}/${name}`, directory: 'DOCUMENTS' });
      } catch {
        failures.push(`${BACKUP_DIR}/${name}`);
      }
    }
  }
  if (failures.length) fail('local-data-clear-failed');
}

export function createAccountDeletionFlow(deps) {
  let running = false;
  async function load(language = 'ja') {
    let plan;
    try {
      plan = await deps.fetchPlan();
    } catch (error) {
      if (error?.code !== 'reauthentication-required') throw error;
      await deps.reauthenticate();
      plan = await deps.fetchPlan();
    }
    return createDeletionFormState({ plan, language, requestIdFactory: deps.createRequestId || createRequestId });
  }
  async function execute(state) {
    if (running) fail('deletion-in-progress');
    const request = buildDeletionRequest(state);
    running = true;
    try {
      const proof = await deps.reauthenticate();
      await deps.deleteAccount(request);
      let localData = 'kept';
      if (state.localDataChoice === 'erase') {
        try {
          await deps.clearLocalData();
          localData = 'erased';
        } catch {
          localData = 'erase-failed';
        }
      }
      try {
        await deps.signOut();
      } catch {
        fail('sign-out-failed');
      }
      return { cloudDeleted: true, localData, providerId: proof?.providerId || '' };
    } finally {
      running = false;
    }
  }
  return { load, execute, isRunning: () => running };
}
