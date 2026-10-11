import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEventTabs, parseListing, parsePaging, parseResultsPage, nextListingUrl } from '../src/sources/racetec.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const RESULTS_URL = 'https://results.runthrough.co.uk/results.aspx?CId=16487&RId=5911&EId=1&dt=0';

test('listing: reads race links and dates, ignores thumbnail links', () => {
  const races = parseListing(fixture('runthrough-listing.html'), 'https://results.runthrough.co.uk/StartPage.aspx?CId=16487&From=21&To=40');
  assert.equal(races.length, 2);
  assert.deepEqual(races[0], {
    customerId: '16487', raceId: '5911',
    name: 'Run Heaton Park 5k, 10k, Half Marathon & Junior Race',
    date: '2026-10-11',
    url: 'https://results.runthrough.co.uk/results.aspx?CId=16487&RId=5911',
  });
  assert.equal(races[1].date, '2026-10-07');
});

test('listing: finds the next page and stops on the last', () => {
  const html = fixture('runthrough-listing.html');
  assert.equal(
    nextListingUrl(html, 'https://results.runthrough.co.uk/StartPage.aspx?CId=16487&From=21&To=40'),
    'https://results.runthrough.co.uk/StartPage.aspx?CId=16487&From=41&To=60',
  );
  assert.equal(nextListingUrl(html, 'https://results.runthrough.co.uk/StartPage.aspx?CId=16487&From=1681&To=1700'), null);
});

test('event tabs: one entry per distance', () => {
  assert.deepEqual(parseEventTabs(fixture('runthrough-results.html')), [
    { eventId: '1', label: '5k' },
    { eventId: '2', label: '10k' },
    { eventId: '5', label: 'Half Marathon' },
  ]);
});

test('paging: total, page and page count', () => {
  assert.deepEqual(parsePaging(fixture('runthrough-results.html')), { total: 113, page: 1, pages: 3 });
});

test('results: maps columns by header and reads position, time, category and gender', () => {
  const { rows, skipped } = parseResultsPage(fixture('runthrough-results.html'), RESULTS_URL);
  assert.equal(skipped, 0);
  assert.equal(rows.length, 3);

  const first = rows[0];
  assert.equal(first.uid, '16487-5911-1-54684');
  assert.equal(first.position, 1);
  assert.equal(first.status, 'finished');
  assert.equal(first.name, 'Test Runner One');
  assert.equal(first.bib, '24');
  assert.equal(first.category, 'V45');
  assert.equal(first.categoryPos, 1);
  assert.equal(first.gender, 'M');
  assert.equal(first.genderPos, 1);
  assert.equal(first.gunMs, (17 * 60 + 9) * 1000);
  assert.equal(first.chipMs, (17 * 60 + 8) * 1000);
  assert.equal(first.timeText, '17:08', 'chip time is shown when there is one');
  assert.equal(first.officialUrl, 'https://results.runthrough.co.uk/myresults.aspx?uid=16487-5911-1-54684');
});

test('results: accents, apostrophes, hours, club and female gender', () => {
  const { rows } = parseResultsPage(fixture('runthrough-results.html'), RESULTS_URL);
  const second = rows[1];
  assert.equal(second.name, "Sample Étienne O'Brien-Smith");
  assert.equal(second.athleteKey, "sample etienne o'brien-smith");
  assert.equal(second.club, 'Fixture Harriers');
  assert.equal(second.gender, 'F');
  assert.equal(second.timeText, '1:04:02');
  assert.equal(second.gunMs, (64 * 60 + 18) * 1000);
});

test('results: disqualified rows are kept with a status and no position or time', () => {
  const { rows } = parseResultsPage(fixture('runthrough-results.html'), RESULTS_URL);
  const dq = rows[2];
  assert.equal(dq.status, 'dq');
  assert.equal(dq.position, null);
  assert.equal(dq.timeText, null);
});

test('results: a page with no table returns nothing instead of throwing', () => {
  assert.deepEqual(parseResultsPage('<html><body>No results yet</body></html>', RESULTS_URL), { rows: [], skipped: 0 });
});

test('listing: skin where the first link wraps the date and thumbnail (Resultsbase)', () => {
  const html = readFileSync(new URL('./fixtures/resultsbase-listing.html', import.meta.url), 'utf8');
  const races = parseListing(html, 'https://results.resultsbase.net/StartPage.aspx?CId=8');
  assert.equal(races.length, 1);
  assert.equal(races[0].name, 'Fixture Park 10K 2026', 'the name comes from the text link, not the date link');
  assert.equal(races[0].date, '2026-10-18');
});
