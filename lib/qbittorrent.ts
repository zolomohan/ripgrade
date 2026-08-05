import "server-only";

import { db, getSetting, setSetting } from "./db";
import { titleKey } from "./derive";
import { getMovies } from "./library";
import { guessFromTitle } from "./release-title";
import { getWishlist } from "./wishlist";

/**
 * qBittorrent, over its WebUI API.
 *
 * The last step of the upgrade loop used to leave the app: a magnet went to
 * whatever the OS had registered and the story ended there. Connected to
 * qBittorrent, the app can hand the release over itself and then watch it
 * arrive — which is what lets the Upgrades page show a download landing next
 * to the queue that asked for it.
 *
 * Everything sent from here is tagged with its own category, so the app only
 * ever lists what it added — your other torrents are none of its business.
 */

const URL_KEY = "qbUrl";
const USER_KEY = "qbUsername";
const PASS_KEY = "qbPassword";
const STOP_SEED_KEY = "qbStopSeeding";

/** What marks a torrent as this app's, in qBittorrent's own sidebar too. */
const CATEGORY = "ripgrade";

const TIMEOUT_MS = 10_000;

export class QbError extends Error {}

export type QbConfig = { url: string; username?: string; password?: string };

/**
 * Environment wins over the stored value, so a deployment can pin it, but the
 * settings page is the expected route. The username and password are optional
 * on purpose: qBittorrent's "bypass authentication for localhost" is common,
 * and demanding credentials it will not ask for is a hurdle for nothing.
 */
export function getQbConfig(): QbConfig | undefined {
  const url = process.env.QBITTORRENT_URL ?? getSetting(URL_KEY);
  if (!url) return undefined;
  return {
    url: url.replace(/\/+$/, ""),
    username: process.env.QBITTORRENT_USERNAME ?? getSetting(USER_KEY),
    password: process.env.QBITTORRENT_PASSWORD ?? getSetting(PASS_KEY),
  };
}

export function hasQb(): boolean {
  return getQbConfig() !== undefined;
}

/**
 * Whether a finished download is told to stop seeding. On by default — the
 * payload is what the app wanted — but a toggle, because ratio-counting
 * trackers make auto-stopping a liability.
 */
export function getStopSeeding(): boolean {
  return getSetting(STOP_SEED_KEY) !== "off";
}

export function setStopSeeding(enabled: boolean): void {
  setSetting(STOP_SEED_KEY, enabled ? "on" : "off");
}

export function setQbConfig(config: QbConfig): void {
  setSetting(URL_KEY, config.url.trim().replace(/\/+$/, ""));
  if (config.username) setSetting(USER_KEY, config.username.trim());
  else db.prepare("DELETE FROM settings WHERE key = ?").run(USER_KEY);
  if (config.password) setSetting(PASS_KEY, config.password);
  else db.prepare("DELETE FROM settings WHERE key = ?").run(PASS_KEY);
  globalForQb.medlibQbSid = undefined;
}

export function clearQbConfig(): void {
  db.prepare("DELETE FROM settings WHERE key IN (?, ?, ?)").run(
    URL_KEY,
    USER_KEY,
    PASS_KEY,
  );
  globalForQb.medlibQbSid = undefined;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** The session cookie, on globalThis so a dev reload does not re-login. */
const globalForQb = globalThis as unknown as { medlibQbSid?: string };

/** qBittorrent checks Origin/Referer against its own address. */
const originHeaders = (config: QbConfig) => ({
  Origin: config.url,
  Referer: config.url,
});

async function login(config: QbConfig): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${config.url}/api/v2/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...originHeaders(config),
      },
      body: new URLSearchParams({
        username: config.username ?? "",
        password: config.password ?? "",
      }).toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw unreachable(config, err);
  }

  const text = (await response.text()).trim();
  if (!response.ok || text !== "Ok.") {
    throw new QbError(
      "qBittorrent refused the login — check the username and password.",
    );
  }

  const cookies =
    response.headers.getSetCookie?.() ??
    (response.headers.get("set-cookie")
      ? [response.headers.get("set-cookie")!]
      : []);
  const sid = cookies
    .map((cookie) => cookie.match(/SID=([^;]+)/)?.[1])
    .find(Boolean);
  if (!sid) {
    throw new QbError("qBittorrent answered the login without a session.");
  }
  return sid;
}

function unreachable(config: QbConfig, err: unknown): QbError {
  const reason = err instanceof Error ? err.message : String(err);
  return new QbError(
    reason.includes("timed out") || reason.includes("abort")
      ? `qBittorrent did not answer within ${TIMEOUT_MS / 1000}s.`
      : `Could not reach qBittorrent at ${config.url} — ${reason}`,
  );
}

/**
 * One request, logging in when asked to. The first attempt rides whatever
 * session is cached — or none at all, which localhost-bypass installs accept —
 * and a 403 answers the question "was that enough" the only reliable way.
 */
async function request(
  path: string,
  init: { method?: "GET" | "POST"; body?: FormData | string } = {},
  retried = false,
): Promise<Response> {
  const config = getQbConfig();
  if (!config) {
    throw new QbError(
      "qBittorrent is not set up. Add its address on the Settings page.",
    );
  }

  const sid = globalForQb.medlibQbSid;
  let response: Response;
  try {
    response = await fetch(`${config.url}${path}`, {
      method: init.method ?? "GET",
      headers: {
        ...originHeaders(config),
        ...(sid ? { Cookie: `SID=${sid}` } : {}),
        ...(typeof init.body === "string"
          ? { "Content-Type": "application/x-www-form-urlencoded" }
          : {}),
      },
      body: init.body,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw unreachable(config, err);
  }

  if (response.status === 403 && !retried) {
    globalForQb.medlibQbSid = await login(config);
    return request(path, init, true);
  }
  if (response.status === 403) {
    throw new QbError(
      "qBittorrent wants a login. Add the WebUI username and password on the Settings page.",
    );
  }
  if (!response.ok) {
    throw new QbError(`qBittorrent answered ${response.status} on ${path}.`);
  }

  return response;
}

/** Verifies the address (and login, if given) with one round trip. */
export async function checkQb(): Promise<string> {
  const response = await request("/api/v2/app/version");
  return (await response.text()).trim();
}

/** The info hash and display name a magnet link itself carries. */
function parseMagnet(magnet: string): { hash?: string; name?: string } {
  try {
    const params = new URL(magnet).searchParams;
    const xt = params
      .getAll("xt")
      .find((value) => value.startsWith("urn:btih:"));
    return {
      hash: xt?.slice("urn:btih:".length).toLowerCase(),
      name: params.get("dn") ?? undefined,
    };
  } catch {
    return {};
  }
}

/** Which film a release was fetched for, carried from the button that sent it. */
export type FilmContext = { title?: string; posterPath?: string };

/** Hands a magnet over, into this app's own category — and into the log. */
export async function addMagnet(
  magnet: string,
  options: { savePath?: string; film?: FilmContext } = {},
): Promise<void> {
  if (!magnet.startsWith("magnet:")) {
    throw new QbError("Not a magnet link.");
  }

  const body = new FormData();
  body.set("urls", magnet);
  body.set("category", CATEGORY);
  if (options.savePath) {
    body.set("savepath", options.savePath);
    // Auto torrent management routes by category and quietly ignores an
    // explicit path; a chosen destination has to switch it off for this one.
    body.set("autoTMM", "false");
  }

  const response = await request("/api/v2/torrents/add", {
    method: "POST",
    body,
  });
  const text = (await response.text()).trim();
  if (text === "Fails.") {
    throw new QbError("qBittorrent refused the torrent.");
  }

  // Logged only after qBittorrent accepted, keyed by the hash the magnet
  // itself carries — the add API returns nothing to key on.
  const { hash, name } = parseMagnet(magnet);
  if (hash) {
    db.prepare(
      `INSERT INTO downloads (hash, title, added_at, film_title, poster_path)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(hash) DO UPDATE SET
         film_title = COALESCE(excluded.film_title, downloads.film_title),
         poster_path = COALESCE(excluded.poster_path, downloads.poster_path)`,
    ).run(
      hash,
      name ?? "Unknown release",
      Date.now(),
      options.film?.title ?? null,
      options.film?.posterPath ?? null,
    );
  }
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

/**
 * qBittorrent 5 renamed pause/resume to stop/start; the old routes 404 there
 * and the new ones 404 on 4.x. Trying one and falling back to the other is
 * what works on both without asking the version first.
 */
async function torrentAction(
  paths: [string, string],
  body: string,
): Promise<void> {
  try {
    await request(paths[0], { method: "POST", body });
  } catch (err) {
    if (err instanceof QbError && err.message.includes("404")) {
      await request(paths[1], { method: "POST", body });
      return;
    }
    throw err;
  }
}

export async function pauseTorrent(hash: string): Promise<void> {
  await torrentAction(
    ["/api/v2/torrents/stop", "/api/v2/torrents/pause"],
    `hashes=${hash}`,
  );
}

export async function resumeTorrent(hash: string): Promise<void> {
  await torrentAction(
    ["/api/v2/torrents/start", "/api/v2/torrents/resume"],
    `hashes=${hash}`,
  );
}

/**
 * Takes a torrent out of qBittorrent. `deleteFiles` is the caller's choice:
 * a cancelled half-download's files are junk, a finished one's files are the
 * entire point.
 */
export async function removeTorrent(
  hash: string,
  deleteFiles: boolean,
): Promise<void> {
  await request("/api/v2/torrents/delete", {
    method: "POST",
    body: `hashes=${hash}&deleteFiles=${deleteFiles}`,
  });
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

export type Download = {
  hash: string;
  name: string;
  /** 0..1 */
  progress: number;
  state: string;
  sizeBytes: number;
  speedBps: number;
  /** Seconds, absent when qBittorrent reports its "no estimate" sentinel. */
  etaSec?: number;
  done: boolean;
  addedOn: number;
};

/** qBittorrent's "no ETA" sentinel: 100 days, exactly. */
const NO_ETA = 8_640_000;

/** The states that mean the payload is fully on disk, whatever seeding does. */
const DONE_STATES = new Set([
  "uploading",
  "stalledUP",
  "pausedUP",
  "stoppedUP",
  "queuedUP",
  "forcedUP",
  "checkingUP",
]);

type QbTorrent = {
  hash: string;
  name: string;
  progress: number;
  state: string;
  size: number;
  dlspeed: number;
  eta: number;
  added_on: number;
};

/** Everything this app has handed over, newest first. */
export async function getDownloads(): Promise<Download[]> {
  const response = await request(
    `/api/v2/torrents/info?category=${CATEGORY}&sort=added_on&reverse=true`,
  );
  const torrents = (await response.json()) as QbTorrent[];

  return torrents.map((t) => ({
    hash: t.hash.toLowerCase(),
    name: t.name,
    progress: t.progress,
    state: t.state,
    sizeBytes: t.size,
    speedBps: t.dlspeed,
    etaSec: t.eta > 0 && t.eta < NO_ETA ? t.eta : undefined,
    done: t.progress >= 1 || DONE_STATES.has(t.state),
    addedOn: t.added_on * 1000,
  }));
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/**
 * One entry per release ever sent: the log row, wearing whatever qBittorrent
 * currently says about it. `live` absent means qBittorrent no longer lists
 * it — removed by hand, or cleaned up after seeding — and the log is all
 * that remains, which is the point of keeping one.
 */
export type DownloadEntry = {
  hash: string;
  title: string;
  addedAt: number;
  completedAt?: number;
  lastState?: string;
  /** The film the release was fetched for, when the send knew it. */
  filmTitle?: string;
  posterPath?: string;
  live?: Download;
};

/**
 * Which film a release name belongs to, worked out after the fact.
 *
 * Most sends record their film at the button. The ones that cannot — the
 * keyword search page, torrents adopted from qBittorrent, sends that predate
 * the log knowing about films — still carry a release name, and the same
 * parser that scores releases can read a title and year out of it. Matched
 * against the library first and the wishlist second, exact year before
 * title alone.
 */
function resolveFilm(releaseTitle: string): FilmContext | undefined {
  const tags = guessFromTitle(releaseTitle, {}).tags;
  if (!tags.title) return undefined;

  /*
   * The candidate readings of the name, strongest first. A trailing year is
   * kept inside the title by the parser because of films like Blade Runner
   * 2049 — but a name carrying two years ("Obsession.2025.2026.…") parses as
   * title "Obsession 2025", so the stripped form is tried as well. Exact
   * years before title alone: release names and databases disagree by a year
   * around premieres often enough that the loose pass earns its place.
   */
  const stripped = tags.title.match(/^(.*?)\s+(?:19|20)\d{2}$/)?.[1];
  const titles = stripped ? [tags.title, stripped] : [tags.title];

  const passes: { key: string; year: boolean }[] = [];
  for (const year of [true, false]) {
    for (const title of titles) {
      passes.push({ key: titleKey(title, year ? tags.year : undefined), year });
    }
  }

  for (const pass of passes) {
    const movie = getMovies().find(
      (m) =>
        m.tmdb &&
        titleKey(m.tmdb.title, pass.year ? m.tmdb.year : undefined) ===
          pass.key,
    );
    if (movie?.tmdb) {
      return { title: movie.tmdb.title, posterPath: movie.art.poster };
    }

    const wish = getWishlist().find(
      (w) => titleKey(w.title, pass.year ? w.year : undefined) === pass.key,
    );
    if (wish) return { title: wish.title, posterPath: wish.posterPath };
  }

  return undefined;
}

/**
 * The full log, enriched with the client's present tense.
 *
 * Reading also writes, in three small ways: a torrent seen finished stamps
 * its `completed_at`, a torrent qBittorrent lists that the log has never met
 * (added before the log existed, or straight in qBittorrent under this
 * category) is adopted, and a row with no film identity gets one worked out
 * from its release name — so history converges on the truth as it is read.
 */
export async function getDownloadLog(): Promise<DownloadEntry[]> {
  let live: Map<string, Download> | undefined;
  if (hasQb()) {
    try {
      live = new Map((await getDownloads()).map((d) => [d.hash, d]));
    } catch {
      // Unreachable mid-read: the log still renders, just without progress.
    }
  }

  const rows = db
    .prepare(
      "SELECT hash, title, added_at, completed_at, last_state, film_title, poster_path FROM downloads",
    )
    .all() as {
    hash: string;
    title: string;
    added_at: number;
    completed_at: number | null;
    last_state: string | null;
    film_title: string | null;
    poster_path: string | null;
  }[];

  const known = new Set(rows.map((r) => r.hash));
  const adopt = db.prepare(
    "INSERT INTO downloads (hash, title, added_at) VALUES (?, ?, ?) ON CONFLICT(hash) DO NOTHING",
  );
  for (const download of live?.values() ?? []) {
    if (!known.has(download.hash)) {
      adopt.run(download.hash, download.name, download.addedOn);
      rows.push({
        hash: download.hash,
        title: download.name,
        added_at: download.addedOn,
        completed_at: null,
        last_state: null,
        film_title: null,
        poster_path: null,
      });
    }
  }

  const stamp = db.prepare(
    "UPDATE downloads SET completed_at = ?, last_state = ? WHERE hash = ?",
  );

  const fill = db.prepare(
    "UPDATE downloads SET film_title = ?, poster_path = ? WHERE hash = ?",
  );

  const entries = rows.map((row): DownloadEntry => {
    const current = live?.get(row.hash);
    let completedAt = row.completed_at ?? undefined;

    if (!row.film_title) {
      const film = resolveFilm(current?.name ?? row.title);
      if (film) {
        row.film_title = film.title ?? null;
        row.poster_path = film.posterPath ?? null;
        fill.run(row.film_title, row.poster_path, row.hash);
      }
    }

    if (current) {
      if (current.done && !completedAt) {
        completedAt = Date.now();
        stamp.run(completedAt, current.state, row.hash);

        // The payload is on the drive, which is all the app wanted — seeding
        // is stopped in the same breath the finish is noticed, when the
        // setting says so. Once, at this stamp: resume it by hand in
        // qBittorrent and nothing here will stop it again. Fire-and-forget,
        // because a read should not wait on it.
        if (getStopSeeding()) void pauseTorrent(row.hash).catch(() => {});
      } else if (current.state !== row.last_state) {
        stamp.run(completedAt ?? null, current.state, row.hash);
      }
    }

    return {
      hash: row.hash,
      title: current?.name ?? row.title,
      addedAt: row.added_at,
      completedAt,
      lastState: current?.state ?? row.last_state ?? undefined,
      filmTitle: row.film_title ?? undefined,
      posterPath: row.poster_path ?? undefined,
      live: current,
    };
  });

  return entries.sort((a, b) => b.addedAt - a.addedAt);
}

/** Drops a row from the log — the one delete history itself supports. */
export function forgetDownload(hash: string): void {
  db.prepare("DELETE FROM downloads WHERE hash = ?").run(hash);
}
