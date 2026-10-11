import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCategory, parseListing, parseResultsPage, sportsTimingAdapter } from '../src/sources/sportstiming.js';
import { parseDate } from '../src/lib/text.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const URL_ = 'https://www.sportstimingsolutions.co.uk/results/fixture-half-marathon-2026';

test('dates with weekday, ordinal and "of"', () => {
  assert.equal(parseDate('Sunday 12th of July 2026'), '2026-07-12');
  assert.equal(parseDate('Sunday, 11th October, 2026'), '2026-10-11');
});

test('listing: name, date, type and link', () => {
  const races = parseListing(fixture('sts-listing.html'));
  assert.equal(races.length, 3);
  assert.deepEqual(races[0], {
    slug: 'east-yorkshire-cross-country-bishop-wilton-2026',
    name: 'East Yorkshire Cross Country - Bishop Wilton 2026',
    date: '2026-10-11',
    type: 'Running',
    url: 'https://www.sportstimingsolutions.co.uk/results/east-yorkshire-cross-country-bishop-wilton-2026',
  });
  assert.equal(races[1].type, 'XCountry');
});

test('category text splits into gender, category and position', () => {
  assert.deepEqual(parseCategory('Male U23 1 out of 52'), { gender: 'M', category: 'U23', categoryPos: 1 });
  assert.deepEqual(parseCategory('Female V40 12 out of 90'), { gender: 'F', category: 'V40', categoryPos: 12 });
  assert.deepEqual(parseCategory('Non Binary Open 1 out of 3'), { gender: null, category: 'Open', categoryPos: 1 });
  assert.deepEqual(parseCategory(''), { gender: null, category: null, categoryPos: null });
});

test('results page: event details and every row', () => {
  const page = parseResultsPage(fixture('sts-results.html'), URL_);
  assert.equal(page.eventId, '639');
  assert.equal(page.name, 'Fixture Half Marathon 2026');
  assert.equal(page.date, '2026-07-12');
  assert.equal(page.finishers, 1820);
  assert.equal(page.rows.length, 3);
  assert.equal(page.skipped, 0);

  const [a, b, c] = page.rows;
  assert.equal(a.name, 'Sample Racer A', 'the "1st male" badge is not part of the name');
  assert.equal(a.club, 'Fixture Harriers Ac');
  assert.equal(a.clubKey, 'fixture harriers ac');
  assert.equal(a.category, 'U23');
  assert.equal(a.categoryPos, 1);
  assert.equal(a.gender, 'M');
  assert.equal(a.gunMs, 4124000);
  assert.equal(a.chipMs, 4122000);
  assert.equal(a.timeText, '1:08:42', 'chip time is shown');
  assert.equal(a.uid, '639-2282');
  assert.equal(a.officialUrl, 'https://www.sportstimingsolutions.co.uk/rcd.php?id=639&bib=2282');
  assert.equal(b.position, 2);
  assert.equal(c.gender, 'F');
  assert.equal(c.timeText, '1:12:11');
});

test('adapter: discipline from the listing type, other sports marked other', async () => {
  const adapter = sportsTimingAdapter();
  const pages = {
    'https://www.sportstimingsolutions.co.uk/allresults': fixture('sts-listing.html'),
    [URL_]: fixture('sts-results.html'),
  };
  const client = { getText: async (u) => pages[u] ?? '<html></html>' };
  const races = await adapter.discover(client, { since: '2026-10-05', until: '2026-10-11' });
  assert.deepEqual(races.map((r) => r.date), ['2026-10-11', '2026-10-10'], 'the 4 October triathlon is outside the window');

  const [item] = await adapter.crawl(client, { name: 'Fixture Half Marathon 2026', type: 'Running', date: '2026-07-12', url: URL_ });
  assert.equal(item.event.id, 'sportstiming:639');
  assert.equal(item.event.discipline, 'road');
  assert.equal(item.results.length, 3);

  const [xc] = await adapter.crawl(client, { name: 'Anything', type: 'XCountry', date: '2026-07-12', url: URL_ });
  assert.equal(xc.event.discipline, 'xc');
  const [tri] = await adapter.crawl(client, { name: 'Anything', type: 'Triathlon', date: '2026-07-12', url: URL_ });
  assert.equal(tri.event.discipline, 'other');
});
