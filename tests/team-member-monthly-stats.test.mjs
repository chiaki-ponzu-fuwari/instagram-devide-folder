import assert from 'node:assert/strict';
import test from 'node:test';
import { getTeamMemberProjectStats } from '../www/js/team-member-stats.mjs';

test('member stats use assignee UIDs rather than reward allocations', () => {
  const stats = getTeamMemberProjectStats([
    { id: 'p1', status: '契約中', assigneeUids: ['u1'], rewardAllocations: [] },
    { id: 'p2', status: '契約中', assigneeUids: [], rewardAllocations: [{ uid: 'u2', assigned: true }] },
  ], { monthKey: '2026-08', timeZone: 'Asia/Tokyo' });
  assert.deepEqual(stats.get('u1'), { inProgress: 1, completedThisMonth: 0 });
  assert.equal(stats.has('u2'), false);
});

test('completed count uses completedAt in the selected Tokyo month', () => {
  const stats = getTeamMemberProjectStats([
    { id: 'aug', status: '終了', assigneeUids: ['u1'], completedAt: '2026-07-31T15:00:00.000Z' },
    { id: 'jul', status: '終了', assigneeUids: ['u1'], completedAt: '2026-07-31T14:59:59.999Z' },
    { id: 'unknown', status: '終了', assigneeUids: ['u1'] },
  ], { monthKey: '2026-08', timeZone: 'Asia/Tokyo' });
  assert.deepEqual(stats.get('u1'), { inProgress: 0, completedThisMonth: 1 });
});
