import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chipTimingAdapter, eventUrl, listingUrl, parseEventPage, parseListing } from '../src/sources/chiptiming.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('listing: event ids and names, placeholder option dropped', () => {
  assert.deepEqual(parseListing(fixture('chiptiming-listing.html')), [
    { id: '1010999', name: 'Fixture Half Marathon 2026' },
    { id: '1010998', name: 'Fixture 10k 2026' },
  ]);
});

test('event page: title, date, venue and participants from the embedded JSON', () => {
  const page = parseEventPage(fixture('chiptiming-event.html'));
  assert.equal(page.name, 'Fixture Half Marathon 2026');
  assert.equal(page.date, '2026-09-27');
  assert.equal(page.venue, 'Ipswich, Suffolk');
  assert.equal(page.eventLink, 'https://chiptiming.co.uk/events/fixture-half-marathon-2026/');
  assert.equal(page.total, 4);
  assert.equal(page.rows.length, 3);
  assert.equal(page.skipped, 1, 'a row with no name or time is skipped, not guessed');

  const [a, b, c] = page.rows;
  assert.equal(a.name, 'Sample Runner A');
  assert.equal(a.position, 1);
  assert.equal(a.gunMs, 4093000);
  assert.equal(a.chipMs, 4090000);
  assert.equal(a.timeText, '1:08:10', 'chip time is shown');
  assert.equal(a.gender, 'M');
  assert.equal(a.club, 'Fixture Harriers');
  assert.equal(a.officialUrl, 'https://chiptiming.co.uk/events/fixture-half-marathon-2026/101/');
  assert.equal(b.club, null);
  assert.equal(b.gender, 'F');
  assert.equal(c.club, 'Pacers RC', 'trailing space trimmed');
  assert.equal(c.categoryPos, 1);
});

test('adapter: discovers per year, keeps only events inside the window', async () => {
  const adapter = chipTimingAdapter();
  const pages = {
    [listingUrl(2026)]: fixture('chiptiming-listing.html'),
    [eventUrl(2026, '1010999')]: fixture('chiptiming-event.html'),
    [eventUrl(2026, '1010998')]: fixture('chiptiming-event.html'),
  };
  const client = { getText: async (u) => pages[u] ?? '<html></html>' };
  const races = await adapter.discover(client, { since: '2026-09-20', until: '2026-10-11' });
  assert.equal(races.length, 2);

  const [item] = await adapter.crawl(client, races[0]);
  assert.equal(item.event.id, 'chiptiming:1010999');
  assert.equal(item.event.date, '2026-09-27');
  assert.equal(item.event.discipline, 'road');
  assert.equal(item.results.length, 3);

  const outside = await adapter.crawl(client, { ...races[0], since: '2026-10-01', until: '2026-10-11' });
  assert.deepEqual(outside, [], 'a 27 September event is outside a 1-11 October window');
});
