# Feedback, Update, and Review Prompts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a prominent feedback route, remotely configured update notice, and respectful review-request timing.

**Architecture:** Keep UI and orchestration in the existing app shell; put pure engagement state, version comparison, and mail formatting in a small testable module. The iOS bridge exposes only the installed version.

**Tech Stack:** Vanilla HTML/CSS/JS, Capacitor iOS Swift, Firebase Hosting, Node test runner.

---

### Task 1: Engagement model

**Files:**
- Create: `www/js/app-engagement-model.mjs`
- Create: `tests/app-engagement-model.test.mjs`
- Modify: `package.json`

- [ ] Write tests for the two review triggers, seven-day retry, mail body, and semantic-version comparison.
- [ ] Run `node --test tests/app-engagement-model.test.mjs` and confirm RED because the module is absent.
- [ ] Add `shouldRequestReview`, `nextReviewRequestAt`, `buildFeedbackMail`, `compareVersions`, and `shouldShowUpdate` with no DOM dependencies.
- [ ] Re-run the focused test and add it to `npm test`.

### Task 2: Version source and release configuration

**Files:**
- Modify: `ios/App/App/AppDelegate.swift`
- Create: `www/release.json`
- Modify: `www/index.html`

- [ ] Add failing assertions that the app reads the hosted release file and that an `AppInfo.getVersion` Capacitor plugin exists.
- [ ] Add `AppInfo.getVersion`, returning `CFBundleShortVersionString` only.
- [ ] Add `release.json` with current `latestVersion` and `minimumVersion` set to `1.0` and an empty App Store URL, so no prompt is visible before the product page exists.
- [ ] Fetch `https://dm-management-ecc1f.web.app/release.json` only while online; do not show an update modal without a valid URL.
- [ ] Run focused tests.

### Task 3: Settings feedback and modal UI

**Files:**
- Modify: `www/index.html`
- Modify: `www/i18n.js`
- Create: `tests/settings-feedback-engagement-ui.test.mjs`
- Modify: `package.json`

- [ ] Add failing DOM tests for settings feedback entry, feedback modal, update modal, review modal, and fallback copy button.
- [ ] Add a highlighted settings-home card above templates and the three existing-style sheets.
- [ ] Implement feedback mail composition to `herac.7.app@gmail.com`, including category, app version, platform, and entered text; add clipboard fallback.
- [ ] Persist update snooze and review retry state in `S.meta`, then call existing `save()`.
- [ ] Trigger review eligibility only after successful personal account/project changes, and at app start when seven days have elapsed. Exclude team records and defer while feedback is open.
- [ ] Add Japanese and English text, including secret-data warning.
- [ ] Run focused UI tests.

### Task 4: Full verification and iOS handoff

**Files:**
- Modify: `package.json`
- Modify: `www/index.html`

- [ ] Verify the tests cover individual third registration, first individual completion, team exclusion, seven-day retry, blank feedback, update snooze, and no URL behavior.
- [ ] Run `npm test`, `npm run test:rules`, `npm run check:js`, `npm run check:html`, and `git diff --check`.
- [ ] Run `npm run copy:ios`, build a signed Debug app for the iPhone 16 Pro Max, then install only after successful signature verification.
