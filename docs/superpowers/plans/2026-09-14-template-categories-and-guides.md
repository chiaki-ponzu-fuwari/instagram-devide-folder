# Template Categories and Guides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a clear personal-use guide and user-created horizontal template categories without changing existing template-card behavior.

**Architecture:** Keep category normalization, filtering, and safe deletion in a small pure module. Store personal category definitions in `S.meta.templateCategories` and each personal template’s optional `categoryId`; existing templates remain uncategorized. `index.html` owns the DOM and saves through the existing local/native/cloud workspace snapshot path, so no new sync transport is needed.

**Tech Stack:** Vanilla JavaScript modules, single-page HTML/CSS, Node.js built-in test runner, existing personal cloud workspace sync.

---

### Task 1: Pure category model and migration safety

**Files:**
- Create: `www/js/template-category-model.mjs`
- Create: `tests/template-category-model.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing model tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeTemplateCategories,
  normalizeTemplateCategoryId,
  removeTemplateCategory,
} from '../www/js/template-category-model.mjs';

test('normalizes categories and keeps only unique non-empty names', () => {
  assert.deepEqual(normalizeTemplateCategories([
    { id: 'sales', name: '営業', order: 2 },
    { id: 'sales', name: '重複', order: 1 },
    { id: '', name: '無効' },
    { id: 'thanks', name: 'お礼', order: 0 },
  ]), [
    { id: 'thanks', name: 'お礼', order: 0 },
    { id: 'sales', name: '営業', order: 1 },
  ]);
});

test('legacy templates without category remain uncategorized', () => {
  assert.equal(normalizeTemplateCategoryId({ id: 't1' }, [{ id: 'sales', name: '営業' }]), '');
});

test('removing a category preserves templates as uncategorized', () => {
  const result = removeTemplateCategory({
    categoryId: 'sales',
    categories: [{ id: 'sales', name: '営業', order: 0 }],
    templates: [{ id: 't1', categoryId: 'sales' }, { id: 't2', categoryId: '' }],
  });
  assert.deepEqual(result.templates, [{ id: 't1', categoryId: '' }, { id: 't2', categoryId: '' }]);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/template-category-model.test.mjs`

Expected: `ERR_MODULE_NOT_FOUND` because the model does not exist yet.

- [ ] **Step 3: Implement the minimal pure model**

```js
export function normalizeTemplateCategories(input = []) {
  const seen = new Set();
  return (Array.isArray(input) ? input : [])
    .map((category, index) => ({
      id: String(category?.id || '').trim(),
      name: String(category?.name || '').trim(),
      order: Number.isFinite(Number(category?.order)) ? Number(category.order) : index,
    }))
    .filter((category) => category.id && category.name && !seen.has(category.id) && (seen.add(category.id), true))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ja'))
    .map((category, order) => ({ ...category, order }));
}

export function normalizeTemplateCategoryId(template, categories) {
  const id = String(template?.categoryId || '').trim();
  return normalizeTemplateCategories(categories).some((category) => category.id === id) ? id : '';
}

export function removeTemplateCategory({ categoryId, categories, templates }) {
  const id = String(categoryId || '').trim();
  return {
    categories: normalizeTemplateCategories(categories).filter((category) => category.id !== id).map((category, order) => ({ ...category, order })),
    templates: (Array.isArray(templates) ? templates : []).map((template) =>
      String(template?.categoryId || '').trim() === id ? { ...template, categoryId: '' } : template),
  };
}
```

- [ ] **Step 4: Run focused test and verify GREEN**

Run: `node --test tests/template-category-model.test.mjs`

Expected: all tests pass.

- [ ] **Step 5: Add the model test to the normal test command and commit**

```bash
git add www/js/template-category-model.mjs tests/template-category-model.test.mjs package.json
git commit -m "feat: add safe template category model"
```

### Task 2: Settings guide and template guide copy

**Files:**
- Modify: `www/index.html:3443-3473,7275-7305`
- Modify: `tests/personal-page-guide-ui.test.mjs`

- [ ] **Step 1: Write a failing guide-content test**

```js
test('global guide explains the five personal-workflow steps and template guide explains categories', () => {
  const settingsGuide = html.match(/id="paneGuideDoc">([\s\S]*?)<\/div>\s*<\/div>\s*<div class="settings-bottom-links/)?.[1] || '';
  assert.match(settingsGuide, /5\. テンプレートを使う/);
  const source = sliceFunction('openPageGuide', 'startPageGuideHint');
  assert.match(source, /template/);
  assert.match(html, /カテゴリを追加/);
});
```

- [ ] **Step 2: Run the focused UI test and verify RED**

Run: `node --test tests/personal-page-guide-ui.test.mjs`

Expected: failure because template-specific guide content does not exist.

- [ ] **Step 3: Add the fifth global step and page guide**

Add a fifth settings-guide card headed `5. テンプレートを使う` that explains saving frequently used replies and categorizing them. Add `template` to `PAGE_GUIDE_CONTENT` with short instructions for category tabs, the `＋` tab, changing a template category, and copying text. The template guide uses the existing `pageGuideModal` and does not create another modal type.

- [ ] **Step 4: Run focused UI test and verify GREEN**

Run: `node --test tests/personal-page-guide-ui.test.mjs`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add www/index.html tests/personal-page-guide-ui.test.mjs
git commit -m "feat: document personal template workflow"
```

### Task 3: Horizontal personal category tabs and manager UI

**Files:**
- Modify: `www/index.html:1346-1392,3330-3334,3483-3510,7690-7835,8798-8968`
- Modify: `www/i18n.js`
- Modify: `tests/template-category-ui.test.mjs`

- [ ] **Step 1: Write failing UI tests**

```js
test('personal templates have horizontal all and add-category tabs without changing cards', () => {
  const pane = html.match(/id="paneTemplates">([\s\S]*?)<div class="settings-pane" id="paneTerms">/)?.[1] || '';
  assert.match(pane, /id="templateCategoryTabs"/);
  assert.match(pane, /data-template-category="all"/);
  assert.match(pane, /id="templateCategoryAddBtn"/);
  assert.match(html, /\.template-category-tabs\s*\{[^}]*overflow-x:auto/);
  assert.match(html, /class="tmpl-card"/);
});

test('template editor has a category selection that is hidden for team templates', () => {
  assert.match(html, /id="tmplCategoryWrap"/);
  assert.match(html, /id="tmplCategory"/);
  assert.match(html, /origin === 'teamTemplates'/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/template-category-ui.test.mjs`

Expected: missing tabs and category selector failures.

- [ ] **Step 3: Add minimal markup and styles**

Add a `templateCategoryTabs` horizontal scroll row above `templateList`, containing a permanent `すべて` button and an add button with `id="templateCategoryAddBtn"`. Add `categoryModal` for category name input and `categoryManageModal` for rename, delete, and up/down sort controls. Add a category `<select id="tmplCategory">` inside `tmplModal`. Keep `.tmpl-card`, `.tmpl-row`, and `.tmpl-detail` markup unchanged.

Use CSS equivalent to:

```css
.template-category-tabs { display:flex; gap:8px; overflow-x:auto; padding:0 2px 12px; scrollbar-width:none; }
.template-category-tab { flex:0 0 auto; min-height:36px; padding:0 14px; border-radius:18px; }
.template-category-tab.active { background:rgba(225,48,108,.13); color:var(--accent); }
```

- [ ] **Step 4: Run focused test and verify GREEN**

Run: `node --test tests/template-category-ui.test.mjs`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add www/index.html www/i18n.js tests/template-category-ui.test.mjs
git commit -m "feat: add personal template category tabs"
```

### Task 4: Category actions, filtering, and personal persistence

**Files:**
- Modify: `www/index.html:8798-8968,5117-5155,5223-5235,5343-5350`
- Modify: `tests/template-category-ui.test.mjs`
- Modify: `tests/personal-cloud-store.test.mjs`

- [ ] **Step 1: Write failing interaction and persistence tests**

```js
test('saving a template persists the selected category and filtering does not delete other templates', () => {
  const source = sliceFunction('saveTemplate', '');
  assert.match(source, /tmplCategory/);
  assert.match(source, /categoryId/);
  assert.match(html, /renderTemplates\(\)/);
});

test('personal workspace snapshots retain templateCategories inside settings', () => {
  const source = sliceFunction('getWorkspaceSnapshot', 'getLocalWorkspaceState');
  assert.match(source, /settings: JSON\.parse\(JSON\.stringify\(S\.meta/);
  assert.match(html, /templateCategories/);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/template-category-ui.test.mjs tests/personal-cloud-store.test.mjs`

Expected: category interaction assertions fail.

- [ ] **Step 3: Implement category state and actions**

Import the pure model dynamically with the existing module-loading pattern. Add:

```js
let activeTemplateCategoryId = 'all';
let templateCategoryMod = null;
async function loadTemplateCategoryModule() {
  if (templateCategoryMod) return templateCategoryMod;
  templateCategoryMod = await import('./js/template-category-model.mjs');
  return templateCategoryMod;
}
function getPersonalTemplateCategories() {
  return templateCategoryMod?.normalizeTemplateCategories(S.meta?.templateCategories || []) || [];
}
function setPersonalTemplateCategories(categories) {
  S.meta = { ...(S.meta || {}), templateCategories: templateCategoryMod.normalizeTemplateCategories(categories) };
  save();
}
function getTemplatesForActiveCategory() {
  return activeTemplateCategoryId === 'all'
    ? (S.templates || [])
    : (S.templates || []).filter((template) => templateCategoryMod.normalizeTemplateCategoryId(template, getPersonalTemplateCategories()) === activeTemplateCategoryId);
}
```

`renderTemplates()` renders tabs then calls the unchanged card renderer with filtered templates. `saveTemplate()` writes the selected `categoryId` for personal templates. For `teamTemplates`, hide the category select and do not read or write personal category state. Category deletion calls `removeTemplateCategory`, then saves once and changes an active deleted tab back to `all`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/template-category-model.test.mjs tests/template-category-ui.test.mjs tests/personal-cloud-store.test.mjs`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add www/index.html tests/template-category-ui.test.mjs tests/personal-cloud-store.test.mjs
git commit -m "feat: persist and filter personal template categories"
```

### Task 5: Full regression and iPhone-width review

**Files:**
- Modify only if a failing test or browser defect requires it.

- [ ] **Step 1: Run targeted category and guide tests**

Run: `node --test tests/template-category-model.test.mjs tests/template-category-ui.test.mjs tests/personal-page-guide-ui.test.mjs`

Expected: all tests pass.

- [ ] **Step 2: Run full automated checks**

Run: `npm test && npm run check:js && npm run check:html && git diff --check`

Expected: exit code 0; Firestore emulator skip is acceptable only if reported separately.

- [ ] **Step 3: Browser verification at 430px width**

Verify the following manually:

1. Settings guide shows all five steps, including templates.
2. New template page has `すべて` and `＋` on one horizontal tab row.
3. Add a category, add a template in it, then edit it to another category.
4. The selected tab filters without changing the existing template card visual style.
5. Reorder categories, delete one, and confirm its templates remain in `すべて` as uncategorized.
6. Reload the page and verify categories and associations remain.
7. Team template page remains unchanged.

- [ ] **Step 4: Commit only scoped files if the dirty worktree allows it**

```bash
git add www/js/template-category-model.mjs www/index.html www/i18n.js package.json tests/template-category-model.test.mjs tests/template-category-ui.test.mjs tests/personal-page-guide-ui.test.mjs tests/personal-cloud-store.test.mjs
git commit -m "feat: organize templates with personal categories"
```

If a file contains unrelated pre-existing hunks, use `git add -p` and commit only the category and guide hunks.
