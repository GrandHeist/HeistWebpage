import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from '../server/ratelimit.js';
import { rateKey, clientAddress } from '../server/ip.js';

function limiter(opts = {}) {
  const clock = { t: 1_000_000 };
  const rl = createRateLimiter({ max: 3, windowMs: 60_000, now: () => clock.t, ...opts });
  return { rl, clock };
}

test('allows up to max hits, then blocks', () => {
  const { rl } = limiter();
  assert.equal(rl.hit('a').allowed, true);
  assert.equal(rl.hit('a').allowed, true);
  const third = rl.hit('a');
  assert.equal(third.allowed, true);
  assert.equal(third.remaining, 0);
  assert.equal(rl.hit('a').allowed, false);
  rl.stop();
});

test('keys are independent', () => {
  const { rl } = limiter();
  for (let i = 0; i < 3; i++) rl.hit('a');
  assert.equal(rl.hit('a').allowed, false);
  assert.equal(rl.hit('b').allowed, true);
  rl.stop();
});

test('blocked response says how long to wait', () => {
  const { rl, clock } = limiter();
  rl.hit('a');
  clock.t += 10_000;
  rl.hit('a');
  rl.hit('a');
  const blocked = rl.hit('a');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSec, 50);
  rl.stop();
});

test('the window slides: the oldest hit expires first', () => {
  const { rl, clock } = limiter();
  rl.hit('a');
  clock.t += 30_000;
  rl.hit('a');
  rl.hit('a');
  assert.equal(rl.hit('a').allowed, false);
  clock.t += 30_000; // first hit is now exactly one window old
  assert.equal(rl.hit('a').allowed, true);
  assert.equal(rl.hit('a').allowed, false);
  rl.stop();
});

test('retrying while blocked does not extend the block', () => {
  const { rl, clock } = limiter();
  for (let i = 0; i < 3; i++) rl.hit('a');
  for (let i = 0; i < 50; i++) {
    clock.t += 1000;
    rl.hit('a');
  }
  clock.t += 10_001; // 60 s + a bit after the first hit
  assert.equal(rl.hit('a').allowed, true);
  rl.stop();
});

test('everything is allowed again after a full window', () => {
  const { rl, clock } = limiter();
  for (let i = 0; i < 3; i++) rl.hit('a');
  clock.t += 60_000;
  assert.equal(rl.hit('a').remaining, 2);
  rl.stop();
});

test('sweep removes expired keys', () => {
  const { rl, clock } = limiter();
  rl.hit('a');
  rl.hit('b');
  assert.equal(rl.size(), 2);
  clock.t += 60_001;
  rl.sweep();
  assert.equal(rl.size(), 0);
  rl.stop();
});

test('the key table is bounded', () => {
  const { rl } = limiter({ maxKeys: 5 });
  for (let i = 0; i < 100; i++) rl.hit(`ip-${i}`);
  assert.ok(rl.size() <= 5);
  rl.stop();
});

test('the default limit of 10 per hour blocks the 11th hit', () => {
  const rl = createRateLimiter({ max: 10, windowMs: 3_600_000 });
  for (let i = 0; i < 10; i++) assert.equal(rl.hit('x').allowed, true);
  assert.equal(rl.hit('x').allowed, false);
  rl.stop();
});

// rateKey
for (const [input, expected] of [
  ['203.0.113.7', '203.0.113.7'],
  ['::ffff:203.0.113.7', '203.0.113.7'],
  ['::ffff:cb00:7107', '203.0.113.7'],
  ['2001:db8:1:2:3:4:5:6', '2001:db8:1:2::/64'],
  ['2001:db8:1:2:ffff:ffff:ffff:ffff', '2001:db8:1:2::/64'],
  ['2001:DB8::1', '2001:db8:0:0::/64'],
  ['::1', '0:0:0:0::/64'],
  ['fe80::1%en0', 'fe80:0:0:0::/64'],
  ['', 'unknown'],
  ['not an ip', 'unknown'],
  [undefined, 'unknown'],
]) {
  test(`rateKey(${JSON.stringify(input)})`, () => {
    assert.equal(rateKey(input), expected);
  });
}

test('two addresses in the same /64 share a key', () => {
  assert.equal(rateKey('2001:db8:aaaa:bbbb::1'), rateKey('2001:db8:aaaa:bbbb:1234::9'));
  assert.notEqual(rateKey('2001:db8:aaaa:bbbb::1'), rateKey('2001:db8:aaaa:bbbc::1'));
});

// clientAddress
const req = (remote, xff) => ({ socket: { remoteAddress: remote }, headers: xff === undefined ? {} : { 'x-forwarded-for': xff } });

test('forwarded headers are ignored unless a proxy is trusted', () => {
  assert.equal(clientAddress(req('10.0.0.1', '198.51.100.9'), 0), '10.0.0.1');
});

test('with one trusted proxy the last forwarded entry is the client', () => {
  assert.equal(clientAddress(req('10.0.0.1', '6.6.6.6, 198.51.100.9'), 1), '198.51.100.9');
});

test('with two trusted proxies the second from the right is the client', () => {
  assert.equal(clientAddress(req('10.0.0.1', '198.51.100.9, 10.0.0.2'), 2), '198.51.100.9');
});

test('a spoofed leading entry cannot pick the client address', () => {
  assert.equal(clientAddress(req('10.0.0.1', '1.1.1.1, 198.51.100.9'), 1), '198.51.100.9');
});

test('garbage or missing forwarded values fall back to the socket address', () => {
  assert.equal(clientAddress(req('10.0.0.1', 'garbage'), 1), '10.0.0.1');
  assert.equal(clientAddress(req('10.0.0.1', undefined), 1), '10.0.0.1');
  assert.equal(clientAddress(req('10.0.0.1', '198.51.100.9'), 3), '10.0.0.1');
});
