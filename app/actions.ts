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
import { setManualMatch } from "@/lib/enrich";
import { deriveAll } from "@/lib/library";
import { getScanState, startScan, type ScanState } from "@/lib/scanner";
import { revealInFinder } from "@/lib/system";
import { setTriage } from "@/lib/triage";
import { imageUrl } from "@/lib/image-url";
import {
  getImages,
  isTmdbImagePath,
  searchMovies,
  type TmdbImage,
} from "@/lib/tmdb";

/** Guards write actions against paths that are not films we have scanned. */
function knownMoviePath(moviePath: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM movies WHERE path = ?").get(moviePath),
  );
}

// Not exported: a "use server" module may only export async functions.
const LIBRARY_ROOT_KEY = "libraryRoot";

export async function browse(target: string): Promise<DirListing> {
  return listDirectory(target);
}

export async function getLibraryRoot(): Promise<string | undefined> {
  return getSetting(LIBRARY_ROOT_KEY);
}

export async function setLibraryRoot(
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

  setSetting(LIBRARY_ROOT_KEY, resolved);
  refresh();
  return { ok: true };
}

export async function beginScan(): Promise<ScanState> {
  const root = getSetting(LIBRARY_ROOT_KEY);
  if (!root) {
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
      discTotal: 0,
      discDone: 0,
      error: "No library folder selected.",
    };
  }
  return startScan(root);
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
): Promise<{ posters: ArtworkChoice[]; backdrops: ArtworkChoice[] }> {
  const images = await getImages(tmdbId);
  const map = (list: TmdbImage[]) =>
    list.slice(0, 24).map((i) => ({
      filePath: i.file_path,
      width: i.width,
      height: i.height,
      language: i.iso_639_1,
      vote: i.vote_average,
    }));

  return { posters: map(images.posters), backdrops: map(images.backdrops) };
}

/** Downloads the chosen image into the film's own folder. */
export async function chooseArtwork(
  moviePath: string,
  kind: "poster" | "fanart",
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
