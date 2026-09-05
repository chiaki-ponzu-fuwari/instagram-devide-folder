import assert from 'node:assert/strict';
import test from 'node:test';

import {
  makeAuthorizedUserCredentials,
  prepareFirebaseCliApplicationDefault,
} from '../scripts/firebase-cli-credential.mjs';

test('Firebase CLI login is converted to the authorized_user shape required by ADC', () => {
  assert.deepEqual(makeAuthorizedUserCredentials({
    account: { tokens: { refresh_token: 'refresh-secret' } },
    clientId: 'public-client-id',
    clientSecret: 'public-client-secret',
  }), {
    type: 'authorized_user',
    client_id: 'public-client-id',
    client_secret: 'public-client-secret',
    refresh_token: 'refresh-secret',
  });
});

test('Firebase CLI ADC bridge uses a private temporary file and always removes it', async () => {
  const writes = [];
  const removals = [];
  const previous = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const prepared = await prepareFirebaseCliApplicationDefault({
    getGlobalDefaultAccount: () => ({ tokens: { refresh_token: 'refresh-secret' } }),
    clientId: () => 'client-id',
    clientSecret: () => 'client-secret',
    makeTempDir: async () => '/private/tmp/dm-manager-test-credential',
    writeCredentialFile: async (path, content, options) => writes.push({ path, content, options }),
    removeTempDir: async (path, options) => removals.push({ path, options }),
  });
  assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS, '/private/tmp/dm-manager-test-credential/adc.json');
  assert.equal(writes[0].options.mode, 0o600);
  assert.doesNotThrow(() => JSON.parse(writes[0].content));
  await prepared.cleanup();
  assert.deepEqual(removals, [{ path: '/private/tmp/dm-manager-test-credential', options: { recursive: true, force: true } }]);
  assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS, previous);
});

test('Firebase CLI ADC bridge fails closed when login is missing', async () => {
  await assert.rejects(() => prepareFirebaseCliApplicationDefault({
    getGlobalDefaultAccount: () => null,
  }), /firebase-cli-login-required/);
});
