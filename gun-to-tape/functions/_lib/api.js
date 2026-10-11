// Gun to Tape read API. Pure function of (request, env) so it can be tested without Cloudflare.
// env.DB is a D1 binding: prepare(sql).bind(...).all() / .first() / .run().

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
};

export function athleteKey(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9' -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}
const cacheable = { 'cache-control': 'public, max-age=300' };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function disciplineOf(v) {
  return v === 'road' || v === 'xc' ? v : null;
}
function clampInt(v, def, min, max) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}
/** Escape LIKE wildcards so a search for "100%" is literal. */
function likeEscape(s) {
  return s.replace(/[\\%_]/g, (c) => '\\' + c);
}
/** Every word the person typed must appear in the key, in any order: "mayne harrison" finds "harrison mayne". */
function wordClauses(column, key, binds) {
  const words = key.split(' ').filter(Boolean).slice(0, 5);
  for (const w of words) binds.push(`%${likeEscape(w)}%`);
  return words.map(() => `${column} LIKE ? ESCAPE '\\'`);
}

const RESULT_COLS = `r.id, r.position, r.status, r.athlete_name AS name, r.club, r.category, r.gender,
  r.gender_pos AS genderPos, r.category_pos AS categoryPos, r.time_text AS time, r.official_url AS officialUrl,
  e.id AS eventId, e.race_name AS raceName, e.distance, e.date, e.venue, e.discipline, e.official_url AS eventUrl`;

async function all(db, sql, binds) {
  const { results } = await db.prepare(sql).bind(...binds).all();
  return results ?? [];
}

async function athletes(url, db) {
  const q = athleteKey(url.searchParams.get('q'));
  if (q.length < 2) return json({ error: 'Type at least two characters of a name.' }, 400);
  const binds = [];
  const where = wordClauses('r.athlete_key', q, binds);
  const disc = disciplineOf(url.searchParams.get('discipline'));
  if (disc) { where.push('e.discipline = ?'); binds.push(disc); }
  const limit = clampInt(url.searchParams.get('limit'), 100, 1, 200);
  const rows = await all(
    db,
    `SELECT ${RESULT_COLS} FROM results r JOIN events e ON e.id = r.event_id
     WHERE ${where.join(' AND ')} ORDER BY e.date DESC, r.position LIMIT ?`,
    [...binds, limit],
  );
  return json({ q, count: rows.length, results: rows }, 200, cacheable);
}

async function events(url, db) {
  const binds = [];
  const where = [];
  const date = url.searchParams.get('date');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (date && ISO_DATE.test(date)) { where.push('e.date = ?'); binds.push(date); }
  if (from && ISO_DATE.test(from)) { where.push('e.date >= ?'); binds.push(from); }
  if (to && ISO_DATE.test(to)) { where.push('e.date <= ?'); binds.push(to); }
  const disc = disciplineOf(url.searchParams.get('discipline'));
  if (disc) { where.push('e.discipline = ?'); binds.push(disc); }
  const q = athleteKey(url.searchParams.get('q'));
  if (q) {
    // Event names are not stored in key form, so match the lower-cased name.
    for (const w of q.split(' ').slice(0, 5)) { where.push(`lower(e.race_name || ' ' || coalesce(e.venue, '')) LIKE ? ESCAPE '\\'`); binds.push(`%${likeEscape(w)}%`); }
  }
  const limit = clampInt(url.searchParams.get('limit'), 100, 1, 300);
  const rows = await all(
    db,
    `SELECT e.id, e.race_name AS raceName, e.distance, e.date, e.venue, e.discipline, e.finishers, e.official_url AS officialUrl
     FROM events e ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY e.date DESC, e.race_name, e.distance LIMIT ?`,
    [...binds, limit],
  );
  return json({ count: rows.length, events: rows }, 200, cacheable);
}

async function eventDetail(id, url, db) {
  const [event] = await all(
    db,
    `SELECT e.id, e.race_name AS raceName, e.distance, e.date, e.venue, e.discipline, e.finishers, e.official_url AS officialUrl
     FROM events e WHERE e.id = ?`,
    [id],
  );
  if (!event) return json({ error: 'Event not found.' }, 404);
  const binds = [id];
  const where = ['r.event_id = ?'];
  const q = athleteKey(url.searchParams.get('q'));
  if (q) where.push(...wordClauses('r.athlete_key', q, binds));
  const gender = url.searchParams.get('gender');
  if (gender === 'M' || gender === 'F') { where.push('r.gender = ?'); binds.push(gender); }
  const club = athleteKey(url.searchParams.get('club'));
  if (club) where.push(...wordClauses('r.club_key', club, binds));
  const limit = clampInt(url.searchParams.get('limit'), 100, 1, 500);
  const offset = clampInt(url.searchParams.get('offset'), 0, 0, 1_000_000);
  const rows = await all(
    db,
    `SELECT r.id, r.position, r.status, r.athlete_name AS name, r.club, r.category, r.gender,
            r.gender_pos AS genderPos, r.category_pos AS categoryPos, r.time_text AS time, r.official_url AS officialUrl
     FROM results r WHERE ${where.join(' AND ')}
     ORDER BY CASE WHEN r.position IS NULL THEN 1 ELSE 0 END, r.position LIMIT ? OFFSET ?`,
    [...binds, limit, offset],
  );
  return json({ event, count: rows.length, results: rows }, 200, cacheable);
}

async function clubs(url, db) {
  const q = athleteKey(url.searchParams.get('q'));
  if (q.length < 2) return json({ error: 'Type at least two characters of a club name.' }, 400);
  const binds = [];
  const where = wordClauses('r.club_key', q, binds);
  const date = url.searchParams.get('date');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (date && ISO_DATE.test(date)) { where.push('e.date = ?'); binds.push(date); }
  if (from && ISO_DATE.test(from)) { where.push('e.date >= ?'); binds.push(from); }
  if (to && ISO_DATE.test(to)) { where.push('e.date <= ?'); binds.push(to); }
  const disc = disciplineOf(url.searchParams.get('discipline'));
  if (disc) { where.push('e.discipline = ?'); binds.push(disc); }
  const limit = clampInt(url.searchParams.get('limit'), 300, 1, 500);
  const rows = await all(
    db,
    `SELECT ${RESULT_COLS} FROM results r JOIN events e ON e.id = r.event_id
     WHERE ${where.join(' AND ')} ORDER BY e.date DESC, e.race_name, e.distance, r.position LIMIT ?`,
    [...binds, limit],
  );
  const names = [...new Set(rows.map((r) => r.club).filter(Boolean))].sort();
  return json({ q, count: rows.length, clubNames: names, results: rows }, 200, cacheable);
}

/** Dates that have results, newest first, with counts: drives the weekend dropdown. */
async function dates(url, db) {
  const disc = disciplineOf(url.searchParams.get('discipline'));
  const rows = await all(
    db,
    `SELECT date, COUNT(*) AS events, SUM(CASE WHEN discipline = 'road' THEN 1 ELSE 0 END) AS road,
            SUM(CASE WHEN discipline = 'xc' THEN 1 ELSE 0 END) AS xc, COALESCE(SUM(finishers), 0) AS finishers
     FROM events ${disc ? 'WHERE discipline = ?' : ''} GROUP BY date ORDER BY date DESC LIMIT 400`,
    disc ? [disc] : [],
  );
  return json({ dates: rows }, 200, cacheable);
}

async function stats(db) {
  const [row] = await all(
    db,
    `SELECT (SELECT COUNT(*) FROM events) AS events, (SELECT COUNT(*) FROM results) AS results,
            (SELECT MAX(date) FROM events) AS latest, (SELECT MAX(scraped_at) FROM events) AS scrapedAt`,
    [],
  );
  return json(row ?? { events: 0, results: 0, latest: null, scrapedAt: null }, 200, cacheable);
}

async function removalRequest(request, db) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send the form as JSON.' }, 400); }
  const name = String(body.name ?? '').trim().slice(0, 120);
  const contact = String(body.contact ?? '').trim().slice(0, 200);
  const details = String(body.details ?? '').trim().slice(0, 1000);
  if (String(body.website ?? '') !== '') return json({ ok: true }); // honeypot: pretend success to bots
  if (athleteKey(name).length < 3) return json({ error: 'Enter your full name as it appears in the results.' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return json({ error: 'Enter an email address we can reply to.' }, 400);
  await db
    .prepare('INSERT INTO removal_requests (athlete_name, athlete_key, contact, details, requested_at) VALUES (?, ?, ?, ?, ?)')
    .bind(name, athleteKey(name), contact, details || null, new Date().toISOString())
    .run();
  return json({ ok: true, message: 'Request received. We reply within 30 days and usually much sooner.' }, 201);
}

export async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { ...JSON_HEADERS, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' } });
  }
  if (!env?.DB) return json({ error: 'Database not connected.' }, 503);
  try {
    if (request.method === 'POST' && path === 'removal') return await removalRequest(request, env.DB);
    if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
    if (path === 'athletes') return await athletes(url, env.DB);
    if (path === 'events') return await events(url, env.DB);
    if (path.startsWith('events/')) return await eventDetail(decodeURIComponent(path.slice('events/'.length)), url, env.DB);
    if (path === 'clubs') return await clubs(url, env.DB);
    if (path === 'dates') return await dates(url, env.DB);
    if (path === 'stats') return await stats(env.DB);
    return json({ error: 'Not found.' }, 404);
  } catch (err) {
    return json({ error: 'Something went wrong on our side.' }, 500);
  }
}
