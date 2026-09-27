import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { statSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { startApp } from './helpers/harness.js';

test('rate limit: the 11th attempt from one address gets 429 with Retry-After', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  for (let i = 0; i < 10; i++) {
    const res = await s.postJson({ email: `rl${i}@example.com` });
    assert.equal(res.status, 200, `attempt ${i + 1}`);
  }
  const blocked = await s.postJson({ email: 'rl11@example.com' });
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).error, 'rate_limited');
  const wait = Number(blocked.headers.get('retry-after'));
  assert.ok(wait > 0 && wait <= 3600);
  assert.equal(s.rows().length, 10);
});

test('rate limit: invalid attempts and honeypot hits count too', async (t) => {
  const s = await startApp({ rateLimit: { max: 3, windowMs: 60_000 } });
  t.after(() => s.stop());
  assert.equal((await s.postJson({ email: 'bad' })).status, 400);
  assert.equal((await s.postJson({ email: 'a@example.com', homepage: 'x' })).status, 200);
  assert.equal((await s.postJson({ email: 'b@example.com' })).status, 200);
  assert.equal((await s.postJson({ email: 'c@example.com' })).status, 429);
});

test('rate limit: the 429 for a browser form post is a friendly page', async (t) => {
  const s = await startApp({ rateLimit: { max: 1, windowMs: 60_000 } });
  t.after(() => s.stop());
  await s.postForm({ email: 'a@example.com' }, { Accept: 'text/html' });
  const res = await s.postForm({ email: 'b@example.com' }, { Accept: 'text/html' });
  assert.equal(res.status, 429);
  assert.match(res.headers.get('content-type'), /^text\/html/);
  assert.match(await res.text(), /try again later/i);
});

test('rate limit: does not apply to pages or health', async (t) => {
  const s = await startApp({ rateLimit: { max: 1, windowMs: 60_000 } });
  t.after(() => s.stop());
  await s.postJson({ email: 'a@example.com' });
  for (let i = 0; i < 5; i++) assert.equal((await s.get('/api/health')).status, 200);
});

test('rate limit: X-Forwarded-For cannot dodge the limit when no proxy is trusted', async (t) => {
  const s = await startApp({ rateLimit: { max: 2, windowMs: 60_000 } });
  t.after(() => s.stop());
  await s.postJson({ email: 'a@example.com' }, { 'X-Forwarded-For': '1.1.1.1' });
  await s.postJson({ email: 'b@example.com' }, { 'X-Forwarded-For': '2.2.2.2' });
  const res = await s.postJson({ email: 'c@example.com' }, { 'X-Forwarded-For': '3.3.3.3' });
  assert.equal(res.status, 429);
});

test('rate limit: behind a trusted proxy each forwarded client gets its own allowance', async (t) => {
  const s = await startApp({ rateLimit: { max: 1, windowMs: 60_000 }, trustProxy: 1 });
  t.after(() => s.stop());
  assert.equal((await s.postJson({ email: 'a@example.com' }, { 'X-Forwarded-For': '198.51.100.1' })).status, 200);
  assert.equal((await s.postJson({ email: 'b@example.com' }, { 'X-Forwarded-For': '198.51.100.2' })).status, 200);
  assert.equal((await s.postJson({ email: 'c@example.com' }, { 'X-Forwarded-For': '9.9.9.9, 198.51.100.2' })).status, 429);
});

// body size
test('body limit: a body over 4 KB gets 413 and stores nothing', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  const res = await s.postJson({ email: 'big@example.com', server: 'x'.repeat(5000) });
  assert.equal(res.status, 413);
  assert.equal((await res.json()).error, 'too_large');
  assert.equal(s.rows().length, 0);
});

test('body limit: a body of exactly 4096 bytes is read', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  const prefix = '{"email":"edge@example.com","pad":"';
  const suffix = '"}';
  const body = prefix + 'x'.repeat(4096 - prefix.length - suffix.length) + suffix;
  assert.equal(Buffer.byteLength(body), 4096);
  assert.equal((await s.postJson(body)).status, 200);
});

test('body limit: one byte over is refused', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  const prefix = '{"email":"edge@example.com","pad":"';
  const body = prefix + 'x'.repeat(4097 - prefix.length - 2) + '"}';
  assert.equal(Buffer.byteLength(body), 4097);
  assert.equal((await s.postJson(body)).status, 413);
});

test('body limit: a form body over 4 KB gets 413', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  const res = await s.postForm({ email: 'a@example.com', server: 'y'.repeat(6000) }, { Accept: 'application/json' });
  assert.equal(res.status, 413);
});

test('body limit: a body that lies about its length is still cut off (chunked upload)', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  const chunks = (async function* () {
    for (let i = 0; i < 20; i++) yield Buffer.alloc(1000, 'a');
  })();
  const res = await fetch(`${s.base}/api/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: chunks,
    duplex: 'half',
  });
  assert.equal(res.status, 413);
  assert.equal(s.rows().length, 0);
});

test('body limit: a huge upload is dropped without a response body being buffered', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  const big = Buffer.alloc(2 * 1024 * 1024, 'a');
  let outcome;
  try {
    const res = await fetch(`${s.base}/api/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: big,
    });
    outcome = res.status;
  } catch {
    outcome = 'closed';
  }
  assert.ok(outcome === 413 || outcome === 'closed', String(outcome));
  assert.equal((await s.get('/api/health')).status, 200);
});

test('a client that disconnects mid-body does not break the server', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  const { port } = new URL(s.base);
  await new Promise((resolve) => {
    const sock = net.connect(Number(port), '127.0.0.1', () => {
      sock.write('POST /api/signup HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{"email":');
      setTimeout(() => {
        sock.destroy();
        resolve();
      }, 50);
    });
  });
  assert.equal((await s.get('/api/health')).status, 200);
  assert.equal(s.rows().length, 0);
});

// logs and stored data
test('logs never contain email addresses, server names, addresses or query strings', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  await s.postJson({ email: 'secret.person@example.com', server: 'Private RP Name' });
  await s.postJson({ email: 'secret.person@example.com' });
  await s.postJson({ email: 'bad' });
  await s.get('/?email=leak@example.com');
  await s.get('/leak@example.com');
  await s.get('/api/leak@example.com');
  const all = s.logs.join('\n');
  assert.ok(s.logs.length >= 6);
  assert.doesNotMatch(all, /secret|person|example\.com|Private|leak|127\.0\.0\.1|::1|\?/);
  assert.match(all, /POST api\/signup 200/);
});

test('the database holds a keyed hash of the address, never the address', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  await s.postJson({ email: 'hash@example.com' });
  const [row] = s.rows();
  assert.doesNotMatch(JSON.stringify(row), /127\.0\.0\.1|::1|ffff/);
  assert.equal(row.ip_hash, s.app.db.hashIp('127.0.0.1')); // the socket address the server actually saw
  assert.notEqual(s.app.db.hashIp('1.2.3.4'), s.app.db.hashIp('1.2.3.5'));
  assert.equal(s.app.db.hashIp('1.2.3.4'), s.app.db.hashIp('1.2.3.4'));
});

test('a different salt gives a different hash for the same address', async (t) => {
  const a = await startApp({ ipSalt: 'salt-one' });
  const b = await startApp({ ipSalt: 'salt-two' });
  t.after(() => Promise.all([a.stop(), b.stop()]));
  assert.notEqual(a.app.db.hashIp('1.2.3.4'), b.app.db.hashIp('1.2.3.4'));
});

test('the salt is generated once, kept in an owner-only file, and reused after a restart', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  const file = join(s.dataDir, 'ip-salt');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const salt = readFileSync(file, 'utf8');
  assert.match(salt, /^[0-9a-f]{64}$/);
  const before = s.app.db.hashIp('1.2.3.4');
  const { openSignups } = await import('../server/db.js');
  const again = openSignups({ dataDir: s.dataDir });
  assert.equal(again.hashIp('1.2.3.4'), before);
  again.close();
});

test('the data folder and database are owner-only and contain the expected columns', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  assert.equal(statSync(s.dataDir).mode & 0o777, 0o700);
  assert.equal(statSync(s.app.db.file).mode & 0o777, 0o600);
  await s.postJson({ email: 'cols@example.com' });
  assert.deepEqual(Object.keys(s.rows()[0]), ['id', 'email', 'role', 'server', 'created_at', 'ip_hash']);
  assert.ok(readdirSync(s.dataDir).includes('signups.sqlite'));
});

test('the database itself refuses a duplicate email and an unknown role', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(s.app.db.file);
  db.prepare("INSERT INTO signups (email, role, server, created_at, ip_hash) VALUES ('x@example.com', NULL, NULL, 'now', 'h')").run();
  assert.throws(() => db.prepare("INSERT INTO signups (email, created_at, ip_hash) VALUES ('x@example.com', 'now', 'h')").run(), /UNIQUE/);
  assert.throws(() => db.prepare("INSERT INTO signups (email, role, created_at, ip_hash) VALUES ('y@example.com', 'admin', 'now', 'h')").run(), /CHECK/);
  db.close();
});

test('the database is created on first run and survives a restart with its data', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  await s.postJson({ email: 'keep@example.com' });
  const { openSignups } = await import('../server/db.js');
  const again = openSignups({ dataDir: s.dataDir });
  assert.equal(again.count(), 1);
  assert.equal(again.add({ email: 'keep@example.com', role: null, server: null, ip: '1.1.1.1' }), false);
  assert.equal(again.add({ email: 'new@example.com', role: null, server: null, ip: '1.1.1.1' }), true);
  again.close();
});

// health and misc
test('health answers ok on GET and HEAD and reveals nothing else', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  await s.postJson({ email: 'h@example.com' });
  const res = await s.get('/api/health');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^application\/json/);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal((await s.get('/api/health', { method: 'HEAD' })).status, 200);
  assert.equal((await s.get('/api/health', { method: 'POST' })).status, 405);
});

test('unknown api routes are JSON 404s', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  for (const path of ['/api', '/api/', '/api/export', '/api/signups', '/api/admin']) {
    const res = await s.get(path, { headers: { Accept: 'application/json' } });
    assert.equal(res.status, 404, path);
    assert.equal((await res.json()).error, 'not_found');
  }
});

test('there is no HTTP route that exposes the signups', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  await s.postJson({ email: 'private@example.com' });
  for (const path of ['/api/export', '/export', '/export.csv', '/signups', '/data/signups.sqlite', '/signups.sqlite', '/api/signup?export=1']) {
    const res = await s.get(path);
    const text = await res.text();
    assert.doesNotMatch(text, /private@example\.com/, path);
  }
});
