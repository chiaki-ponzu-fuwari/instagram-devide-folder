import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') out.mode = 'dry-run';
    else if (arg === '--apply') out.mode = 'apply';
    else if (arg.startsWith('--')) out[arg.slice(2)] = argv[index + 1], index += 1;
  }
  if (!out.project) throw new Error('--project is required');
  if (!out.uid) throw new Error('--uid is required');
  if (!out.mode) throw new Error('exactly one of --dry-run or --apply is required');
  if (out.mode === 'apply' && out['confirm-project'] !== out.project) {
    throw new Error('--confirm-project must exactly match --project for apply');
  }
  return out;
}

async function firebaseCliAccessToken() {
  const require = createRequire(import.meta.url);
  const auth = require('../node_modules/firebase-tools/lib/auth.js');
  const account = auth.getGlobalDefaultAccount();
  if (!account?.tokens?.refresh_token) throw new Error('firebase-cli-login-required');
  const token = await auth.getAccessToken(account.tokens.refresh_token, [
    'https://www.googleapis.com/auth/cloud-platform',
  ]);
  if (!token?.access_token) throw new Error('firebase-cli-access-token-required');
  return token.access_token;
}

function fieldString(document, key) {
  return String(document?.fields?.[key]?.stringValue || '');
}

function fieldStrings(document, key) {
  return (document?.fields?.[key]?.arrayValue?.values || []).map((value) => String(value?.stringValue || ''));
}

function fieldInteger(fields, key) {
  return Number(fields?.[key]?.integerValue || fields?.[key]?.doubleValue || 0) || 0;
}

function docId(document) {
  return String(document?.name || '').split('/').pop() || '';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const accessToken = await firebaseCliAccessToken();
  const root = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(args.project)}/databases/(default)/documents`;
  const request = async (url, { method = 'GET', body } = {}) => {
    const response = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`${method} ${response.status}: ${await response.text()}`);
    if (response.status === 204) return null;
    return response.json();
  };
  const listDocuments = async (collectionPath) => {
    const documents = [];
    let pageToken = '';
    do {
      const url = new URL(`${root}/${collectionPath}`);
      url.searchParams.set('pageSize', '300');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const page = await request(url.toString());
      documents.push(...(page.documents || []));
      pageToken = String(page.nextPageToken || '');
    } while (pageToken);
    return documents;
  };

  const personalAccounts = await listDocuments(`users/${args.uid}/accounts`);
  const personalProjects = await listDocuments(`users/${args.uid}/projects`);
  const allTeams = await listDocuments('teams');
  const visibleTeams = allTeams.filter((team) => (
    fieldString(team, 'createdBy') === args.uid || fieldStrings(team, 'memberUids').includes(args.uid)
  ));
  const teams = [];
  for (const team of visibleTeams) {
    const id = docId(team);
    teams.push({
      id,
      team,
      accounts: await listDocuments(`teams/${id}/accounts`),
      projects: await listDocuments(`teams/${id}/projects`),
    });
  }
  const summary = {
    mode: args.mode,
    projectId: args.project,
    uid: args.uid,
    personal: { accounts: personalAccounts.length, projects: personalProjects.length },
    teams: teams.map((team) => ({ id: team.id, accounts: team.accounts.length, projects: team.projects.length })),
  };
  if (args.mode === 'dry-run') {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = resolve('.reset-backups', args.project, timestamp);
  await mkdir(backupDir, { recursive: true });
  const backupPath = resolve(backupDir, 'project-data.json');
  await writeFile(backupPath, `${JSON.stringify({ ...summary, personalAccounts, personalProjects, teams }, null, 2)}\n`, { flag: 'wx' });

  for (const document of [...personalAccounts, ...personalProjects]) {
    await request(`${root}/${document.name.split('/documents/')[1]}`, { method: 'DELETE' });
  }

  const now = Date.now();
  const integer = (value) => ({ integerValue: String(value) });
  const string = (value) => ({ stringValue: String(value) });
  const patch = async (document, fields, masks) => {
    const url = new URL(`${root}/${document.name.split('/documents/')[1]}`);
    for (const mask of masks) url.searchParams.append('updateMask.fieldPaths', mask);
    await request(url.toString(), { method: 'PATCH', body: { fields } });
  };
  for (const team of teams) {
    for (const document of team.accounts) {
      const nestedFields = document.fields?.project?.mapValue?.fields;
      const fields = {
        deletedAt: integer(now),
        deletedBy: string(args.uid),
        updatedAt: integer(now),
        updatedBy: string(args.uid),
      };
      const masks = ['deletedAt', 'deletedBy', 'updatedAt', 'updatedBy'];
      if (nestedFields) {
        fields.project = {
          mapValue: {
            fields: {
              ...nestedFields,
              deletedAt: integer(now),
              deletedBy: string(args.uid),
              updatedAt: integer(now),
              updatedBy: string(args.uid),
              revision: integer(Math.max(1, fieldInteger(nestedFields, 'revision') + 1)),
            },
          },
        };
        masks.push('project');
      }
      await patch(document, fields, masks);
    }
    for (const document of team.projects) {
      await patch(document, {
        deletedAt: integer(now),
        deletedBy: string(args.uid),
        updatedAt: integer(now),
        updatedBy: string(args.uid),
        revision: integer(Math.max(1, fieldInteger(document.fields, 'revision') + 1)),
      }, ['deletedAt', 'deletedBy', 'updatedAt', 'updatedBy', 'revision']);
    }
  }

  console.log(JSON.stringify({ ...summary, backupPath, applied: true }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
