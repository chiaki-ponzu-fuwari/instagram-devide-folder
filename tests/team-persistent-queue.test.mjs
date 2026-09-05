import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMemoryStorage,
  createTeamMutationQueue,
  shouldApplyProjectMutation,
} from '../www/js/team-mutation-queue.mjs';

test('team mutation survives queue reconstruction until explicitly removed', () => {
  const storage = createMemoryStorage();
  const input = {
    operationId: 'op-1', teamId: 't1', type: 'update', projectId: 'p1',
    baseRevision: 2, actorUid: 'u1', createdAt: 100, payload: { revision: 3 },
  };
  createTeamMutationQueue({ storage, uid: 'u1' }).enqueue(input);
  const restored = createTeamMutationQueue({ storage, uid: 'u1' });
  assert.deepEqual(restored.list(), [input]);
  restored.remove('op-1');
  assert.deepEqual(createTeamMutationQueue({ storage, uid: 'u1' }).list(), []);
});

test('queue de-duplicates operation IDs and keeps a failed operation', () => {
  const storage = createMemoryStorage();
  const queue = createTeamMutationQueue({ storage, uid: 'u1' });
  const operation = { operationId: 'same', teamId: 't1', type: 'delete', projectId: 'p1', actorUid: 'u1' };
  queue.enqueue(operation);
  queue.enqueue({ ...operation, createdAt: 2 });
  assert.equal(queue.list().length, 1);
  assert.equal(queue.list()[0].createdAt, 2);
});

test('stale normal update cannot overwrite a tombstone', () => {
  assert.deepEqual(
    shouldApplyProjectMutation({ current: { revision: 4, deletedAt: 100 }, mutation: { type: 'update', baseRevision: 3 } }),
    { apply: false, reason: 'project-deleted' },
  );
  assert.deepEqual(
    shouldApplyProjectMutation({ current: { revision: 4, deletedAt: null }, mutation: { type: 'update', baseRevision: 2 } }),
    { apply: false, reason: 'stale-revision' },
  );
});
