import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/harness.js';

const paths = [
  ['GET', '/'],
  ['GET', '/styles.css'],
  ['GET', '/app.js'],
  ['GET', '/favicon.svg'],
  ['GET', '/no-such-page'],
  ['GET', '/api/health'],
  ['GET', '/api/nothing'],
  ['GET', '/api/signup'],
  ['POST', '/api/signup'],
];

for (const [method, path] of paths) {
  test(`security headers on ${method} ${path}`, async (t) => {
    const s = await startApp();
    t.after(() => s.stop());
    const res = await s.get(path, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
    const h = (name) => res.headers.get(name);
    assert.equal(h('x-content-type-options'), 'nosniff');
    assert.equal(h('referrer-policy'), 'no-referrer');
    assert.equal(h('x-frame-options'), 'DENY');
    assert.match(h('permissions-policy'), /camera=\(\)/);
    assert.equal(h('cross-origin-opener-policy'), 'same-origin');
    assert.equal(h('x-powered-by'), null);
    assert.equal(h('access-control-allow-origin'), null);
    const csp = h('content-security-policy');
    assert.match(csp, /(^|; )frame-ancestors 'none'(;|$)/);
    assert.match(csp, /(^|; )default-src 'none'(;|$)/);
    assert.match(csp, /(^|; )script-src 'self'(;|$)/);
    assert.match(csp, /(^|; )style-src 'self'(;|$)/);
    assert.match(csp, /(^|; )form-action 'self'(;|$)/);
    assert.match(csp, /(^|; )base-uri 'none'(;|$)/);
    assert.match(csp, /(^|; )object-src 'none'(;|$)/);
  });
}

test('the CSP has no unsafe keywords and no remote origins', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  const csp = (await s.get('/')).headers.get('content-security-policy');
  assert.doesNotMatch(csp, /unsafe|\*|https?:|data:/);
});

test('API responses are never cached', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  assert.equal((await s.get('/api/health')).headers.get('cache-control'), 'no-store');
  assert.equal((await s.postJson({ email: 'c@example.com' })).headers.get('cache-control'), 'no-store');
  assert.equal((await s.postJson({ email: 'bad' })).headers.get('cache-control'), 'no-store');
});

test('the real page has no inline script, inline style, or external requests', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  for (const path of ['/', '/privacy']) {
    const html = await (await s.get(path)).text();
    assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/i, `${path}: inline script`);
    assert.doesNotMatch(html, /<style/i, `${path}: style element`);
    assert.doesNotMatch(html, /\sstyle\s*=/i, `${path}: style attribute`);
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${path}: inline handler`);
    assert.doesNotMatch(html, /(src|href)\s*=\s*"\/\//i, `${path}: protocol-relative url`);
  }
});
