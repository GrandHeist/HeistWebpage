import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startApp } from './helpers/harness.js';
import { exportCsv } from '../server/export.js';
import { openSignups } from '../server/db.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runExport = (dataDir) =>
  execFileSync('node', ['server/export.js'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir }, encoding: 'utf8' });

test('export prints a header and one CRLF-terminated line per signup, oldest first', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  await s.postJson({ email: 'one@example.com', role: 'developer', server: 'First RP' });
  await s.postJson({ email: 'two@example.com' });
  const out = runExport(s.dataDir);
  const lines = out.split('\r\n');
  assert.equal(lines[0], '"id","email","role","server","created_at"');
  assert.match(lines[1], /^"1","one@example\.com","developer","First RP","\d{4}-\d\d-\d\dT[\d:.]+Z"$/);
  assert.match(lines[2], /^"2","two@example\.com","","",/);
  assert.equal(lines[3], '');
  assert.equal(lines.length, 4);
});

test('export never includes the ip hash', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  await s.postJson({ email: 'one@example.com' });
  const [row] = s.rows();
  const out = runExport(s.dataDir);
  assert.ok(!out.includes(row.ip_hash));
  assert.ok(!/ip_hash/.test(out));
});

test('export neutralises spreadsheet formulas in the server field', async (t) => {
  const s = await startApp({ rateLimit: { max: 100, windowMs: 60_000 } });
  t.after(() => s.stop());
  const payloads = ['=1+1', '+1+1', '-1+1', '@SUM(A1)', '=HYPERLINK("http://evil.example","x")', '=cmd|\' /C calc\'!A0'];
  for (const [i, server] of payloads.entries()) await s.postJson({ email: `f${i}@example.com`, server });
  const out = runExport(s.dataDir);
  const rows = out.trim().split('\r\n').slice(1);
  assert.equal(rows.length, payloads.length);
  for (const line of rows) {
    // the server field is the fourth cell; whatever it holds must not start with a formula character
    const cells = line.match(/"(?:[^"]|"")*"/g);
    assert.match(cells[3], /^"'/, line);
  }
  assert.doesNotMatch(out, /,"[=+\-@]/);
});

test('export neutralises addresses that start with + or -', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  await s.postJson({ email: '+plus@example.com' });
  await s.postJson({ email: '-minus@example.com' });
  const out = runExport(s.dataDir);
  assert.match(out, /"'\+plus@example\.com"/);
  assert.match(out, /"'-minus@example\.com"/);
  assert.doesNotMatch(out, /,"[=+\-@]/);
});

test('export quotes commas, quotes and keeps unicode', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  await s.postJson({ email: 'q@example.com', server: 'Big, "Loud" RP 東京' });
  assert.match(runExport(s.dataDir), /"Big, ""Loud"" RP 東京"/);
});

test('export of an empty database is just the header', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  assert.equal(runExport(s.dataDir), '"id","email","role","server","created_at"\r\n');
});

test('export with no database prints the header, explains on stderr and exits cleanly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'heist-site-none-'));
  try {
    const r = spawnSync('node', ['server/export.js'], { cwd: root, env: { ...process.env, DATA_DIR: join(dir, 'nothing') }, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '"id","email","role","server","created_at"\r\n');
    assert.match(r.stderr, /No signups database/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('export works while the server is running and does not write to the database', async (t) => {
  const s = await startApp();
  t.after(() => s.stop());
  await s.postJson({ email: 'live@example.com' });
  const before = s.app.db.count();
  const out = runExport(s.dataDir);
  assert.match(out, /live@example\.com/);
  assert.equal(s.app.db.count(), before);
});

test('exportCsv returns null when there is no database', () => {
  assert.equal(exportCsv(join(tmpdir(), 'definitely-not-here-heist-site')), null);
});

test('exportCsv reads rows written through the db layer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'heist-site-exp-'));
  try {
    const db = openSignups({ dataDir: dir });
    db.add({ email: 'x@example.com', role: 'player', server: null, ip: '1.1.1.1' });
    db.close();
    assert.match(exportCsv(dir), /"x@example\.com","player",""/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('npm scripts exist for start, test and export', async () => {
  const pkg = JSON.parse((await import('node:fs')).readFileSync(join(root, 'package.json'), 'utf8'));
  assert.ok(pkg.scripts.start && pkg.scripts.test && pkg.scripts.export);
  assert.equal(Object.keys(pkg.dependencies || {}).length, 0);
  assert.equal(Object.keys(pkg.devDependencies || {}).length, 0);
});
