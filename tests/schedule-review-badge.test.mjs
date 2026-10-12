import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const indexHtml = readFileSync(new URL('../www/index.html', import.meta.url), 'utf8');

test('review badges are non-interactive children of the existing schedule entrances', () => {
  assert.match(
    indexHtml,
    /id="schedBtn"[\s\S]*?id="personalScheduleReviewBadge" class="schedule-review-badge" hidden aria-hidden="true">!<\/span>[\s\S]*?<\/button>/,
  );
  assert.match(
    indexHtml,
    /id="teamDeadlineBanner"[\s\S]*?id="teamScheduleReviewBadge" class="schedule-review-badge" hidden aria-hidden="true">!<\/span>[\s\S]*?<\/button>/,
  );
  assert.match(indexHtml, /\.schedule-review-badge\s*\{[^}]*pointer-events:\s*none[^}]*\}/);
  assert.match(indexHtml, /\.schedule-review-badge\[hidden\]\s*\{[^}]*display:\s*none[^}]*\}/);
  assert.doesNotMatch(indexHtml, /personalScheduleReviewBadge['"]?\)\.addEventListener|teamScheduleReviewBadge['"]?\)\.addEventListener/);
});

test('badge updater counts only personal projects and the selected team full project set', () => {
  assert.match(
    indexHtml,
    /const personalRecords = \(S\.accounts \|\| \[\]\)\.filter\(\(a\) => isScopedProject\(a, 'personal'\)\)/,
  );
  assert.match(
    indexHtml,
    /const teamRecords = teamId \? getTeamAnalysisRecords\(teamId\) : \[\]/,
  );
  assert.match(
    indexHtml,
    /_scheduleItemsForAccounts\(personalRecords, 'review', \{ team: false \}\)\.length/,
  );
  assert.match(
    indexHtml,
    /_scheduleItemsForAccounts\(teamRecords, 'review', \{ team: true \}\)\.length/,
  );
  assert.match(indexHtml, /badge\.hidden = count === 0/);
});

test('review mode includes today schedule items, overdue posts, and unpaid delivered projects', () => {
  const reviewBlock = indexHtml.match(
    /if \(mode === 'review'\) \{([\s\S]*?)\n\s*return;\n\s*\}/,
  )?.[1];
  assert.ok(reviewBlock, 'review-mode schedule block should exist');
  assert.match(indexHtml, /function _scheduleIsReviewToday\(project, field\)/);
  assert.match(reviewBlock, /\['shootDate', shoot, 'review_today_shoot'/);
  assert.match(reviewBlock, /\['draftAt', draft, 'review_today_draft'/);
  assert.match(reviewBlock, /\['deadline', due, 'review_today_deadline'/);
  assert.match(reviewBlock, /_scheduleIsReviewToday\(p, field\)/);
  assert.match(reviewBlock, /_scheduleIsReviewOverdue\(p, 'deadline'\)/);
  assert.match(reviewBlock, /st === '納品済' && !p\?\.paidConfirmed/);
  assert.doesNotMatch(reviewBlock, /_scheduleIsReviewOverdue\(p, 'shootDate'\)/);
  assert.doesNotMatch(reviewBlock, /_scheduleIsReviewOverdue\(p, 'draftAt'\)/);
});
