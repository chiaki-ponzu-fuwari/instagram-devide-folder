import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  arrayUnion,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseCore } from './firestore-core.mjs';
import { buildActivityText, currentUserLabel, normalizeTeamRecord } from './team-model.mjs';

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

async function writeActivity(db, teamId, user, action, targetName) {
  await addDoc(collection(db, 'teams', teamId, 'activity'), {
    action,
    text: buildActivityText({ actorName: currentUserLabel(user), action, targetName }),
    actorUid: user.uid,
    actorName: currentUserLabel(user),
    targetName: targetName || '',
    createdAt: serverTimestamp(),
  });
}

export async function createTeam({ user, name }) {
  requireUser(user);
  const { db } = await getFirebaseCore();
  const teamDoc = doc(collection(db, 'teams'));
  const now = Date.now();
  const team = normalizeTeamRecord({
    id: teamDoc.id,
    name,
    createdBy: user.uid,
    rewardVisibility: 'admin_only',
  }, { uid: user.uid, now });

  await setDoc(teamDoc, {
    ...team,
    memberUids: [user.uid],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await setDoc(memberRef(db, teamDoc.id, user.uid), {
    uid: user.uid,
    role: 'admin',
    status: 'active',
    displayName: currentUserLabel(user),
    email: user.email || '',
    photoURL: user.photoURL || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await writeActivity(db, teamDoc.id, user, 'createTeam', team.name);
  return { ...team, id: teamDoc.id };
}

export async function listMyTeams({ user }) {
  requireUser(user);
  const { db } = await getFirebaseCore();
  const q = query(
    collection(db, 'teams'),
    where('memberUids', 'array-contains', user.uid),
    limit(50),
  );
  const snaps = await getDocs(q);
  const teams = [];
  for (const teamSnap of snaps.docs) {
    const teamData = teamSnap.data();
    if (teamData.deletedAt != null) continue;
    const member = await getDoc(memberRef(db, teamSnap.id, user.uid));
    if (member.exists() && member.data().status === 'active') {
      teams.push({ id: teamSnap.id, ...teamData, myRole: member.data().role || 'member' });
    }
  }
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
  await setDoc(inviteDoc, {
    id: inviteDoc.id,
    code,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    disabledAt: null,
  });
  return { id: inviteDoc.id, code };
}

export async function requestJoinTeam({ user, teamId, inviteId }) {
  requireUser(user);
  const { db } = await getFirebaseCore();
  const invite = await getDoc(doc(db, 'teams', teamId, 'invites', inviteId));
  if (!invite.exists() || invite.data().disabledAt) throw new Error('invalid-invite');
  await setDoc(doc(db, 'teams', teamId, 'joinRequests', user.uid), {
    uid: user.uid,
    inviteId,
    displayName: currentUserLabel(user),
    email: user.email || '',
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function approveJoinRequest({ user, teamId, requestUid }) {
  requireUser(user);
  const { db } = await getFirebaseCore();
  const reqRef = doc(db, 'teams', teamId, 'joinRequests', requestUid);
  const req = await getDoc(reqRef);
  if (!req.exists()) throw new Error('request-not-found');
  const data = req.data();
  await setDoc(memberRef(db, teamId, requestUid), {
    uid: requestUid,
    role: 'member',
    status: 'active',
    displayName: data.displayName || 'メンバー',
    email: data.email || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await updateDoc(teamRef(db, teamId), {
    memberUids: arrayUnion(requestUid),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  });
  await updateDoc(reqRef, {
    status: 'approved',
    approvedBy: user.uid,
    updatedAt: serverTimestamp(),
  });
  await writeActivity(db, teamId, user, 'joinTeam', data.displayName || 'メンバー');
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

export function subscribeTeam({ teamId, includeJoinRequests = false, onChange, onError }) {
  const unsubscribers = [];
  let closed = false;
  getFirebaseCore().then(({ db }) => {
    if (closed) return;
    unsubscribers.push(onSnapshot(teamRef(db, teamId), (snap) => {
      onChange({ type: 'team', data: snap.exists() ? { id: snap.id, ...snap.data() } : null });
    }, onError));
    unsubscribers.push(onSnapshot(collection(db, 'teams', teamId, 'members'), (snap) => {
      onChange({ type: 'members', data: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
    }, onError));
    unsubscribers.push(onSnapshot(collection(db, 'teams', teamId, 'activity'), (snap) => {
      onChange({ type: 'activity', data: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
    }, onError));
    if (includeJoinRequests) {
      unsubscribers.push(onSnapshot(collection(db, 'teams', teamId, 'joinRequests'), (snap) => {
        onChange({ type: 'joinRequests', data: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
      }, onError));
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
