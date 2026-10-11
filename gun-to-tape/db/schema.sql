-- Gun to Tape: Cloudflare D1 schema.
-- Apply once with: npx wrangler d1 execute gun-to-tape --remote --file=db/schema.sql

CREATE TABLE IF NOT EXISTS events (
  id            TEXT PRIMARY KEY,   -- e.g. racetec:16487-5911-1
  source        TEXT NOT NULL,      -- racetec, sportstiming, ...
  race_name     TEXT NOT NULL,      -- e.g. Run Heaton Park 5k, 10k, Half Marathon & Junior Race
  distance      TEXT,               -- e.g. 5k, Half Marathon (the tab the results sit under)
  date          TEXT NOT NULL,      -- ISO yyyy-mm-dd
  venue         TEXT,
  discipline    TEXT NOT NULL,      -- road, xc, other
  official_url  TEXT NOT NULL,      -- the organiser's own results page
  finishers     INTEGER,
  scraped_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_date ON events (date DESC);
CREATE INDEX IF NOT EXISTS events_discipline ON events (discipline, date DESC);

CREATE TABLE IF NOT EXISTS results (
  id            TEXT PRIMARY KEY,   -- e.g. racetec:16487-5911-1-54684
  event_id      TEXT NOT NULL REFERENCES events (id),
  position      INTEGER,            -- null for DNF, DQ and similar
  status        TEXT NOT NULL,      -- finished, dq, dnf, other
  athlete_name  TEXT NOT NULL,
  athlete_key   TEXT NOT NULL,      -- lower-case, accent-free, single-spaced name
  bib           TEXT,
  club          TEXT,
  club_key      TEXT,               -- same normalisation as athlete_key, for club search
  category      TEXT,
  gender        TEXT,               -- M, F or null
  gender_pos    INTEGER,
  category_pos  INTEGER,
  gun_ms        INTEGER,
  chip_ms       INTEGER,
  time_text     TEXT,               -- the time to show: chip time if there is one, else gun time
  official_url  TEXT NOT NULL       -- the athlete's own page on the organiser's site
);
CREATE INDEX IF NOT EXISTS results_athlete ON results (athlete_key);
CREATE INDEX IF NOT EXISTS results_event ON results (event_id, position);
CREATE INDEX IF NOT EXISTS results_club ON results (club_key, event_id);

-- Athletes who asked to be removed. Every import ends by deleting their results,
-- so a removed athlete does not reappear on the next scrape.
CREATE TABLE IF NOT EXISTS removals (
  athlete_key   TEXT PRIMARY KEY,
  requested_at  TEXT NOT NULL,
  note          TEXT
);

-- Requests submitted through the site's removal form. They are checked by a person
-- (the name must match a real result) and then copied into `removals`.
CREATE TABLE IF NOT EXISTS removal_requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  athlete_name  TEXT NOT NULL,
  athlete_key   TEXT NOT NULL,
  contact       TEXT NOT NULL,
  details       TEXT,
  requested_at  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS removal_requests_status ON removal_requests (status, requested_at);
