import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { prepareFirebaseCliApplicationDefault } from './firebase-cli-credential.mjs';
import { planActivityIdentityMigration } from './activity-identity-migration-core.mjs';

const PAGE_SIZE = 200;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--dry-run') args.mode = 'dry-run';
    else if (value === '--apply') args.mode = 'apply';
    else if (value.startsWith('--')) args[value.slice(2)] = argv[index + 1], index += 1;
  }
  if (!args.project) throw new Error('--project is required');
  if (!['adc', 'firebase-cli'].includes(args.auth)) {
    throw new Error('--auth must be adc or firebase-cli');
  }
  if (!args.mode) throw new Error('exactly one of --dry-run or --apply is required');
  if (args.mode === 'apply' && args['confirm-project'] !== args.project) {
    throw new Error('--confirm-project must exactly match --project for apply');
  }
  return args;
}

async function readPaged(collection) {
  const rows = [];
  let last = null;
  while (true) {
    let query = collection.orderBy('__name__').limit(PAGE_SIZE);
    if (last) query = query.startAfter(last);
    const snapshot = await query.get();
    rows.push(...snapshot.docs.map((row) => ({ id: row.id, data: row.data() })));
    if (snapshot.size < PAGE_SIZE) return rows;
    last = snapshot.docs.at(-1);
  }
}

async function applyPatches(db, writes) {
  for (let start = 0; start < writes.length; start += 400) {
    const batch = db.batch();
    for (const write of writes.slice(start, start + 400)) {
      batch.set(db.doc(write.path), write.data, { merge: true });
    }
    await batch.commit();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (process.env.FIRESTORE_EMULATOR_HOST && args.emulator !== 'yes') {
    throw new Error('FIRESTORE_EMULATOR_HOST is set; pass --emulator yes explicitly');
  }
  const prepared = args.auth === 'firebase-cli' ? await prepareFirebaseCliApplicationDefault() : null;
  try {
  initializeApp({ credential: applicationDefault(), projectId: args.project });
  const db = getFirestore();
  const teams = args.team
    ? { docs: [await db.doc(`teams/${args.team}`).get()] }
    : await db.collection('teams').get();
  const reports = [];
  for (const team of teams.docs.filter((row) => row.exists)) {
    const [members, activities] = await Promise.all([
      readPaged(team.ref.collection('members')),
      readPaged(team.ref.collection('activity')),
    ]);
    const plan = planActivityIdentityMigration({ teamId: team.id, members, activities });
    if (args.mode === 'apply') await applyPatches(db, plan.writes);
    reports.push({
      teamId: team.id,
      writeCount: plan.writes.length,
      ambiguous: plan.report.ambiguous,
      unresolved: plan.report.unresolved,
    });
  }
  console.log(JSON.stringify({ mode: args.mode, projectId: args.project, teams: reports }, null, 2));
  } finally {
    await prepared?.cleanup();
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
