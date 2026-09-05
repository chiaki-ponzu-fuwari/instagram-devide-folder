import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const app = read('www/index.html');
const i18n = read('www/i18n.js');
const firebase = JSON.parse(read('firebase.json'));

const publicPages = {
  privacy: read('www/privacy.html'),
  terms: read('www/terms.html'),
  support: read('www/support.html'),
};

test('hosting exposes independent legal and support HTML pages from www', () => {
  assert.equal(firebase.hosting.public, 'www');
  for (const [name, html] of Object.entries(publicPages)) {
    assert.match(html, /<!doctype html>/i, `${name} must be an independent HTML document`);
    assert.match(html, /<meta name="viewport"/i, `${name} must fit an iPhone viewport`);
    assert.match(html, /<html[^>]+lang="ja"/i, `${name} must identify the primary language`);
  }
});

test('privacy copy matches authentication, cloud storage, team sharing, and deletion behavior', () => {
  const html = publicPages.privacy;
  for (const expected of [
    /Google/, /Apple/, /Firebase Authentication/, /Cloud Firestore/, /Cloud Functions/,
    /ユーザー識別子/, /メールアドレス/, /プロフィール画像/,
    /案件/, /予定/, /報酬/, /経費/, /報酬配分/, /銀行名/, /支店/, /口座番号/, /口座名義/,
    /承認済みのチームメンバー/, /国外/, /保存期間/,
    /アプリ内の「アカウントを削除」/, /端末内データ/,
  ]) assert.match(html, expected);

  assert.match(html, /現在[、は]*第三者広告/);
  assert.match(html, /現在[^。]*横断追跡/);
  assert.match(html, /現在[、は]*有料機能/);
  assert.match(html, /自動クラッシュ収集/);
  assert.match(html, /導入前[には、]/);
  assert.match(html, /App Tracking Transparency|ATT/);
  assert.match(html, /App Store Connect/);
  assert.match(html, /Google Sign-In/);
  assert.match(html, /端末識別子/);
  assert.match(html, /IPアドレス/);
  assert.match(html, /概略的な位置情報/);
  assert.match(html, /不正利用防止/);
  assert.match(html, /暗証番号[^<]*取得しません/);
});

test('terms describe current free state, team responsibility, deletion, and future Apple purchase rules', () => {
  const html = publicPages.terms;
  for (const expected of [
    /個人機能はログインなし/, /Google または Apple/,
    /チーム管理者/, /承認済みメンバー/, /公開範囲/,
    /管理者の引き継ぎ/, /チームの解散/, /端末内データ/,
    /禁止事項/, /現在は無料/, /広告は表示していません/,
    /アプリ内課金/, /Apple/, /消費者契約法/,
    /アカウントを削除/, /HERAC LLC/, /herac\.7\.app@gmail\.com/,
  ]) assert.match(html, expected);
});

test('support page gives contact and direct links to both legal pages', () => {
  assert.match(publicPages.support, /herac\.7\.app@gmail\.com/);
  assert.match(publicPages.support, /href="\/privacy\.html"/);
  assert.match(publicPages.support, /href="\/terms\.html"/);
  assert.match(publicPages.support, /アカウント削除/);
});

test('GitHub Pages mirrors use exactly the same approved copy', () => {
  for (const name of Object.keys(publicPages)) {
    assert.equal(read(`docs/${name}.html`), publicPages[name], `${name} mirror diverged`);
  }
});

test('in-app legal navigation and key claims agree with public pages', () => {
  for (const id of ['settingsGoTerms', 'settingsGoPrivacy', 'settingsGoSupportPage']) {
    assert.match(app, new RegExp(`<button[^>]+id="${id}"`));
  }
  assert.match(i18n, /nav_support:\s*'サポート'/);
  assert.match(i18n, /nav_support:\s*'Support'/);
  assert.match(app, /Google または Apple/);
  assert.match(app, /Firebase Authentication/);
  assert.match(app, /Cloud Firestore/);
  assert.match(app, /Cloud Functions/);
  assert.match(app, /承認済みの?チームメンバー/);
  assert.match(app, /approved team members|approved members/i);
  assert.match(app, /アカウントを削除/);
  assert.match(app, /現在[^。]*第三者広告/);
  assert.match(app, /現在[^。]*横断追跡/);
  assert.match(app, /現在[^。]*アプリ内課金/);
  assert.match(app, /currently[^.]*third-party ads/i);
  assert.match(app, /currently[^.]*in-app purchases/i);
});

test('published legal copy does not contain obsolete local-only claims', () => {
  const published = [app, i18n, ...Object.values(publicPages), read('docs/privacy.html'), read('docs/terms.html')].join('\n');
  for (const obsolete of [
    /The App has <strong>no sign-in<\/strong>/,
    /There is no login/,
    /We do <strong>not<\/strong> send your content/,
    /本アプリの仕様上、当社サーバーへの送信は行いません/,
  ]) assert.doesNotMatch(published, obsolete);
});

test('legal and support pages publish an effective date and English summary', () => {
  for (const [name, html] of Object.entries(publicPages)) {
    assert.match(html, /施行日：2026年9月6日/, `${name} effective date missing`);
    assert.match(html, /lang="en"/i, `${name} English summary missing`);
  }
});

test('existing settings navigation rows remain native buttons', () => {
  for (const id of ['settingsGoTemplates', 'settingsGoRevenue', 'settingsGoDoneList', 'settingsGoSupport']) {
    assert.match(app, new RegExp(`<button[^>]+id="${id}"`));
  }
});
