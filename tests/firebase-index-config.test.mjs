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

  for (const [collectionGroup, fieldPath] of [
    ['members', 'uid'],
    ['joinRequests', 'uid'],
    ['joinRequests', 'createdBy'],
    ['joinRequests', 'email'],
    ['invites', 'uid'],
    ['invites', 'invitedUid'],
    ['invites', 'createdBy'],
    ['invites', 'email'],
    ['activity', 'actorUid'],
    ['activity', 'targetUid'],
    ['activity', 'memberUid'],
  ]) {
    const override = fieldOverrides.find((entry) => (
      entry.collectionGroup === collectionGroup
      && entry.fieldPath === fieldPath
    ));
    assert.ok(override, `${collectionGroup}.${fieldPath} needs a collection-group index`);
    assert.ok(
      override.indexes?.some((entry) => entry.order === 'ASCENDING' && entry.queryScope === 'COLLECTION_GROUP'),
      `${collectionGroup}.${fieldPath} needs an ascending collection-group index`,
    );
  }

  const activityIdentityIndex = fieldOverrides.find((entry) => (
    entry.collectionGroup === 'activity' && entry.fieldPath === 'identityUids'
  ));
  assert.ok(activityIdentityIndex, 'activity.identityUids needs a collection-group index');
  assert.ok(
    activityIdentityIndex.indexes?.some((entry) => (
      entry.arrayConfig === 'CONTAINS' && entry.queryScope === 'COLLECTION_GROUP'
    )),
    'activity.identityUids needs an array-contains collection-group index',
  );
});

test('account deletion verification declares every collection-group identity lookup', () => {
  const indexConfig = JSON.parse(readFileSync(new URL('../firestore.indexes.json', import.meta.url), 'utf8'));
  const fieldOverrides = Array.isArray(indexConfig.fieldOverrides) ? indexConfig.fieldOverrides : [];
  const ascendingLookups = [
    ['memberEmails', 'uid'], ['memberNotes', 'uid'], ['payouts', 'uid'],
    ['projectRewardShares', 'memberUid'], ['projectRewardShares', 'uid'],
    ['operations', 'actorUid'],
  ];
  const arrayLookups = [
    ['projects', 'assignedUids'], ['projects', 'assigneeUids'],
    ['settings', 'assignOwnerUids'], ['settings', 'assignedUids'], ['settings', 'assigneeUids'],
  ];

  const identityMetadataFields = ['createdBy', 'updatedBy', 'deletedBy', 'ownerUid', 'approvedBy'];
  const protectedCollectionGroups = [
    'folders', 'accounts', 'projects', 'templates', 'settings',
    'projectRewardTotals', 'projectCosts', 'members', 'memberEmails',
    'memberNotes', 'payouts', 'projectRewardShares', 'joinRequests', 'invites',
  ];
  for (const collectionGroup of protectedCollectionGroups) {
    for (const fieldPath of identityMetadataFields) ascendingLookups.push([collectionGroup, fieldPath]);
  }

  for (const [collectionGroup, fieldPath] of ascendingLookups) {
    const override = fieldOverrides.find((entry) => (
      entry.collectionGroup === collectionGroup && entry.fieldPath === fieldPath
    ));
    assert.ok(override, `${collectionGroup}.${fieldPath} needs a collection-group index for account deletion`);
    assert.ok(
      override.indexes?.some((entry) => entry.order === 'ASCENDING' && entry.queryScope === 'COLLECTION_GROUP'),
      `${collectionGroup}.${fieldPath} needs an ascending collection-group index for account deletion`,
    );
  }
  for (const [collectionGroup, fieldPath] of arrayLookups) {
    const override = fieldOverrides.find((entry) => (
      entry.collectionGroup === collectionGroup && entry.fieldPath === fieldPath
    ));
    assert.ok(override, `${collectionGroup}.${fieldPath} needs a collection-group index for account deletion`);
    assert.ok(
      override.indexes?.some((entry) => entry.arrayConfig === 'CONTAINS' && entry.queryScope === 'COLLECTION_GROUP'),
      `${collectionGroup}.${fieldPath} needs an array-contains collection-group index for account deletion`,
    );
  }
});
