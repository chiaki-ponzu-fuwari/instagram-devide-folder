# Team Login Cloud Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add low-cost Firebase login, personal cloud backup, and team realtime sync for the existing DM management app.

**Architecture:** Keep the current local-first app behavior. Add small Firebase modules under `www/js/` for Auth, Firestore team data, and personal backup. `www/index.html` remains the UI shell, but team persistence moves from `S.meta.teamsState` demo data to Firestore when logged in.

**Tech Stack:** Vanilla HTML/CSS/JS, Capacitor, Firebase Auth Web SDK, Cloud Firestore Web SDK, Firebase Security Rules, Node local dev server.

---

## Scope

This plan implements the first working team/cloud milestone:

- Google login state is used as the real user identity.
- Personal mode still works without login.
- Logged-in users can create teams in Firestore.
- Admins can issue invite codes.
- Logged-in users can request to join by invite code.
- Admins can approve join requests.
- Approved members can open a team and receive realtime updates while the team screen is open.
- Firestore rules prevent non-members from reading team records.
- Personal cloud backup is available as explicit backup/restore actions, not constant realtime sync.

Out of this plan:

- Apple login.
- Paid feature gating.
- Field-level permissions.
- Realtime text-cursor collaboration.
- Automatic migration of all personal data into team data.

## File Map

- Modify `package.json`: add syntax/test helper scripts.
- Modify `firebase.json`: add Firestore rules configuration.
- Create `firestore.rules`: protect user backups and team data.
- Create `www/js/firestore-core.mjs`: Firebase app, Auth, Firestore shared initialization.
- Modify `www/js/firebase-auth.mjs`: reuse shared core and expose normalized user helpers.
- Create `www/js/personal-cloud-backup.mjs`: explicit personal backup/restore helpers.
- Create `www/js/team-cloud.mjs`: Firestore team CRUD, invites, join requests, listeners.
- Create `www/js/team-model.mjs`: pure data normalization helpers that can be tested in Node.
- Create `tests/team-model.test.mjs`: low-cost unit tests for pure team helpers.
- Modify `www/index.html`: connect existing team UI to cloud functions and stop demo-only behavior.
- Modify `www/i18n.js`: add missing Japanese/English strings for cloud sync states and errors.
- Modify `docs/privacy.html` and `docs/support.html`: update public text because login/cloud sync changes data handling.

## Task 1: Add Test And Firebase Rule Scaffolding

**Files:**
- Modify: `package.json`
- Modify: `firebase.json`
- Create: `firestore.rules`
- Create: `tests/team-model.test.mjs`

- [ ] **Step 1: Add scripts to `package.json`**

Replace the `scripts` object with:

```json
"scripts": {
  "dev": "node scripts/dev-server.mjs",
  "test": "node --test tests/*.test.mjs",
  "check:js": "node --check www/js/firebase-auth.mjs && node --check www/js/firestore-core.mjs && node --check www/js/team-model.mjs && node --check www/js/team-cloud.mjs && node --check www/js/personal-cloud-backup.mjs",
  "check:html": "node --check www/i18n.js"
}
```

- [ ] **Step 2: Connect Firestore rules in `firebase.json`**

Change `firebase.json` to:

```json
{
  "firestore": {
    "rules": "firestore.rules"
  },
  "hosting": {
    "public": ".",
    "ignore": [
      "firebase.json",
      ".firebaserc",
      "**/.*",
      "**/node_modules/**"
    ]
  }
}
```

- [ ] **Step 3: Create a restrictive first version of `firestore.rules`**

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }

    function isSelf(uid) {
      return signedIn() && request.auth.uid == uid;
    }

    function memberDoc(teamId) {
      return get(/databases/$(database)/documents/teams/$(teamId)/members/$(request.auth.uid));
    }

    function isApprovedMember(teamId) {
      return signedIn()
        && exists(/databases/$(database)/documents/teams/$(teamId)/members/$(request.auth.uid))
        && memberDoc(teamId).data.status == 'active';
    }

    function isAdmin(teamId) {
      return isApprovedMember(teamId) && memberDoc(teamId).data.role == 'admin';
    }

    match /users/{uid} {
      allow read, write: if isSelf(uid);
    }

    match /teams/{teamId} {
      allow create: if signedIn()
        && request.resource.data.createdBy == request.auth.uid
        && request.resource.data.deletedAt == null;
      allow read: if signedIn() && request.auth.uid in resource.data.memberUids;
      allow update: if isAdmin(teamId);
      allow delete: if false;

      match /members/{uid} {
        allow read: if isApprovedMember(teamId);
        allow create: if isAdmin(teamId)
          || (signedIn()
            && uid == request.auth.uid
            && get(/databases/$(database)/documents/teams/$(teamId)).data.createdBy == request.auth.uid
            && request.resource.data.role == 'admin'
            && request.resource.data.status == 'active'
            && request.resource.data.uid == request.auth.uid);
        allow update: if isAdmin(teamId) || isSelf(uid);
        allow delete: if false;
      }

      match /folders/{folderId} {
        allow read, create, update: if isApprovedMember(teamId);
        allow delete: if false;
      }

      match /accounts/{accountId} {
        allow read, create, update: if isApprovedMember(teamId);
        allow delete: if false;
      }

      match /templates/{templateId} {
        allow read, create, update: if isApprovedMember(teamId);
        allow delete: if false;
      }

      match /activity/{activityId} {
        allow read: if isApprovedMember(teamId);
        allow create: if isApprovedMember(teamId);
        allow update, delete: if false;
      }

      match /invites/{inviteId} {
        allow read: if signedIn();
        allow create, update: if isAdmin(teamId);
        allow delete: if false;
      }

      match /joinRequests/{requestId} {
        allow create: if signedIn() && request.resource.data.uid == request.auth.uid;
        allow read: if isAdmin(teamId) || (signedIn() && resource.data.uid == request.auth.uid);
        allow update: if isAdmin(teamId);
        allow delete: if false;
      }
    }
  }
}
```

- [ ] **Step 4: Add the first failing model test**

Create `tests/team-model.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTeamRecord,
  canUseTeamRecord,
  buildActivityText,
} from '../www/js/team-model.mjs';

test('normalizeTeamRecord keeps safe fields and fills metadata', () => {
  const now = 1778493600000;
  const team = normalizeTeamRecord({
    id: 't1',
    name: '  HERAC  ',
    createdBy: 'u1',
  }, { uid: 'u1', now });

  assert.equal(team.id, 't1');
  assert.equal(team.name, 'HERAC');
  assert.equal(team.createdBy, 'u1');
  assert.equal(team.updatedBy, 'u1');
  assert.equal(team.createdAt, now);
  assert.equal(team.updatedAt, now);
  assert.equal(team.deletedAt, null);
});

test('canUseTeamRecord hides soft-deleted records', () => {
  assert.equal(canUseTeamRecord({ id: 'a1', deletedAt: null }), true);
  assert.equal(canUseTeamRecord({ id: 'a1', deletedAt: 1778493600000 }), false);
});

test('buildActivityText creates a short Japanese message', () => {
  assert.equal(
    buildActivityText({ actorName: '山田', action: 'createTeam', targetName: 'HERAC' }),
    '山田さんがチーム「HERAC」を作成しました',
  );
});
```

- [ ] **Step 5: Run the test and confirm it fails**

Run:

```bash
npm test
```

Expected result:

```text
ERR_MODULE_NOT_FOUND
```

Reason: `www/js/team-model.mjs` has not been created yet.

- [ ] **Step 6: Commit scaffolding**

```bash
git add package.json firebase.json firestore.rules tests/team-model.test.mjs
git commit -m "test: add team sync scaffolding"
```

## Task 2: Add Pure Team Model Helpers

**Files:**
- Create: `www/js/team-model.mjs`
- Test: `tests/team-model.test.mjs`

- [ ] **Step 1: Create `www/js/team-model.mjs`**

```js
export function cleanString(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

export function normalizeTeamRecord(input, ctx) {
  const now = Number(ctx?.now || Date.now());
  const uid = cleanString(ctx?.uid);
  const id = cleanString(input?.id);
  const name = cleanString(input?.name, 'チーム');
  const createdBy = cleanString(input?.createdBy, uid);

  return {
    ...input,
    id,
    name,
    createdBy,
    updatedBy: uid || cleanString(input?.updatedBy, createdBy),
    createdAt: Number(input?.createdAt || now),
    updatedAt: now,
    deletedAt: input?.deletedAt ?? null,
    deletedBy: input?.deletedBy ?? null,
  };
}

export function canUseTeamRecord(record) {
  return !!record && record.deletedAt == null;
}

export function buildActivityText({ actorName, action, targetName }) {
  const actor = cleanString(actorName, 'メンバー');
  const target = cleanString(targetName, 'データ');
  if (action === 'createTeam') return `${actor}さんがチーム「${target}」を作成しました`;
  if (action === 'joinTeam') return `${actor}さんがチームに参加しました`;
  if (action === 'updateRecord') return `${actor}さんが「${target}」を更新しました`;
  if (action === 'deleteRecord') return `${actor}さんが「${target}」を削除しました`;
  return `${actor}さんが「${target}」を変更しました`;
}

export function currentUserLabel(user) {
  return cleanString(user?.displayName, cleanString(user?.email, 'メンバー'));
}
```

- [ ] **Step 2: Run tests**

Run:

```bash
npm test
```

Expected result:

```text
pass
```

- [ ] **Step 3: Commit model helpers**

```bash
git add www/js/team-model.mjs tests/team-model.test.mjs
git commit -m "feat: add team model helpers"
```

## Task 3: Centralize Firebase Initialization

**Files:**
- Create: `www/js/firestore-core.mjs`
- Modify: `www/js/firebase-auth.mjs`

- [ ] **Step 1: Create `www/js/firestore-core.mjs`**

```js
/* global window */
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

let app;
let auth;
let db;
let initPromise;

export function firebaseConfig() {
  return typeof window !== 'undefined' ? window.DM_FIREBASE_CONFIG : null;
}

export function hasFirebaseConfig() {
  const c = firebaseConfig();
  return !!(c && c.apiKey && c.projectId);
}

function isNative() {
  try {
    const C = window.Capacitor;
    return !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform());
  } catch {
    return false;
  }
}

export async function initFirebaseCore() {
  if (!hasFirebaseConfig()) throw new Error('DM_FIREBASE_CONFIG missing');
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const apps = getApps();
    app = apps.length ? apps[0] : initializeApp(firebaseConfig());
    auth = getAuth(app);
    db = getFirestore(app);
    try {
      await getRedirectResult(auth);
    } catch {
      // Redirect result can fail after cancelled login. Keep app usable.
    }
    return { app, auth, db };
  })();
  return initPromise;
}

export async function getFirebaseCore() {
  await initFirebaseCore();
  return { app, auth, db };
}

export async function waitForInitialAuth() {
  const core = await getFirebaseCore();
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(core.auth, (user) => {
      unsub();
      resolve(user);
    });
  });
}

export function getCurrentUser() {
  return auth?.currentUser ?? null;
}

export function subscribeAuth(callback) {
  initFirebaseCore()
    .then(({ auth: activeAuth }) => onAuthStateChanged(activeAuth, callback))
    .catch(() => {});
}

export async function signInWithGoogle() {
  const core = await getFirebaseCore();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  if (isNative()) {
    await signInWithRedirect(core.auth, provider);
    return;
  }
  try {
    await signInWithPopup(core.auth, provider);
  } catch {
    await signInWithRedirect(core.auth, provider);
  }
}

export async function signOutGoogle() {
  const core = await getFirebaseCore();
  await signOut(core.auth);
}

export { serverTimestamp };
```

- [ ] **Step 2: Replace `www/js/firebase-auth.mjs` with wrapper exports**

```js
export {
  hasFirebaseConfig,
  initFirebaseCore as initFirebase,
  waitForInitialAuth,
  getCurrentUser,
  subscribeAuth,
  signInWithGoogle,
  signOutGoogle,
} from './firestore-core.mjs';
```

- [ ] **Step 3: Check syntax**

Run:

```bash
node --check www/js/firestore-core.mjs
node --check www/js/firebase-auth.mjs
```

Expected result: both commands exit with no output.

- [ ] **Step 4: Commit Firebase core**

```bash
git add www/js/firestore-core.mjs www/js/firebase-auth.mjs
git commit -m "feat: centralize firebase initialization"
```

## Task 4: Add Personal Cloud Backup Helpers

**Files:**
- Create: `www/js/personal-cloud-backup.mjs`
- Modify: `www/i18n.js`

- [ ] **Step 1: Create `www/js/personal-cloud-backup.mjs`**

```js
import {
  doc,
  getDoc,
  setDoc,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseCore, serverTimestamp } from './firestore-core.mjs';

export async function savePersonalBackup({ user, data }) {
  if (!user?.uid) throw new Error('login-required');
  const { db } = await getFirebaseCore();
  await setDoc(doc(db, 'users', user.uid), {
    profile: {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || '',
      photoURL: user.photoURL || '',
    },
    privateBackup: data,
    syncMeta: {
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
      schemaVersion: 1,
    },
  }, { merge: true });
}

export async function loadPersonalBackup({ user }) {
  if (!user?.uid) throw new Error('login-required');
  const { db } = await getFirebaseCore();
  const snap = await getDoc(doc(db, 'users', user.uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  return data.privateBackup || null;
}
```

- [ ] **Step 2: Add i18n strings**

Add these Japanese keys near existing backup strings in `www/i18n.js`:

```js
backup_cloud_save: 'クラウドへ保存',
backup_cloud_load: 'クラウドから復元',
toast_cloud_backup_ok: 'クラウドに保存しました',
toast_cloud_backup_fail: 'クラウド保存に失敗しました',
toast_cloud_restore_empty: 'クラウドバックアップがありません',
toast_cloud_restore_ok: 'クラウドから復元しました',
toast_cloud_restore_fail: 'クラウド復元に失敗しました',
```

Add matching English keys:

```js
backup_cloud_save: 'Save to cloud',
backup_cloud_load: 'Restore from cloud',
toast_cloud_backup_ok: 'Saved to cloud',
toast_cloud_backup_fail: 'Cloud save failed',
toast_cloud_restore_empty: 'No cloud backup found',
toast_cloud_restore_ok: 'Restored from cloud',
toast_cloud_restore_fail: 'Cloud restore failed',
```

- [ ] **Step 3: Check syntax**

Run:

```bash
node --check www/js/personal-cloud-backup.mjs
node --check www/i18n.js
```

Expected result: both commands exit with no output.

- [ ] **Step 4: Commit personal backup module**

```bash
git add www/js/personal-cloud-backup.mjs www/i18n.js
git commit -m "feat: add personal cloud backup helpers"
```

## Task 5: Add Firestore Team Service

**Files:**
- Create: `www/js/team-cloud.mjs`
- Test: `www/js/team-model.mjs`

- [ ] **Step 1: Create `www/js/team-cloud.mjs`**

```js
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  arrayUnion,
  limit,
  onSnapshot,
  orderBy,
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
    where('deletedAt', '==', null),
    orderBy('updatedAt', 'desc'),
    limit(50),
  );
  const snaps = await getDocs(q);
  const teams = [];
  for (const teamSnap of snaps.docs) {
    const member = await getDoc(memberRef(db, teamSnap.id, user.uid));
    if (member.exists() && member.data().status === 'active') {
      teams.push({ id: teamSnap.id, ...teamSnap.data(), myRole: member.data().role || 'member' });
    }
  }
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

export function subscribeTeam({ teamId, onChange, onError }) {
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
  }).catch(onError);

  return () => {
    closed = true;
    while (unsubscribers.length) {
      const unsub = unsubscribers.pop();
      try { unsub(); } catch {}
    }
  };
}
```

- [ ] **Step 2: Check syntax**

Run:

```bash
node --check www/js/team-cloud.mjs
```

Expected result: command exits with no output.

- [ ] **Step 3: Commit team service**

```bash
git add www/js/team-cloud.mjs
git commit -m "feat: add firestore team service"
```

## Task 6: Wire Existing Team UI To Firestore

**Files:**
- Modify: `www/index.html`
- Modify: `www/i18n.js`

- [ ] **Step 1: Add cloud team state near existing team globals**

Near `let teamTab = 'members';`, add:

```js
let cloudTeamApi = null;
let cloudTeamUnsubscribe = null;
let cloudTeams = [];
let cloudSelectedTeam = null;
let cloudTeamMembers = [];
let cloudTeamActivity = [];
```

- [ ] **Step 2: Add loader helpers**

Near existing team functions, add:

```js
async function getCloudTeamApi() {
  if (cloudTeamApi) return cloudTeamApi;
  cloudTeamApi = await import('./js/team-cloud.mjs');
  return cloudTeamApi;
}

async function getLoggedInUserOrPrompt() {
  const auth = await import('./js/firebase-auth.mjs');
  await auth.initFirebase();
  await auth.waitForInitialAuth();
  const user = auth.getCurrentUser();
  if (user) return user;
  document.getElementById('loginRequiredModal').classList.add('show');
  return null;
}

function stopCloudTeamListener() {
  if (cloudTeamUnsubscribe) {
    cloudTeamUnsubscribe();
    cloudTeamUnsubscribe = null;
  }
}
```

- [ ] **Step 3: Replace `openTeamList()` with cloud loading**

Replace the body of `openTeamList()` with:

```js
async function openTeamList() {
  const user = await getLoggedInUserOrPrompt();
  if (!user) return;
  try {
    const api = await getCloudTeamApi();
    cloudTeams = await api.listMyTeams({ user });
    renderTeamList();
    document.getElementById('teamListOv').classList.add('show');
  } catch (e) {
    console.error(e);
    toast('チーム一覧を読み込めませんでした');
  }
}
```

- [ ] **Step 4: Update `renderTeamList()` to prefer cloud teams**

At the start of `renderTeamList()`, use:

```js
const sourceTeams = cloudTeams.length ? cloudTeams : _teamsState().teams;
list.innerHTML = sourceTeams.map(t => {
  const members = Array.isArray(t.members) ? t.members : [];
  const isAdmin = t.myRole ? t.myRole === 'admin' : isTeamAdmin(t);
  return `<button type="button" class="team-row" data-tid="${esc(t.id)}">
    <div class="left">
      <div class="name">${esc(t.name || 'チーム')}${isAdmin ? `<span class="team-admin-badge" title="管理者">★</span>` : ''}</div>
    </div>
    <div class="right">
      <div class="cnt">${members.length ? `${members.length}人` : ''}</div>
      <div style="color:var(--txt3);font-size:20px;line-height:1">›</div>
    </div>
  </button>`;
}).join('');
```

Inside the click handler, replace local selection with:

```js
const tid = btn.dataset.tid;
cloudSelectedTeam = sourceTeams.find(t => String(t.id) === String(tid)) || null;
closeTeamList();
openTeamDetail();
```

- [ ] **Step 5: Replace `teamListAdd` handler**

Replace the current prompt-only add handler with:

```js
if (teamListAdd) teamListAdd.addEventListener('click', async () => {
  const user = await getLoggedInUserOrPrompt();
  if (!user) return;
  const name = prompt('チーム名を入力してください', '新しいチーム');
  if (!name || !name.trim()) return;
  try {
    const api = await getCloudTeamApi();
    const team = await api.createTeam({ user, name: name.trim() });
    cloudTeams = await api.listMyTeams({ user });
    cloudSelectedTeam = team;
    renderTeamList();
    toast('チームを作成しました');
  } catch (e) {
    console.error(e);
    toast('チームを作成できませんでした');
  }
});
```

- [ ] **Step 6: Replace `openTeamDetail()` with listener start**

Replace the body with:

```js
async function openTeamDetail() {
  const user = await getLoggedInUserOrPrompt();
  if (!user || !cloudSelectedTeam) return;
  stopCloudTeamListener();
  const api = await getCloudTeamApi();
  cloudTeamUnsubscribe = api.subscribeTeam({
    teamId: cloudSelectedTeam.id,
    onChange: (event) => {
      if (event.type === 'team') cloudSelectedTeam = event.data;
      if (event.type === 'members') cloudTeamMembers = event.data;
      if (event.type === 'activity') cloudTeamActivity = event.data;
      renderTeam();
    },
    onError: (err) => {
      console.error(err);
      toast('チーム同期が切断されました');
    },
  });
  renderTeam();
  document.getElementById('teamOv').classList.add('show');
}
```

- [ ] **Step 7: Update `closeTeam()` to stop listener**

```js
function closeTeam() {
  stopCloudTeamListener();
  document.getElementById('teamOv').classList.remove('show');
}
```

- [ ] **Step 8: Update `renderTeam()` to use cloud team data**

At the start of `renderTeam()`, change:

```js
const T = _teamState();
```

to:

```js
const T = cloudSelectedTeam || _teamState();
if (cloudTeamMembers.length) T.members = cloudTeamMembers.map((m) => ({
  id: m.uid || m.id,
  handle: m.displayName || m.email || 'メンバー',
  role: m.role || 'member',
  color: '#2F86D9',
}));
if (cloudTeamActivity.length) T.activities = cloudTeamActivity.map((a) => ({
  handle: a.actorName || 'メンバー',
  color: '#2F86D9',
  text: a.text || '',
  time: '',
}));
```

- [ ] **Step 9: Check syntax**

Run:

```bash
node --check www/index.html
```

Expected result: this fails because HTML is not a JS file. Then run the real checks:

```bash
npm run check:html
npm run check:js
```

Expected result: both commands exit with no output.

- [ ] **Step 10: Commit UI wiring**

```bash
git add www/index.html www/i18n.js
git commit -m "feat: wire team ui to firestore"
```

## Task 7: Wire Personal Backup Buttons

**Files:**
- Modify: `www/index.html`

- [ ] **Step 1: Add buttons under the existing data backup card**

In the `paneData` backup create button group, after `backupCopyBtn`, add:

```html
<button class="tmpl-btn tmpl-copy" id="backupCloudSaveBtn">クラウドへ保存</button>
<button class="tmpl-btn tmpl-edit" id="backupCloudLoadBtn">クラウドから復元</button>
```

- [ ] **Step 2: Add click handlers near existing backup handlers**

After the `backupCopyBtn` handler, add:

```js
const cloudSaveBtn = document.getElementById('backupCloudSaveBtn');
if (cloudSaveBtn) cloudSaveBtn.addEventListener('click', async () => {
  try {
    const auth = await import('./js/firebase-auth.mjs');
    const backup = await import('./js/personal-cloud-backup.mjs');
    await auth.initFirebase();
    await auth.waitForInitialAuth();
    const user = auth.getCurrentUser();
    if (!user) { toast(tt('login_req_title')); return; }
    await backup.savePersonalBackup({ user, data: JSON.parse(exportJSON()) });
    toast(tt('toast_cloud_backup_ok'));
  } catch (e) {
    console.error(e);
    toast(tt('toast_cloud_backup_fail'));
  }
});

const cloudLoadBtn = document.getElementById('backupCloudLoadBtn');
if (cloudLoadBtn) cloudLoadBtn.addEventListener('click', async () => {
  try {
    const auth = await import('./js/firebase-auth.mjs');
    const backup = await import('./js/personal-cloud-backup.mjs');
    await auth.initFirebase();
    await auth.waitForInitialAuth();
    const user = auth.getCurrentUser();
    if (!user) { toast(tt('login_req_title')); return; }
    const data = await backup.loadPersonalBackup({ user });
    if (!data) { toast(tt('toast_cloud_restore_empty')); return; }
    if (!validateBackupObject(data)) { toast(tt('toast_backup_bad')); return; }
    showAS(tt('restore_pick'), [
      { label: tt('restore_overwrite'), fn:() => { S.folders=data.folders; S.accounts=data.accounts; S.templates=data.templates||[]; S.meta=data.meta||{}; save(); toast(tt('toast_cloud_restore_ok')); } },
      { label: tt('restore_merge'), fn:() => { mergeBackupObject(data); toast(tt('toast_merged')); } },
    ]);
  } catch (e) {
    console.error(e);
    toast(tt('toast_cloud_restore_fail'));
  }
});
```

- [ ] **Step 3: Check scripts**

Run:

```bash
npm run check:html
npm run check:js
```

Expected result: both commands exit with no output.

- [ ] **Step 4: Commit cloud backup UI**

```bash
git add www/index.html
git commit -m "feat: add personal cloud backup actions"
```

## Task 8: Update Legal And Help Text

**Files:**
- Modify: `www/index.html`
- Modify: `docs/privacy.html`
- Modify: `docs/support.html`

- [ ] **Step 1: Update in-app terms/privacy copy**

In `www/index.html`, replace statements that say the app has no login and no cloud sync with text that says:

```html
<p>本アプリは、個人利用ではログインなしでも利用できます。チーム機能やクラウドバックアップを利用する場合、Googleログインを使用します。</p>
<p>ログイン時には、Firebase Authenticationを通じてユーザー識別子、メールアドレス、表示名等を取得する場合があります。これらは本人確認、クラウドバックアップ、チーム機能の提供に利用します。</p>
<p>チーム機能で入力した情報は、承認済みのチームメンバーに共有されます。個人データのクラウドバックアップは、本人のアカウントからのみアクセスできる設計にします。</p>
```

- [ ] **Step 2: Update `docs/privacy.html`**

Replace the body with:

```html
<!doctype html><html lang="ja"><meta charset="utf-8"><title>プライバシーポリシー</title><h1>プライバシーポリシー</h1><p>DM・お仕事管理（HERAC LLC）は、個人利用ではログインなしで利用できます。チーム機能やクラウドバックアップを利用する場合、GoogleログインおよびFirebaseを使用します。</p><p>ログイン時にはユーザー識別子、メールアドレス、表示名等を取得する場合があります。入力データは、端末内保存、本人用クラウドバックアップ、承認済みチーム内での共有に利用されます。</p><p>お問い合わせ: herac.7.app@gmail.com</p>
```

- [ ] **Step 3: Update `docs/support.html`**

Replace the body with:

```html
<!doctype html><html lang="ja"><meta charset="utf-8"><title>サポート</title><h1>DM・お仕事管理 サポート</h1><p>ログイン、チーム機能、クラウドバックアップ、データ復元で困った場合は、状況と表示されたエラーを添えてご連絡ください。</p><p>お問い合わせ: herac.7.app@gmail.com</p>
```

- [ ] **Step 4: Commit legal/help updates**

```bash
git add www/index.html docs/privacy.html docs/support.html
git commit -m "docs: update privacy text for cloud sync"
```

## Task 9: Manual Verification

**Files:**
- No planned source edits unless verification finds bugs.

- [ ] **Step 1: Run unit tests**

Run:

```bash
npm test
```

Expected result: all tests pass.

- [ ] **Step 2: Run syntax checks**

Run:

```bash
npm run check:html
npm run check:js
```

Expected result: both checks pass.

- [ ] **Step 3: Start local dev server**

Run:

```bash
npm run dev
```

Expected result:

```text
Open http://127.0.0.1:8080/
```

If port `8080` is used, the script prints the next available port.

- [ ] **Step 4: Browser smoke test**

Open the printed local URL and check:

- App opens without login.
- Existing folders and accounts still render.
- Settings opens.
- Google login row is visible.
- Team button asks for login when logged out.
- Data backup buttons still work.

- [ ] **Step 5: Firebase manual test**

With Firebase Auth and Firestore enabled in the Firebase console:

- Sign in with Google.
- Open team list.
- Create a team.
- Confirm the team appears in Firestore under `teams/{teamId}`.
- Confirm `teams/{teamId}/members/{uid}` exists with `role: admin`.
- Open the team screen.
- Confirm realtime listener updates the team name after editing it from Firestore console.

- [ ] **Step 6: Security manual test**

Use a second Google account or browser profile:

- Sign in as second user.
- Confirm second user cannot open the team before approval.
- Create join request.
- Sign back in as admin and approve it.
- Confirm second user can open the team after approval.

- [ ] **Step 7: Cost behavior check**

In the browser console, confirm:

- `cloudTeamUnsubscribe` is non-null while the team screen is open.
- After closing team screen, `cloudTeamUnsubscribe` becomes null.
- Personal mode does not call `subscribeTeam`.

- [ ] **Step 8: Commit verification fixes if any**

If bugs were fixed during verification:

```bash
git add www/index.html www/js firestore.rules docs package.json firebase.json tests
git commit -m "fix: stabilize team cloud sync"
```

If no fixes were needed, do not create an empty commit.
