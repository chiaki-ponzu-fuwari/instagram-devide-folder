import { deriveActivityIdentityUids } from '../www/js/activity-identity.mjs';

const TARGET_PERSON_ACTIONS = new Set(['removeMember', 'approveMember', 'rejectMember']);
const clean = (value) => typeof value === 'string' ? value.trim() : '';

export function planActivityIdentityMigration({ teamId, activities = [], members = [] }) {
  const targetTeamId = clean(teamId);
  if (!targetTeamId) throw new Error('team-id-required');
  const membersByName = new Map();
  for (const row of members) {
    const uid = clean(row?.data?.uid || row?.id);
    const name = clean(row?.data?.displayName || row?.data?.name);
    if (!uid || !name) continue;
    const matches = membersByName.get(name) || [];
    matches.push(uid);
    membersByName.set(name, matches);
  }
  const writes = [];
  const report = { ambiguous: [], unresolved: [] };
  for (const row of activities) {
    const id = clean(row?.id);
    if (!id) throw new Error('activity-id-required');
    const data = row?.data || {};
    const path = `teams/${targetTeamId}/activity/${id}`;
    let targetUid = clean(data.targetUid || data.memberUid);
    const needsTarget = TARGET_PERSON_ACTIONS.has(data.action) && !targetUid;
    if (needsTarget) {
      const matches = membersByName.get(clean(data.targetName || data.memberName)) || [];
      if (matches.length === 1) targetUid = matches[0];
      else report[matches.length > 1 ? 'ambiguous' : 'unresolved'].push(path);
    }
    const patch = {};
    if (targetUid && !clean(data.targetUid) && !clean(data.memberUid)) patch.targetUid = targetUid;
    const identityUids = deriveActivityIdentityUids({ ...data, ...patch });
    if (JSON.stringify(data.identityUids) !== JSON.stringify(identityUids)) patch.identityUids = identityUids;
    if (Object.keys(patch).length) writes.push({ path, data: patch });
  }
  return { teamId: targetTeamId, writes, report };
}
