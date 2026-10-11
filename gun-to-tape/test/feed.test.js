import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, readFeedFile, buildEvents } from '../src/sources/feed.js';
import { buildImportFiles } from '../src/lib/sql-out.js';

const file = new URL('./fixtures/feed-sample.csv', import.meta.url).pathname;

test('csv parser handles quoted commas and header names', () => {
  const rows = parseCsv(readFeedFile && 'a,b\n"x, y",2\n');
  assert.deepEqual(rows, [{ a: 'x, y', b: '2' }]);
});

test('feed rows become one event with finishers, a DNF, and skipped bad rows', () => {
  const { events, skipped } = buildEvents(readFeedFile(file), 'stuweb');
  assert.equal(skipped, 1);
  assert.equal(events.length, 1);
  const [{ event, results }] = events;
  assert.equal(event.id, 'stuweb:test-fell-race-2026-10-10-8k');
  assert.equal(event.discipline, 'road');
  assert.equal(event.finishers, 2);
  assert.equal(results[0].name, 'Sam Jones');
  assert.equal(results[0].club, 'Hill, Dale & Moor AC');
  assert.equal(results[1].athleteKey, 'ana muller');
  assert.equal(results[2].status, 'dnf');
  assert.equal(results[2].position, null);
  assert.equal(results[0].officialUrl, 'https://example.org/results/test-fell');
});

test('feed output is importable SQL ending with the removal cleanup', () => {
  const { events } = buildEvents(readFeedFile(file), 'stuweb');
  const [sqlText] = buildImportFiles(events, '2026-10-11T00:00:00Z');
  assert.match(sqlText, /INSERT OR REPLACE INTO events/);
  assert.match(sqlText, /DELETE FROM results WHERE athlete_key IN \(SELECT athlete_key FROM removals\);\n$/);
});
