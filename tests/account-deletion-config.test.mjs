import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function readJson(relativePath) {
  const contents = await readFile(new URL(relativePath, projectRoot), "utf8");
  return JSON.parse(contents);
}

test("Firebase Functions uses the functions directory with the Node 22 runtime", async () => {
  const firebaseConfig = await readJson("firebase.json");

  assert.equal(firebaseConfig.functions?.source, "functions");
  assert.equal(firebaseConfig.functions?.runtime, "nodejs22");
});

test("account deletion emulators use fixed local ports", async () => {
  const firebaseConfig = await readJson("firebase.json");

  assert.equal(firebaseConfig.emulators?.auth?.port, 9099);
  assert.equal(firebaseConfig.emulators?.firestore?.port, 8088);
  assert.equal(firebaseConfig.emulators?.functions?.port, 5001);
});

test("root scripts include the account deletion configuration test", async () => {
  const rootPackage = await readJson("package.json");
  const configTest = "tests/account-deletion-config.test.mjs";

  assert.match(rootPackage.scripts?.test ?? "", new RegExp(configTest));
  assert.match(
    rootPackage.scripts?.["test:account-deletion"] ?? "",
    new RegExp(configTest),
  );
  assert.match(
    rootPackage.scripts?.["test:account-deletion:emulator"] ?? "",
    new RegExp(configTest),
  );
  assert.match(
    rootPackage.scripts?.["test:emulators"] ?? "",
    /firebase emulators:start --only auth,firestore,functions/,
  );
  assert.match(rootPackage.scripts?.["check:js"] ?? "", /functions\/index\.mjs/);
});

test("Functions package is private ESM on Node 22 with Firebase dependencies", async () => {
  const functionsPackage = await readJson("functions/package.json");

  assert.equal(functionsPackage.private, true);
  assert.equal(functionsPackage.type, "module");
  assert.equal(functionsPackage.engines?.node, "22");
  assert.equal(functionsPackage.dependencies?.["firebase-admin"], "^14.3.0");
  assert.equal(functionsPackage.dependencies?.["firebase-functions"], "^7.3.2");
});
