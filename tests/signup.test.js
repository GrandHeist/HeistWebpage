import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/harness.js';

test('JSON signup stores a normalised row and answers ok', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  const res = await s.postJson({ email: '  New.User@Example.COM ', role: 'server_owner', server: ' My   RP ' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^application\/json/);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.match(body.message, /on the list/);
  const rows = s.rows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, 'new.user@example.com');
  assert.equal(rows[0].role, 'server_owner');
  assert.equal(rows[0].server, 'My RP');
  assert.match(rows[0].created_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.match(rows[0].ip_hash, /^[0-9a-f]{32}$/);
});

test('form-encoded signup works and, for a browser, returns a friendly HTML page', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  const res = await s.postForm({ email: 'form@example.com', role: 'developer', server: 'x' }, { Accept: 'text/html,application/xhtml+xml' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/html/);
  const html = await res.text();
  assert.match(html, /<h1>You&#39;re on the list\.<\/h1>|<h1>You're on the list\.<\/h1>/);
  assert.match(html, /href="\/styles\.css"/);
  assert.doesNotMatch(html, /<script|style=|form@example\.com/);
  assert.equal(s.rows().length, 1);
});

test('form-encoded signup with a JSON Accept header gets JSON (what the page script would use)', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  const res = await s.postForm({ email: 'a@example.com' }, { Accept: 'application/json' });
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(await res.json()).sort(), ['message', 'ok']);
});

test('form-encoded signup from a bare client (Accept */*) gets HTML', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  const res = await s.postForm({ email: 'a@example.com' }, { Accept: '*/*' });
  assert.match(res.headers.get('content-type'), /^text\/html/);
});

test('an invalid email gets 400 JSON with a message and stores nothing', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  const res = await s.postJson({ email: 'not-an-email' });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, 'invalid_email');
  assert.match(body.message, /valid email/);
  assert.equal(s.rows().length, 0);
});

test('an invalid email on a form post gets a friendly HTML error page', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  const res = await s.postForm({ email: 'nope' }, { Accept: 'text/html' });
  assert.equal(res.status, 400);
  assert.match(res.headers.get('content-type'), /^text\/html/);
  const html = await res.text();
  assert.match(html, /valid email/);
  assert.match(html, /href="\/#early-access"/);
});

test('error pages never echo what the visitor sent', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  const res = await s.postForm({ email: '<script>alert(1)</script>@example.com', server: '<img src=x>' }, { Accept: 'text/html' });
  const html = await res.text();
  assert.doesNotMatch(html, /alert\(1\)|<img src=x>/);
});

for (const [name, body, error] of [
  ['bad role', { email: 'a@example.com', role: 'boss' }, 'invalid_role'],
  ['server name too long', { email: 'a@example.com', server: 'x'.repeat(101) }, 'server_too_long'],
  ['numeric email', { email: 12345 }, 'invalid_email'],
  ['missing email', { role: 'player' }, 'invalid_email'],
  ['array body', [], 'invalid_body'],
  ['null body', null, 'invalid_body'],
  ['object server', { email: 'a@example.com', server: { a: 1 } }, 'invalid_server'],
]) {
  test(`JSON: ${name} is rejected with ${error}`, async (t) => {
    const s = await startApp();
    t.after(() => s.stop());
    const res = await s.postJson(JSON.stringify(body));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, error);
    assert.equal(s.rows().length, 0);
  });
}

test('malformed JSON is a 400, not a crash', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  for (const bad of ['{', '{"email":', 'null]', '', 'email=a@example.com']) {
    const res = await s.postJson(bad);
    assert.equal(res.status, 400, bad);
    assert.equal((await res.json()).error, 'invalid_body');
  }
  assert.equal((await s.get('/api/health')).status, 200);
});

test('the same form field sent twice is refused', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  const res = await fetch(`${s.base}/api/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: 'email=a%40example.com&email=b%40example.com',
  });
  assert.equal(res.status, 400);
  assert.equal(s.rows().length, 0);
});

test('a duplicate email gets the identical response and no second row', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  const first = await s.postJson({ email: 'dup@example.com', role: 'player' });
  const second = await s.postJson({ email: 'DUP@example.com ', role: 'developer', server: 'other' });
  assert.equal(first.status, second.status);
  assert.deepEqual(await first.json(), await second.json());
  const rows = s.rows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, 'player'); // the first signup is not overwritten
  assert.equal(rows[0].server, null);
});

test('a duplicate on a form post shows the same page as a new signup', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  const a = await (await s.postForm({ email: 'same@example.com' }, { Accept: 'text/html' })).text();
  const b = await (await s.postForm({ email: 'same@example.com' }, { Accept: 'text/html' })).text();
  assert.equal(a, b);
});

test('the honeypot is accepted with the normal response but nothing is stored', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  const real = await s.postJson({ email: 'real@example.com' });
  const bot = await s.postJson({ email: 'bot@example.com', homepage: 'http://spam.example' });
  assert.equal(bot.status, 200);
  assert.deepEqual(await bot.json(), await real.json());
  assert.deepEqual(s.rows().map((r) => r.email), ['real@example.com']);
});

test('the honeypot works on form posts too, even with junk in the email', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  const res = await s.postForm({ email: 'junk', homepage: 'x' }, { Accept: 'text/html' });
  assert.equal(res.status, 200);
  assert.equal(s.rows().length, 0);
});

test('an empty honeypot field (what the real form sends) is a normal signup', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  await s.postForm({ email: 'ok@example.com', homepage: '', role: '', server: '' }, { Accept: 'application/json' });
  const rows = s.rows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, null);
  assert.equal(rows[0].server, null);
});

test('SQL metacharacters are stored as plain text', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  const nasty = "x'); DROP TABLE signups;--";
  const res = await s.postJson({ email: "o'brien@example.com", server: nasty });
  assert.equal(res.status, 200);
  const rows = s.rows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].server, nasty);
  assert.equal(rows[0].email, "o'brien@example.com");
});

test('unicode server names round-trip', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  await s.postJson({ email: 'u@example.com', server: '東京 RP 🚓' });
  assert.equal(s.rows()[0].server, '東京 RP 🚓');
});

test('an internationalised domain is stored in punycode', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  await s.postJson({ email: 'u@bücher.de' });
  assert.equal(s.rows()[0].email, 'u@xn--bcher-kva.de');
});

test('unsupported content types get 415', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  for (const type of ['text/plain', 'multipart/form-data; boundary=x', 'application/xml', '']) {
    const res = await fetch(`${s.base}/api/signup`, { method: 'POST', headers: type ? { 'Content-Type': type } : {}, body: 'email=a@example.com' });
    assert.equal(res.status, 415, type);
  }
  assert.equal(s.rows().length, 0);
});

test('content type parameters and case are tolerated', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  const res = await s.postJson({ email: 'c@example.com' }, { 'Content-Type': 'Application/JSON; charset=UTF-8' });
  assert.equal(res.status, 200);
});

test('only POST is allowed on the signup route', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  for (const method of ['GET', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
    const res = await fetch(`${s.base}/api/signup`, { method });
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get('allow'), 'POST');
  }
});

test('no CORS headers are ever sent, and a preflight is not honoured', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  const pre = await fetch(`${s.base}/api/signup`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(pre.headers.get('access-control-allow-origin'), null);
  const post = await s.postJson({ email: 'cors@example.com' }, { Origin: 'https://evil.example' });
  assert.equal(post.headers.get('access-control-allow-origin'), null);
  assert.equal((await s.get('/', { headers: { Origin: 'https://evil.example' } })).headers.get('access-control-allow-origin'), null);
});

test('the database is capped', async (t) => {
  const s = await startApp({ maxSignups: 2 });
  t.after(() => s.stop());
  assert.equal((await s.postJson({ email: 'a1@example.com' })).status, 200);
  assert.equal((await s.postJson({ email: 'a2@example.com' })).status, 200);
  const res = await s.postJson({ email: 'a3@example.com' });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'closed');
  assert.equal(s.rows().length, 2);
});

test('many concurrent signups all land exactly once', async (t) => {
  const s = await startApp({ rateLimit: { max: 1000, windowMs: 60_000 } });
  t.after(() => s.stop());
  const emails = Array.from({ length: 40 }, (_, i) => `load${i % 20}@example.com`);
  const results = await Promise.all(emails.map((email) => s.postJson({ email })));
  assert.ok(results.every((r) => r.status === 200));
  assert.equal(s.rows().length, 20);
});
