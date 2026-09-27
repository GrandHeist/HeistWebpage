import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../../server/config.js';
import { createApp } from '../../server/app.js';

// Starts the real server on a random port with a throwaway data folder and (optionally) a
// throwaway public folder. Returns helpers for talking to it and reading the database back.
export async function startApp(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'heist-site-test-'));
  const dataDir = join(dir, 'data');
  const logs = [];
  const config = loadConfig({}, { port: 0, dataDir, log: (line) => logs.push(line), ...overrides });
  const app = createApp(config);
  const { port } = await app.listen();
  const base = `http://127.0.0.1:${port}`;

  return {
    base,
    dir,
    dataDir,
    logs,
    app,
    config,
    get: (path, init) => fetch(base + path, { redirect: 'manual', ...init }),
    postJson: (body, headers = {}) =>
      fetch(`${base}/api/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    postForm: (fields, headers = {}) =>
      fetch(`${base}/api/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
        body: new URLSearchParams(fields).toString(),
      }),
    rows() {
      const db = new DatabaseSync(app.db.file, { readOnly: true });
      try {
        return db.prepare('SELECT * FROM signups ORDER BY id').all();
      } finally {
        db.close();
      }
    },
    async stop() {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// A small public folder for static-serving tests (so they do not depend on the real site files).
export function makePublicDir(root) {
  const pub = join(root, 'public');
  mkdirSync(join(pub, 'sub'), { recursive: true });
  mkdirSync(join(pub, '.hidden'), { recursive: true });
  writeFileSync(join(pub, 'index.html'), '<!doctype html><title>home</title>');
  writeFileSync(join(pub, 'privacy.html'), '<!doctype html><title>privacy</title>');
  writeFileSync(join(pub, 'styles.css'), 'body{color:red}');
  writeFileSync(join(pub, 'app.js'), 'console.log(1)');
  writeFileSync(join(pub, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  writeFileSync(join(pub, 'og.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(join(pub, 'data.bin'), 'x');
  writeFileSync(join(pub, 'sub', 'index.html'), '<title>sub</title>');
  writeFileSync(join(pub, '.env'), 'SECRET=1');
  writeFileSync(join(pub, '.hidden', 'a.txt'), 'hidden');
  writeFileSync(join(root, 'outside.txt'), 'outside the public folder');
  return pub;
}
