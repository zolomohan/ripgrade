"use server";

import { refresh } from "next/cache";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import { listDirectory, type DirListing } from "@/lib/browse";
import { getSetting, setSetting } from "@/lib/db";
import {
  MAX_UPLOAD_BYTES,
  recordArtworkSource,
  reindexDir,
  saveArtwork,
  saveUploadedArtwork,
} from "@/lib/artwork";
import { db } from "@/lib/db";
import {
  candidateFromUrl,
  clearDisc,
  fetchDisc,
  getDisc,
  searchReleases,
  setEnteredDisc,
  setManualDisc,
  type Candidate,
} from "@/lib/disc";
import { readEntry, type DiscEntry } from "@/lib/disc-entry";
import { canStripAudio, type AudioPreference } from "@/lib/audio-plan";
import {
  getAudioPreference,
  libraryLanguages,
  setAudioPreference,
  type LibraryLanguage,
} from "@/lib/audio-prefs";
import {
  audioBackupBytes,
  cancelStrip,
  deleteAudioBackup,
  getStripJob,
  restoreAudioTracks,
  startStripAudio,
  type StripJob,
} from "@/lib/audio-strip";
import {
  backupBytes,
  cancelConvert,
  deleteBackup,
  deleteElArchive,
  elArchiveBytes,
  getConvertJob,
  keepsEnhancementLayer,
  restoreOriginal as restore,
  startConvert,
  startRebuild,
  KEEP_EL_KEY,
  type ConvertJob,
} from "@/lib/convert";
import {
  addToCustomSet,
  collectionDir,
  createCustomSet,
  customSetExists,
  customSetKeys,
  deleteCustomSet,
  getCustomSetsHolding,
  removeFromCustomSet,
  renameCustomSet,
  type CollectionMember,
} from "@/lib/custom-collections";
import { classifyEnhancementLayer, convertRefusal } from "@/lib/derive";
import { getDiscoverEpisodes, type DiscoverEpisode } from "@/lib/discover";
import { deleteCleanupFiles } from "@/lib/queue-tasks";
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
  getStoredJackettConfig,
  hasEnvJackett,
  hasJackett,
  setJackettConfig,
  testJackett,
} from "@/lib/jackett";
import {
  findUpgrades,
  searchAnything,
  type UpgradeSearch,
} from "@/lib/upgrades";
import {
  deriveAll,
  getLibrary,
  getMovies,
  type LibraryItem,
} from "@/lib/library";
import { movieId, showId } from "@/lib/routes";
import { startScan, type ScanState } from "@/lib/scanner";
import {
  addLibraryRoot,
  getLibraryRoots,
  removeLibraryRoot,
} from "@/lib/roots";
import { revealInFinder } from "@/lib/system";
import { setExtendedCut } from "@/lib/triage";
import {
  cancelThumbRebuild,
  clearThumbCache,
  startThumbRebuild,
  thumbCacheStats,
  type ThumbJob,
} from "@/lib/thumbs";
import {
  cancelSweep,
  getQueueRules as readQueueRules,
  getSweepJob,
  setQueueRules as writeQueueRules,
  startSweep,
  type QueueRules,
  type SweepJob,
} from "@/lib/upgrade-sweep";
import {
  addMagnet,
  checkQb,
  clearQbConfig,
  forgetDownload,
  getDownloadLog,
  getQbConfig,
  getStopSeeding,
  pauseTorrent,
  removeTorrent,
  resumeTorrent,
  setQbConfig,
  setStopSeeding,
  type DownloadEntry,
  type FilmContext,
} from "@/lib/qbittorrent";
import {
  addToWishlist,
  getWishlist,
  getWishlistIds,
  removeFromWishlist,
  type WishKind,
} from "@/lib/wishlist";
import { imageUrl } from "@/lib/image-url";
import { getShow, getShows, type Show } from "@/lib/shows";
import {
  clearSeasonDisc,
  getSeasonDisc,
  searchSeasonReleases,
  setEnteredSeasonDisc,
  setManualSeasonDisc,
} from "@/lib/tv-disc";
import { enrichShow, setManualShowMatch } from "@/lib/tv";
import {
  getImages,
  clearTmdbToken,
  getMovie as getTmdbMovie,
  getTmdbToken,
  getTvImages,
  getTvShow,
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

// ---------------------------------------------------------------------------
// Thumbnail cache
// ---------------------------------------------------------------------------

export async function getThumbCache(): Promise<{
  files: number;
  bytes: number;
}> {
  return thumbCacheStats();
}

export async function clearThumbs(): Promise<{ files: number; bytes: number }> {
  const removed = await clearThumbCache();
  refresh();
  return removed;
}

/**
 * Walks every poster at every width — slow on purpose; see lib/thumbs.ts.
 *
 * Returns the job rather than the outcome: the pass outlives the request, and
 * the rail follows it from there.
 */
export async function rebuildThumbs(): Promise<ThumbJob> {
  return startThumbRebuild();
}

export async function stopThumbRebuild(): Promise<ThumbJob> {
  return cancelThumbRebuild();
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
      artTotal: 0,
      artDone: 0,
      artSaved: 0,
      discTotal: 0,
      discDone: 0,
      wishTotal: 0,
      wishDone: 0,
      wishFound: 0,
      error: "No library folder selected.",
    };
  }
  return startScan(roots);
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
  /**
   * Which half of TMDb answered. Absent means a film — the match review asks
   * one half at a time and already knows which — but a want list holding both
   * cannot tell one id from the other without it.
   */
  kind?: WishKind;
  title: string;
  year?: string;
  posterPath?: string;
  overview?: string;
  /** Already on the drive — a want list has nothing to do with it. */
  inLibrary?: boolean;
};

export async function searchTmdb(query: string): Promise<SearchHit[]> {
  if (!query.trim()) return [];

  const { results } = await searchMovies(query.trim());

  // What the library already holds, by TMDb id, so the wishlist search can
  // refuse to offer a film that is not missing.
  const held = new Set(
    getLibrary()
      .map((m) => m.tmdb?.id)
      .filter((id): id is number => id !== undefined),
  );

  return results.slice(0, 12).map((r) => ({
    id: r.id,
    kind: "movie" as const,
    title: r.title,
    year: r.release_date?.slice(0, 4) || undefined,
    posterPath: (r as { poster_path?: string | null }).poster_path ?? undefined,
    overview: (r as { overview?: string }).overview,
    inLibrary: held.has(r.id),
  }));
}

/**
 * The same search against TMDb's TV half, for linking a show by hand and for
 * the shows half of the universal search.
 */
export async function searchTmdbShows(query: string): Promise<SearchHit[]> {
  if (!query.trim()) return [];

  const { results } = await searchTv(query.trim());

  // Nothing is said here about what the drive holds: rebuilding every show from
  // its episodes to answer that would be a second full pass per keystroke, and
  // the one caller that cares — the universal search — has the shows in hand
  // already and matches them itself.
  return results.slice(0, 12).map((r) => ({
    id: r.id,
    kind: "tv" as const,
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

/**
 * Answers the extended-cut question a long-running film is asked, or takes the
 * answer back with `null` so it is asked again.
 *
 * No re-derive: the answer is a decision about the file rather than a fact
 * derived from it, so it is joined on when the library is read and every page
 * sees it on the next render.
 */
export async function answerExtendedCut(
  moviePath: string,
  answer: boolean | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!knownMoviePath(moviePath)) {
    return { ok: false, error: `Unknown file: ${moviePath}` };
  }

  try {
    setExtendedCut(moviePath, answer);
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
  const kind: WishKind = hit.kind ?? "movie";

  // A search result carries no collection, so the film is fetched for it — the
  // list groups by set, and a film that arrives ungrouped looks misfiled until
  // the next backfill. A failed fetch is left unchecked to be picked up then.
  //
  // A series has no such set to belong to, so it is stored as asked-and-answered
  // and the backfill never looks at it again.
  let collection: { id: number; name: string } | undefined;
  let checked = kind === "tv";
  if (kind === "movie") {
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
  }

  addToWishlist({
    tmdbId: hit.id,
    kind,
    title: hit.title,
    year: hit.year ? Number(hit.year) : undefined,
    posterPath: hit.posterPath,
    overview: hit.overview,
    collection,
    collectionChecked: checked,
  });

  /**
   * Its disc, and then go and look for it — without being asked twice.
   *
   * Wanting a film is a standing question only the indexers can answer, and
   * until something asks them the entry sits on the list saying nothing. The
   * sweep is that question — the same one the queue's own button runs — so it
   * is started here rather than waiting for the next scan.
   *
   * The disc goes first, and the order is the whole point. A release is scored
   * against the disc wherever one is known and against the bare rubric where
   * none is, and which of those a search did is frozen into the result it
   * stores. The scan's disc pass only walks films on the drive, so a want had
   * no disc to be scored against at all: it was searched blind, and stayed
   * blind for the day its check took to expire — even if you linked the disc
   * by hand a minute later. Fetching it here is what makes the first search
   * the right one.
   *
   * The whole sweep rather than this one film: a check younger than a day is
   * skipped, so on a swept library this amounts to searching the new want and
   * little else, and on an unswept one it fills the queue that was going to
   * need filling anyway. It reports on the rail like any other job, and can be
   * stopped there.
   *
   * Detached, so the button does not wait on someone else's server for either.
   * Films only — the wishlist's pass is film-only, and a series is sold a
   * season at a time with no single release to look up; see wishlistCandidates
   * and the scan's own split. Jackett unconnected, the disc is still worth
   * having: it is what the film's page and every later search read.
   */
  if (kind === "movie") {
    void (async () => {
      try {
        await fetchDisc(
          hit.id,
          hit.title,
          hit.year ? Number(hit.year) : undefined,
        );
      } catch {
        // A dead blu-ray.com is no reason not to search; the film is simply
        // scored on the rubric until a later scan or a hand-linked disc.
      }
      if (hasJackett()) startSweep();
    })();
  }

  refresh();
}

export async function removeWish(
  tmdbId: number,
  kind: WishKind = "movie",
): Promise<void> {
  removeFromWishlist(tmdbId, kind);
  refresh();
}

// ---------------------------------------------------------------------------
// Universal search
// ---------------------------------------------------------------------------

/**
 * A film or a show you have, as little of it as a search result needs: enough
 * to recognise it, and the route id to open it with.
 */
export type LibraryHit = {
  /** Route id — `/film/{id}` for a film, `/show/{id}` for a show. */
  id: string;
  kind: WishKind;
  title: string;
  year?: number;
  /** Artwork on the drive, and the TMDb path to fall back to; see app/art.tsx. */
  poster?: string;
  remotePoster?: string;
  artAt?: number;
  score: number;
  /** A film's standing. A show has none — it is an average of many. */
  status?: string;
  /** What the drive holds of a show, which is how much of it you have. */
  episodeCount?: number;
  seasonCount?: number;
};

/** A film or show you do not have, and whether it is already on the want list. */
export type DiscoverHit = SearchHit & {
  kind: WishKind;
  wishlisted: boolean;
};

export type UniversalResults = {
  /** What matched on the drive. */
  library: LibraryHit[];
  /** What matched at TMDb and is not on the drive. */
  discover: DiscoverHit[];
  /** Without TMDb there is no second half — the local half still works. */
  tmdb: boolean;
  /** TMDb answered with something other than results. */
  error?: string;
};

/** How many owned titles one search puts on screen before it stops listing. */
const LIBRARY_LIMIT = 12;

/**
 * One question asked of both halves of the app: what you have, and what you
 * could have.
 *
 * The two used to be separate searches on separate pages — the library filtered
 * itself, the wishlist searched TMDb — which meant knowing which of the two a
 * film was in before you could look for it. That is the one thing a search is
 * for finding out.
 *
 * Films and shows are searched together for the same reason. Which shelf a
 * title lives on is not something you should have to settle before typing it:
 * the answer names the kind, and the tile that comes back knows where to go.
 *
 * A TMDb hit the library already holds is not offered as something to acquire;
 * it is moved into the owned half, so a title appears once whichever side found
 * it. That also covers the case a plain title match misses — something filed
 * under a different name than the one you typed.
 */
export async function universalSearch(
  query: string,
): Promise<UniversalResults> {
  const term = query.trim();
  const tmdb = hasCredentials();
  if (!term) return { library: [], discover: [], tmdb };

  const needle = term.toLowerCase();
  const movies = getMovies();
  const shows = getShows();

  // Keyed by path so a film found by title and again by TMDb id is one entry.
  const owned = new Map<string, LibraryItem>();
  for (const movie of movies) {
    if (
      movie.title.toLowerCase().includes(needle) ||
      movie.fileName.toLowerCase().includes(needle)
    ) {
      owned.set(movie.path, movie);
    }
  }

  // The same, a show at a time rather than a file at a time: an episode's name
  // is not what you typed, and matching one would put a show on screen for
  // every episode it has.
  const ownedShows = new Map<string, Show>();
  for (const show of shows) {
    if (show.title.toLowerCase().includes(needle))
      ownedShows.set(show.key, show);
  }

  const byTmdbId = new Map<number, LibraryItem>();
  for (const movie of movies) {
    if (movie.tmdb?.id !== undefined) byTmdbId.set(movie.tmdb.id, movie);
  }

  const showsByTmdbId = new Map<number, Show>();
  for (const show of shows) {
    if (show.tmdb?.id !== undefined) showsByTmdbId.set(show.tmdb.id, show);
  }

  const discover: DiscoverHit[] = [];
  let error: string | undefined;

  if (tmdb) {
    // Both halves at once: two requests to TMDb answering one question, and
    // waiting for them in turn would make the second wait on the first for no
    // reason. One half failing does not take the other down with it.
    const [films, series] = await Promise.allSettled([
      searchTmdb(term),
      searchTmdbShows(term),
    ]);

    if (films.status === "fulfilled") {
      const wanted = getWishlistIds("movie");
      for (const hit of films.value) {
        const held = byTmdbId.get(hit.id);
        if (held) owned.set(held.path, held);
        else
          discover.push({
            ...hit,
            kind: "movie",
            wishlisted: wanted.has(hit.id),
          });
      }
    } else {
      error = reasonOf(films.reason);
    }

    if (series.status === "fulfilled") {
      const wanted = getWishlistIds("tv");
      for (const hit of series.value) {
        const held = showsByTmdbId.get(hit.id);
        if (held) ownedShows.set(held.key, held);
        else
          discover.push({ ...hit, kind: "tv", wishlisted: wanted.has(hit.id) });
      }
    } else {
      error = error ?? reasonOf(series.reason);
    }
  }

  // A title that starts with what you typed is more likely the one you meant
  // than one that merely contains it somewhere. Films before shows within that,
  // because the library is mostly films and the exceptions read as exceptions.
  const library: LibraryHit[] = [
    ...[...owned.values()].map((movie) => ({
      id: movieId(movie.path),
      kind: "movie" as const,
      title: movie.title,
      year: movie.year,
      poster: movie.poster,
      remotePoster: movie.art.poster,
      artAt: movie.artAt,
      score: movie.scores.overall,
      status: movie.status,
    })),
    ...[...ownedShows.values()].map((show) => ({
      id: showId(show.key),
      kind: "tv" as const,
      title: show.title,
      year: show.tmdb?.year,
      poster: show.poster,
      remotePoster: show.art.poster,
      artAt: show.artAt,
      score: show.score,
      episodeCount: show.episodeCount,
      seasonCount: show.seasons.length,
    })),
  ]
    .sort((a, b) => {
      const starts = (hit: LibraryHit) =>
        hit.title.toLowerCase().startsWith(needle) ? 0 : 1;
      const film = (hit: LibraryHit) => (hit.kind === "movie" ? 0 : 1);
      return (
        starts(a) - starts(b) ||
        film(a) - film(b) ||
        a.title.localeCompare(b.title)
      );
    })
    .slice(0, LIBRARY_LIMIT);

  return { library, discover, tmdb, error };
}

const reasonOf = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

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

/**
 * Records a ceiling you typed in, for a film Blu-ray.com has no page for.
 *
 * The last resort of the three: the search found nothing and there is no URL to
 * paste, so the specs themselves are the input. Everything downstream — the
 * score, the gap list, the release search — reads it as it would a scraped
 * release, which is the point of allowing it at all.
 */
export async function enterDisc(
  tmdbId: number,
  entry: DiscEntry,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const clean = readEntry(entry);
  if (!clean) return { ok: false, error: "Those specs did not make sense." };

  try {
    setEnteredDisc(tmdbId, clean);
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
 * The same four, for one season of a show. A series is sold a season at a
 * time, so the release being picked belongs to the season and not to the show.
 *
 * Each one re-derives, exactly as the film side does. The show page reads the
 * season's release live, but an episode's scores and gaps are not read live:
 * they were written into its `derived` row by the last pass, with the season's
 * ceiling already folded in. Without this the panel names the new release
 * while every score beneath it still answers to the old one.
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

/** The same, for a season no search can find a boxed set of. */
export async function enterSeasonDisc(
  showKey: string,
  season: number,
  entry: DiscEntry,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const clean = readEntry(entry);
  if (!clean) return { ok: false, error: "Those specs did not make sense." };

  try {
    setEnteredSeasonDisc(showKey, season, clean);
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

export async function unlinkSeasonDisc(
  showKey: string,
  season: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    clearSeasonDisc(showKey, season);
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
// Dolby Vision
// ---------------------------------------------------------------------------

/**
 * Reads every frame of one film's RPU. Minutes of disk, so it starts a job and
 * returns — the job stream (`/api/jobs`) is how the page follows it.
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
  if (getStripJob().status === "running") {
    return { ok: false, error: "Wait for the track removal to finish." };
  }

  // The duration is only used to turn elapsed time into a percentage.
  const movie = getLibrary().find((m) => m.path === moviePath);
  startFullDoviScan(moviePath, movie?.durationSec);
  return { ok: true };
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
 * Whether this film could be converted, asked without starting anything.
 *
 * What a full pass is for on a FEL: the pass answers a question, and a question
 * answered by a row quietly vanishing from a list is not answered. This gives
 * the page the same sentence `beginConvert` would have refused with, so a check
 * can say what it found rather than leaving the reader to infer it.
 */
export async function checkConvertible(
  moviePath: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!knownMoviePath(moviePath)) {
    return { ok: false, error: `Unknown file: ${moviePath}` };
  }
  const movie = getLibrary().find((m) => m.path === moviePath);
  if (!movie) return { ok: false, error: "Film is no longer in the library." };

  const refusal = convertRefusal(
    movie.dvProfile,
    classifyEnhancementLayer(movie.dovi, movie.hdr10),
  );
  return refusal ? { ok: false, error: refusal } : { ok: true };
}

/**
 * What the progress watcher measures against, read from the file we already
 * know about. The video's share is worked out from its bitrate because
 * MediaInfo reports no stream size for a Matroska track — near enough, and
 * only ever used to weight one part of a bar against another.
 */
const workingSizes = (movie: {
  sizeBytes: number;
  videoBitrateKbps?: number;
  durationSec?: number;
}) => ({
  sourceBytes: movie.sizeBytes,
  videoBytes:
    movie.videoBitrateKbps && movie.durationSec
      ? (movie.videoBitrateKbps * 1000 * movie.durationSec) / 8
      : undefined,
});

/**
 * Rewrites a Profile 7 file as Profile 8.1, in place, via dovi_convert.
 *
 * The only action in this app that changes a film rather than describing one,
 * so every precondition is checked here and not merely in the button: a page
 * can be stale, and this one is expensive to be wrong about.
 */
export async function beginConvert(
  moviePath: string,
): Promise<{ ok: true; job: ConvertJob } | { ok: false; error: string }> {
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
  if (getStripJob().status === "running") {
    return { ok: false, error: "Wait for the track removal to finish." };
  }
  // One original at a time. dovi_convert would rename the stripped file aside
  // as *its* original, leaving two files each claiming to be what the film was
  // before — and restoring either would silently undo the other.
  if (audioBackupBytes(moviePath) !== undefined) {
    return {
      ok: false,
      error:
        "An original from a track removal is still kept beside this film. Restore it or delete it before converting.",
    };
  }

  const movie = getLibrary().find((m) => m.path === moviePath);
  if (!movie) return { ok: false, error: "Film is no longer in the library." };

  // The same rule the button reads, so the two cannot disagree about a film.
  const refusal = convertRefusal(
    movie.dvProfile,
    classifyEnhancementLayer(movie.dovi, movie.hdr10),
  );
  if (refusal) return { ok: false, error: refusal };

  const job = startConvert(moviePath, workingSizes(movie));
  // The job itself, not an `ok` for the caller to build one from. A page that
  // hand-wrote the running state got to leave a field out of it — and the one
  // it left out was `percent`, which is the difference between the rail drawing
  // a bar and drawing only the name above where the bar should be.
  return { ok: true, job };
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
  if (getStripJob().status === "running") {
    return { ok: false, error: "A track removal is running — wait for it." };
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
  if (getStripJob().status === "running") {
    return { ok: false, error: "A track removal is running — wait for it." };
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

/**
 * Whether a conversion keeps the enhancement layer it discards.
 *
 * One setting rather than a question per film: the conversions this app starts
 * come from the Dolby Vision list as often as from a film's own page, and a
 * decision that only exists in a dialog is one that list would have to invent
 * an answer to.
 */
export async function getKeepEnhancementLayer(): Promise<boolean> {
  return keepsEnhancementLayer();
}

export async function setKeepEnhancementLayer(on: boolean): Promise<void> {
  setSetting(KEEP_EL_KEY, on ? "on" : "off");
  refresh();
}

/**
 * Rebuilds the Profile 7 file from the layer a conversion kept aside.
 *
 * Minutes of disk and a job of its own, unlike `restoreOriginal` — that one is
 * two renames because the original file is still there. This one has only the
 * enhancement layer, and has to put the film back together around it.
 */
export async function beginRebuildProfile7(
  moviePath: string,
): Promise<{ ok: true; job: ConvertJob } | { ok: false; error: string }> {
  if (!knownMoviePath(moviePath)) {
    return { ok: false, error: `Unknown file: ${moviePath}` };
  }
  if (getConvertJob().status === "running") {
    return { ok: false, error: "A conversion is already running." };
  }
  if (getDoviJob().status === "running") {
    return { ok: false, error: "Wait for the current full pass to finish." };
  }
  if (getStripJob().status === "running") {
    return { ok: false, error: "Wait for the track removal to finish." };
  }
  if (elArchiveBytes(moviePath) === undefined) {
    return {
      ok: false,
      error:
        "No enhancement layer is kept beside this film, so there is nothing to rebuild from.",
    };
  }
  // Rebuilding while the original is still there was refused here, on the
  // grounds that it spends an hour arriving at a worse copy of a file already
  // sitting beside it. True, and not this function's call to make: the film's
  // card offers both ways back now and says which is which, and the one reason
  // anybody wants the long way round is to watch it work *before* deleting the
  // file that makes it unnecessary. Nothing about it is unsafe — the rebuild
  // swaps through a name of its own and never touches the kept original.
  //
  // The audio removal's original is a different matter, and still refused —
  // the same rule converting has, for the same reason: two files each claiming
  // to be what the film was before, and restoring either silently undoes the
  // other.
  if (audioBackupBytes(moviePath) !== undefined) {
    return {
      ok: false,
      error:
        "An original from a track removal is still kept beside this film. Restore it or delete it before rebuilding.",
    };
  }

  const movie = getLibrary().find((m) => m.path === moviePath);
  if (!movie) return { ok: false, error: "Film is no longer in the library." };

  return { ok: true, job: startRebuild(moviePath, workingSizes(movie)) };
}

/**
 * Throws away the kept enhancement layer.
 *
 * The last step of a conversion for anyone reclaiming space, and on a film
 * whose original has already gone it is the point of no return: after this the
 * Profile 7 version exists only on the disc it came from.
 */
export async function discardEnhancementLayer(
  moviePath: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!knownMoviePath(moviePath)) {
    return { ok: false, error: `Unknown file: ${moviePath}` };
  }
  if (getConvertJob().status === "running") {
    return { ok: false, error: "A conversion is running — wait for it." };
  }
  if (getStripJob().status === "running") {
    return { ok: false, error: "A track removal is running — wait for it." };
  }

  try {
    await deleteElArchive(moviePath);
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
// Audio tracks
// ---------------------------------------------------------------------------

/**
 * Whether anything else is already rewriting this drive.
 *
 * Every one of these reads or writes the same film on the same disk, and two of
 * them at once means a tool describing a file another tool is replacing
 * underneath it. Named once because the four actions below all need it and all
 * need it to say the same thing.
 */
function otherWorkRunning(): string | undefined {
  if (getConvertJob().status === "running") {
    return "A Dolby Vision conversion is running — wait for it.";
  }
  if (getDoviJob().status === "running") {
    return "A full Dolby Vision pass is running — wait for it.";
  }
  return undefined;
}

/**
 * Removes audio tracks from a film, keeping the original beside it.
 *
 * Minutes of disk on a large remux, so it starts a job and returns — the job
 * stream is how the page follows it. The tracks are named by position among the
 * audio tracks alone; `resolvePlan` is what turns that into mkvmerge's own
 * numbering, and it re-reads the container before it will.
 */
export async function beginStripAudio(
  moviePath: string,
  removeOrdinals: number[],
  audioCount: number,
  numbers?: (number | undefined)[],
  freedBytes?: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!knownMoviePath(moviePath)) {
    return { ok: false, error: `Unknown file: ${moviePath}` };
  }
  if (getStripJob().status === "running") {
    return { ok: false, error: "A track removal is already running." };
  }
  const busy = otherWorkRunning();
  if (busy) return { ok: false, error: busy };

  if (!canStripAudio(moviePath)) {
    return {
      ok: false,
      error: "Only Matroska (.mkv) files can have tracks removed.",
    };
  }
  if (audioBackupBytes(moviePath) !== undefined) {
    return {
      ok: false,
      error:
        "An original is already kept beside this film. Restore it or delete it before removing more tracks.",
    };
  }
  // The reciprocal of the guard in `beginConvert`, for the same reason: two
  // files each claiming to be the original is a state nothing can undo cleanly.
  if (backupBytes(moviePath) !== undefined) {
    return {
      ok: false,
      error:
        "The pre-conversion original is still kept beside this film. Restore it or delete it before removing tracks.",
    };
  }
  if (removeOrdinals.length === 0) {
    return { ok: false, error: "No audio tracks were selected." };
  }

  startStripAudio(moviePath, {
    removeOrdinals,
    audioCount,
    numbers,
    freedBytes,
  });
  return { ok: true };
}

/** Stops a removal and sweeps up its working file. The film is untouched. */
export async function stopStripAudio(): Promise<StripJob> {
  return cancelStrip();
}

/**
 * Puts back the file that still holds every track, and deletes the stripped
 * one. Two renames and a re-read, so it runs inline rather than as a job.
 */
export async function restoreAudioOriginal(
  moviePath: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!knownMoviePath(moviePath)) {
    return { ok: false, error: `Unknown file: ${moviePath}` };
  }
  if (getStripJob().status === "running") {
    return { ok: false, error: "A track removal is running — wait for it." };
  }
  const busy = otherWorkRunning();
  if (busy) return { ok: false, error: busy };

  try {
    await restoreAudioTracks(moviePath);
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
 * Throws away the original that still holds the removed tracks. The one action
 * here that cannot be walked back, so it is kept separate from restoring.
 */
export async function discardAudioBackup(
  moviePath: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!knownMoviePath(moviePath)) {
    return { ok: false, error: `Unknown file: ${moviePath}` };
  }
  if (getStripJob().status === "running") {
    return { ok: false, error: "A track removal is running — wait for it." };
  }

  try {
    await deleteAudioBackup(moviePath);
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
 * Which audio languages to keep, and what there is to choose between.
 *
 * Both in one call because the panel needs both to draw a single row, and the
 * two are read from the same pass over the library.
 */
export async function getAudioLanguages(): Promise<{
  preference: AudioPreference;
  available: LibraryLanguage[];
}> {
  return { preference: getAudioPreference(), available: libraryLanguages() };
}

/**
 * Changes what the audio queue proposes removing.
 *
 * Nothing is rewritten by this and nothing is remembered about the last answer:
 * the queue is computed from the preference every time it is read, so a language
 * ticked here brings every track of it straight back off the list.
 */
export async function setAudioLanguages(
  preference: AudioPreference,
): Promise<{ ok: true }> {
  setAudioPreference(preference);
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Clearing up
// ---------------------------------------------------------------------------

/**
 * Deletes originals and leftovers the jobs page's cleanup list found.
 *
 * Takes several at once because a run of leftovers is one decision, not one per
 * file. Which paths are acceptable is decided by `deleteCleanupFiles` against
 * its own fresh scan, so nothing here has to trust the browser about what a
 * given path is.
 *
 * Both rewrites are refused while they run, and for the same reason the film's
 * own console refuses: a conversion's half-written output is a leftover by
 * every test this app can apply, and it is also the file the running tool is
 * still writing to.
 */
export async function discardCleanup(
  paths: string[],
): Promise<
  { ok: true; deleted: number; freed: number } | { ok: false; error: string }
> {
  if (getConvertJob().status === "running") {
    return { ok: false, error: "A conversion is running — wait for it." };
  }
  if (getStripJob().status === "running") {
    return { ok: false, error: "A track removal is running — wait for it." };
  }

  let result;
  try {
    result = await deleteCleanupFiles(paths);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Outside the catch, like every other action here: by this point the files
  // are gone, and a failure to repaint the page is not a failure to delete
  // them — reporting one as the other would have the list offering them again.
  refresh();
  return { ok: true, ...result };
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

/**
 * Writes an uploaded image into a folder, and forgets where the last one came
 * from.
 *
 * The tail of `chooseArtwork` with a different first step: once the file is on
 * the drive, an image of your own and an image of TMDb's are the same thing to
 * everything downstream, and the only difference is that this one has no
 * source to record.
 */
async function acceptUpload(
  dir: string,
  kind: "poster" | "fanart" | "logo",
  file: unknown,
  /**
   * Whether the library has to be re-derived after this. It does when the
   * folder holds a film or a show, and it does not when the folder is a
   * collection's — nothing on any shelf changed, and re-running every heuristic
   * over every probe to say so is seconds of work to reach the same numbers.
   */
  rederive = true,
): Promise<{ ok: true; saved: string } | { ok: false; error: string }> {
  // What arrives is whatever the caller put in the form. `Blob` covers the
  // `File` a picker yields and the one a drop yields, and is the only part of
  // it this needs — the bytes. The name it came with is not used: what the
  // file is called says nothing about what is inside it.
  if (!(file instanceof Blob) || file.size === 0) {
    return { ok: false, error: "No image was uploaded." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `That image is ${Math.round(file.size / 1024 / 1024)}MB; the limit is ${MAX_UPLOAD_BYTES / 1024 / 1024}MB.`,
    };
  }

  try {
    const saved = await saveUploadedArtwork(
      dir,
      kind,
      Buffer.from(await file.arrayBuffer()),
    );
    await reindexDir(dir);
    recordArtworkSource(dir, kind, null);
    if (rederive) deriveAll();
    refresh();
    return { ok: true, saved };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Writes an image you supplied into the film's own folder. */
export async function uploadArtwork(
  moviePath: string,
  kind: "poster" | "fanart" | "logo",
  form: FormData,
): Promise<{ ok: true; saved: string } | { ok: false; error: string }> {
  if (!knownMoviePath(moviePath)) {
    return { ok: false, error: `Unknown file: ${moviePath}` };
  }
  return acceptUpload(path.dirname(moviePath), kind, form.get("file"));
}

/** Writes an image you supplied into the show's own folder. */
export async function uploadShowArtwork(
  showKey: string,
  kind: "poster" | "fanart" | "logo",
  form: FormData,
): Promise<{ ok: true; saved: string } | { ok: false; error: string }> {
  const show = getShow(showKey);
  if (!show) return { ok: false, error: `Unknown show: ${showKey}` };
  return acceptUpload(show.dir, kind, form.get("file"));
}

// ---------------------------------------------------------------------------
// Collections of your own
// ---------------------------------------------------------------------------

/**
 * A name, as a set will actually be listed under: trimmed, and not empty.
 *
 * Collapsing the inner whitespace too, because a name is a heading and a
 * heading with two spaces in it is a typo that survives every time you read
 * past it.
 */
const NAME_LIMIT = 80;

function cleanName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, NAME_LIMIT);
}

/** Makes a set. The id comes back so the page can open the set you just made. */
export async function createCollection(
  name: string,
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const clean = cleanName(name);
  if (!clean) return { ok: false, error: "Give the collection a name." };

  const id = createCustomSet(clean);
  refresh();
  return { ok: true, id };
}

export async function renameCollection(
  id: number,
  name: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!customSetExists(id)) return { ok: false, error: "No such collection." };

  const clean = cleanName(name);
  if (!clean) return { ok: false, error: "Give the collection a name." };

  renameCustomSet(id, clean);
  refresh();
  return { ok: true };
}

/**
 * Throws a set away, and the backdrop with it. Nothing on any drive is touched:
 * a set names films, it does not hold them.
 */
export async function deleteCollection(
  id: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!customSetExists(id)) return { ok: false, error: "No such collection." };

  deleteCustomSet(id);
  // The folder after the rows, and forgiving of a folder that was never made:
  // a set given no backdrop has nothing on disk to remove.
  await rm(collectionDir(id), { recursive: true, force: true }).catch(() => {});

  refresh();
  return { ok: true };
}

/**
 * A film joining a set, named the way it was found.
 *
 * From the shelf it is a path, and everything else is read off the record this
 * app already holds. From TMDb it is the search hit itself, stored as it
 * stands — the same bargain the wishlist makes, and for the same reason: the
 * row has to draw with TMDb unreachable, so what it needs has to be in it.
 */
export type CollectionAdd =
  | { from: "library"; path: string }
  | {
      from: "tmdb";
      id: number;
      title: string;
      year?: number;
      posterPath?: string;
      overview?: string;
    };

/**
 * The key a membership row is stored under: TMDb's number wherever the film has
 * one, the path otherwise. Mirrors `filmKey` in lib/collections.ts, which reads
 * the same key back off a set that has been assembled.
 */
const memberKey = (tmdbId: number | undefined, filePath: string) =>
  tmdbId !== undefined ? `t${tmdbId}` : `p${filePath}`;

/**
 * A film off the shelf, as the row that will remember it.
 *
 * Everything a membership row holds is read from the record this app already
 * keeps, so the caller hands over a path and nothing else — which is also what
 * makes the path the only thing that has to be checked.
 */
function memberFromLibrary(moviePath: string): CollectionMember | string {
  // The same guard every write here keeps: not a security boundary — this app
  // is local-only — but it stops a malformed call writing a row about a file
  // nobody has scanned.
  if (!knownMoviePath(moviePath)) return `Unknown file: ${moviePath}`;

  const item = getMovies().find((movie) => movie.path === moviePath);
  if (!item) return `Not a film: ${moviePath}`;

  return {
    key: memberKey(item.tmdb?.id, item.path),
    tmdbId: item.tmdb?.id,
    // The path is kept only where there is no number to keep instead: it is the
    // weaker key of the two, and holding both would leave two answers to "which
    // film is this" the day one of them moves.
    path: item.tmdb?.id === undefined ? item.path : undefined,
    title: item.tmdb?.title ?? item.title,
    year: item.tmdb?.year ?? item.year,
    posterPath: item.tmdb?.posterPath,
    overview: item.tmdb?.overview,
  };
}

/**
 * A film named from either end, as the row that will remember it.
 *
 * A hit off TMDb is stored as it stands, and a film off the shelf is looked up
 * — so everything below can take one argument and stop caring which page it was
 * called from. An error comes back as the sentence to show, which only the
 * library branch can produce: a search hit is already everything the row needs.
 */
function memberFor(film: CollectionAdd): CollectionMember | string {
  if (film.from === "library") return memberFromLibrary(film.path);

  return {
    key: memberKey(film.id, ""),
    tmdbId: film.id,
    title: film.title,
    year: film.year,
    posterPath: film.posterPath,
    overview: film.overview,
  };
}

export async function addToCollection(
  id: number,
  film: CollectionAdd,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!customSetExists(id)) return { ok: false, error: "No such collection." };

  const member = memberFor(film);
  if (typeof member === "string") return { ok: false, error: member };
  addToCustomSet(id, member);

  refresh();
  return { ok: true };
}

/** Every set of your own, and whether this film is in it. */
export type FilmCollection = { id: number; name: string; holds: boolean };

/**
 * The sets a film could be in, answered from the film's own page.
 *
 * The collections page asks "what is in this set"; this is the same question
 * from the other end, which is the one you have when you are looking at a film
 * and thinking where it belongs. Cheap enough to ask on opening the menu: it is
 * one read of a table you wrote by hand.
 *
 * Asked of a film you do not own as readily as of one you do — a discover page
 * is where you meet a film you have decided belongs with the others, and a set
 * has held films nobody has since it was first written. The film is keyed by
 * TMDb's number either way, so the two ends agree without having to be told:
 * file it off TMDb today and the copy you rip next month arrives already in it.
 */
export async function collectionsForFilm(
  film: CollectionAdd,
): Promise<FilmCollection[]> {
  const member = memberFor(film);
  if (typeof member === "string") return [];

  return getCustomSetsHolding(member.key);
}

/**
 * Puts a film in a set or takes it out, said as the state you want rather than
 * as the act — which is what a row with a tick on it means when you click it.
 */
export async function setFilmInCollection(
  id: number,
  film: CollectionAdd,
  member: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!customSetExists(id)) return { ok: false, error: "No such collection." };

  const row = memberFor(film);
  if (typeof row === "string") return { ok: false, error: row };

  if (member) addToCustomSet(id, row);
  else removeFromCustomSet(id, row.key);

  refresh();
  return { ok: true };
}

export async function removeFromCollection(
  id: number,
  key: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!customSetExists(id)) return { ok: false, error: "No such collection." };

  removeFromCustomSet(id, key);
  refresh();
  return { ok: true };
}

/**
 * The set's own backdrop, uploaded.
 *
 * A TMDb set arrives with artwork; one of yours has nobody to get it from, so
 * this is the only way it gets a hero — and it is the same write a film's
 * backdrop takes, into a folder of the set's own. The folder is made here
 * rather than at creation: a set that never gets a picture should leave nothing
 * on disk behind it.
 */
export async function uploadCollectionBackdrop(
  id: number,
  form: FormData,
): Promise<{ ok: true; saved: string } | { ok: false; error: string }> {
  if (!customSetExists(id)) return { ok: false, error: "No such collection." };

  const dir = collectionDir(id);
  try {
    await mkdir(dir, { recursive: true });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Saved under the same name a film's backdrop takes, which is what lets the
  // art route, the thumbnail cache and the folder index all handle it without
  // being told a collection is a different kind of thing.
  return acceptUpload(dir, "fanart", form.get("file"), false);
}

/** A film a set could have in it, as the picker draws it. */
export type CollectionCandidate = {
  /** Its membership key, so the picker knows what is already in the set. */
  key: string;
  add: CollectionAdd;
  title: string;
  year?: number;
  /** Artwork on the drive, and the TMDb path to fall back to; see app/art.tsx. */
  poster?: string;
  posterPath?: string;
  artAt?: number;
  /** A film you hold has a standing; one you do not, does not. */
  score?: number;
};

export type CollectionSearch = {
  /** What matched on the drive. */
  library: CollectionCandidate[];
  /** What matched at TMDb and is not on the drive. */
  discover: CollectionCandidate[];
  /** Which of these are in the set already, by key. */
  inSet: string[];
  /** Without TMDb there is no second half — the local half still works. */
  tmdb: boolean;
  error?: string;
};

/** How many owned films one search offers before it stops listing. */
const PICKER_LIMIT = 12;

/**
 * What you could put in a set, asked of both halves of the app at once.
 *
 * The same question the universal search asks, narrowed to films — a collection
 * here is a set of films, the way TMDb's are — and answered with what a picker
 * needs rather than what a result page needs: the key membership is stored
 * under, and enough to draw a poster with a name under it.
 *
 * A TMDb hit the library already holds is moved into the owned half rather than
 * offered twice. It is one film either way, and the copy on the drive is the
 * one worth showing you.
 */
export async function searchFilmsForCollection(
  id: number,
  query: string,
): Promise<CollectionSearch> {
  const term = query.trim();
  const tmdb = hasCredentials();
  const inSet = [...customSetKeys(id)];
  if (!term) return { library: [], discover: [], inSet, tmdb };

  const needle = term.toLowerCase();
  const movies = getMovies();

  // Keyed by path so a film found by title and again by TMDb id is one entry.
  const owned = new Map<string, LibraryItem>();
  for (const movie of movies) {
    if (
      movie.title.toLowerCase().includes(needle) ||
      movie.fileName.toLowerCase().includes(needle)
    ) {
      owned.set(movie.path, movie);
    }
  }

  // Best copy per film: a film ripped twice is one film to a set, and the
  // better copy is the one its tile should carry.
  const byTmdbId = new Map<number, LibraryItem>();
  for (const movie of movies) {
    if (movie.tmdb?.id === undefined) continue;
    const best = byTmdbId.get(movie.tmdb.id);
    if (!best || movie.scores.overall > best.scores.overall) {
      byTmdbId.set(movie.tmdb.id, movie);
    }
  }

  const discover: CollectionCandidate[] = [];
  let error: string | undefined;

  if (tmdb) {
    try {
      for (const hit of await searchTmdb(term)) {
        const held = byTmdbId.get(hit.id);
        if (held) {
          owned.set(held.path, held);
          continue;
        }
        discover.push({
          key: memberKey(hit.id, ""),
          add: {
            from: "tmdb",
            id: hit.id,
            title: hit.title,
            year: hit.year ? Number(hit.year) : undefined,
            posterPath: hit.posterPath,
            overview: hit.overview,
          },
          title: hit.title,
          year: hit.year ? Number(hit.year) : undefined,
          posterPath: hit.posterPath,
        });
      }
    } catch (err) {
      // TMDb being unreachable is no reason to stop offering the shelf.
      error = err instanceof Error ? err.message : String(err);
    }
  }

  // A title that starts with what you typed is more likely the one you meant
  // than one that merely contains it somewhere.
  const library = [...owned.values()]
    .map((movie) => ({
      key: memberKey(movie.tmdb?.id, movie.path),
      add: { from: "library" as const, path: movie.path },
      title: movie.tmdb?.title ?? movie.title,
      year: movie.tmdb?.year ?? movie.year,
      poster: movie.poster,
      posterPath: movie.art.poster,
      artAt: movie.artAt,
      score: movie.scores.overall,
    }))
    .sort((a, b) => {
      const starts = (hit: CollectionCandidate) =>
        hit.title.toLowerCase().startsWith(needle) ? 0 : 1;
      return starts(a) - starts(b) || a.title.localeCompare(b.title);
    })
    .slice(0, PICKER_LIMIT);

  return { library, discover, inSet, tmdb, error };
}

// ---------------------------------------------------------------------------
// Upgrade sweep
// ---------------------------------------------------------------------------

/**
 * There is no start here. A sweep begins where a scan ends — see
 * sweepAfterScan in lib/scanner.ts — and a want being added starts one too, so
 * nothing in the browser has to ask for it. Stopping one is still yours: the
 * rail's cancel is the only control the sweep has left.
 */
export async function stopUpgradeSweep(): Promise<SweepJob> {
  return cancelSweep();
}

/*
 * There was a `retryUpgradeSweep` here — a resume for a sweep that gave up,
 * called by a notice at the head of the queue page. The notice is gone, and
 * with it the only thing that called this: `rescanUpgradeQueue` below is the
 * page's way to start another pass, and it is the more useful of the two
 * anyway, since it does not skip what the failed pass already got through.
 */

/**
 * The other way in: check it all again, now.
 *
 * A sweep skips anything checked in the last day, which is what keeps a scan an
 * hour after a scan from costing four hundred searches. Read from the queue
 * page, though, that window is a wall: every row says how long ago it was
 * checked, and the natural response to "checked 20 h ago" — when a release you
 * are waiting for might have landed since — is to ask again. Nothing on the
 * page could, and waiting out the rest of the day is not an answer.
 *
 * So this is the sweep with the freshness rule turned off. It is deliberately
 * not the same button as the one that fills the queue by itself: that one runs
 * unasked and should stay cheap. This one was asked for, and the asking is what
 * pays for the searches.
 *
 * Reached from the Scan pill at the end of the queue page's listing bar — see
 * app/upgrades/rescan-button.tsx — which is the page's only way to ask for
 * anything. Both halves of the queue are refreshed by one press: `startSweep`
 * passes the force through to the wishlist pass as well.
 */
export async function rescanUpgradeQueue(): Promise<SweepJob> {
  return sweep(true);
}

/** Both of the above, which differ only in whether a recent check counts. */
function sweep(force: boolean): SweepJob {
  if (!hasJackett()) {
    return {
      ...getSweepJob(),
      status: "error",
      error:
        "Jackett is not set up. Add its URL and API key on the Settings page.",
    };
  }
  return startSweep({ force });
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

// ---------------------------------------------------------------------------
// The queue's bar
// ---------------------------------------------------------------------------

export async function getQueueRules(): Promise<QueueRules> {
  return readQueueRules();
}

/**
 * Takes whichever half changed. The queue is filtered as it is read, so this
 * needs nothing more than a refresh to show its effect.
 */
export async function setQueueRules(rules: Partial<QueueRules>): Promise<void> {
  writeQueueRules(rules);
  refresh();
}

// ---------------------------------------------------------------------------
// qBittorrent
// ---------------------------------------------------------------------------

export async function getQbStatus(): Promise<{
  configured: boolean;
  url?: string;
  managed: boolean;
  stopSeeding: boolean;
}> {
  const config = getQbConfig();
  return {
    configured: Boolean(config),
    url: config?.url,
    managed: Boolean(process.env.QBITTORRENT_URL),
    stopSeeding: getStopSeeding(),
  };
}

export async function setQbStopSeeding(enabled: boolean): Promise<void> {
  setStopSeeding(enabled);
  refresh();
}

/** Saves only after a live check, so a typo cannot be stored as working. */
export async function saveQb(
  url: string,
  username: string,
  password: string,
): Promise<{ ok: true; version: string } | { ok: false; error: string }> {
  if (!/^https?:\/\//i.test(url.trim())) {
    return {
      ok: false,
      error: "Enter the full address, starting http:// or https://",
    };
  }

  const previous = getQbConfig();
  setQbConfig({
    url,
    username: username.trim() || undefined,
    password: password || undefined,
  });

  try {
    const version = await checkQb();
    refresh();
    return { ok: true, version };
  } catch (err) {
    // Put back whatever worked before rather than leaving the app pointed at
    // an address that does not answer.
    if (previous) setQbConfig(previous);
    else clearQbConfig();

    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function disconnectQb(): Promise<void> {
  clearQbConfig();
  refresh();
}

/**
 * Hands a release to qBittorrent, with where to put it and which film it is
 * for — the button that sends knows both, and nothing downstream can recover
 * either from a bare magnet.
 */
export async function sendToQb(
  magnet: string,
  savePath?: string,
  film?: FilmContext,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await addMagnet(magnet, { savePath, film });
    // The queue drops what is being fetched, and the row this was sent from is
    // on screen at this moment — so the page it left is re-read now rather
    // than on whatever navigation happens to come next.
    refresh();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

const qbResult = async (
  run: () => Promise<void>,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  try {
    await run();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

export async function qbPause(hash: string) {
  return qbResult(() => pauseTorrent(hash));
}

export async function qbResume(hash: string) {
  return qbResult(() => resumeTorrent(hash));
}

/**
 * `deleteFiles` follows the caller: junk for a cancel, kept for a finish.
 *
 * Refreshed after, because a cancelled fetch is a film worth offering again:
 * the queue row that was hidden while this was downloading comes back on the
 * same click that stopped it.
 */
export async function qbRemove(hash: string, deleteFiles: boolean) {
  const result = await qbResult(() => removeTorrent(hash, deleteFiles));
  if (result.ok) refresh();
  return result;
}

/** The transfer list's poll: the log wearing qBittorrent's present tense. */
export async function listDownloadLog(): Promise<DownloadEntry[]> {
  return getDownloadLog();
}

export async function forgetDownloadEntry(hash: string): Promise<void> {
  forgetDownload(hash);
  // The log is what hides a queue row; forgetting the row un-hides the film.
  refresh();
}

/**
 * What the settings page needs to know, which is never the key itself.
 *
 * The environment is reported as a fallback rather than as a lock: `env` says
 * there is one to go back to, `overriding` says something saved here is being
 * used instead of it.
 */
export async function getJackettStatus(): Promise<{
  configured: boolean;
  url?: string;
  env: boolean;
  overriding: boolean;
}> {
  const config = getJackettConfig();
  const env = hasEnvJackett();
  return {
    configured: Boolean(config),
    url: config?.url,
    env,
    overriding: env && Boolean(getStoredJackettConfig()),
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

  // The stored half only: putting the environment's values back would store
  // them, turning a failed save into a pin.
  const previous = getStoredJackettConfig();
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

/**
 * Drops what was saved here. Where the environment names a config, that is
 * what the app goes back to rather than to nothing — which is why the button
 * reads "Use the environment" in that case.
 */
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
  /** A hand-edited search phrase, replacing the constructed one. */
  query?: string,
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
    const search = await findUpgrades(
      {
        kind: "movie",
        title: movie.tmdb?.title ?? movie.title,
        year: movie.tmdb?.year ?? movie.year,
        imdbId: movie.imdbId,
        runtimeMinutes:
          movie.tmdb?.runtimeMinutes ??
          (movie.durationSec ? Math.round(movie.durationSec / 60) : undefined),
        currentScore: current,
        disc,
      },
      { term: query },
    );
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
  /** A hand-edited search phrase, replacing the constructed one. */
  query?: string,
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
      (movie.release_date ? Number(movie.release_date.slice(0, 4)) : undefined);
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
    const search = await findUpgrades(
      {
        kind: "movie",
        title,
        year,
        imdbId,
        runtimeMinutes,
        disc,
      },
      { term: query },
    );
    return { ok: true, search };
  } catch (err) {
    return failed(err);
  }
}

/**
 * Releases for a series nobody here owns — a want list entry, or a show found
 * in the search and not on the drive.
 *
 * The whole series at once, which is the only question that can be asked of a
 * show you have none of: a season search needs a season, and picking one for
 * you would be inventing the question. Complete-series packs are what the
 * indexers answer with, and a season landing among them is still a season.
 */
export async function findReleasesForShow(
  tmdbId: number,
  /** A hand-edited search phrase, replacing the constructed one. */
  query?: string,
): Promise<UpgradeResponse> {
  const entry = getWishlist().find(
    (w) => w.kind === "tv" && w.tmdbId === tmdbId,
  );

  // As with a wanted film: the list is consulted but not required, and TMDb
  // fills in whatever it does not carry. Usually cached, so usually free.
  let title = entry?.title;
  let year = entry?.year;
  try {
    const show = await getTvShow(tmdbId);
    title = title ?? show.name;
    year =
      year ??
      (show.first_air_date
        ? Number(show.first_air_date.slice(0, 4))
        : undefined);
  } catch {
    // Searchable without the year; only the title filter gets looser.
  }

  if (!title) return { ok: false, error: "Nothing known about this show." };

  try {
    // No disc and no copy on the drive, so the scores are the rubric's own —
    // there is nothing here to be a fraction of or an improvement on.
    const search = await findUpgrades(
      { kind: "tv", title, year },
      { term: query },
    );
    return { ok: true, search };
  } catch (err) {
    return failed(err);
  }
}

/**
 * The same for one season, and for one episode, of a series nobody here owns.
 *
 * Everything the library's own season and episode searches lean on — the files
 * held, their runtimes, the disc set the season was released on — comes from
 * the drive, and none of it exists here. What is left is the series' name and
 * the numbers, which is exactly what an indexer is asked for anyway.
 */
async function tvTargetFor(
  tmdbId: number,
): Promise<{ title?: string; year?: number; runtimeMinutes?: number }> {
  const entry = getWishlist().find(
    (w) => w.kind === "tv" && w.tmdbId === tmdbId,
  );

  try {
    const show = await getTvShow(tmdbId);
    return {
      title: entry?.title ?? show.name,
      year:
        entry?.year ??
        (show.first_air_date
          ? Number(show.first_air_date.slice(0, 4))
          : undefined),
      // TMDb's own figure for how long an episode runs, without which every
      // encode among the results scores as "bitrate unknown".
      runtimeMinutes: show.episode_run_time?.[0],
    };
  } catch {
    return { title: entry?.title, year: entry?.year };
  }
}

export async function findReleasesForTmdbSeason(
  tmdbId: number,
  season: number,
  /** A hand-edited search phrase, replacing the constructed one. */
  query?: string,
): Promise<UpgradeResponse> {
  const target = await tvTargetFor(tmdbId);
  if (!target.title)
    return { ok: false, error: "Nothing known about this show." };

  try {
    const search = await findUpgrades(
      { kind: "tv", title: target.title, year: target.year, season },
      { term: query },
    );
    return { ok: true, search };
  } catch (err) {
    return failed(err);
  }
}

export async function findReleasesForTmdbEpisode(
  tmdbId: number,
  season: number,
  episode: number,
  /** A hand-edited search phrase, replacing the constructed one. */
  query?: string,
): Promise<UpgradeResponse> {
  const target = await tvTargetFor(tmdbId);
  if (!target.title)
    return { ok: false, error: "Nothing known about this show." };

  try {
    const search = await findUpgrades(
      {
        kind: "tv",
        title: target.title,
        year: target.year,
        season,
        episode,
        runtimeMinutes: target.runtimeMinutes,
      },
      { term: query },
    );
    return { ok: true, search };
  } catch (err) {
    return failed(err);
  }
}

/**
 * One season's episodes, for the list on a series nobody here owns. Read from
 * TMDb on demand — the page asks for the season being looked at and no other.
 */
export async function listDiscoverEpisodes(
  tmdbId: number,
  season: number,
): Promise<
  { ok: true; episodes: DiscoverEpisode[] } | { ok: false; error: string }
> {
  try {
    return { ok: true, episodes: await getDiscoverEpisodes(tmdbId, season) };
  } catch (err) {
    return { ok: false, error: reasonOf(err) };
  }
}

/** Releases for one season — both season packs and individual episodes. */
export async function findUpgradesForSeason(
  showKey: string,
  season: number,
  /** A hand-edited search phrase, replacing the constructed one. */
  query?: string,
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
    const search = await findUpgrades(
      {
        kind: "tv",
        title: show.tmdb?.name ?? show.title,
        season,
        runtimeMinutes,
        currentScore: current,
        disc,
      },
      { term: query },
    );
    return { ok: true, search, current };
  } catch (err) {
    return failed(err);
  }
}

/**
 * Releases for one episode: an upgrade search when the episode is held, a
 * plain search when it is a gap.
 *
 * A held episode's own file is the thing to beat, so results are ranked
 * against its score. A missing one has no copy, so they stand against the
 * season's disc set where one is linked — the same yardstick the held
 * episodes are scored on — and on the bare rubric where none is.
 */
export async function findReleasesForEpisode(
  showKey: string,
  season: number,
  episode: number,
  /** A hand-edited search phrase, replacing the constructed one. */
  query?: string,
): Promise<UpgradeResponse> {
  const show = getShow(showKey);
  if (!show) return { ok: false, error: "Unknown show." };

  const held = show.seasons.find((s) => s.number === season);

  // The copy of this episode, when there is one — including a double-episode
  // file that covers the number asked for.
  const have = held?.episodes.find(
    (e) =>
      e.number === episode ||
      (e.numberEnd !== undefined &&
        episode >= e.number &&
        episode <= e.numberEnd),
  );

  // The episode's own file times itself; a gap borrows the held episodes'
  // average — episodes of a season run close enough for a bitrate to be
  // judged from it.
  const durations = (held?.episodes ?? [])
    .map((e) => e.item.durationSec)
    .filter((d): d is number => Boolean(d));
  const runtimeMinutes = have?.item.durationSec
    ? Math.round(have.item.durationSec / 60)
    : durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 60)
      : undefined;

  const disc = getSeasonDisc(showKey, season);
  const current = have?.item.scores.overall;

  try {
    const search = await findUpgrades(
      {
        kind: "tv",
        title: show.tmdb?.name ?? show.title,
        season,
        episode,
        runtimeMinutes,
        currentScore: current,
        disc,
      },
      { term: query },
    );
    return { ok: true, search, current };
  } catch (err) {
    return failed(err);
  }
}
