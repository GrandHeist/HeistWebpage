import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmail, normalizeServer, normalizeRole, validateSignup, MAX_SERVER_LENGTH } from '../server/validate.js';

const goodEmails = [
  ['alex@example.com', 'alex@example.com'],
  ['  Alex@Example.COM  ', 'alex@example.com'],
  ['first.last@example.co.uk', 'first.last@example.co.uk'],
  ['name+tag@example.com', 'name+tag@example.com'],
  ["o'brien@example.ie", "o'brien@example.ie"],
  ['a_b-c%d@sub.domain.example.org', 'a_b-c%d@sub.domain.example.org'],
  ['x1@e-x.io', 'x1@e-x.io'],
  ['user@bücher.de', 'user@xn--bcher-kva.de'],
  ['user@xn--bcher-kva.de', 'user@xn--bcher-kva.de'],
  ['\tuser@example.com\n', 'user@example.com'],
  ['user@example.museum', 'user@example.museum'],
];

for (const [input, expected] of goodEmails) {
  test(`email accepted and normalised: ${JSON.stringify(input)}`, () => {
    assert.equal(normalizeEmail(input), expected);
  });
}

const badEmails = [
  ['empty', ''],
  ['spaces only', '   '],
  ['no at sign', 'alex.example.com'],
  ['two at signs', 'a@b@example.com'],
  ['no local part', '@example.com'],
  ['no domain', 'alex@'],
  ['no dot in domain', 'alex@localhost'],
  ['single-letter tld', 'alex@example.c'],
  ['numeric tld', 'alex@example.123'],
  ['ip literal', 'alex@[127.0.0.1]'],
  ['bare ip', 'alex@127.0.0.1'],
  ['leading dot in local', '.alex@example.com'],
  ['trailing dot in local', 'alex.@example.com'],
  ['double dot in local', 'al..ex@example.com'],
  ['trailing dot in domain', 'alex@example.com.'],
  ['double dot in domain', 'alex@example..com'],
  ['leading hyphen label', 'alex@-example.com'],
  ['trailing hyphen label', 'alex@example-.com'],
  ['underscore in domain', 'alex@exa_mple.com'],
  ['space inside', 'al ex@example.com'],
  ['space in domain', 'alex@exam ple.com'],
  ['display name form', 'Alex <alex@example.com>'],
  ['quoted local', '"alex"@example.com'],
  ['comma list', 'a@example.com,b@example.com'],
  ['semicolon list', 'a@example.com;b@example.com'],
  ['unicode local part', 'jörg@example.com'],
  ['emoji local part', '😀@example.com'],
  ['newline header injection', 'alex@example.com\r\nBcc: victim@example.com'],
  ['newline inside', 'alex@exam\nple.com'],
  ['null byte', 'alex@example.com\0'],
  ['angle brackets', '<script>@example.com'],
  ['backslash', 'a\\b@example.com'],
  ['slash', 'a/b@example.com'],
  ['equals sign', 'a=b@example.com'],
  ['pipe', 'a|b@example.com'],
  ['too short', 'a@b.c'],
  ['local part over 64', `${'a'.repeat(65)}@example.com`],
  ['whole address over 254', `a@${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.${'e'.repeat(60)}.${'f'.repeat(20)}.com`],
  ['label over 63', `a@${'b'.repeat(64)}.com`],
  ['huge input', `${'a'.repeat(100000)}@example.com`],
  ['number', 12345],
  ['null', null],
  ['undefined', undefined],
  ['array', ['a@example.com']],
  ['object', { toString: () => 'a@example.com' }],
  ['boolean', true],
];

for (const [name, input] of badEmails) {
  test(`email rejected: ${name}`, () => {
    assert.equal(normalizeEmail(input), null);
  });
}

test('email at exactly the length limit is accepted', () => {
  const local = 'a'.repeat(64);
  const host = `${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(50)}.com`;
  const email = `${local}@${host}`;
  assert.ok(email.length <= 254);
  assert.equal(normalizeEmail(email), email);
});

test('email with an address starting with + or - is valid text (neutralised at export, not here)', () => {
  assert.equal(normalizeEmail('+a@example.com'), '+a@example.com');
  assert.equal(normalizeEmail('-a@example.com'), '-a@example.com');
});

test('email starting with = or @ is rejected', () => {
  assert.equal(normalizeEmail('=cmd@example.com'), null);
  assert.equal(normalizeEmail('@example.com'), null);
});

test('email validation of pathological input is fast', () => {
  const start = performance.now();
  normalizeEmail(`${'a.'.repeat(150)}@${'a-'.repeat(150)}.com`);
  normalizeEmail(`${'a'.repeat(300)}!`);
  assert.ok(performance.now() - start < 100);
});

// server field
test('server: missing, null and blank become null', () => {
  assert.deepEqual(normalizeServer(undefined), { value: null });
  assert.deepEqual(normalizeServer(null), { value: null });
  assert.deepEqual(normalizeServer(''), { value: null });
  assert.deepEqual(normalizeServer('   \t  '), { value: null });
});

test('server: trims and collapses whitespace', () => {
  assert.deepEqual(normalizeServer('  Vinewood   RP \n  city '), { value: 'Vinewood RP city' });
});

test('server: control characters and newlines cannot survive', () => {
  const { value } = normalizeServer('a\r\nb\u0000c\u0007d\te');
  assert.equal(value, 'a b c d e');
});

test('server: bidi overrides and zero-width characters are removed', () => {
  const { value } = normalizeServer('abc‮def​ghi');
  assert.equal(value, 'abc def ghi');
  assert.ok(!/[‮​]/.test(value));
});

test('server: unicode is kept and normalised to NFC', () => {
  const decomposed = 'Café RP';
  assert.equal(normalizeServer(decomposed).value, 'Café RP');
  assert.equal(normalizeServer('東京RP').value, '東京RP');
});

test('server: exactly 100 characters is fine, 101 is not', () => {
  assert.equal(normalizeServer('x'.repeat(MAX_SERVER_LENGTH)).value, 'x'.repeat(MAX_SERVER_LENGTH));
  assert.deepEqual(normalizeServer('x'.repeat(MAX_SERVER_LENGTH + 1)), { error: 'server_too_long' });
});

test('server: length counts characters, not UTF-16 units', () => {
  assert.equal(normalizeServer('😀'.repeat(100)).value, '😀'.repeat(100));
  assert.deepEqual(normalizeServer('😀'.repeat(101)), { error: 'server_too_long' });
});

test('server: absurdly long input is rejected without work', () => {
  assert.deepEqual(normalizeServer('x'.repeat(1e6)), { error: 'invalid_server' });
});

for (const [name, input] of [['number', 5], ['object', {}], ['array', ['a']], ['boolean', false]]) {
  test(`server: ${name} is rejected`, () => {
    assert.deepEqual(normalizeServer(input), { error: 'invalid_server' });
  });
}

test('server: markup and formula text is kept as plain text (escaped or neutralised at output)', () => {
  assert.equal(normalizeServer('<b>x</b>').value, '<b>x</b>');
  assert.equal(normalizeServer('=1+1').value, '=1+1');
});

// role
for (const [input, expected] of [
  ['server_owner', 'server_owner'],
  [' Developer ', 'developer'],
  ['PLAYER', 'player'],
  ['', null],
  [undefined, null],
  [null, null],
]) {
  test(`role accepted: ${JSON.stringify(input)}`, () => {
    assert.deepEqual(normalizeRole(input), { value: expected });
  });
}

for (const input of ['admin', 'server owner', 'owner', 'player;drop table', 7, {}, ['player']]) {
  test(`role rejected: ${JSON.stringify(input)}`, () => {
    assert.deepEqual(normalizeRole(input), { error: 'invalid_role' });
  });
}

// whole body
test('validateSignup: a full valid body', () => {
  const r = validateSignup({ email: 'A@Example.com', role: 'developer', server: ' My RP ' });
  assert.deepEqual(r, { ok: true, bot: false, value: { email: 'a@example.com', role: 'developer', server: 'My RP' } });
});

test('validateSignup: only an email is needed', () => {
  const r = validateSignup({ email: 'a@example.com' });
  assert.deepEqual(r.value, { email: 'a@example.com', role: null, server: null });
});

test('validateSignup: unknown fields are ignored', () => {
  const r = validateSignup({ email: 'a@example.com', admin: true, id: 5, created_at: 'x', ip_hash: 'y' });
  assert.deepEqual(Object.keys(r.value).sort(), ['email', 'role', 'server']);
});

test('validateSignup: __proto__ and inherited keys are not read', () => {
  const body = JSON.parse('{"__proto__": {"email": "a@example.com"}}');
  assert.equal(validateSignup(body).error, 'invalid_email');
  assert.equal(validateSignup(Object.create({ email: 'a@example.com' })).error, 'invalid_email');
});

for (const [name, body] of [['null', null], ['array', []], ['string', 'email=a@example.com'], ['number', 1], ['undefined', undefined]]) {
  test(`validateSignup: ${name} body is invalid`, () => {
    assert.equal(validateSignup(body).error, 'invalid_body');
  });
}

test('validateSignup: reports the first problem with a friendly message', () => {
  const r = validateSignup({ email: 'nope' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'invalid_email');
  assert.match(r.message, /valid email/);
});

test('validateSignup: bad role and long server are reported', () => {
  assert.equal(validateSignup({ email: 'a@example.com', role: 'boss' }).error, 'invalid_role');
  assert.equal(validateSignup({ email: 'a@example.com', server: 'x'.repeat(101) }).error, 'server_too_long');
});

test('validateSignup: a filled honeypot is flagged even when the rest is junk', () => {
  assert.deepEqual(validateSignup({ email: 'junk', homepage: 'http://spam.example' }), { ok: true, bot: true });
  assert.equal(validateSignup({ email: 'a@example.com', homepage: 'x' }).bot, true);
});

test('validateSignup: an empty honeypot is normal', () => {
  assert.equal(validateSignup({ email: 'a@example.com', homepage: '' }).bot, false);
  assert.equal(validateSignup({ email: 'a@example.com', homepage: null }).bot, false);
});

test('email with invisible characters in the domain is rejected, not silently cleaned', () => {
  assert.equal(normalizeEmail('a@exa​mple.com'), null);
  assert.equal(normalizeEmail('a@exa­mple.com'), null);
  assert.equal(normalizeEmail('a@exa\tmple.com'), null);
});
