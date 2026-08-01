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

-- Your decisions about a film, kept apart from anything derived so a rescan or
-- a change to the heuristics never discards them.
CREATE TABLE IF NOT EXISTS triage (
  path          TEXT PRIMARY KEY,
  acknowledged  INTEGER NOT NULL DEFAULT 0,
  note          TEXT,
  updated_at    INTEGER NOT NULL
);

-- Raw TMDb records, cached like probes: expensive to fetch, cheap to re-derive
-- from. Keyed by TMDb id so several files of the same film share one row.
CREATE TABLE IF NOT EXISTS tmdb_movies (
  tmdb_id     INTEGER PRIMARY KEY,
  fetched_at  INTEGER NOT NULL,
  json        TEXT NOT NULL
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

-- Poster/fanart live beside the movie file, so this is keyed by directory
-- rather than by film. A separate table so adding it needed no rescan.
CREATE TABLE IF NOT EXISTS artwork (
  dir         TEXT PRIMARY KEY,
  poster      TEXT,
  fanart      TEXT,
  found_at    INTEGER NOT NULL
);
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

// Applied on every module evaluation, not just on first open. Every statement
// is CREATE TABLE IF NOT EXISTS, so it is idempotent — and it means a new table
// reaches the cached dev connection without needing a server restart.
db.exec(SCHEMA);

if (process.env.NODE_ENV !== "production") globalForDb.medlibDb = db;

export function getSetting(key: string): string | undefined {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}
