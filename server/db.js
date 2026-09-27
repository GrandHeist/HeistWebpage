import { DatabaseSync } from 'node:sqlite';
import { createHmac, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const DB_FILE = 'signups.sqlite';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS signups (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT    NOT NULL UNIQUE CHECK (length(email) BETWEEN 6 AND 254),
    role       TEXT    CHECK (role IS NULL OR role IN ('server_owner', 'developer', 'player')),
    server     TEXT    CHECK (server IS NULL OR length(server) <= 400),
    created_at TEXT    NOT NULL,
    ip_hash    TEXT    NOT NULL
  )
`;

// The secret that IP hashes are salted with: IP_SALT if set, otherwise a random value
// generated once and kept next to the database (owner-only file).
export function loadSalt(dataDir, envSalt = '') {
  if (envSalt) return envSalt;
  const file = join(dataDir, 'ip-salt');
  if (!existsSync(file)) {
    try {
      writeFileSync(file, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
  chmodSync(file, 0o600);
  return readFileSync(file, 'utf8').trim();
}

// Opens (and on first run creates) the signups database in `dataDir`.
export function openSignups({ dataDir, ipSalt = '' }) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const salt = loadSalt(dataDir, ipSalt);
  const file = join(dataDir, DB_FILE);
  const db = new DatabaseSync(file);
  try {
    chmodSync(file, 0o600);
  } catch {
    // not fatal: the data dir itself is already owner-only
  }
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 3000');
  db.exec(SCHEMA);

  const insert = db.prepare(
    'INSERT INTO signups (email, role, server, created_at, ip_hash) VALUES (?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING',
  );
  const countAll = db.prepare('SELECT COUNT(*) AS n FROM signups');

  return {
    file,
    // Never stores the address itself, only a keyed hash that is good for spotting abuse.
    hashIp: (ip) => createHmac('sha256', salt).update(String(ip)).digest('hex').slice(0, 32),
    // Returns true if a new row was written, false if the email was already there.
    add({ email, role, server, ip }) {
      const result = insert.run(email, role, server, new Date().toISOString(), this.hashIp(ip));
      return result.changes === 1;
    },
    count: () => Number(countAll.get().n),
    close: () => db.close(),
  };
}

// Read-only listing for the export command. Returns null if there is no database yet.
export function readSignups(dataDir) {
  const file = join(dataDir, DB_FILE);
  if (!existsSync(file)) return null;
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout = 3000');
    return db.prepare('SELECT id, email, role, server, created_at FROM signups ORDER BY id').all();
  } finally {
    db.close();
  }
}
