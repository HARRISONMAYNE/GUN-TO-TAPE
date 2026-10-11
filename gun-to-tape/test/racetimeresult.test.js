import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  eventPageUrl, findRaceRosterCode, listingUrl, localDate, parseEventInfo, parseListing, parseResultRows, raceTimeResultAdapter,
} from '../src/sources/racetimeresult.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('listing and embedded Race Roster code', () => {
  assert.deepEqual(parseListing(fixture('rtr-listing.html')), [
    { pageUrl: 'fixture-10k-2026', name: 'Fixture 10K 2026' },
    { pageUrl: 'fixture-triathlon-2026', name: 'Fixture Triathlon 2026' },
  ]);
  assert.equal(findRaceRosterCode(fixture('rtr-event.html')), 'abcd1234efgh5678');
  assert.equal(findRaceRosterCode('<html>no results here</html>'), null);
});

test('event date is the local calendar day, not the UTC day', () => {
  assert.equal(localDate('2026-10-10T23:30:00.000Z', 'Europe/London'), '2026-10-11');
  assert.equal(localDate('2026-05-17T09:00:00.000Z', 'Europe/London'), '2026-05-17');
});

test('event info keeps only public running sub-events with results', () => {
  const info = parseEventInfo(JSON.parse(fixture('rr-event.json')));
  assert.equal(info.date, '2026-10-11');
  assert.equal(info.venue, 'Woodbridge, England');
  assert.equal(info.resultEventId, 115978);
  assert.deepEqual(info.subEvents.map((s) => s.id), [1], 'swim and the private race are dropped');
});

test('result rows: positions, times, club, gender from division or from the gender total', () => {
  const page = parseResultRows(JSON.parse(fixture('rr-results.json')), {
    eventUrl: 'https://results.raceroster.com/v3/events/abcd1234efgh5678', subEventId: 1, genderCounts: { M: 3, F: 1 },
  });
  assert.equal(page.rows.length, 3);
  assert.equal(page.skipped, 1);
  const [a, b, c] = page.rows;
  assert.equal(a.name, 'Sample Racer A');
  assert.equal(a.timeText, '31:56', 'chip time is shown');
  assert.equal(a.gender, 'M', '"Open" division: the 1 / 3 gender place matches the 3 male finishers');
  assert.equal(b.gender, 'M');
  assert.equal(b.club, null);
  assert.equal(b.categoryPos, 1);
  assert.equal(c.gender, 'F');
  assert.equal(c.clubKey, 'pacers rc');
  assert.equal(a.officialUrl, 'https://results.raceroster.com/v3/events/abcd1234efgh5678/race/1/participant/aaaa1111');
});

test('adapter: listing -> event page -> Race Roster API, filtered by date', async () => {
  const adapter = raceTimeResultAdapter();
  const pages = {
    [listingUrl(2026)]: fixture('rtr-listing.html'),
    [eventPageUrl(2026, 'fixture-10k-2026')]: fixture('rtr-event.html'),
    [eventPageUrl(2026, 'fixture-triathlon-2026')]: '<html>no embed</html>',
    'https://results.raceroster.com/v2/api/events/abcd1234efgh5678': fixture('rr-event.json'),
  };
  const client = {
    getText: async (u) => {
      if (u.includes('/results?start=')) return fixture('rr-results.json');
      if (!(u in pages)) throw new Error(`unexpected ${u}`);
      return pages[u];
    },
  };
  const races = await adapter.discover(client, { since: '2026-10-05', until: '2026-10-11' });
  assert.equal(races.length, 2);
  const [item] = await adapter.crawl(client, races[0]);
  assert.equal(item.event.id, 'racetimeresult:abcd1234efgh5678-1');
  assert.equal(item.event.date, '2026-10-11');
  assert.equal(item.event.discipline, 'road');
  assert.equal(item.results.length, 3);
  assert.deepEqual(await adapter.crawl(client, races[1]), [], 'a page with no embed is skipped');
  assert.deepEqual(await adapter.crawl(client, { ...races[0], since: '2026-10-12', until: '2026-10-20' }), [], 'outside the window');
});
