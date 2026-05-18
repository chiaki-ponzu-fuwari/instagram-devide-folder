# 継続案件バッジ整理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 案件一覧の表示ラベルを整理し、進行中ステータスだけを見やすく残して、継続関連の表示は継続案件リストへ寄せる。

**Architecture:** メインの案件一覧では案件の進行ステータスだけを表示し、継続案件の親子関係や契約終了状態は詳細画面と継続案件リストに限定する。既存の状態管理と描画ロジックを崩さず、表示条件だけを分岐させる。

**Tech Stack:** Vanilla JavaScript, HTML/CSS, Capacitor iOS

---

### Task 1: Main list badge cleanup

**Files:**
- Modify: `www/index.html`

- [ ] **Step 1: Update the badge rendering rules**

```js
function cardHTML(a) {
  const p = a.project || {};
  const status = normalizeStatus(p.status) || '';
  const statusBadge = status
    ? `<span class="status-badge status-${esc(status)}">${esc(status)}</span>`
    : '';
  const repeatBadge = '';
  const closedBadge = '';
  // main list keeps only the status badge
}
```

- [ ] **Step 2: Run the existing checks**

Run:
```bash
npm run check:js
npm run check:html
```
Expected: PASS

### Task 2: Keep repeat labels inside repeat views only

**Files:**
- Modify: `www/index.html`

- [ ] **Step 1: Keep repeat labels in repeat list and detail views**

```js
function renderRepeatCasesList() {
  const childBadge = `<span class="repeat-parent-meta">${esc(tt('repeat_cases_child_count', { n: repeatDisplayChildCount(a.id) }))}</span>`;
  const isClosed = !!String(a?.project?.repeatClosedAt || '').trim();
  // repeat list still shows repeat-specific labels
}
```

- [ ] **Step 2: Verify the repeat list still shows closed-state information**

Run:
```bash
npm run check:js
npm run check:html
```
Expected: PASS

- [ ] **Step 3: Sync iOS assets**

Run:
```bash
npx cap sync ios
```
Expected: sync completes without errors

