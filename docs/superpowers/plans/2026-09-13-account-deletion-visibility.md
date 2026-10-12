# Account Deletion Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the account deletion entry at the bottom of Settings whenever Firebase has a signed-in user, without changing the deletion flow.

**Architecture:** Keep the existing `settingsAccountDeletion` element and its event listener. Move it out of the collapsible login choices into the Settings home list; `updateLoginUi()` remains the single place that toggles its `hidden` state from Firebase Auth.

**Tech Stack:** Vanilla HTML/JavaScript, Node.js built-in test runner.

---

### Task 1: Visible signed-in account deletion entry

**Files:**
- Modify: `www/index.html:3185-3235`
- Modify: `tests/account-deletion-ui.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
test('settings keeps account deletion outside the collapsible login choices', () => {
  const deletionIndex = html.indexOf('id="settingsAccountDeletion"');
  const loginChoicesStart = html.indexOf('id="settingsLoginChoices"');
  const loginChoicesEnd = html.indexOf('</div>\n        </div>\n        <div class="settings-item">', loginChoicesStart);
  assert.ok(deletionIndex > loginChoicesEnd);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/account-deletion-ui.test.mjs`

Expected: the new test fails because `settingsAccountDeletion` is inside `settingsLoginChoices`.

- [ ] **Step 3: Write minimal implementation**

Move the existing block without changing its ID, button ID, styles, or click handler:

```html
<div class="settings-item" id="settingsAccountDeletionRow">
  <div class="account-deletion-danger" id="settingsAccountDeletion" hidden>
    <button id="settingsDeleteAccountBtn" type="button">アカウントを削除</button>
  </div>
</div>
```

- [ ] **Step 4: Run tests to verify it passes**

Run: `node --test tests/account-deletion-ui.test.mjs`

Expected: all account-deletion UI tests pass.

- [ ] **Step 5: Run release regression checks**

Run: `npm test && npm run check:js && npm run check:html && git diff --check`

Expected: exit code 0.
