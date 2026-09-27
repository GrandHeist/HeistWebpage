import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { symlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startApp, makePublicDir } from './helpers/harness.js';
import { contentTypeFor } from '../server/static.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

async function staticApp(t, extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'heist-site-pub-'));
  const publicDir = makePublicDir(root);
  const s = await startApp({ publicDir, ...extra });
  t.after(() => s.stop());
  return { s, root, publicDir };
}

// Sends a raw request line so the client library cannot tidy up the path first.
function raw(base, requestTarget) {
  const { port } = new URL(base);
  return new Promise((resolve, reject) => {
    const sock = net.connect(Number(port), '127.0.0.1', () => {
      sock.write(`GET ${requestTarget} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
    });
    let data = '';
    sock.on('data', (d) => (data += d));
    sock.on('end', () => resolve(data));
    sock.on('error', reject);
  });
}

for (const [path, type, snippet] of [
  ['/', 'text/html; charset=utf-8', 'home'],
  ['/index.html', 'text/html; charset=utf-8', 'home'],
  ['/privacy', 'text/html; charset=utf-8', 'privacy'],
  ['/privacy.html', 'text/html; charset=utf-8', 'privacy'],
  ['/privacy/', 'text/html; charset=utf-8', 'privacy'],
  ['/sub/', 'text/html; charset=utf-8', 'sub'],
  ['/styles.css', 'text/css; charset=utf-8', 'color:red'],
  ['/app.js', 'text/javascript; charset=utf-8', 'console.log'],
  ['/favicon.svg', 'image/svg+xml', '<svg'],
  ['/og.png', 'image/png', null],
  ['/data.bin', 'application/octet-stream', 'x'],
]) {
  test(`serves ${path} as ${type}`, async (t) => {
    const { s } = await staticApp(t);
    const res = await s.get(path);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), type);
    if (snippet) assert.match(await res.text(), new RegExp(snippet.replace(/[().]/g, '\\$&')));
  });
}

test('content types by extension', () => {
  assert.equal(contentTypeFor('a.HTML'), 'text/html; charset=utf-8');
  assert.equal(contentTypeFor('a.webmanifest'), 'application/manifest+json; charset=utf-8');
  assert.equal(contentTypeFor('a.unknown'), 'application/octet-stream');
  assert.equal(contentTypeFor('noext'), 'application/octet-stream');
});

test('content length matches and HEAD has no body', async (t) => {
  const { s } = await staticApp(t);
  const get = await s.get('/styles.css');
  const body = await get.text();
  assert.equal(Number(get.headers.get('content-length')), Buffer.byteLength(body));
  const head = await s.get('/styles.css', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), get.headers.get('content-length'));
  assert.equal(await head.text(), '');
});

test('ETag revalidation gives 304', async (t) => {
  const { s } = await staticApp(t);
  const first = await s.get('/');
  const etag = first.headers.get('etag');
  assert.ok(etag);
  const again = await s.get('/', { headers: { 'If-None-Match': etag } });
  assert.equal(again.status, 304);
  assert.equal((await s.get('/', { headers: { 'If-None-Match': 'W/"nope"' } })).status, 200);
});

test('unknown paths get a friendly HTML 404', async (t) => {
  const { s } = await staticApp(t);
  const res = await s.get('/nothing-here');
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type'), /^text\/html/);
  assert.match(await res.text(), /Nothing here/);
});

test('only GET and HEAD are allowed on pages', async (t) => {
  const { s } = await staticApp(t);
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const res = await s.get('/', { method });
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get('allow'), 'GET, HEAD');
  }
});

// path traversal
const traversal = [
  '/../outside.txt',
  '/%2e%2e/outside.txt',
  '/%2E%2E/outside.txt',
  '/..%2foutside.txt',
  '/..%2Foutside.txt',
  '/%2e%2e%2foutside.txt',
  '/sub/../../outside.txt',
  '/sub/%2e%2e/%2e%2e/outside.txt',
  '/....//outside.txt',
  '/..\\outside.txt',
  '/..%5coutside.txt',
  '/%5c..%5coutside.txt',
  '/%00',
  '/index.html%00.png',
  '/%252e%252e/outside.txt',
  '/./../outside.txt',
  '//../outside.txt',
  '/sub//..//..//outside.txt',
];

for (const target of traversal) {
  test(`traversal attempt is refused: ${target}`, async (t) => {
    const { s } = await staticApp(t);
    const response = await raw(s.base, target);
    assert.doesNotMatch(response, /outside the public folder/);
    assert.match(response, /^HTTP\/1\.1 (400|404)/);
  });
}

test('absolute-form and odd request targets are refused', async (t) => {
  const { s } = await staticApp(t);
  const abs = await raw(s.base, 'http://evil.example/outside.txt');
  assert.match(abs, /^HTTP\/1\.1 400/);
  const star = await raw(s.base, '*');
  assert.match(star, /^HTTP\/1\.1 400/);
});

test('bad percent-encoding is a 400', async (t) => {
  const { s } = await staticApp(t);
  assert.match(await raw(s.base, '/%zz'), /^HTTP\/1\.1 400/);
  assert.match(await raw(s.base, '/%E0%A4%A'), /^HTTP\/1\.1 400/);
});

test('dotfiles and dot folders are never served', async (t) => {
  const { s } = await staticApp(t);
  for (const path of ['/.env', '/.hidden/a.txt', '/%2eenv', '/.git/config', '/sub/.env']) {
    const res = await s.get(path);
    assert.equal(res.status, 404, path);
    assert.doesNotMatch(await res.text(), /SECRET|hidden/);
  }
});

test('a symlink that points outside the public folder is not followed', async (t) => {
  const { s, root, publicDir } = await staticApp(t);
  symlinkSync(join(root, 'outside.txt'), join(publicDir, 'link.txt'));
  mkdirSync(join(root, 'elsewhere'));
  symlinkSync(join(root, 'elsewhere'), join(publicDir, 'linkdir'));
  assert.equal((await s.get('/link.txt')).status, 404);
  assert.equal((await s.get('/linkdir/')).status, 404);
});

test('a folder without an index file is a 404, not a listing', async (t) => {
  const { s, publicDir } = await staticApp(t);
  mkdirSync(join(publicDir, 'empty'));
  const res = await s.get('/empty/');
  assert.equal(res.status, 404);
  assert.doesNotMatch(await res.text(), /Index of/);
});
