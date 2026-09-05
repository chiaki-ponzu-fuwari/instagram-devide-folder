import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function makeAuthorizedUserCredentials({ account, clientId, clientSecret }) {
  const refreshToken = account?.tokens?.refresh_token;
  if (!refreshToken) throw new Error('firebase-cli-login-required');
  if (!clientId || !clientSecret) throw new Error('firebase-cli-client-required');
  return {
    type: 'authorized_user',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  };
}

export async function prepareFirebaseCliApplicationDefault(overrides = {}) {
  const require = createRequire(import.meta.url);
  const auth = overrides.getGlobalDefaultAccount ? null : require('../node_modules/firebase-tools/lib/auth.js');
  const api = overrides.clientId ? null : require('../node_modules/firebase-tools/lib/api.js');
  const getGlobalDefaultAccount = overrides.getGlobalDefaultAccount || auth.getGlobalDefaultAccount;
  const credentials = makeAuthorizedUserCredentials({
    account: getGlobalDefaultAccount(),
    clientId: (overrides.clientId || api.clientId)(),
    clientSecret: (overrides.clientSecret || api.clientSecret)(),
  });
  const makeTempDir = overrides.makeTempDir || (() => mkdtemp(join(tmpdir(), 'dm-manager-firebase-')));
  const writeCredentialFile = overrides.writeCredentialFile || writeFile;
  const removeTempDir = overrides.removeTempDir || rm;
  const previousPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const dir = await makeTempDir();
  const path = join(dir, 'adc.json');
  await writeCredentialFile(path, `${JSON.stringify(credentials)}\n`, { mode: 0o600, flag: 'wx' });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = path;
  let cleaned = false;
  return {
    async cleanup() {
      if (cleaned) return;
      cleaned = true;
      if (previousPath === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      else process.env.GOOGLE_APPLICATION_CREDENTIALS = previousPath;
      await removeTempDir(dir, { recursive: true, force: true });
    },
  };
}
