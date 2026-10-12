import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const iconSetPath = new URL('../ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json', import.meta.url);

test('AppIcon declares the required iPhone and iPad icon variants', async () => {
  const { images } = JSON.parse(await readFile(iconSetPath, 'utf8'));
  const declared = new Set(images.map(({ idiom, size, scale }) => `${idiom}:${size}:${scale || ''}`));

  for (const key of [
    'iphone:20x20:2x', 'iphone:20x20:3x', 'iphone:29x29:2x', 'iphone:29x29:3x',
    'iphone:40x40:2x', 'iphone:40x40:3x', 'iphone:60x60:2x', 'iphone:60x60:3x',
    'ipad:20x20:1x', 'ipad:20x20:2x', 'ipad:29x29:1x', 'ipad:29x29:2x',
    'ipad:40x40:1x', 'ipad:40x40:2x', 'ipad:76x76:1x', 'ipad:76x76:2x',
    'ipad:83.5x83.5:2x', 'ios-marketing:1024x1024:1x', 'universal:1024x1024:',
  ]) assert.ok(declared.has(key), `missing ${key}`);
});

test('AppIcon keeps a dedicated 1024px source for the universal appearance', async () => {
  const iconPath = new URL('../ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-AnyAppearance-1024.png', import.meta.url);
  await access(iconPath);
});
