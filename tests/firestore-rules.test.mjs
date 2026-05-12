import test from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';

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
    });
    await db.doc('teams/t1/members/u1').set({
      uid: 'u1',
      role: 'admin',
      status: 'active',
      editScope: 'all',
      rewardScope: 'all',
    });
    await db.doc('teams/t1/members/u2').set({
      uid: 'u2',
      role: 'member',
      status: 'active',
      editScope: 'shared',
      rewardScope: 'shared',
    });
    await db.doc('teams/t1/members/u3').set({
      uid: 'u3',
      role: 'member',
      status: 'pending',
      editScope: 'shared',
      rewardScope: 'shared',
    });
    await db.doc('teams/t1/folders/f1').set({ name: 'Inbox' });
    await db.doc('teams/t1/accounts/a1').set({ name: 'Primary' });
    await db.doc('teams/t1/templates/x1').set({ name: 'Default' });
    await db.doc('teams/t1/activity/act1').set({ text: 'created' });
    await db.doc('teams/t1/invites/i1').set({
      codeHash: 'abc',
      createdBy: 'u1',
      enabled: true,
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
      status: 'pending',
      requestedAt: 1778493600000,
    }));
    await assertFails(signedIn.doc('teams/t1/joinRequests/r3').set({
      uid: 'u9',
      status: 'pending',
      requestedAt: 1778493600000,
    }));
    await assertFails(signedOut.doc('teams/t1/joinRequests/r4').set({
      uid: 'u4',
      status: 'pending',
      requestedAt: 1778493600000,
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
      editScope: 'all',
      rewardScope: 'all',
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
    await assertSucceeds(member.doc('teams/t1/accounts/a2').set({ name: 'Shared account' }));
    await assertSucceeds(member.doc('teams/t1/templates/x2').set({ name: 'Shared template' }));
    await assertSucceeds(member.doc('teams/t1/activity/act2').set({ text: 'created' }));
    await assertFails(member.doc('teams/t2/folders/f3').set({ name: 'Wrong team' }));
    await assertFails(outsider.doc('teams/t1/folders/f4').set({ name: 'No access' }));
  } finally {
    await env.cleanup();
  }
});
