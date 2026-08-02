"use server";

import { refresh } from "next/cache";
import { stat } from "node:fs/promises";
import path from "node:path";

import { listDirectory, type DirListing } from "@/lib/browse";
import { getSetting, setSetting } from "@/lib/db";
import { reindexDir, saveArtwork } from "@/lib/artwork";
import { db } from "@/lib/db";
import {
  candidateFromUrl,
  clearDisc,
  searchReleases,
  setManualDisc,
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
import { setManualMatch } from "@/lib/enrich";
import { deriveAll, getLibrary } from "@/lib/library";
import { getScanState, startScan, type ScanState } from "@/lib/scanner";
import {
  addLibraryRoot,
  getLibraryRoots,
  removeLibraryRoot,
} from "@/lib/roots";
import { revealInFinder } from "@/lib/system";
import { addToWishlist, removeFromWishlist } from "@/lib/wishlist";
import { setIssueAck, setTriage } from "@/lib/triage";
import { imageUrl } from "@/lib/image-url";
import { getShow } from "@/lib/shows";
import {
  clearSeasonDisc,
  searchSeasonReleases,
  setManualSeasonDisc,
} from "@/lib/tv-disc";
import { enrichShow, setManualShowMatch } from "@/lib/tv";
import {
  getImages,
  getTvImages,
  isTmdbImagePath,
  searchMovies,
  searchTv,
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
  addToWishlist({
    tmdbId: hit.id,
    title: hit.title,
    year: hit.year ? Number(hit.year) : undefined,
    posterPath: hit.posterPath,
    overview: hit.overview,
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

export type DiscCandidate = {
  id: string;
  url: string;
  title: string;
  year?: number;
  format: "4K" | "3D" | "BD";
};

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

/** Accept a film as-is so it stops counting toward the attention totals. */
export async function acknowledge(
  moviePath: string,
  value: boolean,
  note?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!knownMoviePath(moviePath)) {
    return { ok: false, error: `Unknown file: ${moviePath}` };
  }

  // Reported rather than thrown: an uncaught error here surfaces as a blank
  // failure in the browser console, which is how a missing table went unnoticed.
  try {
    setTriage(moviePath, value, note);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  refresh();
  return { ok: true };
}

/**
 * Marks one issue on one film as dealt with, or reopens it. Separate from
 * accepting a film wholesale: most films that need attention need it for one
 * reason out of several, and clearing them one at a time is how the list
 * actually empties.
 */
export async function resolveIssue(
  moviePath: string,
  code: string,
  resolved: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!knownMoviePath(moviePath)) {
    return { ok: false, error: `Unknown file: ${moviePath}` };
  }

  try {
    setIssueAck(moviePath, code, resolved);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  refresh();
  return { ok: true };
}

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
