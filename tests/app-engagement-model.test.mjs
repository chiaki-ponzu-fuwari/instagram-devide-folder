import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REVIEW_RETRY_MS,
  buildFeedbackMail,
  compareVersions,
  nextReviewRequestAt,
  shouldRequestReview,
  shouldShowUpdate,
} from '../www/js/app-engagement-model.mjs';

test('review request starts after the third personal project or first completed personal project', () => {
  assert.equal(shouldRequestReview({ projectCount: 3, hasCompletedProject: false, now: 100, state: {} }), true);
  assert.equal(shouldRequestReview({ projectCount: 1, hasCompletedProject: true, now: 100, state: {} }), true);
  assert.equal(shouldRequestReview({ projectCount: 2, hasCompletedProject: false, now: 100, state: {} }), false);
});

test('review request waits seven days after either defer choice', () => {
  const later = nextReviewRequestAt(100);
  assert.equal(later, 100 + REVIEW_RETRY_MS);
  assert.equal(shouldRequestReview({ projectCount: 3, hasCompletedProject: false, now: later - 1, state: { nextReviewRequestAt: later } }), false);
  assert.equal(shouldRequestReview({ projectCount: 3, hasCompletedProject: false, now: later, state: { nextReviewRequestAt: later } }), true);
});

test('feedback mail includes the category, app details, and entered message', () => {
  const mail = buildFeedbackMail({ category: 'bug', message: '保存できません', appVersion: '1.0', platform: 'iOS 18' });
  assert.equal(mail.to, 'herac.7.app@gmail.com');
  assert.match(mail.subject, /不具合/);
  assert.match(mail.body, /保存できません/);
  assert.match(mail.body, /iOS 18/);
});

test('release visibility requires a configured App Store URL and a newer version', () => {
  assert.equal(compareVersions('1.0.1', '1.0'), 1);
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
  assert.equal(shouldShowUpdate({ currentVersion: '1.0', release: { latestVersion: '1.0.1', appStoreUrl: 'https://apps.apple.com/app/id1' }, now: 100, state: {} }), true);
  assert.equal(shouldShowUpdate({ currentVersion: '1.0', release: { latestVersion: '1.0.1', appStoreUrl: '' }, now: 100, state: {} }), false);
});
