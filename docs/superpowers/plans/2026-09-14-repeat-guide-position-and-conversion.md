# Repeat Guide Position and Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the repeat-project guide button at the same fixed bottom position as other page guides, and explain how an existing single project becomes a repeat project.

**Architecture:** The repeat sheet keeps its header and guide bar outside the scrollable project list. `PAGE_GUIDE_CONTENT.repeat` receives one explanatory section only; project conversion, persistence, and parent/child data behavior stay unchanged.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, Node.js built-in test runner.

---

### Task 1: Lock the repeat guide into the lower page area

**Files:**
- Modify: `www/index.html:664-672,3179-3203`
- Modify: `tests/personal-page-guide-ui.test.mjs`

- [x] **Step 1: Write the failing layout regression test**

```js
test('repeat guide stays outside the scrollable repeat-project list', () => {
  const repeatSheet = html.match(/<div class="modal-ov" id="repeatCasesOv">([\s\S]*?)<\/div>\n<\/div>\n\n<!-- Settings View -->/)?.[1] || '';
  assert.match(repeatSheet, /<div class="repeat-list-scroll">[\s\S]*id="repeatCasesList"[\s\S]*<\/div>\s*<div class="page-guide-bar">/);
  assert.match(html, /\.repeat-list-scroll\s*\{[^}]*overflow-y:auto/);
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/personal-page-guide-ui.test.mjs`

Expected: FAIL because `repeat-list-scroll` does not exist and `repeat-body` currently scrolls the guide button together with the list.

- [x] **Step 3: Implement the minimal layout change**

Replace the scroll behavior on `.repeat-body` with a flex column that does not itself scroll. Add `.repeat-list-scroll` with `flex:1`, `min-height:0`, `overflow-y:auto`, and the existing iOS momentum scrolling property. Move the existing repeat list header and `#repeatCasesList` into `repeat-list-scroll`; leave the existing `page-guide-bar` as the last child of `.repeat-body`.

```html
<div class="repeat-body">
  <div class="repeat-list-scroll">
    <div class="repeat-list-hdr">…</div>
    <div class="repeat-list-body" id="repeatCasesList"></div>
  </div>
  <div class="page-guide-bar"><button type="button" id="repeatCasesPageGuideBtn" class="page-guide-btn" data-guide-page="repeat">使い方ガイド</button></div>
</div>
```

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `node --test tests/personal-page-guide-ui.test.mjs`

Expected: PASS.

### Task 2: Explain converting a single project into a repeat project

**Files:**
- Modify: `www/index.html:7342-7344`
- Modify: `tests/personal-page-guide-ui.test.mjs`

- [x] **Step 1: Extend the focused test with the approved conversion instructions**

```js
test('repeat guide explains how a single project becomes a repeat project', () => {
  const repeatGuide = html.match(/repeat:\s*\{[\s\S]*?body:\s*`([\s\S]*?)`,\n  \}/)?.[1] || '';
  assert.match(repeatGuide, /単発案件が継続になった時/);
  assert.match(repeatGuide, /「継続案件」を選んで保存/);
  assert.match(repeatGuide, /最初の子案件として残/);
  assert.match(repeatGuide, /次回からは、その継続案件内で子案件を追加/);
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/personal-page-guide-ui.test.mjs`

Expected: FAIL because the repeat guide has no single-to-repeat conversion section.

- [x] **Step 3: Add the approved guide section**

Append this section after the existing A社 example without changing `saveProject`, `createRepeatChild`, or any project data fields:

```html
<h3>単発案件が継続になった時</h3>
<p>元の単発案件を開き、「継続案件」を選んで保存します。<br>元の案件は最初の子案件として残ります。<br>次回からは、その継続案件内で子案件を追加します。</p>
```

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `node --test tests/personal-page-guide-ui.test.mjs`

Expected: PASS.

### Task 3: Verify the narrow change

**Files:**
- Verify: `www/index.html`
- Verify: `tests/personal-page-guide-ui.test.mjs`

- [x] **Step 1: Run the full regression suite**

Run: `npm test`

Expected: all tests pass; an existing emulator skip is allowed.

- [x] **Step 2: Check syntax and whitespace**

Run:

```bash
npm run check:js
npm run check:html
git diff --check
```

Expected: every command exits successfully.

- [ ] **Step 3: Commit only the task files if they can be staged without unrelated hunks**

```bash
git add -p www/index.html tests/personal-page-guide-ui.test.mjs docs/superpowers/plans/2026-09-14-repeat-guide-position-and-conversion.md
git commit -m "fix: align repeat guide and explain conversion"
```

Do not stage unrelated pre-existing changes.
