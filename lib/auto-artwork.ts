import "server-only";

import path from "node:path";

import {
  recordArtworkSource,
  reindexDir,
  saveArtwork,
  SAVED_NAMES,
} from "./artwork";
import { imageUrl } from "./image-url";
import { getMovies } from "./library";
import { getShows } from "./shows";
import { getImages, getTvImages, type TmdbImage } from "./tmdb";

type Kind = keyof typeof SAVED_NAMES;

const KINDS = Object.keys(SAVED_NAMES) as Kind[];

type Target = {
  dir: string;
  title: string;
  media: "movie" | "tv";
  tmdbId: number;
  missing: Kind[];
};

export type AutoArtworkProgress = {
  /** Entries — films and shows — that are short of at least one image. */
  total: number;
  done: number;
  /** Images actually written to disk, across every entry. */
  saved: number;
  current?: string;
};

/**
 * TMDb sorts each list by vote, so the first entry is its best one. Logos can
 * be SVGs, which cannot be saved into the raster file the library expects.
 */
const firstUsable = (list: TmdbImage[] | undefined, kind: Kind) =>
  (list ?? []).find((i) => kind !== "logo" || !i.file_path.endsWith(".svg"))
    ?.file_path;

/**
 * Fills the artwork gaps a scan turned up: every matched film or show still
 * without a poster, fanart or logo gets TMDb's top image for each missing
 * kind, saved into its own folder exactly as if it had been picked by hand.
 *
 * Only fills what is absent — anything already on disk, downloaded or yours,
 * is left alone.
 */
export async function downloadMissingArtwork(
  options: { onProgress?: (p: AutoArtworkProgress) => void } = {},
): Promise<AutoArtworkProgress> {
  const targets: Target[] = [];

  // Artwork is a directory-level fact, so a folder holding several different
  // films (a flat library) is skipped: whichever film's poster landed there
  // would be shown for all of them. Several files of the *same* film — two
  // cuts side by side — share one identity and are safe.
  const byDir = new Map<string, ReturnType<typeof getMovies>>();
  for (const movie of getMovies()) {
    const dir = path.dirname(movie.path);
    byDir.set(dir, [...(byDir.get(dir) ?? []), movie]);
  }

  for (const [dir, movies] of byDir) {
    const first = movies[0];
    if (!first.tmdb?.id) continue;
    if (!movies.every((m) => m.tmdb?.id === first.tmdb!.id)) continue;

    const missing = KINDS.filter((kind) => !first[kind]);
    if (missing.length === 0) continue;

    targets.push({
      dir,
      title: first.tmdb.title,
      media: "movie",
      tmdbId: first.tmdb.id,
      missing,
    });
  }

  for (const show of getShows()) {
    if (!show.tmdb) continue;
    const missing = KINDS.filter((kind) => !show[kind]);
    if (missing.length === 0) continue;

    targets.push({
      dir: show.dir,
      title: show.tmdb.name,
      media: "tv",
      tmdbId: show.tmdb.id,
      missing,
    });
  }

  const progress: AutoArtworkProgress = {
    total: targets.length,
    done: 0,
    saved: 0,
  };
  options.onProgress?.({ ...progress });

  for (const target of targets) {
    progress.current = target.title;
    options.onProgress?.({ ...progress });

    try {
      const images = await (target.media === "tv"
        ? getTvImages(target.tmdbId)
        : getImages(target.tmdbId));

      const pick: Record<Kind, string | undefined> = {
        poster: firstUsable(images.posters, "poster"),
        fanart: firstUsable(images.backdrops, "fanart"),
        logo: firstUsable(images.logos, "logo"),
      };

      let wrote = false;
      for (const kind of target.missing) {
        const filePath = pick[kind];
        if (!filePath) continue;
        await saveArtwork(target.dir, kind, imageUrl(filePath, "original"));
        recordArtworkSource(target.dir, kind, filePath);
        progress.saved += 1;
        wrote = true;
      }
      if (wrote) await reindexDir(target.dir);
    } catch {
      // One entry failing — a read-only folder, the image CDN hiccuping —
      // should not stop the rest of the pass.
    }

    progress.done += 1;
    options.onProgress?.({ ...progress });
  }

  progress.current = undefined;
  return progress;
}
