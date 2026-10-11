import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handle } from '../functions/_lib/api.js';

// A tiny D1 look-alike over node:sqlite so the real SQL runs in tests.
function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  return {
    raw: db,
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        bind(...b) {
          return {
            all: async () => ({ results: stmt.all(...b) }),
            first: async () => stmt.get(...b) ?? null,
            run: async () => { stmt.run(...b); return { success: true }; },
          };
        },
      };
    },
  };
}

function seed(DB) {
  const ev = DB.raw.prepare('INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?,?)');
  ev.run('e1', 'racetec', 'Heaton Park 10k', '10k', '2026-10-11', 'Manchester', 'road', 'https://x/e1', 3, 'now');
  ev.run('e2', 'racetec', 'Midlands XC League', '9k', '2026-10-10', 'Sutton Park', 'xc', 'https://x/e2', 1, 'now');
  const r = DB.raw.prepare('INSERT INTO results VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  r.run('r1', 'e1', 1, 'finished', 'Harrison Mayne', 'harrison mayne', '1', 'Uttoxeter AC', 'uttoxeter ac', 'M35', 'M', 1, 1, null, null, '33:51', 'https://x/r1');
  r.run('r2', 'e1', 2, 'finished', 'Zoë Smith', 'zoe smith', '2', 'Stone Master Runners', 'stone master runners', 'F', 'F', 1, 1, null, null, '35:02', 'https://x/r2');
  r.run('r3', 'e1', null, 'dnf', 'Pat Lee', 'pat lee', '3', null, null, null, null, null, null, null, null, null, 'https://x/r3');
  r.run('r4', 'e2', 1, 'finished', 'Harrison Mayne', 'harrison mayne', '9', 'Uttoxeter AC', 'uttoxeter ac', 'M', 'M', 1, 1, null, null, '31:10', 'https://x/r4');
}

const get = (DB, path) => handle(new Request('https://t.test' + path), { DB });

test('athlete search is order-free, accent-free and filterable', async () => {
  const DB = d1(); seed(DB);
  let body = await (await get(DB, '/api/athletes?q=mayne%20harrison')).json();
  assert.equal(body.count, 2);
  assert.equal(body.results[0].date, '2026-10-11');
  body = await (await get(DB, '/api/athletes?q=Zoë')).json();
  assert.equal(body.results[0].name, 'Zoë Smith');
  body = await (await get(DB, '/api/athletes?q=mayne&discipline=xc')).json();
  assert.equal(body.count, 1);
  assert.equal(body.results[0].eventId, 'e2');
  assert.equal((await get(DB, '/api/athletes?q=a')).status, 400);
});

test('events list, filter by date and fetch results with DNF last', async () => {
  const DB = d1(); seed(DB);
  let body = await (await get(DB, '/api/events?date=2026-10-11')).json();
  assert.equal(body.count, 1);
  body = await (await get(DB, '/api/events?q=heaton')).json();
  assert.equal(body.events[0].id, 'e1');
  body = await (await get(DB, '/api/events/e1')).json();
  assert.deepEqual(body.results.map((r) => r.position), [1, 2, null]);
  assert.equal((await get(DB, '/api/events/nope')).status, 404);
});

test('club by date and the dates dropdown', async () => {
  const DB = d1(); seed(DB);
  let body = await (await get(DB, '/api/clubs?q=uttoxeter&date=2026-10-10')).json();
  assert.equal(body.count, 1);
  assert.deepEqual(body.clubNames, ['Uttoxeter AC']);
  body = await (await get(DB, '/api/dates')).json();
  assert.deepEqual(body.dates.map((d) => d.date), ['2026-10-11', '2026-10-10']);
  assert.equal(body.dates[1].xc, 1);
});

test('LIKE wildcards in a search are literal', async () => {
  const DB = d1(); seed(DB);
  // Punctuation is stripped from the key, so a pure-wildcard search is refused rather than matching everything.
  assert.equal((await get(DB, '/api/athletes?q=%25%25')).status, 400);
  const body = await (await get(DB, '/api/events?q=%25')).json();
  assert.equal(body.count, 2);
});

test('removal request validates, stores and ignores bots', async () => {
  const DB = d1();
  const post = (b) => handle(new Request('https://t.test/api/removal', { method: 'POST', body: JSON.stringify(b) }), { DB });
  assert.equal((await post({ name: 'Harrison Mayne', contact: 'nope' })).status, 400);
  assert.equal((await post({ name: 'H', contact: 'a@b.co' })).status, 400);
  assert.equal((await post({ name: 'Harrison Mayne', contact: 'a@b.co', details: 'please' })).status, 201);
  assert.equal((await post({ name: 'Bot Name', contact: 'a@b.co', website: 'spam.com' })).status, 200);
  assert.equal(DB.raw.prepare('SELECT COUNT(*) c FROM removal_requests').get().c, 1);
});

test('stats and missing database', async () => {
  const DB = d1(); seed(DB);
  const s = await (await get(DB, '/api/stats')).json();
  assert.equal(s.events, 2); assert.equal(s.results, 4);
  assert.equal((await handle(new Request('https://t.test/api/stats'), {})).status, 503);
});
