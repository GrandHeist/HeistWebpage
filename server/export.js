// Prints every signup as CSV on stdout. Local admin use only: there is no HTTP route for this.
//   npm run export > signups.csv
import { pathToFileURL } from 'node:url';
import { loadConfig, loadDotEnv } from './config.js';
import { readSignups } from './db.js';
import { toCsv } from './csv.js';

export const EXPORT_COLUMNS = ['id', 'email', 'role', 'server', 'created_at'];

export function exportCsv(dataDir) {
  const rows = readSignups(dataDir);
  return rows === null ? null : toCsv(EXPORT_COLUMNS, rows);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadDotEnv();
  const { dataDir } = loadConfig();
  const csv = exportCsv(dataDir);
  if (csv === null) {
    console.error(`No signups database found in ${dataDir}. Start the server once to create it.`);
    process.stdout.write(toCsv(EXPORT_COLUMNS, []));
  } else {
    process.stdout.write(csv);
  }
}
