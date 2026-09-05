import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const firebaseConfig = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'));

test('firebase deploy includes Firestore index configuration', () => {
  assert.equal(firebaseConfig.firestore.indexes, 'firestore.indexes.json');
});

test('single-field collection group queries declare Firestore collection-group indexes', () => {
  const indexConfig = JSON.parse(readFileSync(new URL('../firestore.indexes.json', import.meta.url), 'utf8'));
  const fieldOverrides = Array.isArray(indexConfig.fieldOverrides) ? indexConfig.fieldOverrides : [];

  for (const collectionGroup of ['members', 'joinRequests']) {
    const override = fieldOverrides.find((entry) => (
      entry.collectionGroup === collectionGroup
      && entry.fieldPath === 'uid'
    ));
    assert.ok(override, `${collectionGroup}.uid needs a collection-group index`);
    assert.ok(
      override.indexes?.some((entry) => entry.order === 'ASCENDING' && entry.queryScope === 'COLLECTION_GROUP'),
      `${collectionGroup}.uid needs an ascending collection-group index`,
    );
  }
});
