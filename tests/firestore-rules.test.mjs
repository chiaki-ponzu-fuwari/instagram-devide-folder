import test from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { serverTimestamp } from 'firebase/firestore';

const projectId = 'dm-manager-rules';

async function createEnv() {
  return initializeTestEnvironment({
    projectId,
    firestore: {
      host: '127.0.0.1',
      port: 8088,
    },
  });
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
    await db.doc('teams/t1/folders/f1').set({ name: 'Inbox' });
    await db.doc('teams/t1/accounts/a1').set({ name: 'Primary' });
    await db.doc('teams/t1/templates/x1').set({ name: 'Default' });
    await db.doc('teams/t1/settings/main').set({
      memberEmailVisibility: 'self',
      memberNoteVisibility: 'admin_only',
      rewardVisibility: 'self',
    });
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
  } finally {
    await env.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('accountDeletionLocks/u1').delete();
    });
    await env.cleanup();
  }
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
      await db.doc('accountDeletionLocks/uLocked').set({ uid: 'uLocked', phase: 'started' });
      await db.doc('users/uLocked').set({ uid: 'uLocked' });
      await db.doc('teams/tLock').set({
        createdBy: 'u2', memberUids: ['u2'], securitySchemaVersion: 2,
        securityMigrationState: 'ready', rewardVisibility: 'admin_only',
      });
      await db.doc('teams/tLock/members/u2').set({
        uid: 'u2', role: 'admin', status: 'active', displayName: 'Admin',
        createdAt: 1, updatedAt: 1, updatedBy: 'u2',
      });
      await db.doc('teams/tLock/invites/open').set({ disabledAt: null });
    });
    const locked = env.authenticatedContext('uLocked').firestore();
    const admin = env.authenticatedContext('u2').firestore();
    await assertFails(locked.doc('users/uLocked').update({ touched: true }));
    await assertFails(locked.doc('users/uLocked/projects/new').set({ id: 'new' }));
    await assertFails(locked.doc('teams/tLock/joinRequests/uLocked').set({
      uid: 'uLocked', status: 'pending', inviteId: 'open',
    }));
    await assertFails(admin.doc('teams/tLock/invites/locked').set({ invitedUid: 'uLocked' }));
    await assertFails(admin.doc('teams/tLock/members/uLocked').set({
      uid: 'uLocked', role: 'member', status: 'active', displayName: 'Locked',
      createdAt: 2, updatedAt: 2, updatedBy: 'u2',
    }));
    await assertSucceeds(admin.doc('users/u2').set({ uid: 'u2' }));
    await assertSucceeds(admin.doc('teams/tLock/invites/other').set({ invitedUid: 'u3' }));
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
    });
    await db.doc('teams/tReady/settings/main').set({
      memberEmailVisibility: 'self', memberNoteVisibility: 'admin_only',
      rewardVisibility: 'self', memberPayoutVisibility: 'admin_only',
      assignmentVisibility: 'all_members', deletionPermission: 'admin_only',
    });
    for (const [uid, role] of [['u1', 'admin'], ['u2', 'member'], ['u3', 'member']]) {
      await db.doc(`teams/tReady/members/${uid}`).set({
        uid, role, status: 'active', displayName: uid, photoURL: null, createdAt: 1, updatedAt: 1, updatedBy: 'u1',
      });
    }
    await db.doc('teams/tReady/memberEmails/u1').set({ uid: 'u1', email: 'admin@example.com', updatedAt: 1, updatedBy: 'u1' });
    await db.doc('teams/tReady/memberNotes/u1').set({ uid: 'u1', note: 'private', updatedAt: 1, updatedBy: 'u1' });
    await db.doc('teams/tReady/payouts/u2').set({ uid: 'u2', payoutName: 'Member Name', updatedAt: 1, updatedBy: 'u2' });
    await db.doc('teams/tReady/projects/p1').set({ id: 'p1', name: 'Public project', assignedUids: ['u2'], updatedAt: 1, updatedBy: 'u1' });
    await db.doc('teams/tReady/projectRewardTotals/p1').set({ projectId: 'p1', rewardYen: 12000, updatedAt: 1, updatedBy: 'u1' });
    await db.doc('teams/tReady/projectRewardShares/p1_u1').set({ projectId: 'p1', uid: 'u1', rewardYen: 9000, updatedAt: 1, updatedBy: 'u1' });
    await db.doc('teams/tReady/projectRewardShares/p1_u2').set({ projectId: 'p1', uid: 'u2', rewardYen: 3000, updatedAt: 1, updatedBy: 'u1' });
    await db.doc('teams/tReady/projectCosts/p1').set({ projectId: 'p1', costYen: 3000, updatedAt: 1, updatedBy: 'u1' });
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
    await assertFails(member.doc('teams/tLegacy/members/u1').get());
    await assertFails(member.doc('teams/tLegacy/accounts/a1').get());
    await assertFails(member.doc('teams/tLegacy/projects/p1').get());
    await assertFails(member.doc('teams/tLegacy/projects/p1').update({
      name: 'Attempted legacy write', updatedAt: 2, updatedBy: 'u2',
    }));
    await assertFails(member.doc('teams/tLegacy/settings/main').get());
    await assertFails(member.doc('teams/tLegacy/settings/main').update({ any: 'value' }));
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
    await assertFails(member.doc('teams/tLegacy/activity/a1').get());
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
      await context.firestore().doc('teams/tReady/settings/main').set({
        memberEmailVisibility: 'all_members', memberNoteVisibility: 'all_members',
        rewardVisibility: 'all_members', memberPayoutVisibility: 'all_members',
      });
    });
    await assertSucceeds(member.doc('teams/tReady/memberEmails/u1').get());
    await assertSucceeds(member.doc('teams/tReady/memberNotes/u1').get());
    await assertSucceeds(member.doc('teams/tReady/projectRewardShares/p1_u1').get());
    await assertSucceeds(member.doc('teams/tReady/projectRewardTotals/p1').get());
    await assertFails(member.doc('teams/tReady/projectCosts/p1').get());
  } finally { await env.cleanup(); }
});

test('missing or unknown settings deny member private and financial reads including self', async () => {
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
      await db.doc('teams/tReady/settings/main').delete();
    });
    for (const path of selfPrivateRefs) await assertFails(member.doc(path).get());
    await assertSucceeds(admin.doc('teams/tReady/memberEmails/u2').get());
    await assertSucceeds(admin.doc('teams/tReady/memberNotes/u2').get());
    await assertSucceeds(admin.doc('teams/tReady/payouts/u2').get());
    await assertSucceeds(admin.doc('teams/tReady/projectRewardShares/p1_u2').get());

    await env.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('teams/tReady/settings/main').set({
        memberEmailVisibility: 'invalid', memberNoteVisibility: 'self',
        rewardVisibility: 'self', memberPayoutVisibility: 'self',
      });
    });
    for (const path of selfPrivateRefs) await assertFails(member.doc(path).get());
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
    await assertSucceeds(admin.doc('teams/t1/projects/p1').set({
      id: 'p1',
      name: 'Shared project',
      updatedAt: 1,
      updatedBy: 'u1',
    }));
    await assertSucceeds(admin.doc('teams/t1/settings/main').set({
      id: 'main',
      teamId: 't1',
      ownerUid: 'u1',
    }));
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

test('team creation requires a valid reward visibility value', async () => {
  const env = await createEnv();

  try {
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
      rewardVisibility: 'admin_only',
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
      rewardVisibility: 'unexpected',
    }));
    await assertFails(admin.doc('teams/t5').set({
      createdBy: 'u1',
      deletedAt: null,
      name: 'Team Five',
    }));
  } finally {
    await env.cleanup();
  }
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
      status: 'pending',
      requestedAt: 1778493600000,
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
    }));
    await assertSucceeds(self.doc('users/u1/accounts/a1').set({
      id: 'a1',
      username: '@a1',
      ownerUid: 'u1',
    }));
    await assertSucceeds(self.doc('users/u1/projects/a1').set({
      id: 'a1',
      ownerUid: 'u1',
    }));
    await assertSucceeds(self.doc('users/u1/templates/t1').set({
      id: 't1',
      ownerUid: 'u1',
    }));
    await assertSucceeds(self.doc('users/u1/settings/main').set({
      id: 'main',
      ownerUid: 'u1',
      scope: 'personal',
    }));
    await assertSucceeds(self.doc('users/u1/folders/f1').get());
    await assertFails(other.doc('users/u1/folders/f1').get());
    await assertFails(other.doc('users/u1/settings/main').set({
      id: 'main',
      ownerUid: 'u1',
    }));
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

    await assertSucceeds(admin.doc('teams/t1/settings/main').set({
      memberEmailVisibility: 'self',
      memberNoteVisibility: 'admin_only',
      rewardVisibility: 'self',
      memberPayoutVisibility: 'all_members',
    }));

    await assertSucceeds(member.doc('teams/t1/payouts/u1').get());
    await assertFails(pending.doc('teams/t1/payouts/u1').get());

    await assertSucceeds(admin.doc('teams/t1/settings/main').set({
      memberEmailVisibility: 'self',
      memberNoteVisibility: 'admin_only',
      rewardVisibility: 'self',
      memberPayoutVisibility: 'admin_only',
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

    await assertSucceeds(member.doc('teams/t1/folders/f2').set({ name: 'Shared' }));
    await assertSucceeds(member.doc('teams/t1/accounts/a2').set({
      id: 'a2', name: 'Shared account', updatedAt: 1, updatedBy: 'u2',
    }));
    await assertSucceeds(member.doc('teams/t1/projects/a2').set({
      id: 'a2', name: 'Shared project', updatedAt: 1, updatedBy: 'u2',
    }));
    await assertSucceeds(member.doc('teams/t1/templates/x2').set({ name: 'Shared template' }));
    const validActivity = {
      action: 'createProject',
      text: 'メンバーが「共有案件」を追加しました',
      coreText: '「共有案件」を追加しました',
      actorUid: 'u2',
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
