import {
  addDoc,
  collection,
  collectionGroup,
  doc,
  deleteField,
  getDoc,
  getDocs,
  arrayUnion,
  arrayRemove,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseCore } from './firestore-core.mjs';
import { deriveActivityIdentityUids } from './activity-identity.mjs';
import { buildActivityText, currentUserLabel, normalizeTeamRecord } from './team-model.mjs';
import {
  buildMemberEmailRecord,
  buildPublicMemberRecord,
  normalizeTeamSecuritySettings,
} from './team-security-model.mjs';

function requireUser(user) {
  if (!user?.uid) throw new Error('login-required');
  return user;
}

function teamRef(db, teamId) {
  return doc(db, 'teams', teamId);
}

function memberRef(db, teamId, uid) {
  return doc(db, 'teams', teamId, 'members', uid);
}

function memberEmailRef(db, teamId, uid) {
  return doc(db, 'teams', teamId, 'memberEmails', uid);
}

function memberNoteRef(db, teamId, uid) {
  return doc(db, 'teams', teamId, 'memberNotes', uid);
}

function payoutRef(db, teamId, uid) {
  return doc(db, 'teams', teamId, 'payouts', uid);
}

const PAYOUT_FIELDS = [
  'payoutName',
  'payoutAccount',
  'payoutBankCode',
  'payoutBankName',
  'payoutBranchName',
  'payoutBranchCode',
  'payoutAccountType',
  'payoutAccountNumber',
];

function activityCoreText({ action, targetName }) {
  const t = String(targetName || '').trim();
  if (action === 'createTeam') return `チーム「${t}」を作成しました`;
  if (action === 'joinTeam') return 'チームに参加しました';
  if (action === 'leaveTeam') return 'チームから退出しました';
  if (action === 'removeMember') return `${t}さんを外しました`;
  if (action === 'updateRecord') return `「${t}」を更新しました`;
  if (action === 'deleteRecord') return `「${t}」を削除しました`;
  return `「${t}」を変更しました`;
}

async function writeActivity(db, teamId, user, action, targetName, opts = {}) {
  const actorUid = opts.actorUid || user.uid;
  const actorName = opts.actorName || currentUserLabel(user);
  const core = activityCoreText({ action, targetName });
  const identities = {
    actorUid,
    ...(opts.targetUid ? { targetUid: opts.targetUid } : {}),
    ...(opts.memberUid ? { memberUid: opts.memberUid } : {}),
  };
  await addDoc(collection(db, 'teams', teamId, 'activity'), {
    action,
    text: `${actorName}さんが${core}`,
    coreText: core,
    ...identities,
    identityUids: deriveActivityIdentityUids(identities),
    actorName,
    targetName: String(targetName || ''),
    createdAt: serverTimestamp(),
  });
}

export async function createTeam({ user, name }) {
  requireUser(user);
  const { db } = await getFirebaseCore();
  const teamDoc = doc(collection(db, 'teams'));
  const now = Date.now();
  const settings = normalizeTeamSecuritySettings({ settings: {} });
  const team = normalizeTeamRecord({
    id: teamDoc.id,
    name,
    createdBy: user.uid,
    // A newly-created team has no legacy workspace records, so it can start on
    // the verified V2 boundary immediately. Only pre-V2 teams need migration.
    securitySchemaVersion: 2,
    securityMigrationState: 'ready',
    settings,
  }, { uid: user.uid, now });
  const member = buildPublicMemberRecord({
    uid: user.uid,
    role: 'admin',
    status: 'active',
    displayName: currentUserLabel(user),
    photoURL: user.photoURL || '',
  }, { uid: user.uid, updatedBy: user.uid, now });
  const email = buildMemberEmailRecord({
    uid: user.uid,
    email: user.email || '',
  }, { uid: user.uid, updatedBy: user.uid, now });
  const batch = writeBatch(db);
  batch.set(teamDoc, {
    ...team,
    memberUids: [user.uid],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(memberRef(db, teamDoc.id, user.uid), {
    ...member,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(memberEmailRef(db, teamDoc.id, user.uid), {
    ...email,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  await writeActivity(db, teamDoc.id, user, 'createTeam', team.name);
  return { ...team, id: teamDoc.id };
}

export async function listMyTeams({ user }) {
  requireUser(user);
  const { db } = await getFirebaseCore();
  const q1 = query(
    collection(db, 'teams'),
    where('memberUids', 'array-contains', user.uid),
    limit(50),
  );
  const q2 = query(
    collectionGroup(db, 'members'),
    where('uid', '==', user.uid),
    limit(50),
  );
  const q3 = query(
    collectionGroup(db, 'joinRequests'),
    where('uid', '==', user.uid),
    limit(50),
  );
  const settled = await Promise.allSettled([getDocs(q1), getDocs(q2), getDocs(q3)]);
  const snaps1 = settled[0].status === 'fulfilled' ? settled[0].value : { docs: [] };
  const snaps2 = settled[1].status === 'fulfilled' ? settled[1].value : { docs: [] };
  const snaps3 = settled[2].status === 'fulfilled' ? settled[2].value : { docs: [] };
  for (let i = 0; i < settled.length; i++) {
    if (settled[i].status === 'rejected') {
      console.warn('[team] listMyTeams sub-query failed', i, settled[i].reason);
    }
  }
  const teams = [];
  const seen = new Set();
  const docs = [...snaps1.docs];
  for (const teamSnap of docs) {
    if (seen.has(teamSnap.id)) continue;
    seen.add(teamSnap.id);
    const teamData = teamSnap.data();
    if (teamData.deletedAt != null) continue;
    if (String(teamData.createdBy || '') === String(user.uid || '')) {
      teams.push({ id: teamSnap.id, ...teamData, myRole: 'admin' });
      continue;
    }
    try {
      const member = await getDoc(memberRef(db, teamSnap.id, user.uid));
      if (member.exists() && member.data().status === 'active') {
        teams.push({ id: teamSnap.id, ...teamData, myRole: member.data().role || 'member' });
      }
    } catch (err) {
      console.warn('[team] getMember failed', teamSnap.id, err);
    }
  }
  for (const memberSnap of snaps2.docs) {
    const memberData = memberSnap.data();
    if (memberData.status !== 'active') continue;
    const teamId = memberSnap.ref.parent?.parent?.id || '';
    if (!teamId || seen.has(teamId)) continue;
    try {
      const teamSnap = await getDoc(teamRef(db, teamId));
      if (!teamSnap.exists()) continue;
      const teamData = teamSnap.data();
      if (teamData.deletedAt != null) continue;
      seen.add(teamId);
      teams.push({ id: teamId, ...teamData, myRole: memberData.role || 'member' });
    } catch (err) {
      console.warn('[team] fallback team fetch failed', teamId, err);
    }
  }
  for (const reqSnap of snaps3.docs) {
    const reqData = reqSnap.data();
    if (String(reqData.status || '') !== 'pending') continue;
    const teamId = reqSnap.ref.parent?.parent?.id || reqData.teamId || '';
    if (!teamId || seen.has(teamId)) continue;
    let promoted = false;
    try {
      const memberSnap = await getDoc(memberRef(db, teamId, user.uid));
      if (memberSnap.exists() && memberSnap.data().status === 'active') {
        const teamSnap = await getDoc(teamRef(db, teamId));
        if (teamSnap.exists()) {
          const teamData = teamSnap.data();
          if (teamData.deletedAt == null) {
            seen.add(teamId);
            teams.push({ id: teamId, ...teamData, myRole: memberSnap.data().role || 'member' });
            promoted = true;
          }
        }
      }
    } catch (err) {
      console.warn('[team] fallback member lookup failed', teamId, err);
    }
    if (promoted) continue;
    seen.add(teamId);
    teams.push({
      id: teamId,
      name: reqData.teamName || 'チーム',
      createdBy: reqData.createdBy || '',
      memberUids: [],
      members: [],
      joinStatus: 'pending',
      myRole: 'pending',
    });
  }
  console.log('[team] listMyTeams result', {
    uid: user.uid,
    q1Count: snaps1.docs.length,
    q2Count: snaps2.docs.length,
    q3Count: snaps3.docs.length,
    teamsFound: teams.length,
    teamIds: teams.map((t) => ({ id: t.id, role: t.myRole, joinStatus: t.joinStatus || 'active' })),
  });
  teams.sort((a, b) => {
    const left = a.updatedAt && typeof a.updatedAt.toMillis === 'function' ? a.updatedAt.toMillis() : 0;
    const right = b.updatedAt && typeof b.updatedAt.toMillis === 'function' ? b.updatedAt.toMillis() : 0;
    return right - left;
  });
  return teams;
}

export async function createInvite({ user, teamId }) {
  requireUser(user);
  const { db } = await getFirebaseCore();
  const inviteDoc = doc(collection(db, 'teams', teamId, 'invites'));
  const code = inviteDoc.id.slice(0, 8).toUpperCase();
  let teamName = '';
  try {
    const teamSnap = await getDoc(teamRef(db, teamId));
    if (teamSnap.exists()) teamName = String(teamSnap.data().name || '').trim();
  } catch (_) {}
  await setDoc(inviteDoc, {
    id: inviteDoc.id,
    code,
    teamId,
    teamName,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    disabledAt: null,
  });
  await setDoc(doc(db, 'teamInviteCodes', code), {
    code,
    teamId,
    inviteId: inviteDoc.id,
    teamName,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    disabledAt: null,
  });
  return { id: inviteDoc.id, code };
}

export async function requestJoinTeam({ user, teamId, inviteId, teamName = '' }) {
  requireUser(user);
  const { db } = await getFirebaseCore();
  await setDoc(doc(db, 'teams', teamId, 'joinRequests', user.uid), {
    uid: user.uid,
    inviteId,
    teamId,
    teamName: String(teamName || '').trim(),
    displayName: currentUserLabel(user),
    email: user.email || '',
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function requestJoinTeamByCode({ user, code }) {
  requireUser(user);
  const normalizedCode = String(code || '').trim().replace(/\s+/g, '').toUpperCase();
  if (!normalizedCode) throw new Error('invite-code-required');
  const { db } = await getFirebaseCore();
  const codeRef = doc(db, 'teamInviteCodes', normalizedCode);
  const snap = await getDoc(codeRef);
  if (!snap.exists()) throw new Error('invite-code-not-found');
  const invite = snap.data() || {};
  if (invite.disabledAt != null) throw new Error('invite-code-disabled');
  if (!invite.teamId || !invite.inviteId) throw new Error('invite-code-invalid');
  await requestJoinTeam({
    user,
    teamId: invite.teamId,
    inviteId: invite.inviteId,
    teamName: invite.teamName || '',
  });
  return {
    teamId: invite.teamId,
    inviteId: invite.inviteId,
    teamName: invite.teamName || '',
    code: normalizedCode,
  };
}

export async function approveJoinRequest({ user, teamId, requestUid }) {
  requireUser(user);
  const { db } = await getFirebaseCore();
  const reqRef = doc(db, 'teams', teamId, 'joinRequests', requestUid);
  const req = await getDoc(reqRef);
  if (!req.exists()) throw new Error('request-not-found');
  const data = req.data();
  const batch = writeBatch(db);
  batch.set(memberRef(db, teamId, requestUid), {
    uid: requestUid,
    role: 'member',
    status: 'active',
    displayName: data.displayName || 'メンバー',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  });
  batch.set(memberEmailRef(db, teamId, requestUid), {
    uid: requestUid,
    email: String(data.email || '').trim(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  });
  batch.update(teamRef(db, teamId), {
    memberUids: arrayUnion(requestUid),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  });
  batch.update(reqRef, {
    status: 'approved',
    approvedBy: user.uid,
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  try {
    await writeActivity(db, teamId, user, 'joinTeam', data.displayName || 'メンバー', {
      actorUid: requestUid,
      actorName: data.displayName || 'メンバー',
      memberUid: requestUid,
    });
  } catch (err) {
    console.warn('[team] writeActivity after approve failed', err);
  }
}

export async function updateTeamName({ user, teamId, name }) {
  requireUser(user);
  const { db } = await getFirebaseCore();
  await updateDoc(teamRef(db, teamId), {
    name: String(name || '').trim(),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  });
}

export async function updateTeamSettings({ user, teamId, settings }) {
  requireUser(user);
  const { db } = await getFirebaseCore();
  const updates = {
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  };
  Object.entries(settings || {}).forEach(([key, value]) => {
    if (value === undefined) return;
    updates[`settings.${key}`] = value;
    if (key === 'rewardVisibility') updates.rewardVisibility = value;
  });
  await updateDoc(teamRef(db, teamId), updates);
  return settings;
}

export async function updateMemberProfile({ user, teamId, profile }) {
  requireUser(user);
  const { db } = await getFirebaseCore();
  const batch = writeBatch(db);
  batch.set(memberRef(db, teamId, user.uid), {
    uid: user.uid,
    displayName: String(profile?.displayName || '').trim(),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  }, { merge: true });
  batch.set(memberEmailRef(db, teamId, user.uid), {
    uid: user.uid,
    email: String(profile?.email || '').trim(),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  }, { merge: true });
  batch.set(memberNoteRef(db, teamId, user.uid), {
    uid: user.uid,
    note: String(profile?.note || '').trim(),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  }, { merge: true });
  await batch.commit();
}

export async function updateMemberPayout({ user, teamId, payout }) {
  requireUser(user);
  const { db } = await getFirebaseCore();
  await setDoc(payoutRef(db, teamId, user.uid), {
    uid: user.uid,
    payoutName: String(payout?.payoutName || '').trim(),
    payoutAccount: String(payout?.payoutAccount || '').trim(),
    payoutBankCode: String(payout?.payoutBankCode || '').trim(),
    payoutBankName: String(payout?.payoutBankName || '').trim(),
    payoutBranchName: String(payout?.payoutBranchName || '').trim(),
    payoutBranchCode: String(payout?.payoutBranchCode || '').trim(),
    payoutAccountType: String(payout?.payoutAccountType || '').trim() === 'toza' ? 'toza' : 'futsu',
    payoutAccountNumber: String(payout?.payoutAccountNumber || '').trim(),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  }, { merge: true });
}

/**
 * 旧 members ドキュメントに残っている payout 系フィールドを payouts/{uid} に移行し、
 * 移行が済んだフィールドを members 側から削除する。
 * 既に payouts/{uid} が存在する場合は members 側の削除のみ行う。
 * @returns {Promise<{migrated: boolean, removed: boolean}>}
 */
export async function migrateMyPayoutFromMember({ user, teamId, memberData }) {
  requireUser(user);
  const data = memberData || {};
  const hasLegacy = PAYOUT_FIELDS.some((k) => {
    const v = data[k];
    return v !== undefined && v !== null && String(v).trim() !== '';
  });
  if (!hasLegacy) {
    return { migrated: false, removed: false };
  }
  const { db } = await getFirebaseCore();
  const existing = await getDoc(payoutRef(db, teamId, user.uid));
  let migrated = false;
  if (!existing.exists()) {
    await setDoc(payoutRef(db, teamId, user.uid), {
      uid: user.uid,
      payoutName: String(data.payoutName || '').trim(),
      payoutAccount: String(data.payoutAccount || '').trim(),
      payoutBankCode: String(data.payoutBankCode || '').trim(),
      payoutBankName: String(data.payoutBankName || '').trim(),
      payoutBranchName: String(data.payoutBranchName || '').trim(),
      payoutBranchCode: String(data.payoutBranchCode || '').trim(),
      payoutAccountType: String(data.payoutAccountType || '').trim() === 'toza' ? 'toza' : 'futsu',
      payoutAccountNumber: String(data.payoutAccountNumber || '').trim(),
      migratedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
    }, { merge: true });
    migrated = true;
  }
  const deletePatch = {};
  PAYOUT_FIELDS.forEach((k) => { deletePatch[k] = deleteField(); });
  deletePatch.updatedAt = serverTimestamp();
  deletePatch.updatedBy = user.uid;
  await updateDoc(memberRef(db, teamId, user.uid), deletePatch);
  return { migrated, removed: true };
}

export async function dissolveTeam({ user, teamId }) {
  requireUser(user);
  const { db } = await getFirebaseCore();
  await updateDoc(teamRef(db, teamId), {
    deletedAt: serverTimestamp(),
    deletedBy: user.uid,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  });
}

export async function removeTeamMember({ user, teamId, memberId }) {
  requireUser(user);
  const { db } = await getFirebaseCore();
  let removedName = '';
  try {
    const memSnap = await getDoc(memberRef(db, teamId, memberId));
    if (memSnap.exists()) {
      removedName = String(memSnap.data().displayName || memSnap.data().email || '').trim();
    }
  } catch (_) {}
  const batch = writeBatch(db);
  batch.delete(memberRef(db, teamId, memberId));
  batch.delete(memberEmailRef(db, teamId, memberId));
  batch.delete(memberNoteRef(db, teamId, memberId));
  batch.delete(payoutRef(db, teamId, memberId));
  batch.update(teamRef(db, teamId), {
    memberUids: arrayRemove(memberId),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  });
  await batch.commit();
  try {
    if (String(memberId) === String(user.uid)) {
      await writeActivity(db, teamId, user, 'leaveTeam', removedName || currentUserLabel(user));
    } else {
      await writeActivity(db, teamId, user, 'removeMember', removedName || 'メンバー', {
        targetUid: memberId,
      });
    }
  } catch (err) {
    console.warn('[team] writeActivity after removeMember failed', err);
  }
}

export function subscribeTeam({
  teamId,
  workspaceAccess = 'denied',
  includeJoinRequests = false,
  canReadAllMemberEmails = false,
  canReadAllMemberNotes = false,
  canReadAllPayouts = false,
  userUid = '',
  onChange,
  onError,
}) {
  const unsubscribers = [];
  let closed = false;
  getFirebaseCore().then(({ db }) => {
    if (closed) return;
    const reportOptionalReadFailure = (type) => (err) => {
      console.warn(`[team] ${type} subscribe failed`, err?.code || err);
      if (!closed) onChange({ type, data: [], errorCode: String(err?.code || '') });
    };
    unsubscribers.push(onSnapshot(teamRef(db, teamId), (snap) => {
      onChange({ type: 'team', data: snap.exists() ? { id: snap.id, ...snap.data() } : null });
    }, onError));
    const canUseWorkspace = workspaceAccess === 'admin' || workspaceAccess === 'member';
    if (canUseWorkspace) {
      unsubscribers.push(onSnapshot(collection(db, 'teams', teamId, 'members'), (snap) => {
        onChange({ type: 'members', data: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
      }, reportOptionalReadFailure('members')));
    } else if (workspaceAccess === 'locked' && userUid) {
      unsubscribers.push(onSnapshot(memberRef(db, teamId, userUid), (snap) => {
        const list = snap.exists() ? [{ id: snap.id, ...snap.data() }] : [];
        onChange({ type: 'members', data: list });
      }, reportOptionalReadFailure('members')));
    }
    unsubscribers.push(onSnapshot(collection(db, 'teams', teamId, 'activity'), (snap) => {
      onChange({ type: 'activity', data: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
    }, reportOptionalReadFailure('activity')));
    if (includeJoinRequests) {
      unsubscribers.push(onSnapshot(collection(db, 'teams', teamId, 'joinRequests'), (snap) => {
        onChange({ type: 'joinRequests', data: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
      }, reportOptionalReadFailure('joinRequests')));
    }
    const subscribePrivate = ({ all, collectionName, ref, type }) => {
      if (!canUseWorkspace) return;
      if (all) {
        unsubscribers.push(onSnapshot(collection(db, 'teams', teamId, collectionName), (snap) => {
          onChange({ type, data: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
        }, reportOptionalReadFailure(type)));
      } else if (userUid) {
        unsubscribers.push(onSnapshot(ref(db, teamId, userUid), (snap) => {
          const list = snap.exists() ? [{ id: snap.id, ...snap.data() }] : [];
          onChange({ type, data: list });
        }, reportOptionalReadFailure(type)));
      }
    };
    subscribePrivate({
      all: canReadAllMemberEmails,
      collectionName: 'memberEmails',
      ref: memberEmailRef,
      type: 'memberEmails',
    });
    subscribePrivate({
      all: canReadAllMemberNotes,
      collectionName: 'memberNotes',
      ref: memberNoteRef,
      type: 'memberNotes',
    });
    if (canUseWorkspace && canReadAllPayouts) {
      unsubscribers.push(onSnapshot(collection(db, 'teams', teamId, 'payouts'), (snap) => {
        onChange({ type: 'payouts', data: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
      }, reportOptionalReadFailure('payouts')));
    } else if (canUseWorkspace && userUid) {
      unsubscribers.push(onSnapshot(payoutRef(db, teamId, userUid), (snap) => {
        const list = snap.exists() ? [{ id: snap.id, ...snap.data() }] : [];
        onChange({ type: 'payouts', data: list });
      }, reportOptionalReadFailure('payouts')));
    }
  }).catch(onError);

  return () => {
    closed = true;
    while (unsubscribers.length) {
      const unsub = unsubscribers.pop();
      try { unsub(); } catch {}
    }
  };
}
