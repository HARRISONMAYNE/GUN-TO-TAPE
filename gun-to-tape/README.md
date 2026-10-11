# Gun to Tape: scrapers and database

Collects UK road and cross country results into one Cloudflare D1 database. The Gun to Tape site reads from it.

## What's here

| Path | What it does |
|---|---|
| `src/sources/racetec.js` | Racetec platform: racetecresults.com, results.runthrough.co.uk, results.resultsbase.net and other timers on it |
| `src/sources/sportstiming.js` | Sports Timing Solutions (sportstimingsolutions.co.uk) |
| `src/sources/chiptiming.js` | Chip Timing UK, running only (chiptiming.co.uk) |
| `src/sources/racetimeresult.js` | Race Time Result, via the Race Roster results API |
| `src/sources/feed.js` | Importer for CSV/JSON exports from providers who send data (see `FEEDS.md`) |
| `functions/` | The read API (Cloudflare Pages Functions over D1): athletes, events, clubs, dates, stats, removal |
| `site/page.html` | The website. `node scripts/build-site.js` wraps it into `public/index.html` |
| `src/sources/index.js` | Registry of sources. `node src/run.js <source>` runs one |
| `src/lib/http.js` | Polite client: identifies itself, obeys robots.txt and crawl-delay, one request at a time, hard request cap |
| `src/lib/sql-out.js` | Writes `import-NNNN.sql` files. Safe to re-run, and every file ends by deleting removed athletes |
| `db/schema.sql` | D1 tables: `events`, `results`, `removals` |
| `.github/workflows/scrape.yml` | Nightly run, plus a manual run with a start date for backfills |

## Setup (once)

1. `npx wrangler d1 create gun-to-tape`, then paste the `database_id` into `wrangler.toml`.
2. `npx wrangler d1 execute gun-to-tape --remote --file=db/schema.sql`
3. In the GitHub repo, add these secrets: `CLOUDFLARE_API_TOKEN` (D1 edit permission), `CLOUDFLARE_ACCOUNT_ID`, and `SCRAPER_CONTACT` (an email address or web page site owners can reach you on. It goes in the User-Agent).
4. Run the workflow manually with `since` set to the date you want to backfill from.

## Run locally

```
npm ci
npm test
SCRAPER_CONTACT=you@example.com node src/run.js racetec --customer results.runthrough.co.uk:16487 --since 2026-10-01 --out out
SCRAPER_CONTACT=you@example.com node src/run.js sportstiming --since 2026-10-01
SCRAPER_CONTACT=you@example.com node src/run.js chiptiming --since 2026-10-01
```

## Removing an athlete

Athletes can ask to be removed. Add them to the `removals` table using their `athlete_key` (lower-case, no accents):

```
npx wrangler d1 execute gun-to-tape --remote --command "INSERT INTO removals (athlete_key, requested_at, note) VALUES ('jane example', '2026-10-12', 'email request')"
```

Their results are deleted at the end of every import, so they stay gone. Matching is by name, so two people with the same name are both removed. Check the request before adding it.

## Status

Working, checked against real saved pages:
- **Racetec / RunThrough / Resultsbase's Racetec site**: list pages, distance tabs, paging and result rows. A skin where the date link comes first (Resultsbase) is covered by a test.
- **Sports Timing Solutions**: 635 listed events and a 1,820-finisher half marathon read with no skipped rows.
- **Chip Timing UK**: a 3,103-finisher half marathon read with no skipped rows. One request per event.

Not checked yet:
- The racetecresults.com skin shows different columns (Time and Net Time). The parser reads columns by header name, so it should work, but it hasn't seen that skin's raw HTML. Look at the first run's `summary.json` for skipped rows.
- Nothing has run live from GitHub Actions yet, and nothing has been loaded into D1.

Not built, and why:
- **Race Result** (my.raceresult.com): robots.txt disallows the event list and the results data, and the data host disallows everything. Needs permission or an official feed from Race Result.
- **Stuweb**: finisher data needs a login, and robots.txt disallows the API. Needs an export or feed from Stuweb. Permission to scrape is not enough on its own, because the data isn't on public pages.
- **Resultsbase's own events** (www.resultsbase.net/event/...): behind a Cloudflare "verify you're human" check. Not bypassed. The events hosted on their Racetec site are covered.
- **Race Time Result**: results are embedded from Race Roster (results.raceroster.com, robots.txt allows crawling). Needs a Race Roster adapter, not built yet.
- **Sporthive**: pages are rendered by JavaScript from a separate API host. Not built yet.
- Sportsystems and other extras: not looked at yet.


## Launch checklist

1. `npx wrangler d1 create gun-to-tape`, paste the id into `wrangler.toml`, then `npx wrangler d1 execute gun-to-tape --remote --file=db/schema.sql`.
2. Repo secrets: `CLOUDFLARE_API_TOKEN` (Pages and D1 edit), `CLOUDFLARE_ACCOUNT_ID`, `SCRAPER_CONTACT`.
3. Run the **Scrape** workflow manually with a `since` date to backfill, then **Deploy site**. In the Pages project settings, bind the D1 database to `DB`.
4. Removal requests land in `removal_requests`. To act on one: `INSERT INTO removals (athlete_key, requested_at) SELECT athlete_key, requested_at FROM removal_requests WHERE id = N;` then `DELETE FROM results WHERE athlete_key IN (SELECT athlete_key FROM removals);` and mark it `done`.

Events Up North and Timing Up North results run on Racetec (CId 16576), so they are scraped by the `racetec` source. That covers the NEHL cross country league.

## Not built, and why

| Source | Reason |
|---|---|
| Race Result | robots.txt disallows the list and data endpoints |
| Stuweb | Finisher data needs a login; needs an export or feed from them |
| Finished Results, OpenTrack, Webscorer | Not UK road/XC: a California timer, track meets only, and mostly non-UK small races |
| Resultsbase's own site | Behind a human check; their Racetec-hosted events are covered by `racetec` |
| Sporthive / MYLAPS | API host's robots.txt disallows all crawling |
| Sportsystems | robots.txt unreachable from our scraper, so not collected |
| NE Timing | Wix site publishing no structured results |

Permission or an official feed from the first four would unlock them. See `FEEDS.md` for the CSV/JSON importer that takes whatever they send, and `PERMISSION-EMAILS.md` for drafts to ask.
