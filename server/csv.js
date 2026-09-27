// A cell that starts with one of these is read as a formula by spreadsheet programs.
const FORMULA_START = /^[=+\-@\t\r]/;

// Quotes one CSV cell. Text that could run as a formula gets a leading apostrophe.
export function csvCell(value) {
  if (value === null || value === undefined) return '""';
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function toCsv(columns, rows) {
  const lines = [columns.map(csvCell).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c])).join(','));
  return lines.join('\r\n') + '\r\n';
}
