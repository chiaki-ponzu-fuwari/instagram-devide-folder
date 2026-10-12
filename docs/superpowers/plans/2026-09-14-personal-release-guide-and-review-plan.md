# Personal Release Guide and Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the personal-only first release easier to use: flag all same-day schedule events as needing review, hide the unreleased team-reward scope, and add clear global and page-specific help.

**Architecture:** Keep all team code and saved settings intact. A small personal-release flag controls the team-reward selector visibility. Reuse the existing settings guide pane for the global guide, and add a reusable guide-sheet opener for page-specific help plus a once-per-page localStorage animation marker.

**Tech Stack:** Static HTML/CSS/JavaScript, Node built-in test runner, Capacitor iOS asset copy.

---

### Task 1: Add same-day items to personal schedule review

**Files:**
- Modify: `www/index.html:13608-13660`
- Modify: `www/i18n.js`
- Modify: `tests/schedule-review-badge.test.mjs`

- [ ] **Step 1: Write failing review-mode assertions**

Add assertions that review mode calls a helper for `shootDate`, `draftAt`, and `deadline`, and keeps existing overdue-post and unpaid-delivered paths.

- [ ] **Step 2: Run the narrow test**

Run: `node --test tests/schedule-review-badge.test.mjs`

Expected: FAIL because same-day checks are absent.

- [ ] **Step 3: Implement the smallest review additions**

Add a date-only same-day helper. In review mode add an item for each same-day shoot, draft, or post event for non-delivered/non-closed projects. Do not duplicate the same post event when it is already overdue. Add Japanese/English labels and update the empty-state text to mention today.

- [ ] **Step 4: Re-run the narrow test**

Run: `node --test tests/schedule-review-badge.test.mjs`

Expected: PASS.

### Task 2: Hide unreleased team-reward controls without removing their logic

**Files:**
- Modify: `www/index.html:3628-3634, 10166-10171`
- Modify: `tests/personal-team-reward-scope.test.mjs`

- [ ] **Step 1: Write a failing release-gate test**

Assert that the existing team-reward selector remains in the source but is hidden when the personal-release flag is false, and that `personal_plus_team_share` remains supported in the scope function.

- [ ] **Step 2: Run the narrow test**

Run: `node --test tests/personal-team-reward-scope.test.mjs`

Expected: FAIL because the selector is visible.

- [ ] **Step 3: Implement the release gate**

Use a named `TEAM_REWARD_SCOPE_RELEASED = false` constant. Apply `hidden` to the team selector and its sync note when false. Keep the button handlers, saved scope values, and reward aggregation code unchanged so a later release only changes the flag.

- [ ] **Step 4: Re-run the narrow test**

Run: `node --test tests/personal-team-reward-scope.test.mjs`

Expected: PASS.

### Task 3: Create global and page-specific personal guides

**Files:**
- Modify: `www/index.html` (guide content, page guide controls, CSS, sheet controller and event bindings)
- Modify: `www/i18n.js`
- Create: `tests/personal-page-guide-ui.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write a failing UI test**

Assert: the settings guide contains the overall flow; personal list, schedule, and revenue pages each contain a bottom-centered guide button; the guide sheet opens page-specific content; the bounce marker is only selected through a page key saved in localStorage.

- [ ] **Step 2: Run the narrow test**

Run: `node --test tests/personal-page-guide-ui.test.mjs`

Expected: FAIL because page guide controls and sheet do not exist.

- [ ] **Step 3: Implement the reusable guide sheet and controls**

Add a modest, bottom-centered outlined pill matching the supplied PeriShare reference. Put it above the safe-area / FAB region and do not change existing navigation. Each personal page opens concise page-specific content. The settings guide becomes the whole-app guide. Add a short one-time CSS bounce that records its completed page key locally; it must respect `prefers-reduced-motion`.

- [ ] **Step 4: Re-run the narrow test**

Run: `node --test tests/personal-page-guide-ui.test.mjs`

Expected: PASS.

### Task 4: Validate the personal release surface

**Files:**
- Modify only if a test exposes a defect in the scoped changes.

- [ ] **Step 1: Run all automated checks**

Run: `npm test && npm run check:js && npm run check:html && git diff --check`

Expected: all tests pass and no whitespace errors.

- [ ] **Step 2: Browser-check personal screens**

At 320px and 430px, confirm: no horizontal overflow; guide buttons do not cover the FAB; the reward team selector is absent; guide sheet opens and closes; all current-day review categories render.

- [ ] **Step 3: Copy final web assets to iOS and build**

Run: `npm run copy:ios` followed by the existing generic iPhone Release build command.

Expected: asset copy and build succeed. This is a build, not an installation on a device.
