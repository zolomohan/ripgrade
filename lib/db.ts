import "server-only";

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * The database is a cache, not a source of truth — everything in it is derived
 * from files on disk. If the schema needs to change, delete `data/medlib.db`
 * and rescan rather than writing a migration.
 *
 * The one table worth protecting is `probes`: re-deriving from it costs
 * milliseconds, whereas rebuilding it means re-reading the whole drive.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS probes (
  path        TEXT PRIMARY KEY,
  size        INTEGER NOT NULL,
  mtime_ms    INTEGER NOT NULL,
  probed_at   INTEGER NOT NULL,
  mediainfo   TEXT,
  ffprobe     TEXT,
  dovi        TEXT,
  error       TEXT
);

CREATE TABLE IF NOT EXISTS movies (
  path        TEXT PRIMARY KEY,
  first_seen  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  present     INTEGER NOT NULL DEFAULT 1,
  derived     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL
);

-- Disc specs scraped from Blu-ray.com, keyed by TMDb id because this describes
-- the film's best commercial release, not any particular file. Cached forever:
-- refetching is slow and someone else's bandwidth.
CREATE TABLE IF NOT EXISTS disc (
  tmdb_id     INTEGER PRIMARY KEY,
  fetched_at  INTEGER NOT NULL,
  lookup      TEXT NOT NULL,
  error       TEXT
);

-- The same lookup for television, keyed by season rather than by title: a
-- series is sold a season at a time, so the season is the only unit a disc set
-- can be compared against. Keyed on the show key, not a TMDb id, so a season
-- keeps its release through a re-match.
CREATE TABLE IF NOT EXISTS tv_disc (
  show_key    TEXT NOT NULL,
  season      INTEGER NOT NULL,
  fetched_at  INTEGER NOT NULL,
  lookup      TEXT NOT NULL,
  error       TEXT,
  PRIMARY KEY (show_key, season)
);

-- Your decisions about a film, kept apart from anything derived so a rescan or
-- a change to the heuristics never discards them.
CREATE TABLE IF NOT EXISTS triage (
  path          TEXT PRIMARY KEY,
  acknowledged  INTEGER NOT NULL DEFAULT 0,
  note          TEXT,
  updated_at    INTEGER NOT NULL,
  -- Your answer to "is this an extended cut?", asked of a film that runs long.
  -- Nullable on purpose, and three-valued: NULL is a question nobody has
  -- answered, which is not the same as one answered "no". Only the first is
  -- worth asking again.
  extended_cut  INTEGER
);

-- Per-issue decisions, kept from an earlier version of the app that let you
-- clear issues one at a time. Nothing reads or writes it now; the rows are left
-- alone rather than dropped, so the decisions survive if it ever comes back.
CREATE TABLE IF NOT EXISTS issue_acks (
  path      TEXT NOT NULL,
  code      TEXT NOT NULL,
  acked_at  INTEGER NOT NULL,
  PRIMARY KEY (path, code)
);

-- Raw TMDb records, cached like probes: expensive to fetch, cheap to re-derive
-- from. Keyed by TMDb id so several files of the same film share one row.
CREATE TABLE IF NOT EXISTS tmdb_movies (
  tmdb_id     INTEGER PRIMARY KEY,
  fetched_at  INTEGER NOT NULL,
  json        TEXT NOT NULL
);

-- Collections as TMDb defines them, so the app can say what a set is missing
-- rather than only what it holds. Cached like the film records beside them.
CREATE TABLE IF NOT EXISTS tmdb_collections (
  tmdb_id     INTEGER PRIMARY KEY,
  fetched_at  INTEGER NOT NULL,
  json        TEXT NOT NULL
);

-- Sets of your own, as against the ones TMDb publishes.
--
-- A collection here is a list you wrote: nothing on disk derives it and no
-- rescan could rebuild it, which puts it with the wishlist and triage in the
-- small set of tables that hold decisions rather than findings.
--
-- The backdrop is not a column. An uploaded image goes to the collection's own
-- folder under data/collections/, and is indexed in the artwork table beside
-- every other image this app has written — so the art route serves it, the
-- thumbnail cache covers it, and replacing one is the same act as replacing a
-- film's.
CREATE TABLE IF NOT EXISTS custom_collections (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

-- What is in one.
--
-- Keyed by TMDb id where the film has one, which is what lets a film added
-- before you owned it become the copy on the drive the moment one is scanned
-- and matched — the same joining-up that fills in a TMDb set's missing half. A
-- library film TMDb never matched has no such number and is keyed by its path.
--
-- Denormalised like the wishlist and for the same reason: an entry is a
-- decision, and it should still draw with TMDb unreachable and long after any
-- cache of the record has been dropped.
CREATE TABLE IF NOT EXISTS custom_collection_films (
  collection_id INTEGER NOT NULL,
  -- "t" and the TMDb id, or "p" and the path; see filmKey in lib/collections.ts.
  film_key      TEXT NOT NULL,
  tmdb_id       INTEGER,
  path          TEXT,
  added_at      INTEGER NOT NULL,
  title         TEXT NOT NULL,
  year          INTEGER,
  poster_path   TEXT,
  overview      TEXT,
  PRIMARY KEY (collection_id, film_key)
);

-- Which film each file was matched to, and how sure we are. A row with a null
-- tmdb_id records "searched, found nothing" so it is not retried every run.
CREATE TABLE IF NOT EXISTS tmdb_matches (
  path        TEXT PRIMARY KEY,
  tmdb_id     INTEGER,
  method      TEXT NOT NULL,
  confidence  TEXT NOT NULL,
  manual      INTEGER NOT NULL DEFAULT 0,
  matched_at  INTEGER NOT NULL
);

-- Films and shows you want but do not have. Denormalised on purpose: an entry
-- is a decision, and it should still render with TMDb unreachable and long
-- after any cache of the record has been dropped.
--
-- Keyed by id *and* kind: TMDb numbers films and series in separate sequences,
-- so id 1399 is both a film and a series, and one of them would otherwise
-- overwrite the other.
CREATE TABLE IF NOT EXISTS wishlist (
  tmdb_id     INTEGER NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'movie',
  added_at    INTEGER NOT NULL,
  title       TEXT NOT NULL,
  year        INTEGER,
  poster_path TEXT,
  overview    TEXT,
  -- The set the film belongs to, so the list can be read a franchise at a
  -- time. The checked flag separates "asked TMDb, it has none" from "never
  -- asked", which is what stops a standalone film being looked up for ever.
  -- Films only: a series belongs to no collection TMDb will tell you about.
  collection_id      INTEGER,
  collection_name    TEXT,
  collection_checked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tmdb_id, kind)
);

-- Shows and their seasons, cached exactly like the film records: expensive to
-- fetch, cheap to re-derive from. Keyed by TMDb id, so every episode of a show
-- shares one row.
CREATE TABLE IF NOT EXISTS tmdb_shows (
  tmdb_id     INTEGER PRIMARY KEY,
  fetched_at  INTEGER NOT NULL,
  json        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tmdb_seasons (
  tmdb_id     INTEGER NOT NULL,
  season      INTEGER NOT NULL,
  fetched_at  INTEGER NOT NULL,
  json        TEXT NOT NULL,
  PRIMARY KEY (tmdb_id, season)
);

-- Which show each set of episodes belongs to. Keyed by the show's grouping key
-- rather than by path: a show is one thing spread over many files, and the
-- match belongs to the show.
CREATE TABLE IF NOT EXISTS tv_matches (
  show_key    TEXT PRIMARY KEY,
  tmdb_id     INTEGER,
  confidence  TEXT NOT NULL,
  manual      INTEGER NOT NULL DEFAULT 0,
  matched_at  INTEGER NOT NULL
);

-- The folders that make up the library. More than one because a collection
-- outgrows a drive, and the app has no reason to insist they live together.
CREATE TABLE IF NOT EXISTS library_roots (
  path      TEXT PRIMARY KEY,
  added_at  INTEGER NOT NULL
);

-- What the last upgrade sweep found for each film: the one best release, or
-- nothing, with when it looked. A cache like everything else here — the
-- queue page reads it instead of searching, and a fresh sweep overwrites it.
CREATE TABLE IF NOT EXISTS upgrade_checks (
  path          TEXT PRIMARY KEY,
  checked_at    INTEGER NOT NULL,
  -- The copy's score when checked, so a later rescore shows as staleness.
  current_score INTEGER,
  -- The trimmed best release as JSON, or NULL for "looked, found nothing".
  best          TEXT
);

-- The same, for the films you want but do not have. Written by the scan's
-- wishlist pass rather than by a sweep, and keyed by TMDb id because a wanted
-- film has no path to be keyed by — that is the whole point of it.
--
-- Films only, so the bare id is still a key here: a wanted series is a dozen
-- separate searches with no single answer to store, and it is looked for by
-- hand from the list instead.
CREATE TABLE IF NOT EXISTS wishlist_checks (
  tmdb_id    INTEGER PRIMARY KEY,
  checked_at INTEGER NOT NULL,
  -- The trimmed best release as JSON, or NULL for "looked, found nothing".
  best       TEXT
);

-- Every release handed to qBittorrent, kept after qBittorrent forgets it.
-- The client's own list is the present tense; this is the history the
-- Downloads page shows once a torrent is removed or done.
CREATE TABLE IF NOT EXISTS downloads (
  hash         TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  added_at     INTEGER NOT NULL,
  completed_at INTEGER,
  -- The last state qBittorrent reported, for rows it no longer lists.
  last_state   TEXT,
  -- Which film this was fetched for, recorded at send time — a magnet knows
  -- its release name but not its film, and the Downloads page wants the
  -- poster and the title the release was chosen for.
  film_title   TEXT,
  poster_path  TEXT,
  -- Which list the send came from: 'upgrade' for a better copy of a film on
  -- the drive, 'wishlist' for a film you do not have. The queue draws each
  -- tab's transfers under that tab's own list, and nothing about a magnet —
  -- or about the film, which a fetched want soon joins the library as — can
  -- recover afterwards which of the two you pressed Download on. NULL for
  -- sends from elsewhere and for rows that predate the column; those are read
  -- as whichever the library can still answer for. See lib/qbittorrent.ts.
  source       TEXT,
  -- The last size qBittorrent reported, in bytes.
  --
  -- The client is the only thing that ever knows this, and it stops knowing the
  -- moment the torrent is removed from it — which is precisely when the log
  -- becomes the only account of the fetch. So it is copied down on every read
  -- that finds the torrent still listed, and what is left behind is the last
  -- figure anybody had. NULL for rows cleared out of the client before this
  -- column existed: nothing on disk can recover what they weighed.
  size_bytes   INTEGER,
  -- The magnet as sent, so a fetch that failed can be sent again.
  --
  -- A hash alone would make a magnet that only DHT can resolve; the link the
  -- indexer gave carries its trackers, which is what actually finds peers. NULL
  -- for rows adopted from qBittorrent's own window — nobody handed this app a
  -- link for those — and for anything logged before the column, which is why
  -- Retry is offered per row rather than assumed.
  magnet       TEXT
);

-- Records cleared from the log by hand, so they stay cleared.
--
-- getDownloadLog adopts every torrent in this app's category that it has no
-- row for, which is what lets a torrent added from qBittorrent's own window
-- appear here at all. It also means deleting a row is not enough while the
-- client still holds the torrent: the next poll, three seconds later, writes
-- it straight back in the same place, as though the button had missed. So
-- clearing leaves a headstone, and adoption reads it.
--
-- Only adoption consults this. Sending the same release again writes its own
-- row and lifts the stone with it — asking for something a second time is not
-- a thing to go on suppressing. See lib/qbittorrent.ts.
CREATE TABLE IF NOT EXISTS forgotten_downloads (
  hash       TEXT PRIMARY KEY,
  -- Kept for nothing but the answering of "when did I clear this", which is a
  -- question a support log gets asked and a schema costs nothing to answer.
  forgot_at  INTEGER NOT NULL
);

-- Poster/fanart live beside the movie file, so this is keyed by directory
-- rather than by film. A separate table so adding it needed no rescan.
CREATE TABLE IF NOT EXISTS artwork (
  dir         TEXT PRIMARY KEY,
  poster      TEXT,
  fanart      TEXT,
  logo        TEXT,
  found_at    INTEGER NOT NULL,
  -- Where each image was downloaded from, as a TMDb path. The file on the
  -- drive is the real artwork; this is what the app can still show when the
  -- drive is not plugged in.
  poster_src  TEXT,
  fanart_src  TEXT,
  logo_src    TEXT
);

-- What was lying beside the films the last time their folders could be read.
--
-- Every other figure on the dashboard survives an unplugged drive, because
-- every other figure was derived once and written down. Backups and leftovers
-- never were: they are found by reading each folder, so "reclaimable" used to
-- read zero the moment a volume went away — not "unknown", which is what it
-- actually was, but zero, which is a claim.
--
-- Keyed by the file's own path and stamped with the folder it was found in, so
-- one readable folder replaces exactly its own rows and the folders that are
-- away keep theirs.
CREATE TABLE IF NOT EXISTS cleanup_files (
  path        TEXT PRIMARY KEY,
  dir         TEXT NOT NULL,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,
  bytes       INTEGER NOT NULL,
  modified_at INTEGER NOT NULL,
  seen_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cleanup_files_dir ON cleanup_files (dir);

-- Long jobs, after they have ended.
--
-- The rail deliberately keeps no history: it answers "what is happening now",
-- and a list of what finished told you what you already watched finish. That
-- holds for a corner of every screen and stops holding for a page you go to on
-- purpose — a conversion that failed at four in the morning is exactly the
-- thing nobody watched finish.
--
-- Nothing here is derived from the library, so it survives a rescan, and
-- nothing else reads it: losing the file costs the log and nothing else.
CREATE TABLE IF NOT EXISTS job_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL,
  -- What it was, already in the words the list shows: a film's file name, or
  -- the job's own name where it works on the library as a whole.
  title       TEXT NOT NULL,
  path        TEXT,
  outcome     TEXT NOT NULL,
  started_at  INTEGER,
  finished_at INTEGER NOT NULL,
  -- The closing sentence: what it did, or why it stopped.
  detail      TEXT,
  -- What was spawned, as it could be pasted into a shell. Null for the jobs
  -- that are this app's own work rather than a tool being driven.
  command     TEXT,
  -- The tail of what the tool printed, as JSON. Kept for the runs where it is
  -- the only account of what went wrong.
  output      TEXT
);
CREATE INDEX IF NOT EXISTS job_runs_finished ON job_runs (finished_at DESC);
`;

const DB_PATH = path.join(process.cwd(), "data", "medlib.db");

function open(): Database.Database {
  mkdirSync(path.dirname(DB_PATH), { recursive: true });

  const db = new Database(DB_PATH);
  // WAL lets a long scan write while page requests read.
  db.pragma("journal_mode = WAL");
  // Scans write in batched transactions, so durability per-statement is wasted work.
  db.pragma("synchronous = NORMAL");
  return db;
}

// Dev-mode HMR re-evaluates modules; without this each save leaks a connection.
const globalForDb = globalThis as unknown as { medlibDb?: Database.Database };

export const db = globalForDb.medlibDb ?? open();

/**
 * `job_runs` had a previous life, and CREATE TABLE IF NOT EXISTS would leave it
 * in it.
 *
 * An earlier process log kept the same table name with a different set of
 * columns — `label` and `status` where this keeps `title` and `outcome`, and no
 * room at all for the path or the tool's output. That feature was removed, and
 * nothing has read the table since; every row left in it records a scan, which
 * is the one job the Jobs page deliberately does not list.
 *
 * So it is dropped rather than migrated: there is no row in it that the new
 * shape would have anything to say about. Checked by column rather than by
 * existence, so this happens once and is a no-op afterwards.
 *
 * Before the schema below, or the CREATE would find the old table still there
 * and leave it alone.
 */
const jobRunColumns = (
  db.prepare("PRAGMA table_info(job_runs)").all() as { name: string }[]
).map((column) => column.name);

if (jobRunColumns.length > 0 && !jobRunColumns.includes("title")) {
  db.exec("DROP TABLE job_runs");
}

/**
 * Two changes to a log that already exists, both guarded on the same thing:
 * `title` means the table is there *and* is this shape. Not on the table's mere
 * existence — the branch above may have just dropped it — and not on the
 * columns being empty, which is also what a database with no log at all looks
 * like. Either way the schema below creates it correct and these do not run.
 *
 * The sweep's rows go: nothing writes them any more and the Jobs page no longer
 * reads them, but the log is capped at its newest rows, so leaving them would
 * let a hundred boots' worth of "12 upgrades · 418 checked" go on evicting the
 * conversions the page exists to show.
 *
 * The command a run was is added in place rather than waiting for a fresh
 * table, the same way the artwork columns below are: the rows already there are
 * worth more than the column is, and they simply read null.
 */
if (jobRunColumns.includes("title")) {
  db.exec("DELETE FROM job_runs WHERE kind = 'sweep'");

  if (!jobRunColumns.includes("command")) {
    db.exec("ALTER TABLE job_runs ADD COLUMN command TEXT");
  }
}

// Applied on every module evaluation, not just on first open. Every statement
// is CREATE TABLE IF NOT EXISTS, so it is idempotent — and it means a new table
// reaches the cached dev connection without needing a server restart.
db.exec(SCHEMA);

/**
 * The one exception to "delete the database and rescan".
 *
 * `artwork` gained a `logo` column, and CREATE TABLE IF NOT EXISTS cannot add
 * one to a table that already exists. The contents are a directory listing and
 * would cost nothing to rebuild — but the same file also holds the probe cache,
 * which would cost a full re-read of the drive, so the column is added in place
 * instead. Adding it is idempotent: it happens once and is a no-op after.
 */
const artworkColumns = (
  db.prepare("PRAGMA table_info(artwork)").all() as { name: string }[]
).map((c) => c.name);

if (!artworkColumns.includes("logo")) {
  db.exec("ALTER TABLE artwork ADD COLUMN logo TEXT");
}

if (!artworkColumns.includes("poster_src")) {
  db.exec("ALTER TABLE artwork ADD COLUMN poster_src TEXT");
  db.exec("ALTER TABLE artwork ADD COLUMN fanart_src TEXT");
  db.exec("ALTER TABLE artwork ADD COLUMN logo_src TEXT");
}

// Same story for the download log's film identity, added after the table.
const downloadColumns = (
  db.prepare("PRAGMA table_info(downloads)").all() as { name: string }[]
).map((c) => c.name);

if (downloadColumns.length > 0 && !downloadColumns.includes("film_title")) {
  db.exec("ALTER TABLE downloads ADD COLUMN film_title TEXT");
  db.exec("ALTER TABLE downloads ADD COLUMN poster_path TEXT");
}

// And for which list the send came from, added later still. Everything already
// logged stays NULL — the fact was never recorded, and guessing it into the
// table would make a guess indistinguishable from a send that said so.
if (downloadColumns.length > 0 && !downloadColumns.includes("source")) {
  db.exec("ALTER TABLE downloads ADD COLUMN source TEXT");
}

// The size and the magnet, added last of all. Both start NULL on every row
// already logged and fill themselves in from here: the size on the next read
// that finds the torrent still in the client, the magnet on the next send. A
// row whose torrent has already left qBittorrent will never get a size, which
// is why the caption treats it as a fact that may simply be absent.
if (downloadColumns.length > 0 && !downloadColumns.includes("size_bytes")) {
  db.exec("ALTER TABLE downloads ADD COLUMN size_bytes INTEGER");
}

if (downloadColumns.length > 0 && !downloadColumns.includes("magnet")) {
  db.exec("ALTER TABLE downloads ADD COLUMN magnet TEXT");
}

/**
 * The same, for the extended-cut answer. `triage` is the one table that holds
 * decisions rather than derivations — nothing on disk could rebuild it — so the
 * column is added in place rather than waiting for a rescan that would never
 * bring it back.
 */
const triageColumns = (
  db.prepare("PRAGMA table_info(triage)").all() as { name: string }[]
).map((c) => c.name);

if (!triageColumns.includes("extended_cut")) {
  db.exec("ALTER TABLE triage ADD COLUMN extended_cut INTEGER");
}

/**
 * The same exception, for the same reason. The wishlist is not derived from
 * anything — it is a list you wrote — so it cannot be rebuilt by rescanning,
 * which makes adding the columns in place the only option rather than the
 * convenient one.
 */
const wishlistColumns = (
  db.prepare("PRAGMA table_info(wishlist)").all() as { name: string }[]
).map((c) => c.name);

if (!wishlistColumns.includes("collection_id")) {
  db.exec("ALTER TABLE wishlist ADD COLUMN collection_id INTEGER");
  db.exec("ALTER TABLE wishlist ADD COLUMN collection_name TEXT");
  db.exec(
    "ALTER TABLE wishlist ADD COLUMN collection_checked INTEGER NOT NULL DEFAULT 0",
  );
}

/**
 * The list grew a second kind of thing on it, which the key had to grow with:
 * `tmdb_id` alone was the primary key, and a series shares its numbering with
 * some unrelated film. A column cannot be added to a primary key in place, so
 * the table is rebuilt — everything already on the list is a film, which is
 * what the copy across says.
 */
if (!wishlistColumns.includes("kind")) {
  // One transaction: a list half copied and then abandoned by a crash would be
  // a list you wrote, half gone, with nothing to rebuild it from.
  db.transaction(() => {
    db.exec(`
      DROP TABLE IF EXISTS wishlist_rekeyed;

      CREATE TABLE wishlist_rekeyed (
        tmdb_id     INTEGER NOT NULL,
        kind        TEXT NOT NULL DEFAULT 'movie',
        added_at    INTEGER NOT NULL,
        title       TEXT NOT NULL,
        year        INTEGER,
        poster_path TEXT,
        overview    TEXT,
        collection_id      INTEGER,
        collection_name    TEXT,
        collection_checked INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (tmdb_id, kind)
      );

      INSERT INTO wishlist_rekeyed
        (tmdb_id, kind, added_at, title, year, poster_path, overview,
         collection_id, collection_name, collection_checked)
      SELECT tmdb_id, 'movie', added_at, title, year, poster_path, overview,
             collection_id, collection_name, collection_checked
        FROM wishlist;

      DROP TABLE wishlist;
      ALTER TABLE wishlist_rekeyed RENAME TO wishlist;
    `);
  })();
}

/**
 * The single library folder became a list. Moved rather than mirrored: leaving
 * the old key behind would mean two places claiming to say where the library
 * is, and the one that lost would be the one still being read somewhere.
 */
const oldRoot = db
  .prepare("SELECT value FROM settings WHERE key = 'libraryRoot'")
  .get() as { value: string } | undefined;

if (oldRoot) {
  db.prepare(
    "INSERT INTO library_roots (path, added_at) VALUES (?, ?) ON CONFLICT(path) DO NOTHING",
  ).run(oldRoot.value, Date.now());
  db.prepare("DELETE FROM settings WHERE key = 'libraryRoot'").run();
}

if (process.env.NODE_ENV !== "production") globalForDb.medlibDb = db;

export function getSetting(key: string): string | undefined {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}
