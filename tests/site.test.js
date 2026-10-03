import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startApp } from './helpers/harness.js';

const pub = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const html = readFileSync(join(pub, 'index.html'), 'utf8');

test('the real site files are served with the right types', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  for (const [path, type] of [
    ['/', 'text/html; charset=utf-8'],
    ['/styles.css', 'text/css; charset=utf-8'],
    ['/app.js', 'text/javascript; charset=utf-8'],
    ['/favicon.svg', 'image/svg+xml'],
  ]) {
    const res = await s.get(path);
    assert.equal(res.status, 200, path);
    assert.equal(res.headers.get('content-type'), type, path);
  }
});

test('the real pages have no inline script or style and no external requests', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  for (const path of ['/', '/privacy']) {
    const res = await s.get(path);
    assert.equal(res.status, 200, path);
    const body = await res.text();
    assert.doesNotMatch(body, /<style/i, path);
    assert.doesNotMatch(body, /\sstyle\s*=/i, path);
    assert.doesNotMatch(body, /\son[a-z]+\s*=/i, path);
    assert.equal([...body.matchAll(/<script\b([^>]*)>/gi)].filter((m) => !/\ssrc="\/[^"]+"/.test(m[1])).length, 0, path);
    // every src/href is either same-origin or one of the two profile links
    for (const [, url] of body.matchAll(/(?:src|href)="([^"#][^"]*)"/g)) {
      if (/^https?:/.test(url)) assert.match(url, /^https:\/\/(x\.com\/GTAHeistEngine|github\.com\/GrandHeist)$|^https:\/\/heistengine\.com\//, `${path}: ${url}`);
      else assert.match(url, /^(\/|mailto:)/, `${path}: ${url}`);
    }
  }
});

test('the stylesheet and script make no external requests', () => {
  for (const file of ['styles.css', 'app.js']) {
    const text = readFileSync(join(pub, file), 'utf8');
    assert.doesNotMatch(text, /https?:\/\//, file);
    assert.doesNotMatch(text, /@import|url\(\s*["']?(https?:|\/\/|data:)/i, file);
  }
});

test('the page has the basics: lang, title, description, viewport, icon', () => {
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<title>[^<]{5,}<\/title>/);
  assert.match(html, /<meta name="description" content="[^"]{50,}"/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(html, /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml">/);
});

test('open graph and twitter tags are present', () => {
  for (const tag of ['og:title', 'og:description', 'og:type', 'og:url', 'og:image', 'og:image:width', 'og:image:height']) {
    assert.match(html, new RegExp(`<meta property="${tag}" content="[^"]+"`), tag);
  }
  for (const tag of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image', 'twitter:site']) {
    assert.match(html, new RegExp(`<meta name="${tag}" content="[^"]+"`), tag);
  }
  assert.match(html, /content="summary_large_image"/);
  assert.match(html, /og:image" content="https:\/\/heistengine\.com\/og\.png"/);
});

test('the og image exists and is a 1200x630 png', () => {
  const file = join(pub, 'og.png');
  assert.ok(existsSync(file));
  const buf = readFileSync(file);
  assert.equal(buf.subarray(1, 4).toString(), 'PNG');
  assert.equal(buf.readUInt32BE(16), 1200);
  assert.equal(buf.readUInt32BE(20), 630);
  assert.ok(statSync(file).size < 600 * 1024);
});

test('links go to the X account and the GitHub profile, never the private repo', () => {
  assert.match(html, /href="https:\/\/x\.com\/GTAHeistEngine"/);
  assert.match(html, /href="https:\/\/github\.com\/GrandHeist"/);
  assert.doesNotMatch(html, /github\.com\/GrandHeist\/[A-Za-z]/);
  for (const m of html.matchAll(/<a\b[^>]*href="https?:[^"]*"[^>]*>/g)) assert.match(m[0], /rel="noopener noreferrer"/, m[0]);
});

test('the required disclaimer is in the footer, word for word', () => {
  assert.ok(
    html.includes(
      'Heist Engine is an independent project and is not affiliated with or endorsed by Rockstar Games or Take-Two Interactive. Grand Theft Auto is a trademark of Take-Two Interactive Software, Inc.',
    ),
  );
});

test('the form has the required fields and a hidden honeypot', () => {
  assert.match(html, /<form[^>]*method="post"[^>]*action="\/api\/signup"/);
  assert.match(html, /<input id="email" name="email" type="email" required maxlength="254"/);
  assert.match(html, /<select id="role" name="role">/);
  for (const v of ['server_owner', 'developer', 'player']) assert.ok(html.includes(`value="${v}"`), v);
  assert.match(html, /<input id="server" name="server" type="text" maxlength="100"/);
  assert.match(html, /<div class="hp" aria-hidden="true">[\s\S]*name="homepage"[^>]*tabindex="-1"/);
  assert.match(html, /id="form-status" role="status" aria-live="polite"/);
  assert.match(html, /We only use this to tell you when Heist Engine is ready\./);
});

test('every form control has a label', () => {
  for (const id of ['email', 'role', 'server', 'homepage']) assert.match(html, new RegExp(`<label for="${id}"`), id);
});

test('the copy avoids money, token and date language', () => {
  const text = html.replace(/<[^>]+>/g, ' ').toLowerCase();
  // 'solana' is allowed as of the "Why Solana" nav link -- a deliberate, informed call, not an
  // oversight. Everything else here still isn't welcome on this page.
  for (const word of ['crypto', 'token', 'blockchain', 'invest', 'earn', 'profit', 'price', 'airdrop', 'presale', 'roi', 'apy', 'nft', 'bnb']) {
    assert.ok(!new RegExp(`\\b${word}\\b`).test(text), word);
  }
  assert.doesNotMatch(text, /\b(20\d\d|q[1-4]|january|february|march|april|june|july|august|september|october|november|december)\b/);
});

test('no branded game logos or art are referenced', () => {
  assert.doesNotMatch(html, /rockstar[^.]*\.(png|svg|jpg)|gta[a-z-]*\.(png|svg|jpg)/i);
});

test('the headline reads "Coming soon"', () => {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)[1].replace(/<[^>]+>/g, '');
  assert.equal(h1, 'Coming Soon');
});

test('motion is switched off for people who ask for reduced motion', () => {
  const css = readFileSync(join(pub, 'styles.css'), 'utf8');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important/);
  assert.match(css, /:focus-visible\s*{[^}]*outline/);
});

test('the script only talks to the same-origin signup route', () => {
  const js = readFileSync(join(pub, 'app.js'), 'utf8');
  assert.equal([...js.matchAll(/fetch\(/g)].length, 1);
  assert.match(js, /getAttribute\('action'\)/);
  assert.match(html, /action="\/api\/signup"/);
});
