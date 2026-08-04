"use server";

import { refresh } from "next/cache";
import { stat } from "node:fs/promises";
import path from "node:path";

import { listDirectory, type DirListing } from "@/lib/browse";
import { getSetting, setSetting } from "@/lib/db";
import { recordArtworkSource, reindexDir, saveArtwork } from "@/lib/artwork";
import { db } from "@/lib/db";
import {
  candidateFromUrl,
  clearDisc,
  fetchDisc,
  getDisc,
  searchReleases,
  setManualDisc,
  type Candidate,
} from "@/lib/disc";
import {
  cancelConvert,
  deleteBackup,
  getConvertJob,
  restoreOriginal as restore,
  startConvert,
  type ConvertJob,
} from "@/lib/convert";
import { classifyEnhancementLayer } from "@/lib/derive";
import {
  cancelDoviScan,
  getDoviJob,
  startFullDoviScan,
  type DoviJob,
} from "@/lib/dovi";
import { fetchAndCache, setManualMatch } from "@/lib/enrich";
import {
  clearJackettConfig,
  getJackettConfig,
  setJackettConfig,
  testJackett,
} from "@/lib/jackett";
import {
  findUpgrades,
  searchAnything,
  type UpgradeSearch,
} from "@/lib/upgrades";
import { deriveAll, getLibrary } from "@/lib/library";
import { getScanState, startScan, type ScanState } from "@/lib/scanner";
import {
  addLibraryRoot,
  getLibraryRoots,
  removeLibraryRoot,
} from "@/lib/roots";
import { revealInFinder } from "@/lib/system";
import { addToWishlist, getWishlist, removeFromWishlist } from "@/lib/wishlist";
import { imageUrl } from "@/lib/image-url";
import { getShow } from "@/lib/shows";
import {
  clearSeasonDisc,
  getSeasonDisc,
  searchSeasonReleases,
  setManualSeasonDisc,
} from "@/lib/tv-disc";
import { enrichShow, setManualShowMatch } from "@/lib/tv";
import {
  getImages,
  clearTmdbToken,
  getMovie as getTmdbMovie,
  getTmdbToken,
  getTvImages,
  hasCredentials,
  isTmdbImagePath,
  searchMovies,
  searchTv,
  setTmdbToken,
  type TmdbImage,
} from "@/lib/tmdb";

/** Guards write actions against paths that are not films we have scanned. */
function knownMoviePath(moviePath: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM movies WHERE path = ?").get(moviePath),
  );
}

// Not exported: a "use server" module may only export async functions.
const CONVERT_TEMP_KEY = "convertTempDir";

export async function browse(target: string): Promise<DirListing> {
  return listDirectory(target);
}

export async function getLibraryFolders(): Promise<string[]> {
  return getLibraryRoots();
}

/**
 * Adds a folder to the library. Nested folders are refused rather than merged:
 * one inside another means every film under it is scanned twice and pruned by
 * whichever pass ran last.
 */
export async function addLibraryFolder(
  target: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const resolved = path.resolve(target);

  try {
    if (!(await stat(resolved)).isDirectory()) {
      return { ok: false, error: `Not a directory: ${resolved}` };
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const existing = getLibraryRoots();
  const overlaps = existing.find(
    (root) =>
      resolved === root ||
      resolved.startsWith(root.endsWith("/") ? root : `${root}/`) ||
      root.startsWith(resolved.endsWith("/") ? resolved : `${resolved}/`),
  );
  if (overlaps) {
    return {
      ok: false,
      error:
        resolved === overlaps
          ? "That folder is already in the library."
          : `Overlaps a folder already in the library: ${overlaps}`,
    };
  }

  addLibraryRoot(resolved);
  refresh();
  return { ok: true };
}

/** Forgets a folder and every film scanned from it. */
export async function removeLibraryFolder(
  target: string,
): Promise<{ ok: true; removed: number }> {
  const removed = removeLibraryRoot(target);
  deriveAll();
  refresh();
  return { ok: true, removed };
}

/**
 * Where dovi_convert should put its working files.
 *
 * A conversion reads the source and writes the converted video at the same
 * time; on one spinning drive those compete for the same head. Pointing the
 * intermediate file at an SSD splits the two.
 */
export async function getConvertTempDir(): Promise<string | undefined> {
  return getSetting(CONVERT_TEMP_KEY);
}

export async function setConvertTempDir(
  target: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const resolved = path.resolve(target);

  try {
    if (!(await stat(resolved)).isDirectory()) {
      return { ok: false, error: `Not a directory: ${resolved}` };
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  setSetting(CONVERT_TEMP_KEY, resolved);
  refresh();
  return { ok: true };
}

/** Back to writing beside the source file. */
export async function clearConvertTempDir(): Promise<void> {
  db.prepare("DELETE FROM settings WHERE key = ?").run(CONVERT_TEMP_KEY);
  refresh();
}

export async function beginScan(): Promise<ScanState> {
  const roots = getLibraryRoots();
  if (roots.length === 0) {
    return {
      status: "error",
      discovered: 0,
      probed: 0,
      cached: 0,
      failed: 0,
      matchTotal: 0,
      matchDone: 0,
      matched: 0,
      needsReview: 0,
      removed: 0,
      doviTotal: 0,
      doviDone: 0,
      discTotal: 0,
      discDone: 0,
      error: "No library folder selected.",
    };
  }
  return startScan(roots);
}

export async function scanStatus(): Promise<ScanState> {
  return getScanState();
}

/** Re-derives from cached probes and TMDb records — no disk, no network. */
export async function rederive(): Promise<number> {
  const count = deriveAll();
  refresh();
  return count;
}

// ---------------------------------------------------------------------------
// Match review
// ---------------------------------------------------------------------------

export type SearchHit = {
  id: number;
  title: string;
  year?: string;
  posterPath?: string;
  overview?: string;
};

export async function searchTmdb(query: string): Promise<SearchHit[]> {
  if (!query.trim()) return [];

  const { results } = await searchMovies(query.trim());
  return results.slice(0, 12).map((r) => ({
    id: r.id,
    title: r.title,
    year: r.release_date?.slice(0, 4) || undefined,
    posterPath: (r as { poster_path?: string | null }).poster_path ?? undefined,
    overview: (r as { overview?: string }).overview,
  }));
}

/** The same search against TMDb's TV half, for linking a show by hand. */
export async function searchTmdbShows(query: string): Promise<SearchHit[]> {
  if (!query.trim()) return [];

  const { results } = await searchTv(query.trim());
  return results.slice(0, 12).map((r) => ({
    id: r.id,
    title: r.name,
    year: r.first_air_date?.slice(0, 4) || undefined,
    posterPath: r.poster_path ?? undefined,
    overview: r.overview,
  }));
}

/**
 * Links a show to a TMDb series by hand and pulls its facts down straight
 * away — the alternative is a page that says the right name but has nothing
 * behind it until the next scan.
 */
export async function confirmShowMatch(
  showKey: string,
  tmdbId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const show = getShow(showKey);
  if (!show) return { ok: false, error: `Unknown show: ${showKey}` };

  try {
    setManualShowMatch(showKey, tmdbId);
    await enrichShow(
      showKey,
      show.title,
      show.seasons.map((s) => s.number),
    );
    refresh();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Records a reviewed match. Passing the id it already has is how you confirm a
 * low-confidence guess was right — it becomes manual, so re-runs leave it be.
 */
export async function confirmMatch(
  moviePath: string,
  tmdbId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!knownMoviePath(moviePath)) {
    return { ok: false, error: `Unknown file: ${moviePath}` };
  }

  try {
    await setManualMatch(moviePath, tmdbId);
    deriveAll();
    refresh();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Wishlist
// ---------------------------------------------------------------------------

/**
 * Puts a film on the want list. Everything shown later is stored here and now,
 * so the list keeps working with no network and no TMDb key.
 */
export async function addWish(hit: SearchHit): Promise<void> {
  // A search result carries no collection, so the film is fetched for it — the
  // list groups by set, and a film that arrives ungrouped looks misfiled until
  // the next backfill. A failed fetch is left unchecked to be picked up then.
  let collection: { id: number; name: string } | undefined;
  let checked = false;
  try {
    const movie = await getTmdbMovie(hit.id);
    collection = movie.belongs_to_collection
      ? {
          id: movie.belongs_to_collection.id,
          name: movie.belongs_to_collection.name,
        }
      : undefined;
    checked = true;
  } catch {
    // Left for the backfill.
  }

  addToWishlist({
    tmdbId: hit.id,
    title: hit.title,
    year: hit.year ? Number(hit.year) : undefined,
    posterPath: hit.posterPath,
    overview: hit.overview,
    collection,
    collectionChecked: checked,
  });
  refresh();
}

export async function removeWish(tmdbId: number): Promise<void> {
  removeFromWishlist(tmdbId);
  refresh();
}

// ---------------------------------------------------------------------------
// Discs
// ---------------------------------------------------------------------------

/* The candidate as the scraper reads it — including what tells one edition of a
   film from another, which is the whole reason a list of them is shown. */
export type DiscCandidate = Candidate;

/** Every edition Blu-ray.com lists for a film, for you to choose between. */
export async function searchDiscs(
  title: string,
  year?: number,
): Promise<
  { ok: true; results: DiscCandidate[] } | { ok: false; error: string }
> {
  try {
    return { ok: true, results: await searchReleases(title, year) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function linkDisc(
  tmdbId: number,
  candidate: DiscCandidate,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const lookup = await setManualDisc(tmdbId, candidate);
    if (lookup.error) return { ok: false, error: lookup.error };
    deriveAll();
    refresh();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Links a release from a pasted Blu-ray.com URL. */
export async function linkDiscByUrl(
  tmdbId: number,
  url: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const candidate = candidateFromUrl(url);
  if (!candidate) {
    return {
      ok: false,
      error:
        "Not a Blu-ray.com release URL — expected .../movies/<title>/<id>/",
    };
  }
  return linkDisc(tmdbId, candidate);
}

/** Forgets the stored release so the next scan searches again. */
export async function unlinkDisc(
  tmdbId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    clearDisc(tmdbId);
    deriveAll();
    refresh();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * The same three, for one season of a show. A series is sold a season at a
 * time, so the release being picked belongs to the season and not to the show.
 */
export async function searchSeasonDiscs(
  showTitle: string,
  season: number,
  year?: number,
): Promise<
  { ok: true; results: DiscCandidate[] } | { ok: false; error: string }
> {
  try {
    return {
      ok: true,
      results: await searchSeasonReleases(showTitle, season, year),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function linkSeasonDisc(
  showKey: string,
  season: number,
  candidate: DiscCandidate,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const lookup = await setManualSeasonDisc(showKey, season, candidate);
    if (lookup.error) return { ok: false, error: lookup.error };
    refresh();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function linkSeasonDiscByUrl(
  showKey: string,
  season: number,
  url: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const candidate = candidateFromUrl(url);
  if (!candidate) {
    return {
      ok: false,
      error:
        "Not a Blu-ray.com release URL — expected .../movies/<title>/<id>/",
    };
  }
  return linkSeasonDisc(showKey, season, candidate);
}

export async function unlinkSeasonDisc(
  showKey: string,
  season: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    clearSeasonDisc(showKey, season);
    refresh();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Dolby Vision
// ---------------------------------------------------------------------------

/**
 * Reads every frame of one film's RPU. Minutes of disk, so it starts a job and
 * returns — `doviJobStatus` is how the page follows it.
 */
export async function beginFullDoviScan(
  moviePath: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!knownMoviePath(moviePath)) {
    return { ok: false, error: `Unknown file: ${moviePath}` };
  }

  const job = getDoviJob();
  if (job.status === "running" && job.path !== moviePath) {
    return { ok: false, error: "Another full pass is already running." };
  }
  if (getConvertJob().status === "running") {
    return { ok: false, error: "Wait for the conversion to finish." };
  }

  // The duration is only used to turn elapsed time into a percentage.
  const movie = getLibrary().find((m) => m.path === moviePath);
  startFullDoviScan(moviePath, movie?.durationSec);
  return { ok: true };
}

export async function doviJobStatus(): Promise<DoviJob> {
  return getDoviJob();
}

/** Stops a full pass. The film keeps the reading it already had. */
export async function stopFullDoviScan(): Promise<DoviJob> {
  return cancelDoviScan();
}

/**
 * Repaints the page once a full pass has finished. The pass folds itself into
 * the derived rows as it completes, so this only has to invalidate the cache.
 */
export async function refreshAfterDoviScan(): Promise<void> {
  refresh();
}

/**
 * Rewrites a Profile 7 file as Profile 8.1, in place, via dovi_convert.
 *
 * The only action in this app that changes a film rather than describing one,
 * so every precondition is checked here and not merely in the button: a page
 * can be stale, and this one is expensive to be wrong about.
 */
export async function beginConvert(
  moviePath: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!knownMoviePath(moviePath)) {
    return { ok: false, error: `Unknown file: ${moviePath}` };
  }
  if (getConvertJob().status === "running") {
    return { ok: false, error: "A conversion is already running." };
  }
  // Both hammer the same drive, and the reading would describe a file that is
  // being rewritten underneath it.
  if (getDoviJob().status === "running") {
    return { ok: false, error: "Wait for the current full pass to finish." };
  }

  const movie = getLibrary().find((m) => m.path === moviePath);
  if (!movie) return { ok: false, error: "Film is no longer in the library." };
  if (movie.dvProfile !== 7) {
    return { ok: false, error: "Only Profile 7 files need converting." };
  }

  const el = classifyEnhancementLayer(movie.dovi, movie.hdr10);
  if (el?.kind === "complex-fel") {
    return {
      ok: false,
      error:
        "This film's enhancement layer reconstructs brightness — converting would clip it. Run dovi_convert with --force yourself if you want it anyway.",
    };
  }
  // A full enhancement layer judged safe on a few hundred frames has only been
  // judged on those frames: expansion anywhere later in the film would not have
  // shown up. `provisional` is set for exactly that case, and converting on it
  // is the one way to discard highlights while believing you checked.
  if (el?.provisional) {
    return {
      ok: false,
      error:
        "This is a full enhancement layer and only the start of it has been read. Read every frame first — a sample cannot rule out brightness expansion later in the film.",
    };
  }

  // Read from the file we already know about, so the progress watcher has
  // something to measure against.
  startConvert(moviePath, {
    sourceBytes: movie.sizeBytes,
    videoBytes:
      movie.videoBitrateKbps && movie.durationSec
        ? (movie.videoBitrateKbps * 1000 * movie.durationSec) / 8
        : undefined,
  });
  return { ok: true };
}

/**
 * Throws away the pre-conversion original to reclaim its space. The one action
 * here that cannot be walked back, so it is kept separate from restoring.
 */
export async function discardBackup(
  moviePath: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!knownMoviePath(moviePath)) {
    return { ok: false, error: `Unknown file: ${moviePath}` };
  }
  if (getConvertJob().status === "running") {
    return { ok: false, error: "A conversion is running — wait for it." };
  }

  try {
    await deleteBackup(moviePath);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  refresh();
  return { ok: true };
}

export async function convertJobStatus(): Promise<ConvertJob> {
  return getConvertJob();
}

/** Stops a conversion and sweeps up its partial output. */
export async function stopConvert(): Promise<ConvertJob> {
  return cancelConvert();
}

/**
 * Puts back the Profile 7 original a conversion set aside, and deletes the
 * converted file. Fast enough to do inline — it is two renames plus a re-read,
 * not a rewrite.
 */
export async function restoreOriginal(
  moviePath: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!knownMoviePath(moviePath)) {
    return { ok: false, error: `Unknown file: ${moviePath}` };
  }
  if (getConvertJob().status === "running") {
    return { ok: false, error: "A conversion is running — wait for it." };
  }
  if (getDoviJob().status === "running") {
    return { ok: false, error: "A full pass is running — wait for it." };
  }

  try {
    await restore(moviePath);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Triage and shell
// ---------------------------------------------------------------------------

/** Selects the file in Finder — the step between "this copy is worse" and deleting it. */
export async function reveal(
  moviePath: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!knownMoviePath(moviePath)) {
    return { ok: false, error: `Unknown file: ${moviePath}` };
  }
  try {
    await revealInFinder(moviePath);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Artwork
// ---------------------------------------------------------------------------

export type ArtworkChoice = {
  filePath: string;
  width: number;
  height: number;
  language: string | null;
  vote: number;
};

export async function listArtwork(
  tmdbId: number,
  media: "movie" | "tv" = "movie",
): Promise<{
  posters: ArtworkChoice[];
  backdrops: ArtworkChoice[];
  logos: ArtworkChoice[];
}> {
  const images = await (media === "tv"
    ? getTvImages(tmdbId)
    : getImages(tmdbId));
  const map = (list: TmdbImage[]) =>
    list.slice(0, 24).map((i) => ({
      filePath: i.file_path,
      width: i.width,
      height: i.height,
      language: i.iso_639_1,
      vote: i.vote_average,
    }));

  return {
    posters: map(images.posters),
    backdrops: map(images.backdrops),
    // TMDb serves some logos as SVG, which cannot be drawn into a raster file
    // the way the rest are; the PNGs are what this app can actually save.
    logos: map(
      (images.logos ?? []).filter((i) => !i.file_path.endsWith(".svg")),
    ),
  };
}

/**
 * Downloads the chosen image into the show's own folder — the one above the
 * season folders, so it belongs to the series rather than to one season.
 */
export async function chooseShowArtwork(
  showKey: string,
  kind: "poster" | "fanart" | "logo",
  tmdbFilePath: string,
): Promise<{ ok: true; saved: string } | { ok: false; error: string }> {
  const show = getShow(showKey);
  if (!show) return { ok: false, error: `Unknown show: ${showKey}` };
  if (!isTmdbImagePath(tmdbFilePath)) {
    return { ok: false, error: `Not a TMDb image path: ${tmdbFilePath}` };
  }

  try {
    const saved = await saveArtwork(
      show.dir,
      kind,
      imageUrl(tmdbFilePath, "original"),
    );
    await reindexDir(show.dir);
    recordArtworkSource(show.dir, kind, tmdbFilePath);
    deriveAll();
    refresh();
    return { ok: true, saved };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Downloads the chosen image into the film's own folder. */
export async function chooseArtwork(
  moviePath: string,
  kind: "poster" | "fanart" | "logo",
  tmdbFilePath: string,
): Promise<{ ok: true; saved: string } | { ok: false; error: string }> {
  // Both inputs are constrained: the folder must contain a film we scanned, and
  // the source must look like a TMDb path. Not a security boundary — this app
  // is local-only — but it keeps a malformed call from writing somewhere odd.
  if (!knownMoviePath(moviePath)) {
    return { ok: false, error: `Unknown file: ${moviePath}` };
  }
  if (!isTmdbImagePath(tmdbFilePath)) {
    return { ok: false, error: `Not a TMDb image path: ${tmdbFilePath}` };
  }

  const dir = path.dirname(moviePath);

  try {
    const saved = await saveArtwork(
      dir,
      kind,
      imageUrl(tmdbFilePath, "original"),
    );
    await reindexDir(dir);
    recordArtworkSource(dir, kind, tmdbFilePath);
    deriveAll();
    refresh();
    return { ok: true, saved };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Indexer search
// ---------------------------------------------------------------------------

/**
 * What the settings page needs to know, which is never the key itself. An
 * environment-supplied config is reported as managed so the UI can offer to
 * show it rather than to edit something it cannot change.
 */
/** Whether TMDb has been connected. */
export async function getTmdbStatus(): Promise<{ configured: boolean }> {
  return { configured: hasCredentials() };
}

/**
 * Saves the read token, but only once TMDb has answered with it — a key that is
 * one character short fails the same way as no key at all, and storing it would
 * turn a typo into a feature that is quietly broken everywhere.
 */
export async function saveTmdbToken(
  token: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = token.trim();
  if (!trimmed) return { ok: false, error: "Paste the read access token." };

  const previous = getTmdbToken();
  setTmdbToken(trimmed);

  try {
    await searchMovies("Blade Runner", 1982);
    refresh();
    return { ok: true };
  } catch (err) {
    // Put back whatever worked before rather than leaving the app holding a
    // token that does not.
    if (previous && previous !== trimmed) setTmdbToken(previous);
    else clearTmdbToken();

    return {
      ok: false,
      error:
        err instanceof Error && /401|unauthor/i.test(err.message)
          ? "TMDb refused that token."
          : err instanceof Error
            ? err.message
            : String(err),
    };
  }
}

export async function disconnectTmdb(): Promise<void> {
  clearTmdbToken();
  refresh();
}

export async function getJackettStatus(): Promise<{
  configured: boolean;
  url?: string;
  managed: boolean;
}> {
  const config = getJackettConfig();
  return {
    configured: Boolean(config),
    url: config?.url,
    managed: Boolean(process.env.JACKETT_URL && process.env.JACKETT_API_KEY),
  };
}

/** Saves only after a live check, so a typo cannot be stored as working. */
export async function saveJackett(
  url: string,
  apiKey: string,
): Promise<{ ok: true; categories: number } | { ok: false; error: string }> {
  if (!/^https?:\/\//i.test(url.trim())) {
    return {
      ok: false,
      error: "Enter the full address, starting http:// or https://",
    };
  }

  const previous = getJackettConfig();
  setJackettConfig({ url, apiKey });

  try {
    const { categories } = await testJackett();
    refresh();
    return { ok: true, categories };
  } catch (err) {
    // Put back whatever worked before rather than leaving the app pointed at
    // an address that does not answer.
    if (previous) setJackettConfig(previous);
    else clearJackettConfig();

    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function disconnectJackett(): Promise<void> {
  clearJackettConfig();
  refresh();
}

/** Shared shape for every search below, so one component can render them all. */
export type UpgradeResponse =
  | { ok: true; search: UpgradeSearch; current?: number }
  | { ok: false; error: string };

const failed = (err: unknown): { ok: false; error: string } => ({
  ok: false,
  error: err instanceof Error ? err.message : String(err),
});

/**
 * Releases for a film already in the library, ranked against the copy held.
 *
 * Compared against the *absolute* rubric score rather than the headline one:
 * where a disc is known the headline score is a percentage of that disc, and a
 * predicted score has no disc behind it — putting the two side by side would be
 * comparing a proportion against a total.
 */
export async function findUpgradesForMovie(
  moviePath: string,
): Promise<UpgradeResponse> {
  if (!knownMoviePath(moviePath)) return { ok: false, error: "Unknown film." };

  const movie = getLibrary().find((m) => m.path === moviePath);
  if (!movie) return { ok: false, error: "Unknown film." };

  // Television is searched a season at a time — see findUpgradesForSeason.
  if (movie.kind === "episode") {
    return {
      ok: false,
      error: "Episodes are searched by season, from the show page.",
    };
  }

  // The film's own disc, which the scan has usually linked already. Scoring
  // results against it is what puts them on the same scale as the score shown
  // on the film's page — comparing a rubric total against a disc-relative one
  // would have the modal reporting an upgrade that is nothing of the sort.
  const disc = movie.tmdb ? getDisc(movie.tmdb.id) : undefined;

  // `scores.overall` rather than `breakdown.absolute`: where a disc is known
  // that is already the disc-relative figure, which is what the results are
  // now being measured on too.
  const current = movie.scores.overall;

  try {
    const search = await findUpgrades({
      kind: "movie",
      title: movie.tmdb?.title ?? movie.title,
      year: movie.tmdb?.year ?? movie.year,
      imdbId: movie.imdbId,
      runtimeMinutes:
        movie.tmdb?.runtimeMinutes ??
        (movie.durationSec ? Math.round(movie.durationSec / 60) : undefined),
      currentScore: current,
      disc,
    });
    return { ok: true, search, current };
  } catch (err) {
    return failed(err);
  }
}

/** Releases for a film on the want list — nothing held, so nothing to beat. */
/**
 * A keyword search against the indexers, with no film behind it.
 *
 * The other two searches start from something the library knows and score what
 * comes back against it. This one starts from a line of text, so the results
 * carry the rubric score their names imply and nothing else: there is no copy
 * to be better than.
 */
export async function searchTorrents(term: string): Promise<UpgradeResponse> {
  const query = term.trim();
  if (!query) return { ok: false, error: "Type something to search for." };

  try {
    return { ok: true, search: await searchAnything(query) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function findReleasesFor(
  tmdbId: number,
): Promise<UpgradeResponse> {
  // The wishlist is consulted but not required: a film in a collection you do
  // not own has never been wished for, and having to want it on a list first
  // before you may look for it is a step that answers nothing.
  const entry = getWishlist().find((w) => w.tmdbId === tmdbId);

  // Where the wishlist has nothing, TMDb is the title and year — and it is
  // needed anyway for the runtime, without which every encode scores as
  // "bitrate unknown". The record is usually cached already, so this is free.
  let runtimeMinutes: number | undefined;
  let imdbId: string | undefined;
  let title = entry?.title;
  let year = entry?.year;
  try {
    const movie = await fetchAndCache(tmdbId);
    runtimeMinutes = movie.runtime ?? undefined;
    imdbId = movie.imdb_id ?? undefined;
    title = title ?? movie.title;
    year =
      year ??
      (movie.release_date
        ? Number(movie.release_date.slice(0, 4))
        : undefined);
  } catch {
    // Searchable without either; only the encode scores get vaguer.
  }

  if (!title) return { ok: false, error: "Nothing known about this film." };

  // A wanted film has never been scanned, so nothing has ever looked its disc
  // up. Done here, once, and cached exactly like a scanned film's — including
  // the failure, so a film with no disc release is not re-scraped on every
  // visit. Blu-ray.com pages are large and slow, which is why this is worth
  // storing rather than repeating.
  let disc = getDisc(tmdbId);
  if (!disc) {
    try {
      disc = await fetchDisc(tmdbId, title, year);
    } catch {
      // Scored on the bare rubric instead; the search itself is unaffected.
    }
  }

  try {
    const search = await findUpgrades({
      kind: "movie",
      title,
      year,
      imdbId,
      runtimeMinutes,
      disc,
    });
    return { ok: true, search };
  } catch (err) {
    return failed(err);
  }
}

/** Releases for one season — both season packs and individual episodes. */
export async function findUpgradesForSeason(
  showKey: string,
  season: number,
): Promise<UpgradeResponse> {
  const show = getShow(showKey);
  if (!show) return { ok: false, error: "Unknown show." };

  const held = show.seasons.find((s) => s.number === season);

  // Episode runtimes come from the files rather than from TMDb: they are on
  // the drive already, and an average over the season is steadier than any
  // single episode for judging a bitrate.
  const durations = (held?.episodes ?? [])
    .map((e) => e.item.durationSec)
    .filter((d): d is number => Boolean(d));
  const runtimeMinutes = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 60)
    : undefined;

  // The season's own disc set, already linked from the show page where it has
  // been. A series is sold a season at a time, so the season is the only unit
  // a disc set can be compared against.
  const disc = getSeasonDisc(showKey, season);

  // Averaged over the episodes held, on the same relative footing the results
  // will be scored on.
  const scores = (held?.episodes ?? []).map((e) => e.item.scores.overall);
  const current = scores.length
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : undefined;

  try {
    const search = await findUpgrades({
      kind: "tv",
      title: show.tmdb?.name ?? show.title,
      season,
      runtimeMinutes,
      currentScore: current,
      disc,
    });
    return { ok: true, search, current };
  } catch (err) {
    return failed(err);
  }
}

