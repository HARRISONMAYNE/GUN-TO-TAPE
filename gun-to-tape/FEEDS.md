# Feeds: getting data from sources that cannot be scraped

Race Result, Stuweb, Sporthive (MYLAPS), Resultsbase's own site, Sportsystems and NE Timing do not allow
collection by a script (robots.txt, a login or a human check). Gun to Tape does not get round those.
If a provider agrees to send data, it goes in through the feed importer.

## Using it

1. Put the provider's CSV or JSON files in a folder, for example `feeds/stuweb/`.
2. Run `node src/run.js feed --provider stuweb --dir feeds/stuweb --since 2026-10-01`.
3. It writes `out/stuweb/import-0001.sql`, which loads into D1 exactly like a scraped source,
   including the removal block list.

## Columns (one row per finisher, names are not case sensitive)

| Column | Needed | Notes |
|---|---|---|
| event_name | yes | |
| event_date | yes | yyyy-mm-dd or dd/mm/yyyy |
| event_url | yes | The organiser's or provider's own results page. Shown as the official link. |
| name, or first_name and last_name | yes | |
| time | yes, except DNF/DQ | h:mm:ss or m:ss |
| distance, venue | no | |
| discipline | no | road, xc or other. Guessed from the event name if blank. |
| position, club, category, gender (M/F), bib | no | |
| gender_position, category_position | no | |
| status | no | blank = finished, or DNF, DQ, DNS |
| result_url, result_id | no | result_url links straight to the athlete's own page |

Rows missing a required field are skipped and counted in the log.

## Asking for the data

Drafts for each provider are in `PERMISSION-EMAILS.md`.
