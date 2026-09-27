import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, toCsv } from '../server/csv.js';

test('plain values are quoted', () => {
  assert.equal(csvCell('hello'), '"hello"');
  assert.equal(csvCell(42), '"42"');
});

test('null and undefined become empty cells', () => {
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell(undefined), '""');
});

test('quotes are doubled', () => {
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
});

test('commas and newlines stay inside the cell', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('a\nb'), '"a\nb"');
});

for (const lead of ['=', '+', '-', '@', '\t', '\r']) {
  test(`a cell starting with ${JSON.stringify(lead)} is neutralised`, () => {
    const out = csvCell(`${lead}1+1`);
    assert.equal(out, `"'${lead}1+1"`);
    assert.ok(out.startsWith(`"'`));
  });
}

test('classic formula payloads are neutralised', () => {
  for (const payload of ['=cmd|" /C calc"!A0', '=HYPERLINK("http://x.example","a")', '+SUM(1,1)', '-2+3', '@SUM(A1)']) {
    assert.ok(csvCell(payload).startsWith(`"'`), payload);
  }
});

test('an equals sign in the middle is left alone', () => {
  assert.equal(csvCell('a=b'), '"a=b"');
});

test('a negative number as text is also prefixed (it is text, not a number)', () => {
  assert.equal(csvCell('-5'), `"'-5"`);
});

test('toCsv writes a header, CRLF line endings and a final newline', () => {
  const out = toCsv(['id', 'email'], [{ id: 1, email: 'a@example.com' }, { id: 2, email: '+b@example.com' }]);
  assert.equal(out, '"id","email"\r\n"1","a@example.com"\r\n"2","\'+b@example.com"\r\n');
});

test('toCsv with no rows is just the header', () => {
  assert.equal(toCsv(['a', 'b'], []), '"a","b"\r\n');
});
