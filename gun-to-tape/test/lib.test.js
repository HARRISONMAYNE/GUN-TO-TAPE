import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { athleteKey, formatTime, guessDiscipline, parseDate, parseTimeMs } from '../src/lib/text.js';
import { parseRobots, robotsAllows, PoliteClient } from '../src/lib/http.js';
import { buildImportFiles } from '../src/lib/sql-out.js';
import { parseResultsPage } from '../src/sources/racetec.js';

test('times: parse and format', () => {
  assert.equal(parseTimeMs('17:09'), 1029000);
  assert.equal(parseTimeMs('1:04:18'), 3858000);
  assert.equal(parseTimeMs('00:33:51'), 2031000);
  assert.equal(parseTimeMs('17:09.5'), 1029500);
  assert.equal(parseTimeMs('DNF'), null);
  assert.equal(formatTime(3858000), '1:04:18');
  assert.equal(formatTime(1029000), '17:09');
});

test('dates: UK and long formats', () => {
  assert.equal(parseDate('11/10/2026'), '2026-10-11');
  assert.equal(parseDate('4 October 2026'), '2026-10-04');
  assert.equal(parseDate('7 Oct 2026'), '2026-10-07');
  assert.equal(parseDate('nonsense'), null);
  assert.equal(parseDate('31/13/2026'), null);
});

test('athlete key ignores case, accents and spacing', () => {
  assert.equal(athleteKey('  Étienne   O\'Brien-Smith '), "etienne o'brien-smith");
});

test('discipline guess', () => {
  assert.equal(guessDiscipline('Kent Cross Country League Round 1'), 'xc');
  assert.equal(guessDiscipline('Southern XC League'), 'xc');
  assert.equal(guessDiscipline('Hever Castle Triathlon'), 'other');
  assert.equal(guessDiscipline('Cardiff Half Marathon'), 'road');
});

test('robots: stuweb-style rules and longest match', () => {
  const robots = parseRobots('User-agent: *\nDisallow: /api\nDisallow: /basket\nCrawl-delay: 30\n');
  assert.equal(robots.crawlDelay, 30);
  assert.equal(robotsAllows(robots, '/api/results'), false);
  assert.equal(robotsAllows(robots, '/race/3K7'), true);
  const r2 = parseRobots('User-agent: *\nDisallow: /results\nAllow: /results/public\n');
  assert.equal(robotsAllows(r2, '/results/private'), false);
  assert.equal(robotsAllows(r2, '/results/public/1'), true);
});

test('client refuses without a contact and obeys robots.txt', async () => {
  assert.throws(() => new PoliteClient({}), /SCRAPER_CONTACT/);
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow: /private\n');
    return new Response('<html>ok</html>');
  };
  const client = new PoliteClient({ contact: 'a@b.test', delayMs: 0, fetchImpl: fakeFetch });
  assert.equal(await client.getText('https://example.test/public'), '<html>ok</html>');
  await assert.rejects(client.getText('https://example.test/private/x'), /robots\.txt disallows/);
  assert.match(client.userAgent, /GunToTapeBot\/0\.1 \(\+a@b\.test\)/);
});

test('sql: loads into SQLite, is repeatable and honours the removal list', () => {
  const html = readFileSync(new URL('./fixtures/runthrough-results.html', import.meta.url), 'utf8');
  const { rows } = parseResultsPage(html, 'https://results.runthrough.co.uk/results.aspx?CId=16487&RId=5911&EId=1&dt=0');
  const item = {
    event: {
      id: 'racetec:16487-5911-1', source: 'racetec', raceName: "Test Race, with 'quotes'", distance: '5k',
      date: '2026-10-11', venue: null, discipline: 'road', officialUrl: 'https://results.runthrough.co.uk/results.aspx?CId=16487&RId=5911&EId=1', finishers: 113,
    },
    results: rows,
  };

  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  const files = buildImportFiles([item], '2026-10-11T20:00:00Z');
  assert.equal(files.length, 1);

  db.exec(files[0]);
  db.exec(files[0]); // running the same import twice must not duplicate anything
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM results').get().n, 3);
  assert.equal(db.prepare('SELECT race_name FROM events').get().race_name, "Test Race, with 'quotes'");

  const hit = db.prepare("SELECT position, time_text, official_url FROM results WHERE athlete_key = ?").get("sample etienne o'brien-smith");
  assert.equal(hit.position, 2);
  assert.equal(hit.time_text, '1:04:02');
  assert.match(hit.official_url, /myresults\.aspx\?uid=16487-5911-1-54700$/);

  // Club search: one club, found by key, with its event
  const club = db.prepare("SELECT athlete_name, event_id FROM results WHERE club_key = ?").all('fixture harriers');
  assert.equal(club.length, 1);
  assert.equal(club[0].event_id, 'racetec:16487-5911-1');

  // A removal request wins over every later import
  db.prepare("INSERT INTO removals (athlete_key, requested_at) VALUES (?, ?)").run('test runner one', '2026-10-12');
  db.exec(files[0]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM results WHERE athlete_key = 'test runner one'").get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM results').get().n, 2);
});

test('NEHL league races are cross country', async () => {
  const { guessDiscipline } = await import('../src/lib/text.js');
  assert.equal(guessDiscipline('The Start Fitness NEHL Eltringham'), 'xc');
  assert.equal(guessDiscipline('Wild Deer Harewood Duathlon'), 'other');
});
