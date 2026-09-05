import test from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteField, serverTimestamp } from 'firebase/firestore';

const projectId = 'dm-manager-rules';

function securitySettings(overrides = {}) {
  return {
    rewardVisibility: 'self',
    memberEmailVisibility: 'admin_only',
    memberNoteVisibility: 'admin_only',
    memberPayoutVisibility: 'admin_only',
    assignPermission: 'admin_only',
    assignOwnerUids: [],
    deletePermission: 'admin_only',
    ...overrides,
  };
}

function publicAccount(id, updatedBy, overrides = {}) {
  return {
    id, teamId: 't1', scope: 'team', username: `@${id}`,
    createdAt: 1, updatedAt: 1, updatedBy, revision: 1,
    deletedAt: null, deletedBy: null, schemaVersion: 2,
    ...overrides,
  };
}

function publicProject(id, updatedBy, overrides = {}) {
  return {
    id, accountId: id, teamId: 't1', scope: 'team', contractType: 'single',
    status: '契約中', name: id, assignedUids: [],
    createdAt: 1, updatedAt: 1, updatedBy, revision: 1,
    deletedAt: null, deletedBy: null, schemaVersion: 2,
    ...overrides,
  };
}

function publicFolder(id, updatedBy, overrides = {}) {
  return {
    id, teamId: 't1', scope: 'team', name: id, color: '#2F86D9', parentId: null,
    order: 0, collapsed: false, createdAt: 1, updatedAt: 1, updatedBy, revision: 1,
    deletedAt: null, deletedBy: null, schemaVersion: 2,
    ...overrides,
  };
}

function publicTemplate(id, updatedBy, overrides = {}) {
  return {
    id, teamId: 't1', scope: 'team', title: id, body: 'Template body',
    createdAt: 1, updatedAt: 1, updatedBy, revision: 1,
    deletedAt: null, deletedBy: null, schemaVersion: 2,
    ...overrides,
  };
}

function publicWorkspaceSettings(updatedBy, overrides = {}) {
  return {
    id: 'main', teamId: 't1', scope: 'team', hideDoneProjectsInList: false,
    hideRepeatClosedProjectsInRepeatList: false, revenueBasis: 'deadline',
    createdAt: 1, updatedAt: 1, updatedBy, revision: 1, schemaVersion: 2,
    ...overrides,
  };
}

async function createEnv() {
  const env = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: '127.0.0.1',
      port: 8088,
    },
  });
  await env.clearFirestore();
  return env;
}

async function seedTeamData(env) {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await db.doc('teams/t1').set({
      createdBy: 'u1',
      deletedAt: null,
      name: 'Team One',
      memberUids: ['u1', 'u2'],
      securitySchemaVersion: 2,
      securityMigrationState: 'ready',
      settings: securitySettings(),
    });
    await db.doc('teams/t1/members/u1').set({
      uid: 'u1',
      role: 'admin',
      status: 'active',
      displayName: 'Admin',
      createdAt: 1, updatedAt: 1, updatedBy: 'u1',
    });
    await db.doc('teams/t1/members/u2').set({
      uid: 'u2',
      role: 'member',
      status: 'active',
      displayName: 'Member',
      createdAt: 1, updatedAt: 1, updatedBy: 'u1',
    });
    await db.doc('teams/t1/members/u3').set({
      uid: 'u3',
      role: 'member',
      status: 'pending',
      displayName: 'Pending',
      createdAt: 1, updatedAt: 1, updatedBy: 'u1',
    });
    await db.doc('teams/t1/folders/f1').set(publicFolder('f1', 'u1'));
    await db.doc('teams/t1/accounts/a1').set(publicAccount('a1', 'u1'));
    await db.doc('teams/t1/templates/x1').set(publicTemplate('x1', 'u1'));
    await db.doc('teams/t1/settings/main').set(publicWorkspaceSettings('u1'));
    await db.doc('teams/t1/activity/act1').set({ text: 'created' });
    await db.doc('teams/t1/invites/i1').set({
      code: 'ABCD1234',
      createdBy: 'u1',
      disabledAt: null,
      teamId: 't1',
      teamName: 'Team One',
    });
    await db.doc('teamInviteCodes/ABCD1234').set({
      code: 'ABCD1234',
      teamId: 't1',
      inviteId: 'i1',
      teamName: 'Team One',
      disabledAt: null,
      createdBy: 'u1',
    });
    await db.doc('teams/t1/joinRequests/r1').set({
      uid: 'u3',
      status: 'pending',
      requestedAt: 1778493600000,
    });

    await db.doc('teams/t2').set({
      createdBy: 'u9',
      deletedAt: null,
      name: 'Team Two',
      memberUids: ['u9'],
    });
    await db.doc('teams/t2/members/u9').set({
      uid: 'u9',
      role: 'admin',
      status: 'active',
      editScope: 'all',
      rewardScope: 'all',
    });
    await db.doc('teams/t2/folders/f2').set({ name: 'Private' });
  });
}

test('account deletion jobs are inaccessible to every client including the owner', async () => {
  const env = await createEnv();
  try {
    await env.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('accountDeletionJobs/u1_request').set({ uid: 'u1' });
      await context.firestore().doc('accountDeletionLocks/u1').set({ uid: 'u1' });
    });
    const owner = env.authenticatedContext('u1').firestore();
    const other = env.authenticatedContext('u2').firestore();
    const anonymous = env.unauthenticatedContext().firestore();
    for (const client of [owner, other, anonymous]) {
      await assertFails(client.doc('accountDeletionJobs/u1_request').get());
      await assertFails(client.doc('accountDeletionJobs/u1_request').set({ uid: 'u1' }));
      await assertFails(client.doc('accountDeletionLocks/u1').get());
      await assertFails(client.doc('accountDeletionLocks/u1').set({ uid: 'u1' }));
    }
  } finally { await env.cleanup(); }
});

test('owners cannot physically delete their user root or any known personal collection document', async () => {
  const env = await createEnv();
  try {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.doc('users/u1').set({ uid: 'u1' });
      for (const name of ['folders', 'accounts', 'projects', 'templates', 'settings']) {
        await db.doc(`users/u1/${name}/one`).set({ revision: 1, updatedAt: 1, updatedBy: 'u1' });
      }
    });
    const owner = env.authenticatedContext('u1').firestore();
    await assertFails(owner.doc('users/u1').delete());
    for (const name of ['folders', 'accounts', 'projects', 'templates', 'settings']) {
      await assertFails(owner.doc(`users/u1/${name}/one`).delete());
    }
  } finally { await env.cleanup(); }
});

test('deletion lock blocks identity recreation while unrelated users keep normal access', async () => {
  const env = await createEnv();
  try {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.doc('accountDeletionLocks/u1').set({ uid: 'u1', phase: 'started' });
      await db.doc('users/u1').set({ uid: 'u1' });
      await db.doc('teams/tLock').set({
        createdBy: 'u2', memberUids: ['u2'], securitySchemaVersion: 2,
        securityMigrationState: 'ready', settings: securitySettings(),
      });
      await db.doc('teams/tLock/members/u2').set({
        uid: 'u2', role: 'admin', status: 'active', displayName: 'Admin',
        createdAt: 1, updatedAt: 1, updatedBy: 'u2',
      });
      await db.doc('teams/tLock/members/u1').set({
        uid: 'u1', role: 'member', status: 'active', displayName: 'Locked',
        createdAt: 1, updatedAt: 1, updatedBy: 'u2',
      });
      await db.doc('teams/tLock/invites/open').set({ disabledAt: null });
      await db.doc('teams/tSettings/joinRequests/array-ref').set({ uid: 'u2', status: 'pending' });
      await db.doc('teams/tSettings').set({
        createdBy: 'u2', memberUids: ['u2'], securitySchemaVersion: 1,
        securityMigrationState: 'locked', settings: securitySettings(),
      });
      await db.doc('teams/tSettings/members/u2').set({
        uid: 'u2', role: 'admin', status: 'active', displayName: 'Admin',
        createdAt: 1, updatedAt: 1, updatedBy: 'u2',
      });
      await db.doc('teams/tLegacyArrays').set({
        createdBy: 'u2', memberUids: ['u2'], assignedUids: ['legacy-user'],
        securitySchemaVersion: 1, securityMigrationState: 'locked',
        settings: securitySettings(),
      });
      await db.doc('teams/tLegacyArrays/members/u2').set({
        uid: 'u2', role: 'admin', status: 'active', displayName: 'Admin',
        createdAt: 1, updatedAt: 1, updatedBy: 'u2',
      });
    });
    const locked = env.authenticatedContext('u1').firestore();
    const admin = env.authenticatedContext('u2').firestore();
    await assertFails(locked.doc('users/u1').update({ touched: true }));
    await assertFails(locked.doc('users/u1/projects/new').set({
      id: 'new', ownerUid: 'u1', revision: 1, updatedAt: 1, updatedBy: 'u1',
    }));
    await assertFails(locked.doc('teams/tLock/joinRequests/u1').set({
      uid: 'u1', status: 'pending', inviteId: 'open',
    }));
    await assertFails(locked.doc('teams/new-locked').set({
      createdBy: 'u1', deletedAt: null, securitySchemaVersion: 1,
      securityMigrationState: 'locked', settings: securitySettings(),
    }));
    await assertFails(locked.doc('teams/tLock/folders/locked-write').set(
      publicFolder('locked-write', 'u1', { teamId: 'tLock' }),
    ));
    await assertFails(admin.doc('teams/tLock').update({ memberUids: ['u2', 'u1'] }));
    await assertFails(admin.doc('teams/tLock/invites/locked').set({ invitedUid: 'u1' }));
    await assertFails(admin.doc('teams/tLock/members/u1').set({
      uid: 'u1', role: 'member', status: 'active', displayName: 'Locked',
      createdAt: 2, updatedAt: 2, updatedBy: 'u2',
    }));
    await assertFails(admin.doc('teams/tLock/memberEmails/u1').set({
      uid: 'u1', email: 'locked@example.com', createdAt: 2, updatedAt: 2, updatedBy: 'u2',
    }));
    await assertFails(admin.doc('teams/tLock/memberNotes/u1').set({
      uid: 'u1', note: 'locked', createdAt: 2, updatedAt: 2, updatedBy: 'u2',
    }));
    await assertFails(admin.doc('teams/tLock/payouts/u1').set({
      uid: 'u1', payoutName: 'Locked', payoutAccount: '', payoutBankCode: '', payoutBankName: '',
      payoutBranchName: '', payoutBranchCode: '', payoutAccountType: '', payoutAccountNumber: '',
      updatedAt: 2, updatedBy: 'u2',
    }));
    await assertFails(admin.doc('teams/tLock/projectRewardShares/p1_u1').set({
      projectId: 'p1', memberUid: 'u1', amountYen: 0, assigned: false,
      createdAt: 2, updatedAt: 2, updatedBy: 'u2',
    }));
    await assertFails(admin.doc('teams/tLock/activity/locked-target').set({
      action: 'removeMember', text: 'AdminさんがLockedさんを外しました',
      coreText: 'Lockedさんを外しました', actorUid: 'u2', actorName: 'Admin',
      targetUid: 'u1', targetName: 'Locked', identityUids: ['u1', 'u2'],
      createdAt: serverTimestamp(),
    }));
    await assertFails(admin.doc('teams/tLock/projects/locked-assignment').set(
      publicProject('locked-assignment', 'u2', { teamId: 'tLock', assignedUids: ['u1'] }),
    ));
    await assertFails(admin.doc('teams/tLock').update({
      'settings.assignOwnerUids': ['u1'],
    }));
    await assertFails(admin.doc('teams/tSettings/settings/main').set({
      assignOwnerUids: ['u1'],
    }));
    await assertSucceeds(admin.doc('teams/tSettings/settings/main').set({
      assignOwnerUids: ['u2'],
    }));
    await assertFails(admin.doc('teams/tSettings').update({ createdBy: 'u1' }));
    await assertFails(admin.doc('teams/tSettings').update({ ownerUid: 'u1' }));
    await assertFails(admin.doc('teams/tSettings').update({ assignedUids: ['u1'] }));
    await assertSucceeds(admin.doc('teams/tSettings').update({ name: 'Normal update' }));
    await assertSucceeds(admin.doc('teams/tLegacyArrays').update({ name: 'Legacy preserved' }));
    await assertSucceeds(admin.doc('teams/tLegacyArrays').update({ assignedUids: deleteField() }));
    await assertFails(admin.doc('teams/tSettings/folders/locked-owner').set({ createdBy: 'u1' }));
    await assertFails(admin.doc('teams/tSettings/templates/locked-owner').set({ ownerUid: 'u1' }));
    await assertFails(admin.doc('teams/tSettings/settings/locked-updater').set({ updatedBy: 'u1' }));
    await assertFails(admin.doc('teams/tSettings/projects/locked-assignment').set({ assignedUids: ['u1'] }));
    await assertFails(admin.doc('teams/tSettings/projects/malformed-assignment').set({ assignedUids: 'u2' }));
    await assertFails(admin.doc('teams/tSettings/folders/locked-array').set({ memberUids: ['u1'] }));
    await assertFails(admin.doc('teams/tSettings/invites/locked-array').set({ memberUids: ['u1'] }));
    await assertFails(admin.doc('teams/tSettings/joinRequests/array-ref').update({ memberUids: ['u1'] }));
    await assertSucceeds(admin.doc('teams/tSettings/folders/unlocked-owner').set({ createdBy: 'u2' }));
    await assertSucceeds(admin.doc('teams/tSettings/invites/unlocked').set({ invitedUid: 'u2' }));
    const approval = admin.batch();
    approval.set(admin.doc('teams/tLock/members/u3'), {
      uid: 'u3', role: 'member', status: 'active', displayName: 'Unlocked',
      createdAt: 3, updatedAt: 3, updatedBy: 'u2',
    });
    approval.update(admin.doc('teams/tLock'), { memberUids: ['u2', 'u3'] });
    await assertSucceeds(approval.commit());
    await assertSucceeds(admin.doc('teams/tLock/projects/multi-assignment').set(
      publicProject('multi-assignment', 'u2', { teamId: 'tLock', assignedUids: ['u2', 'u3'] }),
    ));
    await assertSucceeds(admin.doc('teams/tLock').update({
      'settings.assignOwnerUids': ['u3'],
    }));
    await assertSucceeds(admin.doc('users/u2').set({ uid: 'u2' }));
    await assertSucceeds(admin.doc('teams/tLock/invites/other').set({ invitedUid: 'u3' }));
  } finally { await env.cleanup(); }
});

test('remaining members can read canonical assignedUids projects', async () => {
  const env = await createEnv();
  try {
    await seedReadyTeamData(env);
    const member = env.authenticatedContext('u2').firestore();
    await assertSucceeds(member.doc('teams/tReady/projects/p1').get());
  } finally { await env.cleanup(); }
});

async function seedLegacyTeamData(env) {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc('teams/tLegacy').set({
      createdBy: 'u1',
      securitySchemaVersion: 1,
      securityMigrationState: 'locked',
      name: 'Legacy Team',
    });
    await db.doc('teams/tLegacy/members/u1').set({
      uid: 'u1', role: 'admin', status: 'active', email: 'admin@example.com', note: 'admin note',
    });
    await db.doc('teams/tLegacy/members/u2').set({
      uid: 'u2', role: 'member', status: 'active', email: 'member@example.com', note: 'member note',
    });
    await db.doc('teams/tLegacy/accounts/a1').set({
      id: 'a1', name: 'Legacy account', project: { rewardYen: 12000, costYen: 3000 },
    });
    await db.doc('teams/tLegacy/projects/p1').set({
      id: 'p1', name: 'Legacy project', costYen: 3000,
    });
    await db.doc('teams/tLegacy/settings/main').set({ any: 'legacy' });
    await db.doc('teams/tLegacy/folders/f1').set({ name: 'legacy folder' });
    await db.doc('teams/tLegacy/templates/x1').set({ name: 'legacy template' });
    await db.doc('teams/tLegacy/activity/a1').set({ text: 'legacy activity' });
  });
}

async function seedReadyTeamData(env) {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc('teams/tReady').set({
      createdBy: 'u1', securitySchemaVersion: 2, securityMigrationState: 'ready', name: 'Ready Team',
      memberUids: ['u1', 'u2', 'u3'],
      settings: securitySettings(),
    });
    for (const [uid, role] of [['u1', 'admin'], ['u2', 'member'], ['u3', 'member']]) {
      await db.doc(`teams/tReady/members/${uid}`).set({
        uid, role, status: 'active', displayName: uid, photoURL: null, createdAt: 1, updatedAt: 1, updatedBy: 'u1',
      });
    }
    await db.doc('teams/tReady/memberEmails/u1').set({ uid: 'u1', email: 'admin@example.com', updatedAt: 1, updatedBy: 'u1' });
    await db.doc('teams/tReady/memberNotes/u1').set({ uid: 'u1', note: 'private', updatedAt: 1, updatedBy: 'u1' });
    await db.doc('teams/tReady/payouts/u2').set({ uid: 'u2', payoutName: 'Member Name', updatedAt: 1, updatedBy: 'u2' });
    await db.doc('teams/tReady/projects/p1').set(publicProject('p1', 'u1', { teamId: 'tReady', assignedUids: ['u2'] }));
    await db.doc('teams/tReady/projectRewardTotals/p1').set({ projectId: 'p1', totalYen: 12000, updatedAt: 1, updatedBy: 'u1' });
    await db.doc('teams/tReady/projectRewardShares/p1_u1').set({ projectId: 'p1', memberUid: 'u1', amountYen: 9000, assigned: true, updatedAt: 1, updatedBy: 'u1' });
    await db.doc('teams/tReady/projectRewardShares/p1_u2').set({ projectId: 'p1', memberUid: 'u2', amountYen: 3000, assigned: true, updatedAt: 1, updatedBy: 'u1' });
    await db.doc('teams/tReady/projectCosts/p1').set({ projectId: 'p1', costYen: 3000, expenses: [], updatedAt: 1, updatedBy: 'u1' });
  });
}

test('legacy teams fail closed for active members while admins retain migration access', async () => {
  const env = await createEnv();
  try {
    await seedLegacyTeamData(env);
    const admin = env.authenticatedContext('u1').firestore();
    const member = env.authenticatedContext('u2').firestore();
    await assertSucceeds(admin.doc('teams/tLegacy/accounts/a1').get());
    await assertSucceeds(admin.doc('teams/tLegacy/projects/p1').get());
    await assertSucceeds(member.doc('teams/tLegacy').get());
    await assertSucceeds(member.doc('teams/tLegacy/members/u2').get());
    await assertFails(member.doc('teams/tLegacy/members/u1').get());
    await assertFails(member.doc('teams/tLegacy/accounts/a1').get());
    await assertFails(member.doc('teams/tLegacy/projects/p1').get());
    await assertFails(member.doc('teams/tLegacy/projects/p1').update({
      name: 'Attempted legacy write', updatedAt: 2, updatedBy: 'u2',
    }));
    await env.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('teams/tLegacy').update({ securityMigrationState: 'migrating' });
    });
    await assertFails(admin.doc('teams/tLegacy/projects/p1').update({ name: 'blocked during migration' }));
    await assertFails(member.doc('teams/tLegacy/settings/main').get());
    await assertFails(member.doc('teams/tLegacy/settings/main').update({ any: 'value' }));
  } finally { await env.cleanup(); }
});

test('migration lock freezes private, financial, and membership writes for admins', async () => {
  const env = await createEnv();
  try {
    await seedReadyTeamData(env);
    await env.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('teams/tReady').update({ securityMigrationState: 'migrating' });
    });
    const admin = env.authenticatedContext('u1').firestore();

    await assertFails(admin.doc('teams/tReady/payouts/u2').update({
      payoutName: 'Changed during migration', updatedAt: 2, updatedBy: 'u1',
    }));
    await assertFails(admin.doc('teams/tReady/memberEmails/u1').update({
      email: 'changed@example.com', updatedAt: 2, updatedBy: 'u1',
    }));
    await assertFails(admin.doc('teams/tReady/memberNotes/u1').update({
      note: 'changed during migration', updatedAt: 2, updatedBy: 'u1',
    }));
    await assertFails(admin.doc('teams/tReady/projectRewardTotals/p1').update({
      totalYen: 99999, updatedAt: 2, updatedBy: 'u1',
    }));
    await assertFails(admin.doc('teams/tReady/projectRewardShares/p1_u2').update({
      amountYen: 99999, updatedAt: 2, updatedBy: 'u1',
    }));
    await assertFails(admin.doc('teams/tReady/projectCosts/p1').update({
      costYen: 99999, updatedAt: 2, updatedBy: 'u1',
    }));
    await assertFails(admin.doc('teams/tReady/members/u2').delete());
    await assertFails(admin.doc('teams/tReady/memberEmails/u1').delete());
    await assertFails(admin.doc('teams/tReady/memberNotes/u1').delete());
  } finally { await env.cleanup(); }
});

test('ready v2 teams separate public data from private and financial documents', async () => {
  const env = await createEnv();
  try {
    await seedReadyTeamData(env);
    const admin = env.authenticatedContext('u1').firestore();
    const member = env.authenticatedContext('u2').firestore();
    await assertSucceeds(member.doc('teams/tReady/members/u1').get());
    await assertSucceeds(member.doc('teams/tReady/projects/p1').get());
    await assertFails(member.doc('teams/tReady/memberEmails/u1').get());
    await assertFails(member.doc('teams/tReady/memberNotes/u1').get());
    await assertFails(member.doc('teams/tReady/projectRewardTotals/p1').get());
    await assertFails(member.doc('teams/tReady/projectRewardShares/p1_u1').get());
    await assertSucceeds(member.doc('teams/tReady/projectRewardShares/p1_u2').get());
    await assertFails(member.doc('teams/tReady/projectCosts/p1').get());
    await assertFails(member.doc('teams/tReady/members/u2').set({
      uid: 'u2', role: 'member', status: 'active', displayName: 'u2', email: 'leak@example.com', updatedAt: 2, updatedBy: 'u2',
    }));
    await assertFails(member.doc('teams/tReady/projects/p2').set({
      id: 'p2', name: 'Leak', rewardYen: 1, updatedAt: 2, updatedBy: 'u2',
    }));
    await assertFails(member.doc('teams/tReady/members/u2').update({ updatedBy: 'u1', updatedAt: 2 }));
    await assertSucceeds(admin.doc('teams/tReady/projectCosts/p1').get());
  } finally { await env.cleanup(); }
});

test('approved members can list ready public team collections while pending users cannot', async () => {
  const env = await createEnv();
  try {
    await seedReadyTeamData(env);
    const member = env.authenticatedContext('u2').firestore();
    const pending = env.authenticatedContext('u4').firestore();

    await assertSucceeds(member.collection('teams/tReady/members').get());
    await assertSucceeds(member.collection('teams/tReady/folders').get());
    await assertSucceeds(member.collection('teams/tReady/accounts').get());
    await assertSucceeds(member.collection('teams/tReady/projects').get());
    await assertSucceeds(member.collection('teams/tReady/templates').get());
    await assertSucceeds(member.doc('teams/tReady/settings/main').get());
    await assertSucceeds(member.collection('teams/tReady/projectRewardShares').where('memberUid', '==', 'u2').get());
    await assertFails(pending.collection('teams/tReady/members').get());
    await assertFails(pending.collection('teams/tReady/projects').get());
  } finally { await env.cleanup(); }
});

test('ready members cannot read malformed public documents while admins can migrate them', async () => {
  const env = await createEnv();
  try {
    await seedReadyTeamData(env);
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.doc('teams/tReady/members/legacy-member').set({
        uid: 'legacy-member', role: 'member', status: 'active', displayName: 'Legacy',
        email: 'legacy@example.com', note: 'private note', updatedAt: 1, updatedBy: 'u1',
      });
      await db.doc('teams/tReady/accounts/legacy-account').set({
        id: 'legacy-account', name: 'Legacy account', rewardYen: 12000, costYen: 3000,
        updatedAt: 1, updatedBy: 'u1',
      });
      await db.doc('teams/tReady/projects/legacy-project').set({
        id: 'legacy-project', name: 'Legacy project', rewardYen: 12000, costYen: 3000,
        updatedAt: 1, updatedBy: 'u1',
      });
    });

    const admin = env.authenticatedContext('u1').firestore();
    const member = env.authenticatedContext('u2').firestore();
    for (const path of [
      'teams/tReady/members/legacy-member',
      'teams/tReady/accounts/legacy-account',
      'teams/tReady/projects/legacy-project',
    ]) {
      await assertFails(member.doc(path).get());
      await assertSucceeds(admin.doc(path).get());
    }
  } finally { await env.cleanup(); }
});

test('ready settings gate private values and locked members cannot use workspace documents', async () => {
  const env = await createEnv();
  try {
    await seedLegacyTeamData(env);
    await seedReadyTeamData(env);
    const member = env.authenticatedContext('u2').firestore();
    const admin = env.authenticatedContext('u1').firestore();
    await assertFails(member.doc('teams/tLegacy/folders/f1').get());
    await assertFails(member.doc('teams/tLegacy/templates/x1').get());
    await assertSucceeds(member.doc('teams/tLegacy/activity/a1').get());
    await assertSucceeds(admin.doc('teams/tLegacy/folders/f1').get());
    await assertSucceeds(member.doc('teams/tReady/memberEmails/u2').set({
      uid: 'u2', email: 'self@example.com', updatedAt: 2, updatedBy: 'u2',
    }));
    await assertFails(member.doc('teams/tReady/memberEmails/u1').get());
    await assertFails(member.doc('teams/tReady/memberNotes/u1').get());
    await assertFails(member.doc('teams/tReady/projectRewardShares/p1_u1').get());
    await assertFails(member.doc('teams/tReady/projects/p2').set({
      id: 'p2', name: 'bad', note: 'private', updatedAt: 2, updatedBy: 'u2',
    }));
    await assertFails(member.doc('teams/tReady/projectCosts/p2').set({
      projectId: 'p2', costYen: 1, extra: true, updatedAt: 2, updatedBy: 'u2',
    }));
    await assertFails(member.doc('teams/tReady/projectRewardTotals/p1').get());
    await env.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('teams/tReady').update({
        'settings.memberEmailVisibility': 'all_members',
        'settings.memberNoteVisibility': 'all_members',
        'settings.rewardVisibility': 'all',
        'settings.memberPayoutVisibility': 'all_members',
      });
    });
    await assertSucceeds(member.doc('teams/tReady/memberEmails/u1').get());
    await assertSucceeds(member.doc('teams/tReady/memberNotes/u1').get());
    await assertSucceeds(member.doc('teams/tReady/projectRewardShares/p1_u1').get());
    await assertSucceeds(member.doc('teams/tReady/projectRewardTotals/p1').get());
    await assertFails(member.doc('teams/tReady/projectCosts/p1').get());
  } finally { await env.cleanup(); }
});

test('ready members receive email and note only through their independent settings', async () => {
  const env = await createEnv();
  try {
    await seedReadyTeamData(env);
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.doc('teams/tReady/memberEmails/u2').set({ uid: 'u2', email: 'member@example.com' });
      await db.doc('teams/tReady/memberNotes/u2').set({ uid: 'u2', note: 'member note' });
    });
    const member = env.authenticatedContext('u2').firestore();
    const pending = env.authenticatedContext('u4').firestore();

    await assertSucceeds(member.doc('teams/tReady/memberEmails/u2').get());
    await assertSucceeds(member.doc('teams/tReady/memberNotes/u2').get());
    await assertFails(member.doc('teams/tReady/memberEmails/u1').get());
    await assertFails(member.doc('teams/tReady/memberNotes/u1').get());
    await assertFails(pending.doc('teams/tReady/memberEmails/u1').get());

    await env.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('teams/tReady').update({
        'settings.memberEmailVisibility': 'all_members',
        'settings.memberNoteVisibility': 'admin_only',
      });
    });
    await assertSucceeds(member.doc('teams/tReady/memberEmails/u1').get());
    await assertFails(member.doc('teams/tReady/memberNotes/u1').get());
  } finally { await env.cleanup(); }
});

test('reward modes never expose costs and expose only the approved share scope', async () => {
  const env = await createEnv();
  try {
    await seedReadyTeamData(env);
    const admin = env.authenticatedContext('u1').firestore();
    const member = env.authenticatedContext('u2').firestore();

    await assertSucceeds(member.doc('teams/tReady/projectRewardShares/p1_u2').get());
    await assertFails(member.doc('teams/tReady/projectRewardShares/p1_u1').get());
    await assertFails(member.doc('teams/tReady/projectRewardTotals/p1').get());
    await assertFails(member.doc('teams/tReady/projectCosts/p1').get());
    await assertSucceeds(admin.doc('teams/tReady/projectCosts/p1').get());

    await env.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('teams/tReady').update({ 'settings.rewardVisibility': 'self_plus_total' });
    });
    await assertSucceeds(member.doc('teams/tReady/projectRewardTotals/p1').get());
    await assertFails(member.doc('teams/tReady/projectRewardShares/p1_u1').get());
    await assertFails(member.doc('teams/tReady/projectCosts/p1').get());

    await env.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('teams/tReady').update({ 'settings.rewardVisibility': 'all' });
    });
    await assertSucceeds(member.doc('teams/tReady/projectRewardTotals/p1').get());
    await assertSucceeds(member.doc('teams/tReady/projectRewardShares/p1_u1').get());
    await assertFails(member.doc('teams/tReady/projectCosts/p1').get());
  } finally { await env.cleanup(); }
});

test('ready assignment and tombstone updates follow team permission settings', async () => {
  const env = await createEnv();
  try {
    await seedReadyTeamData(env);
    const member = env.authenticatedContext('u2').firestore();
    const project = publicProject('p2', 'u2', { teamId: 'tReady' });
    await assertSucceeds(member.doc('teams/tReady/projects/p2').set(project));
    await assertFails(member.doc('teams/tReady/projects/p2').set({ ...project, assignedUids: ['u2'], updatedAt: 2, revision: 2 }));
    await assertFails(member.doc('teams/tReady/projects/p2').set({
      ...project, deletedAt: serverTimestamp(), deletedBy: 'u2', updatedAt: 2, revision: 2,
    }));

    await env.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('teams/tReady').update({
        'settings.assignPermission': 'owner_set',
        'settings.assignOwnerUids': ['u2'],
        'settings.deletePermission': 'all_edit',
      });
    });
    const assigned = { ...project, assignedUids: ['u2'], updatedAt: 3, revision: 2 };
    await assertSucceeds(member.doc('teams/tReady/projects/p2').set(assigned));
    await assertSucceeds(member.doc('teams/tReady/projects/p2').set({
      ...assigned, deletedAt: serverTimestamp(), deletedBy: 'u2', updatedAt: 4, revision: 3,
    }));
    await assertFails(member.doc('teams/tReady/projects/p2').set({
      ...assigned, deletedAt: serverTimestamp(), deletedBy: 'u1', updatedAt: 5, revision: 4,
    }));
    await assertFails(member.doc('teams/tReady/projects/p2').set({ ...assigned, updatedAt: 6 }));
    await assertSucceeds(member.doc('teams/tReady/projects/p2').set({
      ...assigned, deletedAt: null, deletedBy: null, updatedAt: 6, revision: 4,
    }));
  } finally { await env.cleanup(); }
});

test('stale clients cannot overwrite newer ready workspace records', async () => {
  const env = await createEnv();
  try {
    await seedReadyTeamData(env);
    const admin = env.authenticatedContext('u1').firestore();
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.doc('teams/tReady/folders/f1').set(publicFolder('f1', 'u1', { teamId: 'tReady', name: 'new folder', updatedAt: 20, revision: 4 }));
      await db.doc('teams/tReady/templates/x1').set(publicTemplate('x1', 'u1', { teamId: 'tReady', title: 'new template', updatedAt: 20, revision: 4 }));
      await db.doc('teams/tReady/settings/main').set(publicWorkspaceSettings('u1', { teamId: 'tReady', updatedAt: 20, revision: 4 }));
    });

    await assertFails(admin.doc('teams/tReady/folders/f1').set(publicFolder('f1', 'u1', { teamId: 'tReady', name: 'stale', updatedAt: 10, revision: 5 })));
    await assertFails(admin.doc('teams/tReady/templates/x1').set(publicTemplate('x1', 'u1', { teamId: 'tReady', title: 'stale', updatedAt: 10, revision: 5 })));
    await assertFails(admin.doc('teams/tReady/settings/main').set(publicWorkspaceSettings('u1', { teamId: 'tReady', updatedAt: 10, revision: 5 })));
    await assertFails(admin.doc('teams/tReady/folders/f1').set(publicFolder('f1', 'u1', { teamId: 'tReady', name: 'revision skipped', updatedAt: 30, revision: 6 })));
    await assertSucceeds(admin.doc('teams/tReady/folders/f1').set(publicFolder('f1', 'u1', { teamId: 'tReady', name: 'fresh', updatedAt: 30, revision: 5 })));
  } finally { await env.cleanup(); }
});

test('missing or unknown settings keep self-private access but deny other members', async () => {
  const env = await createEnv();
  try {
    await seedReadyTeamData(env);
    const admin = env.authenticatedContext('u1').firestore();
    const member = env.authenticatedContext('u2').firestore();
    const selfPrivateRefs = [
      'teams/tReady/memberEmails/u2',
      'teams/tReady/memberNotes/u2',
      'teams/tReady/payouts/u2',
      'teams/tReady/projectRewardShares/p1_u2',
    ];

    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.doc('teams/tReady/memberEmails/u2').set({ uid: 'u2', email: 'member@example.com', updatedAt: 1, updatedBy: 'u2' });
      await db.doc('teams/tReady/memberNotes/u2').set({ uid: 'u2', note: 'member private', updatedAt: 1, updatedBy: 'u2' });
      await db.doc('teams/tReady').update({ settings: {} });
    });
    for (const path of selfPrivateRefs) await assertSucceeds(member.doc(path).get());
    await assertSucceeds(admin.doc('teams/tReady/memberEmails/u2').get());
    await assertSucceeds(admin.doc('teams/tReady/memberNotes/u2').get());
    await assertSucceeds(admin.doc('teams/tReady/payouts/u2').get());
    await assertSucceeds(admin.doc('teams/tReady/projectRewardShares/p1_u2').get());

    await env.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('teams/tReady').update({
        settings: securitySettings({
          memberEmailVisibility: 'invalid',
          memberNoteVisibility: 'invalid',
          rewardVisibility: 'invalid',
          memberPayoutVisibility: 'invalid',
        }),
      });
    });
    for (const path of selfPrivateRefs) await assertSucceeds(member.doc(path).get());
    await assertFails(member.doc('teams/tReady/memberEmails/u1').get());
    await assertFails(member.doc('teams/tReady/memberNotes/u1').get());
    await assertFails(member.doc('teams/tReady/projectRewardShares/p1_u1').get());
  } finally { await env.cleanup(); }
});

test('project reward share document ID must match its project and member', async () => {
  const env = await createEnv();
  try {
    await seedReadyTeamData(env);
    const admin = env.authenticatedContext('u1').firestore();

    await assertFails(admin.doc('teams/tReady/projectRewardShares/not-p1_u2').set({
      projectId: 'p1', uid: 'u2', rewardYen: 3000, updatedAt: 2, updatedBy: 'u1',
    }));
  } finally { await env.cleanup(); }
});

test('public project and account documents reject embedded cost payloads', async () => {
  const env = await createEnv();
  try {
    await seedReadyTeamData(env);
    const member = env.authenticatedContext('u2').firestore();

    await assertFails(member.doc('teams/tReady/projects/p2').set({
      id: 'p2', name: 'Cost leak project', costYen: 3000, updatedAt: 2, updatedBy: 'u2',
    }));
    await assertFails(member.doc('teams/tReady/accounts/a2').set({
      id: 'a2', name: 'Cost leak account', expenses: 3000, updatedAt: 2, updatedBy: 'u2',
    }));
    await assertFails(member.doc('teams/tReady/projects/cross-team').set(publicProject('cross-team', 'u2', {
      teamId: 'another-team',
    })));
    await assertFails(member.doc('teams/tReady/accounts/cross-team').set(publicAccount('cross-team', 'u2', {
      teamId: 'another-team',
    })));
  } finally { await env.cleanup(); }
});

test('ready public folders templates and workspace settings reject sensitive or unknown fields', async () => {
  const env = await createEnv();
  try {
    await seedTeamData(env);
    const admin = env.authenticatedContext('u1').firestore();
    const member = env.authenticatedContext('u2').firestore();
    await assertSucceeds(member.doc('teams/t1/folders/f2').set(publicFolder('f2', 'u2')));
    await assertSucceeds(member.doc('teams/t1/templates/x2').set(publicTemplate('x2', 'u2')));
    await assertSucceeds(member.doc('teams/t1/settings/main').set(publicWorkspaceSettings('u2', { updatedAt: 2, revision: 2 })));
    for (const [path, data] of [
      ['teams/t1/folders/leak', publicFolder('leak', 'u2', { email: 'leak@example.com' })],
      ['teams/t1/templates/leak', publicTemplate('leak', 'u2', { rewardYen: 50000 })],
      ['teams/t1/settings/main', publicWorkspaceSettings('u2', { costYen: 10000 })],
      ['teams/t1/folders/cross-team', publicFolder('cross-team', 'u2', { teamId: 'another-team' })],
      ['teams/t1/templates/cross-team', publicTemplate('cross-team', 'u2', { teamId: 'another-team' })],
      ['teams/t1/settings/main', publicWorkspaceSettings('u2', { teamId: 'another-team' })],
    ]) {
      await assertFails(member.doc(path).set(data));
    }
    await env.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('teams/t1/folders/legacy-leak').set({ id: 'legacy-leak', email: 'legacy@example.com' });
    });
    await assertFails(member.doc('teams/t1/folders/legacy-leak').get());
    await assertSucceeds(admin.doc('teams/t1/folders/legacy-leak').get());
  } finally { await env.cleanup(); }
});

test('listed members can read team docs even before member docs exist', async () => {
  const env = await createEnv();

  try {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.doc('teams/t4').set({
        createdBy: 'u9',
        deletedAt: null,
        name: 'Team Four',
        memberUids: ['u5'],
      });
    });

    const listed = env.authenticatedContext('u5').firestore();
    await assertSucceeds(listed.doc('teams/t4').get());
  } finally {
    await env.cleanup();
  }
});

test('approved members can read team docs; pending users and outsiders cannot', async () => {
  const env = await createEnv();

  try {
    await seedTeamData(env);

    const admin = env.authenticatedContext('u1').firestore();
    const member = env.authenticatedContext('u2').firestore();
    const pending = env.authenticatedContext('u3').firestore();
    const outsider = env.authenticatedContext('u4').firestore();

    await assertSucceeds(admin.doc('teams/t1').get());
    await assertSucceeds(member.doc('teams/t1').get());
    await assertSucceeds(member.doc('teams/t1/members/u1').get());
    await assertSucceeds(member.doc('teams/t1/folders/f1').get());
    await assertSucceeds(member.doc('teams/t1/accounts/a1').get());
    await assertSucceeds(member.doc('teams/t1/templates/x1').get());
    await assertSucceeds(member.doc('teams/t1/activity/act1').get());

    await assertFails(pending.doc('teams/t1').get());
    await assertFails(outsider.doc('teams/t1').get());
    await assertFails(pending.doc('teams/t1/members/u1').get());
    await assertFails(outsider.doc('teams/t1/folders/f1').get());
    await assertSucceeds(admin.doc('teams/t1/projects/p1').set(publicProject('p1', 'u1')));
    await assertSucceeds(admin.doc('teams/t1/settings/main').set(publicWorkspaceSettings('u1', { updatedAt: 2, revision: 2 })));
    await assertSucceeds(member.doc('teams/t1/projects/p1').get());
    await assertFails(pending.doc('teams/t1/projects/p1').get());
  } finally {
    await env.cleanup();
  }
});

test('all approved members can read new project activity while outsiders cannot', async () => {
  const env = await createEnv();

  try {
    await seedTeamData(env);
    const admin = env.authenticatedContext('u1').firestore();
    const member = env.authenticatedContext('u2').firestore();
    const outsider = env.authenticatedContext('u4').firestore();
    const activityRef = admin.doc('teams/t1/activity/project-created');

    await assertSucceeds(activityRef.set({
      action: 'createProject',
      text: '管理者が「共有案件」を追加しました',
      coreText: '「共有案件」を追加しました',
      actorUid: 'u1',
      identityUids: ['u1'],
      actorName: '管理者',
      targetName: '共有案件',
      projectId: 'p-shared',
      createdAt: serverTimestamp(),
    }));
    await assertSucceeds(member.doc('teams/t1/activity/project-created').get());
    await assertFails(outsider.doc('teams/t1/activity/project-created').get());
  } finally {
    await env.cleanup();
  }
});

test('an approved member receives an admin project write through a live listener', async () => {
  const env = await createEnv();
  try {
    await seedTeamData(env);
    const admin = env.authenticatedContext('u1').firestore();
    const member = env.authenticatedContext('u2').firestore();
    const received = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('member-listener-timeout')), 3000);
      const unsubscribe = member.collection('teams/t1/projects').onSnapshot((snapshot) => {
        if (!snapshot.docs.some((row) => row.id === 'live-project')) return;
        clearTimeout(timer);
        unsubscribe();
        resolve(true);
      }, reject);
    });
    await assertSucceeds(admin.doc('teams/t1/projects/live-project').set(
      publicProject('live-project', 'u1'),
    ));
    await received;
  } finally {
    await env.cleanup();
  }
});

test('operation receipts are idempotent and cannot spoof another actor', async () => {
  const env = await createEnv();
  try {
    await seedTeamData(env);
    const member = env.authenticatedContext('u2').firestore();
    const outsider = env.authenticatedContext('u4').firestore();
    const receipt = { operationId: 'op1', actorUid: 'u2', createdAt: serverTimestamp() };
    await assertSucceeds(member.doc('teams/t1/operations/op1').set(receipt));
    await assertSucceeds(member.doc('teams/t1/operations/op1').get());
    await assertFails(member.doc('teams/t1/operations/spoof').set({ ...receipt, operationId: 'spoof', actorUid: 'u1' }));
    await assertFails(member.doc('teams/t1/operations/op1').update({ actorUid: 'u1' }));
    await assertFails(outsider.doc('teams/t1/operations/op1').get());
  } finally { await env.cleanup(); }
});

test('users can discover their own team memberships with collection group queries', async () => {
  const env = await createEnv();

  try {
    await seedTeamData(env);

    const member = env.authenticatedContext('u2').firestore();
    const pending = env.authenticatedContext('u3').firestore();

    await assertSucceeds(member.collectionGroup('members').where('uid', '==', 'u2').get());
    await assertSucceeds(pending.collectionGroup('joinRequests').where('uid', '==', 'u3').get());
  } finally {
    await env.cleanup();
  }
});

test('team creation requires the restrictive locked security boundary', async () => {
  const env = await createEnv();

  try {
    await env.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('accountDeletionLocks/uLocked').set({ uid: 'uLocked' });
    });
    const admin = env.authenticatedContext('u1').firestore();

    await assertFails(admin.doc('teams/t2').set({
      createdBy: 'u1',
      deletedAt: null,
      name: 'Team Two',
    }));
    await assertSucceeds(admin.doc('teams/t3').set({
      createdBy: 'u1',
      deletedAt: null,
      name: 'Team Three',
      memberUids: ['u1'],
      securitySchemaVersion: 1,
      securityMigrationState: 'locked',
      settings: securitySettings(),
    }));
    await assertSucceeds(admin.doc('teams/t3').update({
      name: 'Team Three Updated',
    }));
    await assertSucceeds(admin.doc('teams/t3/invites/i9').set({
      code: 'I9',
      createdBy: 'u1',
      enabled: true,
    }));
    await assertSucceeds(admin.doc('teams/t3/members/u1').set({
      uid: 'u1',
      role: 'admin',
      status: 'active',
      displayName: 'Creator',
      updatedBy: 'u1',
    }));
    await assertFails(admin.doc('teams/t4').set({
      createdBy: 'u1',
      deletedAt: null,
      name: 'Team Four',
      securitySchemaVersion: 1,
      securityMigrationState: 'locked',
      settings: securitySettings({ rewardVisibility: 'all' }),
    }));
    await assertFails(admin.doc('teams/t5').set({
      createdBy: 'u1',
      deletedAt: null,
      name: 'Team Five',
    }));
    await assertFails(admin.doc('teams/tLockedMember').set({
      createdBy: 'u1', deletedAt: null, name: 'Locked Member Team',
      memberUids: ['u1', 'uLocked'], adminUids: ['u1', 'uLocked'],
      securitySchemaVersion: 1, securityMigrationState: 'locked',
      settings: securitySettings(),
    }));
  } finally {
    await env.cleanup();
  }
});

test('team creator can atomically create the locked team and private profile split', async () => {
  const env = await createEnv();
  try {
    const admin = env.authenticatedContext('u1').firestore();
    const batch = admin.batch();
    batch.set(admin.doc('teams/tAtomic'), {
      id: 'tAtomic', createdBy: 'u1', deletedAt: null, name: 'Atomic Team',
      memberUids: ['u1'], securitySchemaVersion: 1, securityMigrationState: 'locked',
      settings: securitySettings(),
    });
    batch.set(admin.doc('teams/tAtomic/members/u1'), {
      uid: 'u1', role: 'admin', status: 'active', displayName: 'Creator',
      createdAt: 1, updatedAt: 1, updatedBy: 'u1',
    });
    batch.set(admin.doc('teams/tAtomic/memberEmails/u1'), {
      uid: 'u1', email: 'creator@example.com', createdAt: 1, updatedAt: 1, updatedBy: 'u1',
    });
    await assertSucceeds(batch.commit());
  } finally { await env.cleanup(); }
});

test('team creator can atomically create a ready V2 team for immediate member sharing', async () => {
  const env = await createEnv();
  try {
    const admin = env.authenticatedContext('u1').firestore();
    const batch = admin.batch();
    batch.set(admin.doc('teams/tReadyNew'), {
      id: 'tReadyNew', createdBy: 'u1', deletedAt: null, name: 'Ready Team',
      memberUids: ['u1'], securitySchemaVersion: 2, securityMigrationState: 'ready',
      settings: securitySettings(),
    });
    batch.set(admin.doc('teams/tReadyNew/members/u1'), {
      uid: 'u1', role: 'admin', status: 'active', displayName: 'Creator',
      createdAt: 1, updatedAt: 1, updatedBy: 'u1',
    });
    batch.set(admin.doc('teams/tReadyNew/memberEmails/u1'), {
      uid: 'u1', email: 'creator@example.com', createdAt: 1, updatedAt: 1, updatedBy: 'u1',
    });
    await assertSucceeds(batch.commit());
  } finally { await env.cleanup(); }
});

test('ready admin can atomically approve a public member and private email without spoofing actor identity', async () => {
  const env = await createEnv();
  try {
    await seedReadyTeamData(env);
    const admin = env.authenticatedContext('u1').firestore();
    await assertSucceeds(admin.doc('teams/tReady/members/u5').set({
      uid: 'u5', role: 'member', status: 'active', displayName: 'Control Member',
      createdAt: 2, updatedAt: 2, updatedBy: 'u1',
    }));
    const batch = admin.batch();
    batch.set(admin.doc('teams/tReady/members/u4'), {
      uid: 'u4', role: 'member', status: 'active', displayName: 'New Member',
      createdAt: 2, updatedAt: 2, updatedBy: 'u1',
    });
    batch.set(admin.doc('teams/tReady/memberEmails/u4'), {
      uid: 'u4', email: 'new@example.com', createdAt: 2, updatedAt: 2, updatedBy: 'u1',
    });
    await assertSucceeds(batch.commit());
    await assertFails(admin.doc('teams/tReady/memberEmails/u4').update({ updatedBy: 'u4', updatedAt: 3 }));
  } finally { await env.cleanup(); }
});

test('only signed-in users can create join requests', async () => {
  const env = await createEnv();

  try {
    await seedTeamData(env);

    const signedIn = env.authenticatedContext('u4').firestore();
    const signedOut = env.unauthenticatedContext().firestore();

    await assertSucceeds(signedIn.doc('teams/t1/joinRequests/r2').set({
      uid: 'u4',
      inviteId: 'i1',
      teamId: 't1',
      teamName: 'Team One',
      displayName: 'Joiner',
      email: 'joiner@example.com',
      status: 'pending',
      createdAt: 1778493600000,
      updatedAt: 1778493600000,
    }));
    await assertFails(signedIn.doc('teams/t1/joinRequests/r-extra').set({
      uid: 'u4', inviteId: 'i1', teamId: 't1', teamName: 'Team One',
      displayName: 'Joiner', email: 'joiner@example.com', status: 'pending',
      createdAt: 1778493600000, updatedAt: 1778493600000,
      assignedUids: ['u1'],
    }));
    await assertFails(signedIn.doc('teams/t1/joinRequests/r3').set({
      uid: 'u9',
      inviteId: 'i1',
      status: 'pending',
      requestedAt: 1778493600000,
    }));
    await assertFails(signedOut.doc('teams/t1/joinRequests/r4').set({
      uid: 'u4',
      inviteId: 'i1',
      status: 'pending',
      requestedAt: 1778493600000,
    }));
    const admin = env.authenticatedContext('u1').firestore();
    await assertSucceeds(admin.doc('teamInviteCodes/NEWCODE').set({
      code: 'NEWCODE', teamId: 't1', inviteId: 'i-new', teamName: 'Team One',
      createdBy: 'u1', createdAt: 1778493600000, disabledAt: null,
    }));
    await assertSucceeds(admin.doc('teamInviteCodes/NEWCODE').update({ disabledAt: 1778493600001 }));
    await assertFails(admin.doc('teamInviteCodes/NEWCODE').update({ memberUids: ['uLocked'] }));
    await assertFails(admin.doc('teamInviteCodes/BADCODE').set({
      code: 'BADCODE', teamId: 't1', inviteId: 'i-bad', teamName: 'Team One',
      createdBy: 'u1', createdAt: 1778493600000, disabledAt: null,
      memberUids: ['uLocked'],
    }));
  } finally {
    await env.cleanup();
  }
});

test('signed-in users can resolve one invite code but cannot list invite codes', async () => {
  const env = await createEnv();

  try {
    await seedTeamData(env);

    const signedIn = env.authenticatedContext('u4').firestore();
    const signedOut = env.unauthenticatedContext().firestore();

    await assertSucceeds(signedIn.doc('teamInviteCodes/ABCD1234').get());
    await assertFails(signedIn.collection('teamInviteCodes').get());
    await assertFails(signedOut.doc('teamInviteCodes/ABCD1234').get());
  } finally {
    await env.cleanup();
  }
});

test('users can read and write their own personal workspace docs', async () => {
  const env = await createEnv();

  try {
    const self = env.authenticatedContext('u1').firestore();
    const other = env.authenticatedContext('u2').firestore();

    await assertSucceeds(self.doc('users/u1/folders/f1').set({
      id: 'f1',
      name: 'Folder 1',
      ownerUid: 'u1',
      revision: 1, updatedAt: 1, updatedBy: 'u1',
    }));
    await assertSucceeds(self.doc('users/u1/accounts/a1').set({
      id: 'a1',
      username: '@a1',
      ownerUid: 'u1',
      revision: 1, updatedAt: 1, updatedBy: 'u1',
    }));
    await assertSucceeds(self.doc('users/u1/projects/a1').set({
      id: 'a1',
      ownerUid: 'u1',
      revision: 1, updatedAt: 1, updatedBy: 'u1',
    }));
    await assertSucceeds(self.doc('users/u1/templates/t1').set({
      id: 't1',
      ownerUid: 'u1',
      revision: 1, updatedAt: 1, updatedBy: 'u1',
    }));
    await assertSucceeds(self.doc('users/u1/settings/main').set({
      id: 'main',
      ownerUid: 'u1',
      scope: 'personal',
      revision: 1, updatedAt: 1, updatedBy: 'u1',
    }));
    await assertSucceeds(self.doc('users/u1/folders/f1').get());
    await assertFails(other.doc('users/u1/folders/f1').get());
    await assertFails(other.doc('users/u1/settings/main').set({
      id: 'main',
      ownerUid: 'u1',
      revision: 1, updatedAt: 1, updatedBy: 'u2',
    }));
  } finally {
    await env.cleanup();
  }
});

test('stale personal devices cannot overwrite or physically delete newer records', async () => {
  const env = await createEnv();
  try {
    const self = env.authenticatedContext('u1').firestore();
    const ref = self.doc('users/u1/accounts/a1');
    await assertSucceeds(ref.set({
      id: 'a1', ownerUid: 'u1', username: '@first',
      revision: 1, updatedAt: 10, updatedBy: 'u1',
    }));
    await assertSucceeds(ref.set({
      id: 'a1', ownerUid: 'u1', username: '@newer',
      revision: 2, updatedAt: 20, updatedBy: 'u1',
    }));
    await assertFails(ref.set({
      id: 'a1', ownerUid: 'u1', username: '@stale',
      revision: 2, updatedAt: 15, updatedBy: 'u1',
    }));
    await assertFails(ref.delete());
  } finally {
    await env.cleanup();
  }
});

test('only admins can read invites and pending requests', async () => {
  const env = await createEnv();

  try {
    await seedTeamData(env);

    const admin = env.authenticatedContext('u1').firestore();
    const member = env.authenticatedContext('u2').firestore();
    const pending = env.authenticatedContext('u3').firestore();

    await assertSucceeds(admin.doc('teams/t1/invites/i1').get());
    await assertSucceeds(admin.doc('teams/t1/joinRequests/r1').get());
    await assertSucceeds(pending.doc('teams/t1/joinRequests/r1').get());
    await assertFails(member.doc('teams/t1/invites/i1').get());
    await assertFails(member.doc('teams/t1/joinRequests/r1').get());
  } finally {
    await env.cleanup();
  }
});

test('payout records are readable by members only when team setting allows it', async () => {
  const env = await createEnv();

  try {
    await seedTeamData(env);
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.doc('teams/t1/payouts/u1').set({
        uid: 'u1',
        payoutName: 'Admin Name',
        payoutBankName: 'Sample Bank',
        payoutBranchName: 'Main Branch',
        payoutAccountType: 'futsu',
        payoutAccountNumber: '1234567',
      });
    });

    const admin = env.authenticatedContext('u1').firestore();
    const member = env.authenticatedContext('u2').firestore();
    const pending = env.authenticatedContext('u3').firestore();

    await assertSucceeds(admin.doc('teams/t1/payouts/u1').get());
    await assertFails(member.doc('teams/t1/payouts/u1').get());

    await assertSucceeds(admin.doc('teams/t1').update({
      'settings.memberPayoutVisibility': 'all_members',
    }));

    await assertSucceeds(member.doc('teams/t1/payouts/u1').get());
    await assertFails(pending.doc('teams/t1/payouts/u1').get());

    await assertSucceeds(admin.doc('teams/t1').update({
      'settings.memberPayoutVisibility': 'admin_only',
    }));

    await assertFails(member.doc('teams/t1/payouts/u1').get());
  } finally {
    await env.cleanup();
  }
});

test('only admins can approve requests and change other member roles', async () => {
  const env = await createEnv();

  try {
    await seedTeamData(env);

    const admin = env.authenticatedContext('u1').firestore();
    const member = env.authenticatedContext('u2').firestore();

    await assertSucceeds(member.doc('teams/t1/members/u2').update({
      uid: 'u2',
      role: 'member',
      status: 'active',
      displayName: 'Renamed Member',
      createdAt: 1,
      updatedAt: 2,
      updatedBy: 'u2',
    }));
    await assertFails(member.doc('teams/t1/members/u2').update({
      uid: 'u2',
      role: 'member',
      status: 'blocked',
      displayName: 'Renamed Member',
      editScope: 'shared',
      rewardScope: 'shared',
      updatedBy: 'u2',
    }));
    await assertFails(member.doc('teams/t1/members/u2').update({
      uid: 'u2',
      role: 'admin',
      status: 'active',
      displayName: 'Renamed Member',
      editScope: 'shared',
      rewardScope: 'shared',
      updatedBy: 'u2',
    }));
    await assertFails(member.doc('teams/t1/members/u2').update({
      uid: 'u2',
      role: 'member',
      status: 'blocked',
      displayName: 'Renamed Member',
      editScope: 'shared',
      rewardScope: 'shared',
      updatedBy: 'u2',
    }));
    await assertFails(member.doc('teams/t1/members/u2').update({
      uid: 'u2',
      role: 'member',
      status: 'active',
      displayName: 'Renamed Member',
      email: 'member@example.com',
      payoutName: 'Member Name',
      payoutAccount: 'Bank 123',
      note: 'hello',
      editScope: 'shared',
      rewardScope: 'shared',
      updatedBy: 'u2',
      extraField: 'nope',
    }));
    await assertFails(member.doc('teams/t1/joinRequests/r1').update({
      uid: 'u3',
      status: 'active',
      requestedAt: 1778493600000,
    }));
    await assertFails(member.doc('teams/t1/members/u1').update({
      uid: 'u1',
      role: 'member',
      status: 'active',
      editScope: 'all',
      rewardScope: 'all',
    }));
    await assertSucceeds(admin.doc('teams/t1/joinRequests/r1').update({
      uid: 'u3',
      status: 'active',
      requestedAt: 1778493600000,
    }));
    await assertSucceeds(admin.doc('teams/t1/members/u2').update({
      uid: 'u2',
      role: 'admin',
      status: 'active',
      displayName: 'Member',
      createdAt: 1,
      updatedAt: 2,
      updatedBy: 'u1',
    }));
  } finally {
    await env.cleanup();
  }
});

test('approved members can only write inside teams they belong to', async () => {
  const env = await createEnv();

  try {
    await seedTeamData(env);

    const member = env.authenticatedContext('u2').firestore();
    const outsider = env.authenticatedContext('u4').firestore();

    await assertSucceeds(member.doc('teams/t1/folders/f2').set(publicFolder('f2', 'u2')));
    await assertSucceeds(member.doc('teams/t1/accounts/a2').set(publicAccount('a2', 'u2')));
    await assertSucceeds(member.doc('teams/t1/projects/a2').set(publicProject('a2', 'u2')));
    await assertSucceeds(member.doc('teams/t1/templates/x2').set(publicTemplate('x2', 'u2')));
    const validActivity = {
      action: 'createProject',
      text: 'メンバーが「共有案件」を追加しました',
      coreText: '「共有案件」を追加しました',
      actorUid: 'u2',
      identityUids: ['u2'],
      actorName: 'メンバー',
      targetName: '共有案件',
      projectId: 'a2',
      createdAt: serverTimestamp(),
    };
    await assertSucceeds(member.doc('teams/t1/activity/act2').set(validActivity));
    await assertFails(member.doc('teams/t1/activity/spoofed').set({
      ...validActivity,
      actorUid: 'u1',
      createdAt: serverTimestamp(),
    }));
    await assertFails(member.doc('teams/t1/activity/spoofed-index').set({
      ...validActivity,
      identityUids: ['u1', 'u2'],
      createdAt: serverTimestamp(),
    }));
    await assertFails(member.doc('teams/t1/activity/extra-field').set({
      ...validActivity,
      adminOnly: true,
      createdAt: serverTimestamp(),
    }));
    await assertFails(outsider.doc('teams/t1/activity/outsider').set({
      ...validActivity,
      actorUid: 'u4',
      createdAt: serverTimestamp(),
    }));
    await assertFails(member.doc('teams/t1/projects/a1').delete());
    await assertFails(member.doc('teams/t2/folders/f3').set({ name: 'Wrong team' }));
    await assertFails(outsider.doc('teams/t1/folders/f4').set({ name: 'No access' }));
  } finally {
    await env.cleanup();
  }
});

test('admins can remove members and members can leave their own team', async () => {
  try {
    const envMember = await createEnv();
    await seedTeamData(envMember);
    const member = envMember.authenticatedContext('u2').firestore();
    await assertSucceeds(member.doc('teams/t1/members/u2').delete());
    await assertFails(member.doc('teams/t1/members/u1').delete());
    await envMember.cleanup();

    const envAdmin = await createEnv();
    await seedTeamData(envAdmin);
    const admin = envAdmin.authenticatedContext('u1').firestore();
    await assertSucceeds(admin.doc('teams/t1/members/u2').delete());
    await envAdmin.cleanup();
  } finally {
  }
});
