import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { prepareFirebaseCliApplicationDefault } from './firebase-cli-credential.mjs';
import { planTeamV2Migration, validateMigrationPlan } from './team-v2-migration-core.mjs';

const KNOWN_COLLECTIONS = [
  'members', 'memberEmails', 'memberNotes', 'payouts',
  'folders', 'accounts', 'projects', 'templates', 'settings',
  'projectRewardTotals', 'projectRewardShares', 'projectCosts',
  'activity', 'invites', 'joinRequests',
];

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') out.mode = 'dry-run';
    else if (arg === '--apply') out.mode = 'apply';
    else if (arg.startsWith('--')) out[arg.slice(2)] = argv[index + 1], index += 1;
  }
  if (!out.project) throw new Error('--project is required');
  if (!['adc', 'firebase-cli'].includes(out.auth)) {
    throw new Error('--auth must be adc or firebase-cli');
  }
  if (!out.mode) throw new Error('exactly one of --dry-run or --apply is required');
  if (out.mode === 'apply' && out['confirm-project'] !== out.project) {
    throw new Error('--confirm-project must exactly match --project for apply');
  }
  return out;
}

function jsonValue(value) {
  if (value == null) return value;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, jsonValue(entry)]));
  return value;
}

function stableJson(value) {
  const normalize = (entry) => {
    if (Array.isArray(entry)) return entry.map(normalize);
    if (entry && typeof entry === 'object') {
      return Object.fromEntries(Object.keys(entry).sort().map((key) => [key, normalize(entry[key])]));
    }
    return entry;
  };
  return JSON.stringify(normalize(jsonValue(value)));
}

async function readTeam(db, teamDoc) {
  const collections = {};
  for (const name of KNOWN_COLLECTIONS) {
    const snapshot = await teamDoc.ref.collection(name).get();
    collections[name] = snapshot.docs.map((docSnap) => ({ id: docSnap.id, data: jsonValue(docSnap.data()) }));
  }
  return { id: teamDoc.id, data: jsonValue(teamDoc.data()), collections };
}

async function writeBackup({ projectId, teams }) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = resolve('.migration-backups', projectId, timestamp);
  await mkdir(dir, { recursive: true });
  const path = resolve(dir, 'teams.json');
  await writeFile(path, `${JSON.stringify({ projectId, capturedAt: new Date().toISOString(), teams }, null, 2)}\n`, { flag: 'wx' });
  return path;
}

async function applyWrites(db, writes) {
  for (let start = 0; start < writes.length; start += 400) {
    const batch = db.batch();
    for (const write of writes.slice(start, start + 400)) batch.set(db.doc(write.path), write.data);
    await batch.commit();
  }
}

async function verifyWrites(db, plan) {
  const actual = [];
  for (const expected of plan.writes) {
    const snap = await db.doc(expected.path).get();
    if (!snap.exists) throw new Error(`missing-after-write:${expected.path}`);
    const actualData = jsonValue(snap.data());
    if (stableJson(actualData) !== stableJson(expected.data)) throw new Error(`data-mismatch:${expected.path}`);
    actual.push({ path: expected.path, data: actualData });
  }
  const validation = validateMigrationPlan({ ...plan, writes: actual });
  if (!validation.valid) throw new Error(`verification-failed:${validation.errors.join(',')}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (process.env.FIRESTORE_EMULATOR_HOST && !args.emulator) {
    throw new Error('FIRESTORE_EMULATOR_HOST is set; pass --emulator yes explicitly');
  }
  const prepared = args.auth === 'firebase-cli' ? await prepareFirebaseCliApplicationDefault() : null;
  try {
  initializeApp({ credential: applicationDefault(), projectId: args.project });
  const db = getFirestore();
  const snapshot = args.team
    ? { docs: [await db.collection('teams').doc(args.team).get()] }
    : await db.collection('teams').get();
  const teamDocs = snapshot.docs.filter((row) => row.exists);
  const buildPlan = (team) => {
    const plan = planTeamV2Migration({
      teamId: team.id,
      team: { id: team.id, ...team.data },
      collections: team.collections,
      actorUid: team.data.createdBy,
    });
    const validation = validateMigrationPlan(plan);
    if (!validation.valid) throw new Error(`${team.id}:${validation.errors.join(',')}`);
    return plan;
  };
  if (args.mode === 'dry-run') {
    const teams = [];
    for (const teamDoc of teamDocs) teams.push(await readTeam(db, teamDoc));
    const plans = teams.map(buildPlan);
    console.log(JSON.stringify({ mode: args.mode, projectId: args.project, teams: plans.map((plan) => ({
      teamId: plan.teamId, alreadyReady: plan.alreadyReady, writeCount: plan.writes.length,
    })) }, null, 2));
    return;
  }

  for (const initialTeamDoc of teamDocs) {
    const teamRef = initialTeamDoc.ref;
    const original = initialTeamDoc.data() || {};
    await teamRef.set({ securityMigrationState: 'migrating', updatedAt: new Date() }, { merge: true });
    try {
      const lockedTeamDoc = await teamRef.get();
      const team = await readTeam(db, lockedTeamDoc);
      const plan = buildPlan(team);
      const backupPath = await writeBackup({ projectId: args.project, teams: [team] });
      console.log(`backup: ${backupPath}`);
      await applyWrites(db, plan.writes);
      await verifyWrites(db, plan);
      await teamRef.set({ securitySchemaVersion: 2, securityMigrationState: 'ready', updatedAt: new Date() }, { merge: true });
      console.log(`ready: ${plan.teamId}`);
    } catch (error) {
      await teamRef.set({
        securitySchemaVersion: Number(original.securitySchemaVersion || 1),
        securityMigrationState: String(original.securityMigrationState || 'locked'),
        updatedAt: new Date(),
      }, { merge: true });
      throw error;
    }
  }
  } finally {
    await prepared?.cleanup();
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
