import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sw = readFileSync(new URL('../www/sw.js', import.meta.url), 'utf8');

test('service worker does not serve the app shell cache-first', () => {
  assert.match(sw, /networkFirstHtml/);
  assert.match(sw, /e\.request\.mode === 'navigate'/);
  assert.match(sw, /path\.endsWith\('\/index\.html'\)/);
  assert.doesNotMatch(sw, /caches\.match\(e\.request\)\.then\(cached => cached \|\| fetch\(e\.request\)\)/);
});
