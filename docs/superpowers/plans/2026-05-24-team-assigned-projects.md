# Team Assigned Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add team project assignees by member checkbox, keep reward amounts attached to those assigned rows, and let member detail open a filtered list of only that member's assigned team projects.

**Architecture:** Reuse the existing team project reward allocation array instead of adding a second assignment table. Extend each allocation row with an `assigned` flag, then treat checked rows as active assignees and unchecked rows as stored-but-inactive. Reuse the existing team project modal, member detail modal, and team workspace state so personal pages stay unchanged.

**Tech Stack:** Vanilla JavaScript, existing team workspace state, existing project modal, existing member detail modal, existing reward allocation UI.

---

### Task 1: Extend the team reward allocation model to carry assignment state

**Files:**
- Modify: `www/index.html:5146-5255`
- Modify: `www/index.html:7340-7385`
- Modify: `www/index.html:7908-8010`
- Test: `npm run check:js`

- [ ] **Step 1: Update allocation normalization to preserve assignment state**

```js
function normalizeTeamProjectRewardAllocations(rawAllocations, team) {
  const members = getTeamProjectRewardMembers(team);
  const rows = [];
  const byUid = new Map();
  (Array.isArray(rawAllocations) ? rawAllocations : []).forEach((item) => {
    const uid = String(item?.uid || '').trim();
    if (!uid) return;
    const amountRaw = String(item?.amountYen ?? '').trim();
    const amount = amountRaw ? Number(amountRaw.replace(/[^\d]/g, '')) : Number(item?.amountYen || 0);
    byUid.set(uid, {
      uid,
      displayName: String(item?.displayName || '').trim(),
      amountYen: Number.isFinite(amount) && amount > 0 ? Math.max(0, Math.round(amount)) : null,
      assigned: !!item?.assigned,
    });
  });
  members.forEach((member) => {
    const existing = byUid.get(member.uid);
    rows.push({
      uid: member.uid,
      displayName: existing?.displayName || resolveMemberName(member) || member.email || 'メンバー',
      amountYen: existing?.amountYen || null,
      assigned: existing ? !!existing.assigned : false,
    });
    byUid.delete(member.uid);
  });
  byUid.forEach((value) => rows.push(value));
  return rows;
}
```

- [ ] **Step 2: Add a helper that treats checked rows as active assignees**

```js
function isTeamProjectAllocationAssigned(row) {
  return !!row?.assigned && Number(row?.amountYen || 0) > 0;
}
```

- [ ] **Step 3: Make saved repeat children and project saves keep the new row shape**

```js
rewardAllocations: Array.isArray(p.rewardAllocations)
  ? p.rewardAllocations.map((row) => ({
      uid: String(row?.uid || '').trim(),
      displayName: String(row?.displayName || '').trim(),
      amountYen: Number.isFinite(Number(row?.amountYen)) ? Math.max(0, Math.round(Number(row.amountYen))) : null,
      assigned: !!row?.assigned,
    })).filter((row) => row.uid)
  : [],
```

```js
return {
  uid,
  displayName: current.get(uid)?.displayName || '',
  amountYen: Number.isFinite(amount) && amount > 0 ? Math.max(0, Math.round(amount)) : null,
  assigned: checked,
};
```

- [ ] **Step 4: Run the JS syntax check**

Run: `npm run check:js`
Expected: PASS

---

### Task 2: Add member checkboxes and per-member reward inputs to the team project modal

**Files:**
- Modify: `www/index.html:2577-5298`
- Test: `npm run check:js`

- [ ] **Step 1: Render one row per team member with a checkbox and reward amount input**

```js
function renderTeamProjectRewardAllocations() {
  const wrap = document.getElementById('projRewardAllocWrap');
  const list = document.getElementById('projRewardAllocList');
  const sumEl = document.getElementById('projRewardAllocSummary');
  const note = document.getElementById('projRewardAllocNote');
  const rewardInput = document.getElementById('projReward');
  if (!wrap || !list || !sumEl || !rewardInput) return;
  const team = getTeamProjectRewardTeam();
  const inTeamContext = !!teamProjectsExpanded || !!document.getElementById('teamOv')?.classList.contains('show');
  const canEditReward = inTeamContext && !!team && isTeamAdmin(team);
  const visible = inTeamContext && !!team && canViewerSeeTeamProjectReward(team, account(projAccountId)?.project || {});
  const project = account(projAccountId)?.project || {};
  const rawTotal = Number(project?.rewardYen || 0) || 0;
  const rawRows = normalizeTeamProjectRewardAllocations(project?.rewardAllocations || [], team);
  const total = rawTotal > 0 ? rawTotal : sumTeamProjectRewardAllocations(rawRows);

  wrap.style.display = inTeamContext && team ? '' : 'none';
  rewardInput.disabled = inTeamContext && !canEditReward;
  rewardInput.readOnly = inTeamContext && !canEditReward;
  rewardInput.style.opacity = inTeamContext && !canEditReward ? '0.72' : '';
  rewardInput.style.cursor = inTeamContext && !canEditReward ? 'not-allowed' : '';
  if (note) {
    note.textContent = canEditReward
      ? tt('proj_reward_alloc_note')
      : (visible ? tt('proj_reward_alloc_note') : tt('proj_reward_alloc_hidden'));
  }

  if (!team) {
    list.innerHTML = '';
    sumEl.textContent = '';
    return;
  }

  const members = getTeamProjectRewardMembers(team);
  if (!members.length) {
    list.innerHTML = '<div class="proj-reward-alloc-note">メンバーがいません</div>';
    sumEl.textContent = '';
    return;
  }

  list.innerHTML = members.map((member) => {
    const uid = String(member.uid || '').trim();
    const row = rawRows.find((r) => String(r.uid || '').trim() === uid) || { amountYen: null, assigned: false };
    const checked = !!row.assigned;
    const label = resolveMemberName(member);
    return `
      <div class="copy-row proj-reward-alloc-row">
        <label style="display:flex;align-items:center;gap:10px;min-width:0;flex:1">
          <input type="checkbox" class="proj-assign-check" data-alloc-uid="${esc(uid)}" ${checked ? 'checked' : ''} ${canEditReward ? '' : 'disabled'}>
          <span class="proj-reward-alloc-name">${esc(label)}</span>
        </label>
        <input type="number" class="fi proj-reward-alloc-input" data-alloc-uid="${esc(uid)}" min="0" step="1" inputmode="numeric" placeholder="0" value="${esc(row.amountYen ? String(row.amountYen) : '')}" ${checked && canEditReward ? '' : 'disabled'}>
      </div>
    `;
  }).join('');
}
```

- [ ] **Step 2: Keep unchecked members stored but inactive**

```js
function readTeamProjectRewardAllocationsFromUI(team) {
  const list = document.getElementById('projRewardAllocList');
  if (!list || !team) return [];
  const current = new Map(
    normalizeTeamProjectRewardAllocations(account(projAccountId)?.project?.rewardAllocations || [], team)
      .map((row) => [String(row.uid || '').trim(), row])
  );
  return [...list.querySelectorAll('[data-alloc-uid]')].map((el) => {
    const uid = String(el.dataset.allocUid || '').trim();
    if (!uid) return null;
    const checked = !!list.querySelector(`.proj-assign-check[data-alloc-uid="${CSS.escape(uid)}"]`)?.checked;
    const raw = String(el.value || '').trim();
    const amount = raw ? Number(raw.replace(/[^\d]/g, '')) : null;
    return {
      uid,
      displayName: current.get(uid)?.displayName || '',
      amountYen: Number.isFinite(amount) && amount > 0 ? Math.max(0, Math.round(amount)) : null,
      assigned: checked,
    };
  }).filter(Boolean);
}
```

- [ ] **Step 3: Keep the existing admin-only save rule unchanged**

```js
if (scope === 'team') {
  if (canEditTeamReward) {
    rewardAllocations = allocRows;
    if (rewardFinal == null && allocTotal > 0) rewardFinal = allocTotal;
    if (rewardFinal != null && allocTotal > rewardFinal) {
      toast('報酬配分の合計が報酬額を超えています');
      return;
    }
  } else {
    rewardFinal = prevProject.rewardYen != null ? Number(prevProject.rewardYen) : null;
  }
} else {
  rewardAllocations = [];
}
```

- [ ] **Step 4: Run the JS syntax check**

Run: `npm run check:js`
Expected: PASS

---

### Task 3: Add `担当案件一覧` to the member detail page

**Files:**
- Modify: `www/index.html:8648-8765`
- Test: `npm run check:js`

- [ ] **Step 1: Add the button near the bottom of the member detail view**

```js
function renderTeamMemberDetailView(member, viewer, team) {
  const self = String(viewer?.uid || '') === String(member?.uid || member?.id || '');
  const emailVisible = self || canViewerSeeEmail(viewer, team);
  const noteVisible = self || canViewerSeeNote(viewer, team);
  const payoutVisible = self || canViewerSeePayout(viewer, team);
  const displayName = resolveMemberName(member);
  const email = String(member?.email || '').trim();
  const nameStyle = self
    ? 'font-size:20px;font-weight:1000;color:var(--accent);white-space:normal;word-break:break-word;line-height:1.35'
    : 'font-size:20px;font-weight:1000;color:var(--txt);white-space:normal;word-break:break-word;line-height:1.35';
  const note = String(member?.note || '').trim();

  return `
    <div style="margin-bottom:14px">
      <div style="${nameStyle}">${esc(displayName)}</div>
      <div style="font-size:12px;font-weight:900;color:var(--txt3);margin-top:4px">${esc(member?.role === 'admin' ? '管理者' : 'メンバー')}</div>
    </div>
    <div class="fg" style="margin-bottom:10px">
      <label>表示名</label>
      <div class="fi" style="display:block;white-space:normal;word-break:break-word;background:rgba(0,0,0,.03);padding:10px 12px;line-height:1.45">${esc(displayName)}</div>
    </div>
    <div class="fg" style="margin-bottom:10px">
      <label>メールアドレス</label>
      <div class="fi" style="display:flex;align-items:center;background:rgba(0,0,0,.03)">${emailVisible ? esc(email || '未設定') : '非公開'}</div>
    </div>
    ${renderPayoutBankViewSection(member, payoutVisible)}
    <div class="fg" style="margin-bottom:0">
      <label>その他情報</label>
      <div class="fi" style="min-height:72px;white-space:pre-wrap;background:rgba(0,0,0,.03)">${noteVisible ? esc(note || '未設定') : '非公開'}</div>
    </div>
    <div class="fg" style="margin-top:14px">
      <button type="button" class="btn btn-main" id="teamMemberAssignedBtn">担当案件一覧</button>
    </div>
  `;
}
```

- [ ] **Step 2: Wire the button to open the filtered project list**

```js
const assignedBtn = document.getElementById('teamMemberAssignedBtn');
if (assignedBtn) {
  assignedBtn.onclick = () => openTeamMemberAssignedProjects(cloudMemberDetailId);
}
```

- [ ] **Step 3: Keep edit mode unchanged for the member profile**

```js
function openTeamMemberDetail(memberId, fromEdit = false) {
  clearFolderReorderMode();
  const user = await getLoggedInUserOrPrompt();
  if (!user) return;
  const team = _selectedTeam();
  if (!team) return;
  const rawMember = getCloudMemberById(memberId) || (Array.isArray(team.members) ? team.members.find((m) => String(m.uid || m.id || '') === String(memberId || '')) : null);
  if (!rawMember) return;
  const member = mergeMemberWithPayout(rawMember);
  cloudMemberDetailId = String(member.uid || member.id || memberId || '');
  const self = String(user.uid || '') === String(member.uid || member.id || '');
  cloudMemberDetailMode = fromEdit && self ? 'edit' : 'view';
}
```

- [ ] **Step 4: Run the JS syntax check**

Run: `npm run check:js`
Expected: PASS

---

### Task 4: Add a member-filtered team project list view and back navigation

**Files:**
- Modify: `www/index.html:4760-4905`
- Modify: `www/index.html:11270-11520`
- Test: `npm run check:js`

- [ ] **Step 1: Add state for the active member filter**

```js
let teamAssignedProjectFilter = null;
```

- [ ] **Step 2: Add a helper that filters team projects by assigned member**

```js
function getTeamMemberAssignedProjects(teamId, memberUid) {
  const targetTeamId = String(teamId || '').trim();
  const targetUid = String(memberUid || '').trim();
  if (!targetTeamId || !targetUid) return [];
  const team = _selectedTeam() || cloudSelectedTeam || null;
  return getTeamAnalysisDisplayRecords(targetTeamId).filter((a) => {
    if (!a?.project) return false;
    if (String(getProjectTeamId(a)) !== targetTeamId) return false;
    const rows = normalizeTeamProjectRewardAllocations(a.project.rewardAllocations || [], team);
    return rows.some((row) => String(row?.uid || '').trim() === targetUid && isTeamProjectAllocationAssigned(row));
  });
}
```

- [ ] **Step 3: Open the filtered list from the member detail button**

```js
function openTeamMemberAssignedProjects(memberId) {
  const team = _selectedTeam() || cloudSelectedTeam || null;
  const uid = String(memberId || '').trim();
  if (!team || !uid) return;
  teamAssignedProjectFilter = { teamId: String(team.id || '').trim(), memberUid: uid };
  teamProjectsExpanded = true;
  openTeamProjectsExpanded();
  renderMain();
}
```

- [ ] **Step 4: Render the filtered title and keep back navigation returning to the member detail**

```js
const filter = teamAssignedProjectFilter;
const title = filter?.memberUid
  ? `${resolveMemberName(getCloudMemberById(filter.memberUid) || {})}の案件`
  : `${teamName}の案件`;
```

```js
function closeTeamProjectsExpanded() {
  if (teamAssignedProjectFilter?.memberUid) {
    openTeamMemberDetail(teamAssignedProjectFilter.memberUid, false);
  }
  teamAssignedProjectFilter = null;
}
```

- [ ] **Step 5: Run the JS syntax check**

Run: `npm run check:js`
Expected: PASS

---

### Task 5: Sync iOS and verify the full team flow without touching personal pages

**Files:**
- Modify: none if previous tasks are sufficient
- Test: `npx cap sync ios`

- [ ] **Step 1: Sync the iOS project**

Run: `npx cap sync ios`
Expected: completes without errors

- [ ] **Step 2: Manually verify the team flow**

Check:
- Open a team project detail page.
- Confirm the member checkboxes appear.
- Confirm only checked members can edit reward amounts.
- Save and reopen the project to ensure checked state and amounts persist.
- Open a member detail page.
- Confirm `担当案件一覧` appears.
- Open it and confirm only that member's assigned projects are shown.
- Open one of the filtered projects and confirm the normal project detail page still works.
- Confirm the back action returns to the member detail page.
- Confirm personal pages are unchanged.

- [ ] **Step 3: Commit the implementation**

```bash
git add www/index.html
git commit -m "feat: add team member assigned project list"
```
