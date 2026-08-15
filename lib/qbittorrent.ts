import "server-only";

import { db, getSetting, setSetting } from "./db";
import { titleKey, type Status } from "./derive";
import { getMovies, type LibraryItem } from "./library";
import { guessFromTitle, type ReleaseTags } from "./release-title";
import { getWishlist, type WishlistEntry } from "./wishlist";

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
export type FilmContext = {
  title?: string;
  posterPath?: string;
  /**
   * The file in the library, when the match was one. Never stored — a film can
   * arrive or leave between two reads of the log — so it is worked out again
   * each time and only means "the library holds this right now".
   */
  path?: string;
  /**
   * The artwork sitting beside that file, and when it was last read.
   *
   * Never stored either, and for a stronger reason than `path`: this is the
   * poster you chose. `posterPath` is a TMDb path — the picture the send
   * happened to know about, frozen at the moment a button was pressed — and a
   * film whose poster you have since replaced would go on wearing the old one
   * in the log for good. The file on the drive is the app's answer everywhere
   * else, so it is the answer here, worked out fresh on every read.
   */
  poster?: string;
  artAt?: number;
  /**
   * How long the film runs, where the library holds it.
   *
   * Not for showing — for scoring. A release's video score leans on its bitrate,
   * and a bitrate is a size divided by a runtime: without one the scorer can
   * only read what the name states outright. The library is the one place that
   * knows, so it is carried out of the match for the guess to use.
   */
  runtimeMinutes?: number;
};

/**
 * Which list a release was fetched off, carried from the button that sent it.
 *
 * Two pages send releases — the queue, which is better copies of films you own,
 * and the wishlist, which is films you do not — and a transfer belongs under
 * the one it left. Nothing downstream can work that out for itself: the magnet
 * says nothing about it, and the film is no help either, because a want that
 * finishes and gets scanned is a film the library holds by the time you next
 * look at the row.
 */
export type DownloadSource = "upgrade" | "wishlist";

/** Hands a magnet over, into this app's own category — and into the log. */
export async function addMagnet(
  magnet: string,
  options: {
    savePath?: string;
    film?: FilmContext;
    source?: DownloadSource;
  } = {},
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
      `INSERT INTO downloads (hash, title, added_at, film_title, poster_path, source)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(hash) DO UPDATE SET
         film_title = COALESCE(excluded.film_title, downloads.film_title),
         poster_path = COALESCE(excluded.poster_path, downloads.poster_path),
         source = COALESCE(excluded.source, downloads.source)`,
    ).run(
      hash,
      name ?? "Unknown release",
      Date.now(),
      options.film?.title ?? null,
      options.film?.posterPath ?? null,
      options.source ?? null,
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

/**
 * Whether a state is one of the halted ones, under either generation's names.
 *
 * The same rename as `torrentAction` above: 4.x says `pausedUP`/`pausedDL`,
 * 5.x says `stoppedUP`/`stoppedDL`. Matched on the prefix so this does not
 * become a list of four that a third naming would walk straight past.
 */
export const isHalted = (state: string) =>
  state.startsWith("paused") || state.startsWith("stopped");

/** One torrent's state, or undefined once the client no longer has it. */
export async function getTorrentState(
  hash: string,
): Promise<string | undefined> {
  const response = await request(`/api/v2/torrents/info?hashes=${hash}`);
  const [torrent] = (await response.json()) as QbTorrent[];
  return torrent?.state;
}

/**
 * Stop or start a torrent, and do not return until the client says so.
 *
 * The API answers 200 the moment it has taken the request, not when it has
 * acted on it — a stop is queued into the session and the torrent keeps
 * reporting `uploading` for a beat afterwards. Callers that re-read on the
 * back of a resolved promise were therefore reading the old state and drawing
 * it: press Stop seeding on a finished row and it went on saying "seeding",
 * because that read raced the client and lost.
 *
 * So the wait belongs here, where the rename is already understood, rather
 * than in every caller that needs to know it worked. Bounded, because this
 * runs inside a click: if the client has not come round within it the promise
 * resolves anyway, and the row is left to the page's own polling — a control
 * that hangs on a slow client is worse than one that is briefly behind.
 */
async function settle(hash: string, halted: boolean): Promise<void> {
  for (let attempt = 0; attempt < SETTLE_TRIES; attempt++) {
    await new Promise((done) => setTimeout(done, SETTLE_MS));
    const state = await getTorrentState(hash).catch(() => undefined);
    // Gone from the client entirely is as settled as this gets.
    if (state === undefined || isHalted(state) === halted) return;
  }
}

const SETTLE_MS = 150;
const SETTLE_TRIES = 12;

export async function pauseTorrent(hash: string): Promise<void> {
  await torrentAction(
    ["/api/v2/torrents/stop", "/api/v2/torrents/pause"],
    `hashes=${hash}`,
  );
  await settle(hash, true);
}

export async function resumeTorrent(hash: string): Promise<void> {
  await torrentAction(
    ["/api/v2/torrents/start", "/api/v2/torrents/resume"],
    `hashes=${hash}`,
  );
  await settle(hash, false);
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
  /**
   * The TMDb path behind the poster — what a row falls back to when the film
   * is not in the library, or is on a drive that is not plugged in.
   */
  posterPath?: string;
  /**
   * The poster on the drive, where the library still holds this film: the
   * picture you chose, the same file every shelf in the app draws.
   *
   * The log was TMDb's poster and only TMDb's, because the send recorded a
   * path and the row printed it back. That is the right answer for a want,
   * which has no folder to have artwork in, and the wrong one for everything
   * else — replace a film's poster and the history went on showing the picture
   * you replaced. `artAt` comes with it for the reason it always does: the file
   * keeps its name when it is swapped, so this is what tells a browser holding
   * the old one that it is looking at a different picture.
   */
  poster?: string;
  artAt?: number;
  /**
   * Where that film sits in the library, if it is in the library at all. The
   * name the rest of the app knows this poster by is built from it, which is
   * what lets the same film's poster travel between a shelf and this log.
   */
  filmPath?: string;
  /**
   * What this release is predicted to score, read off its own name.
   *
   * The same rubric and the same reading the queue and the search window put on
   * every release before you fetch it — `guessFromTitle` — so a row in this log
   * wears the number it wore on the button you pressed. That is the honest one
   * to print here: a download has no measured score of its own until the file
   * lands and a scan reads it, and the log is a record of what was fetched
   * rather than of what the library currently holds.
   *
   * It is deliberately *not* the library's score for the film. That number
   * belongs to whatever copy is on the drive right now, which for an upgrade
   * fetched an hour ago is still the copy being replaced — so a history row
   * would have reported the old file's score as though it were the new one's.
   *
   * A prediction, and it says so by being one: the name states what it states,
   * and the bitrate behind the video half is inferred from the transfer's size
   * over the film's runtime where both are known. See `FilmContext.runtimeMinutes`.
   */
  score?: number;
  status?: Status;
  /**
   * Which of the two pages that send releases this transfer belongs under.
   *
   * Always answered, never absent: every row has to be drawn somewhere, and a
   * third state would mean a third list nobody would think to look in. Sends
   * that said so are taken at their word; the rest — a fetch from a film's own
   * page, a torrent adopted from qBittorrent, anything logged before the app
   * recorded this — are read off the library and the fetch's own fate, which
   * `getDownloadLog` explains.
   */
  source: DownloadSource;
  /**
   * What the release name claims the file is, read off that name.
   *
   * Present only where the name actually said so, which is `trim`'s rule in
   * lib/upgrade-sweep.ts and the same one the release rows draw their chips by:
   * a name states a resolution or it does not, and "SDR" or "UNKNOWN" are the
   * parser's defaults rather than facts about the file. Absent is how a tile is
   * told to print nothing, so a thin name simply says less.
   *
   * Nothing here is measured. The file is arriving — most of it is not on the
   * drive yet — so this is the release's own claim, exactly as the queue's
   * pending rows show it, and the scanner is what will one day disagree.
   */
  resolution?: string;
  hdr?: string;
  releaseType?: string;
  live?: Download;
};

/**
 * The column back as the type, and anything else as nothing.
 *
 * SQLite will hold whatever string is put in it, and a row written by an older
 * build — or by hand — is not the app's word for where a send came from. A
 * value that is not one of the two is treated as unrecorded, which the read
 * already knows how to answer.
 */
const asSource = (value: string | null): DownloadSource | undefined =>
  value === "upgrade" || value === "wishlist" ? value : undefined;

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
function resolveFilm(
  /**
   * The name already parsed. Handed in rather than parsed here, because the
   * caller wants the rest of the same reading — what the release claims to
   * be — and one name should be read once.
   */
  tags: ReleaseTags,
  /**
   * Read once by the caller and handed in. This used to read the whole library
   * and the whole wishlist itself, inside a loop, inside a loop over every row
   * in the log — which is a full library read per candidate reading per row.
   */
  library: { movies: LibraryItem[]; wishes: WishlistEntry[] },
): FilmContext | undefined {
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
    const movie = library.movies.find(
      (m) =>
        m.tmdb &&
        titleKey(m.tmdb.title, pass.year ? m.tmdb.year : undefined) ===
          pass.key,
    );
    if (movie?.tmdb) {
      return {
        title: movie.tmdb.title,
        posterPath: movie.art.poster,
        path: movie.path,
        poster: movie.poster,
        artAt: movie.artAt,
        runtimeMinutes: movie.durationSec
          ? Math.round(movie.durationSec / 60)
          : undefined,
      };
    }

    const wish = library.wishes.find(
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
      "SELECT hash, title, added_at, completed_at, last_state, film_title, poster_path, source FROM downloads",
    )
    .all() as {
    hash: string;
    title: string;
    added_at: number;
    completed_at: number | null;
    last_state: string | null;
    film_title: string | null;
    poster_path: string | null;
    source: string | null;
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
        // Nobody pressed anything in this app to make it exist, so there is
        // no tab it came from; read off the library below, like the rest.
        source: null,
      });
    }
  }

  const stamp = db.prepare(
    "UPDATE downloads SET completed_at = ?, last_state = ? WHERE hash = ?",
  );

  const fill = db.prepare(
    "UPDATE downloads SET film_title = ?, poster_path = ? WHERE hash = ?",
  );

  // Read once for the whole pass, and handed to every match below.
  const library = { movies: getMovies(), wishes: getWishlist() };

  const entries = rows.map((row): DownloadEntry => {
    const current = live?.get(row.hash);
    let completedAt = row.completed_at ?? undefined;

    /*
     * The name read once, for the two questions asked of it: which film this
     * is, and what the release claims to be.
     *
     * The client's name for the torrent wins over the logged one where there
     * is one — it is the name qBittorrent resolved from the magnet, and the
     * magnet's display name can be the shorter of the two.
     */
    const name = current?.name ?? row.title;
    const parsed = guessFromTitle(name);

    // Run for every row, not only the ones with no film yet: the title and
    // poster are stored once and stay, but where the film sits in the library
    // is only true until the next scan, so it is asked again each read.
    const film = resolveFilm(parsed.tags, library);

    /*
     * And scored again once the film is known.
     *
     * The first pass reads the name, which is all `resolveFilm` needs. This one
     * adds the two things that turn a stated resolution into a judged one: the
     * transfer's real size from the client, and the runtime from the library.
     * Bitrate is one over the other, and without it the scorer can only credit
     * what the name says outright.
     */
    const guess =
      current?.sizeBytes !== undefined || film?.runtimeMinutes !== undefined
        ? guessFromTitle(name, {
            sizeBytes: current?.sizeBytes,
            runtimeMinutes: film?.runtimeMinutes,
          })
        : parsed;
    const { facts } = guess;

    if (!row.film_title && film) {
      row.film_title = film.title ?? null;
      row.poster_path = film.posterPath ?? null;
      fill.run(row.film_title, row.poster_path, row.hash);
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
      // What the library says now, and what the send recorded only where the
      // film can no longer be found. The stored path is a snapshot taken at
      // the button; the match is re-made on every read, and where it succeeds
      // it knows about artwork that has changed since.
      posterPath: film?.posterPath ?? row.poster_path ?? undefined,
      poster: film?.poster,
      artAt: film?.artAt,
      filmPath: film?.path,
      // The library's reading of what landed, where the film is on the drive.
      // What the name promises, on the rubric every release in the app is read
      // by — see `DownloadEntry.score`.
      score: guess.scores.overall,
      status: guess.status,
      // What the send said, or what the library can still say. `filmPath` is
      // the library's answer and only the library's — `resolveFilm` matches
      // the wishlist too, and a want it matched has no file, so a row that
      // fell through to here without one is a film you do not have.
      /*
       * What the send said, or what the log can still work out.
       *
       * The library is the evidence, but it has to be read at the right
       * moment. A fetch that finished is *why* the film is in the library —
       * scanned in after it landed — so holding it says nothing about what the
       * fetch was for, and reading that as an upgrade filed every completed
       * want under the wrong tab. A fetch that never finished is the honest
       * case: nothing has arrived, so a copy on the drive can only be one you
       * already had, and going after a better one is an upgrade.
       *
       * That leaves the genuine completed upgrade — a copy replaced by a
       * finished fetch — reading as a want. It is not recoverable: the file on
       * the drive is the fetched one either way, and the copy it replaced is
       * gone. Only rows that predate `source` are guessed at all, and this way
       * round the guess is wrong about the rarer of the two.
       */
      source:
        asSource(row.source) ??
        (film?.path && !completedAt ? "upgrade" : "wishlist"),
      // Only what the name stated — `trim`'s rule, kept in step with it.
      resolution: facts.resolution !== "unknown" ? facts.resolution : undefined,
      hdr: facts.hdr !== "SDR" ? facts.hdr : undefined,
      releaseType:
        facts.releaseType !== "UNKNOWN" ? facts.releaseType : undefined,
      live: current,
    };
  });

  return entries.sort((a, b) => b.addedAt - a.addedAt);
}

/** Drops a row from the log — the one delete history itself supports. */
export function forgetDownload(hash: string): void {
  db.prepare("DELETE FROM downloads WHERE hash = ?").run(hash);
}

// ---------------------------------------------------------------------------
// What the queue should stop offering
// ---------------------------------------------------------------------------

/**
 * qBittorrent's words for a torrent that has stopped being a download. Not the
 * same as gone: the entry is still listed, still yours to resume or delete —
 * but nothing is arriving, so a film that never finished is worth offering
 * again. Only where it never finished: `missingFiles` is also what a long-done
 * torrent says once its files have been moved or deleted, and that is a fact
 * about the drive rather than about the fetch.
 */
const FAILED_STATES = new Set(["error", "missingFiles"]);

/**
 * Whether a release is already in hand, asked of the client and the log
 * together.
 *
 * A queue is a list of things worth fetching, and the moment one is fetching
 * it stops being one — leaving it there invites the same download twice, which
 * is the one mistake the client will not catch for you. So the page asks this
 * first and drops the rows that answer yes.
 *
 * Yes means: it finished at some point, or qBittorrent is holding it now. No
 * means the fetch never happened — cancelled, deleted, or stopped on an error
 * before it completed — so the row comes back exactly as it was. That is the
 * whole reason this is asked of the client at read time rather than written
 * down at send time: a send is not an arrival, and only the client knows the
 * difference.
 *
 * Two ways a row is matched, because the queue's suggestion is not the only
 * release you might take for a film. The magnet's own info hash is exact. The
 * film recorded against the download catches the rest — you opened the list,
 * read the options and took a different one — at the cost of matching on title
 * alone, since that is all the log stores. Two films of the same name and
 * different years are one hidden row, which the next cancel puts back.
 *
 * With no client configured, or one that will not answer, every logged release
 * counts as held: a row in the log is far more likely to be a fetch in flight
 * than one taken back, and the failure worth avoiding is the duplicate.
 */
export async function alreadyFetching(): Promise<
  (release: { title: string; magnet?: string }) => boolean
> {
  const rows = db
    .prepare("SELECT hash, completed_at, film_title FROM downloads")
    .all() as {
    hash: string;
    completed_at: number | null;
    film_title: string | null;
  }[];

  if (rows.length === 0) return () => false;

  let live: Map<string, Download> | undefined;
  if (hasQb()) {
    try {
      live = new Map((await getDownloads()).map((d) => [d.hash, d]));
    } catch {
      // Unreachable: fall through to the log alone, which holds every hash.
    }
  }

  const hashes = new Set<string>();
  const films = new Set<string>();

  for (const row of rows) {
    const current = live?.get(row.hash);
    const held =
      live === undefined
        ? true
        : // A fetch that finished once is finished for good. What became of
          // the files afterwards — deleted, moved to the library, the drive
          // unplugged — is not a reason to fetch them again: the film either
          // scans in or it does not, and the queue is answered by the library,
          // not by whether qBittorrent can still see what it downloaded. So a
          // stamped row outranks whatever the client says about it now.
          row.completed_at !== null ||
          (current
            ? !FAILED_STATES.has(current.state)
            : // Never finished and no longer listed: cancelled.
              false);

    if (!held) continue;
    hashes.add(row.hash);
    if (row.film_title) films.add(titleKey(row.film_title));
  }

  return (release) => {
    const hash = release.magnet ? parseMagnet(release.magnet).hash : undefined;
    if (hash && hashes.has(hash)) return true;
    return films.has(titleKey(release.title));
  };
}
