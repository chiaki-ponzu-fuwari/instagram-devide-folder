# Repeat Parent/Child Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同じユーザー名の案件を1つの親案件にまとめ、最初は親1+子1、その後は同じ親に子案件を増やしていく repeat モデルに揃える。

**Architecture:** `www/index.html` の既存 repeat 保存フローを中心に、同名アカウントの判定、確認ダイアログ、親への昇格、子の追加保存を整理する。親は系列の基本情報、子は1回分の実行情報として扱い、既存の個人/チーム分離は変えない。表示は repeat 親一覧と通常一覧で役割を分け、子案件だけが通常一覧に残る形に寄せる。

**Tech Stack:** Vanilla JS, existing modal/overlay helpers, existing local save/render pipeline, existing test runner (`npm test`, `npm run check:js`, `npm run check:html`).

---

### Task 1: Repeat family rule を保存フローに固定する

**Files:**
- Modify: `www/index.html`
- Modify: `www/i18n.js`
- Test: `tests/repeat-parent-child-model.test.mjs` (new)

- [ ] **Step 1: Add failing tests for the family rule**

```js
import assert from 'node:assert/strict';
import test from 'node:test';

test('same username creates one parent and one child on first repeat save', () => {
  const family = buildRepeatFamilyFromFirstRepeatSave({
    username: '@dmwaj',
    projectName: '料理教室',
  });

  assert.equal(family.parent.username, '@dmwaj');
  assert.equal(family.parent.project.contractType, 'repeat');
  assert.equal(family.children.length, 1);
  assert.equal(family.children[0].project.repeatParentId, family.parent.id);
});

test('duplicate same username shows confirmation and links to the existing parent', () => {
  const result = resolveRepeatLinkTargetByUsername('dmwaj', 'personal', '');
  assert.ok(result.parent);
});
```

- [ ] **Step 2: Make the save flow show a duplicate-username confirmation**

```js
if (forceRepeatLink === null && sameAccounts.length) {
  showAS('同一アカウントの登録があります。\n子案件として紐付けますか？', [
    { label: 'はい', fn: () => saveAcc(true) },
    { label: 'いいえ', fn: () => saveAcc(false) },
  ]);
  return;
}
```

- [ ] **Step 3: Ensure the yes-path links the new record into the existing repeat family**

```js
if (forceRepeatLink === true && repeatLink?.promote) {
  promoteAccountToRepeatParent(repeatLink.promote, targetScope, teamId);
}
const repeatParent = forceRepeatLink === true ? (repeatLink?.parent || null) : null;
if (repeatParent && nextProjectFinal) {
  Object.assign(nextProjectFinal, {
    scope: targetScope,
    teamId: isTeamMode ? teamId : '',
    contractType: 'repeat',
    repeatParentId: repeatParent.id,
    repeatClosedAt: null,
  });
}
```

- [ ] **Step 4: Run the focused tests and verify the duplicate prompt path**

Run:
```bash
npm test
npm run check:js
```

Expected:
- tests pass
- duplicate same-username save opens the confirmation dialog
- choosing yes links the record to the existing repeat family

### Task 2: Make the first repeat save produce parent + first child

**Files:**
- Modify: `www/index.html`
- Modify: `www/i18n.js`
- Test: `tests/repeat-parent-child-model.test.mjs`

- [ ] **Step 1: Add a test that a first repeat save yields both parent and child**

```js
test('first repeat save creates parent plus first child', () => {
  const family = buildRepeatFamilyFromFirstRepeatSave({
    username: '@dmwaj',
    projectName: '料理教室',
    reward: 10000,
    expense: 500,
  });

  assert.equal(family.parent.project.contractType, 'repeat');
  assert.equal(family.children.length, 1);
  assert.equal(family.children[0].project.repeatParentId, family.parent.id);
  assert.equal(family.children[0].project.rewardYen, 10000);
});
```

- [ ] **Step 2: Keep the parent as the base container and copy its values into the first child**

```js
const nextProjectFinal = nextProject
  ? { ...nextProject }
  : (repeatParent ? { name: '' } : null);
if (repeatParent && nextProjectFinal) {
  Object.assign(nextProjectFinal, {
    scope: targetScope,
    teamId: isTeamMode ? teamId : '',
    contractType: 'repeat',
    repeatParentId: repeatParent.id,
    repeatClosedAt: null,
  });
}
```

- [ ] **Step 3: Verify the family list counts one parent and one child on the first save**

```js
console.log('[repeat] linked child by username confirm', {
  username,
  parentId: repeatParent.id,
  parentUsername: repeatParent.username || '',
  scope: next.scope,
  teamId: next.teamId,
});
```

- [ ] **Step 4: Run tests and manual save verification**

Run:
```bash
npm test
npm run check:html
```

Expected:
- first repeat save creates one parent and one child
- child inherits the parent base fields

### Task 3: Keep child edits local and keep parent stable

**Files:**
- Modify: `www/index.html`
- Modify: `www/i18n.js`

- [ ] **Step 1: Add coverage for child-only edits**

```js
test('editing a child does not mutate the parent', () => {
  const family = buildRepeatFamilyFromFirstRepeatSave({
    username: '@dmwaj',
    projectName: '料理教室',
  });
  const child = family.children[0];

  child.project.postAt = '2026-06-10T10:00:00.000Z';

  assert.equal(family.parent.project.postAt || null, null);
});
```

- [ ] **Step 2: Keep parent values as defaults, but allow child overrides**

```js
const childProject = {
  ...parentProject,
  postAt: childPostAt,
  draftAt: childDraftAt,
  shootAt: childShootAt,
  completeAt: childCompleteAt,
};
```

- [ ] **Step 3: Make the repeat family detail UI show parent and child roles clearly**

```js
// Parent detail: base information + child list
// Child detail: inherited base fields + per-child execution fields
```

- [ ] **Step 4: Verify the parent remains unchanged after child edits**

Run:
```bash
npm run check:js
npm run check:html
npm test
```

Expected:
- child changes stay on the child
- parent stays as the family base record

### Task 4: Verify repeat parent removal keeps children

**Files:**
- Modify: `www/index.html`
- Test: `tests/repeat-parent-child-model.test.mjs`

- [ ] **Step 1: Add a test for parent removal behavior**

```js
test('removing a repeat parent detaches children instead of deleting them', () => {
  const family = buildRepeatFamilyFromFirstRepeatSave({
    username: '@dmwaj',
    projectName: '料理教室',
  });

  detachRepeatChildrenToSingle(family.parent.id);
  const child = family.children[0];

  assert.equal(child.project.repeatParentId, '');
  assert.equal(child.project.contractType, 'single');
});
```

- [ ] **Step 2: Keep the child history intact when the parent is removed**

```js
function detachRepeatChildrenToSingle(parentId) {
  const parentIdStr = String(parentId || '').trim();
  if (!parentIdStr) return 0;
  let changed = 0;
  (S.accounts || []).forEach((a) => {
    const p = a?.project || {};
    if (String(p.repeatParentId || '').trim() !== parentIdStr) return;
    a.project = {
      ...p,
      contractType: 'single',
      repeatParentId: '',
      repeatClosedAt: null,
    };
    changed += 1;
  });
  return changed;
}
```

- [ ] **Step 3: Run the delete/detach scenario on device**

Run:
```bash
npm run check:js
npm run check:html
npm test
npx cap sync ios
```

Expected:
- removing a repeat parent keeps children as standalone projects
- children stay visible in the normal list

### Task 5: Manual verification

**Files:**
- None

- [ ] **Step 1: Exercise the exact user flow on device**

Expected:
- first repeat save creates parent + child
- same username duplicate save shows confirmation
- yes links as child
- parent removal detaches children only
- child edits do not mutate parent

- [ ] **Step 2: Commit the implementation**

Run:
```bash
git add www/index.html www/i18n.js tests/repeat-parent-child-model.test.mjs
git commit -m "feat: align repeat parent child model"
```

Expected:
- commit created cleanly

