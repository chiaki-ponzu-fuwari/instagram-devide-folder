import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../www/index.html', import.meta.url), 'utf8');
const swift = await readFile(new URL('../ios/App/App/AppDelegate.swift', import.meta.url), 'utf8');

test('settings home provides a prominent feedback route and fallback copy action', () => {
  assert.match(html, /id="settingsOpenFeedback"/);
  assert.match(html, /id="feedbackModal"/);
  assert.match(html, /id="feedbackCopyBtn"/);
  assert.match(html, /ご意見・不具合を送る/);
});

test('feedback route sits immediately above the app support route', () => {
  assert.match(html, /id="settingsOpenFeedback"(?:(?!<div class="settings-item").)*<div class="settings-item">\s*<button type="button" class="settings-item-row support-highlight" id="settingsGoSupport"/s);
});

test('app contains update and review sheets plus the hosted release configuration', () => {
  assert.match(html, /id="appUpdateModal"/);
  assert.match(html, /id="reviewPromptModal"/);
  assert.match(html, /https:\/\/dm-management-ecc1f\.web\.app\/release\.json/);
  assert.match(swift, /@objc\(AppInfo\)/);
  assert.match(swift, /CAPPluginMethod\(name: "getVersion"/);
});

test('review eligibility uses only personal projects when accounts are saved', () => {
  assert.match(html, /maybePromptForReview\(\{ trigger: 'project-save', scope: targetScope \}\)/);
  assert.match(html, /maybePromptForReview\(\{ trigger: 'project-save', scope \}\)/);
  assert.match(html, /if \(!item\?\.project\) return false;/);
});
