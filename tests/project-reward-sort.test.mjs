import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sortMod = require('../www/js/project-list-sort.js');

const { sortAccountsForDisplay, sortAccountsByReward } = sortMod;

test('どの表示順でも終了済み案件は進行中の下にまとめる', () => {
  const input = [
    { id: 'done-high', pinned: true, createdAt: 4, project: { rewardYen: 50000, status: '終了' } },
    { id: 'open-low', pinned: true, createdAt: 3, project: { rewardYen: 1000, status: '契約中' } },
    { id: 'open-high', createdAt: 2, project: { rewardYen: 30000, status: '契約中' } },
    { id: 'done-low', createdAt: 1, project: { rewardYen: 2000, status: '終了' } },
  ];

  const sorted = sortAccountsForDisplay(input, 'reward').ordered.map((row) => row.id);
  assert.deepEqual(sorted, ['open-low', 'open-high', 'done-high', 'done-low']);
});

test('ピン留めは進行中・終了済みそれぞれの中だけで上に来る', () => {
  const sorted = sortAccountsForDisplay([
    { id: 'open', createdAt: 2, project: { status: '契約中' } },
    { id: 'open-pinned', pinned: true, createdAt: 1, project: { status: '契約中' } },
    { id: 'done', createdAt: 4, project: { status: '終了' } },
    { id: 'done-pinned', pinned: true, createdAt: 3, project: { status: '終了' } },
  ], 'newest').ordered.map((row) => row.id);

  assert.deepEqual(sorted, ['open-pinned', 'open', 'done-pinned', 'done']);
});

test('投稿日時順は日付の早い順で、未入力は後ろ', () => {
  const sorted = sortAccountsForDisplay([
    { id: 'later', createdAt: 1, project: { deadline: '2026-03-10T10:00', status: '契約中' } },
    { id: 'none', createdAt: 2, project: { status: '契約中' } },
    { id: 'earlier', createdAt: 3, project: { deadline: '2026-03-01T09:00', status: '契約中' } },
  ], 'deadline').ordered.map((row) => row.id);

  assert.deepEqual(sorted, ['earlier', 'later', 'none']);
});

test('報酬額順は通貨記号やカンマを含む既存の金額も比較できる', () => {
  const sorted = sortAccountsByReward([
    { id: 'ten-thousand', createdAt: 1, project: { rewardYen: '¥10,000' } },
    { id: 'twenty-thousand', createdAt: 2, project: { rewardYen: '20,000円' } },
    { id: 'blank', createdAt: 3, project: { rewardYen: '' } },
  ]).map((row) => row.id);

  assert.deepEqual(sorted, ['twenty-thousand', 'ten-thousand', 'blank']);
});
