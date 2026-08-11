import "server-only";

import { readdirSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";

import {
  canStripAudio,
  originalUnknown,
  removableTracks,
  savingsOf,
} from "./audio-plan";
import { getAudioPreference } from "./audio-prefs";
import { audioBackupBytes, audioBackupPathFor } from "./audio-strip";
import { artefactOf, isSidecar, sidecarFor, stemOf } from "./cleanup-names";
import type { CleanupKind } from "./cleanup-names";
import { backupBytes, backupPathFor, filePresent } from "./convert";
import { db, getSetting } from "./db";
import { classifyEnhancementLayer } from "./derive";
import type { ElVerdict, EpisodeInfo } from "./derive";
import { recordDiscardedBackup } from "./job-history";
import { getLibrary } from "./library";
import type { LibraryItem } from "./library";
import { reachabilityReader } from "./reach";
import { getShows } from "./shows";

/**
 * The work the library can do to itself, listed the way the download queue is.
 *
 * Both consoles on a film's page answer the same question one film at a time —
 * is there something worth doing to this file — and neither has any way of
 * being asked across the whole library. So a Profile 7 rip sits unconverted
 * because nobody opened its page, and eight gigabytes of Hungarian DTS-HD stay
 * on the drive for the same reason.
 *
 * This is that question asked of everything at once. Nothing here starts a job:
 * a row is a film worth opening, and the console on its page is still what does
 * the deciding — the rewrite is the same 90 GB either way, and the page is
 * where the caveats live.
 *
 * Both lists are read straight out of the derived rows the last scan wrote,
 * plus one stat per candidate. Neither spawns a tool.
 *
 * The module keeps the queue's name because that is the page these were written
 * for and read on. They are drawn on the jobs page now, as the pending half of
 * its tabs — above the job running on one of these films and the log of the
 * ones that ran. The shape of the answer did not change with the address.
 */

/** What both lists need to draw a row and open the film behind it. */
export type TaskFilm = {
  path: string;
  kind: "movie" | "episode";
  /** The show's title on an episode, the film's own on a film. */
  title: string;
  year?: number;
  /** "S01E02" and the episode's own title, where a file is an episode. */
  episode?: string;
  fileName: string;
  poster?: string;
  /** The TMDb path behind it, for when the drive holding the file is away. */
  posterRemote?: string;
  artAt?: number;
  sizeBytes: number;
  /** When the file first appeared in the library, for "newest first". */
  addedAt: number;
  /**
   * The drive this file lives on is not plugged in.
   *
   * The row is still here, because every fact on it came out of the database
   * and none of them stopped being true — the file is Profile 7 whether or not
   * you can reach it today, and a backlog that empties itself when a volume is
   * unmounted is a backlog reporting on the cable rather than on the library.
   * What it cannot do is be acted on, so the buttons are off.
   */
  offline: boolean;
};

export type DoviTask = TaskFilm & {
  /** What the enhancement layer is, once a pass has read one. */
  el?: ElVerdict["kind"];
  /** True when every frame has been read, which is what converting waits for. */
  scanned: boolean;
};

export type AudioTask = TaskFilm & {
  /** What removing the foreign-language tracks would free. */
  freedBytes: number;
  /** True when any of that total is bitrate × runtime rather than counted. */
  estimated: boolean;
  removing: number;
  keeping: number;
  /** The language tags going, in the order the file lists them. */
  languages: string[];
};

const pad = (n: number) => String(n).padStart(2, "0");

const episodeLabel = (e: EpisodeInfo) => {
  const code = `S${pad(e.season)}E${pad(e.episode)}${
    e.episodeEnd ? `-E${pad(e.episodeEnd)}` : ""
  }`;
  return e.episodeTitle ? `${code} · ${e.episodeTitle}` : code;
};

/** What an episode inherits from the show it belongs to. */
type Artwork = {
  poster?: string;
  posterRemote?: string;
  artAt?: number;
  /** The language the series was made in — an episode has no record of its own. */
  originalLanguage?: string;
};

/**
 * What an episode has to borrow from its show.
 *
 * Two things, and for the same reason: they are facts about a series, and a
 * file is one episode of one. Artwork sits a level up from the file, beside the
 * season folders — it is the *show* that was ever given a poster, and nobody
 * downloads one per episode. The original language is on the series record for
 * the same reason there is no per-episode record to put it on. Read from the
 * file's own row an episode has neither, which is what left every episode here
 * as a grey rectangle, and would have dropped every one of them out of the
 * audio queue the moment it started asking what a film was made in.
 *
 * Built lazily and only once, by the one thing in the app that already groups
 * files into shows: a list with no episodes in it never asks.
 */
function showFacts(): Map<string, Artwork> {
  const byEpisode = new Map<string, Artwork>();

  for (const show of getShows()) {
    const art: Artwork = {
      poster: show.poster,
      posterRemote: show.art.poster,
      artAt: show.artAt,
      originalLanguage: show.tmdb?.originalLanguage,
    };
    for (const season of show.seasons) {
      for (const episode of season.episodes) {
        byEpisode.set(episode.item.path, art);
      }
    }
  }

  return byEpisode;
}

/** Resolves what a file borrows from its show, the first time one needs it. */
function artworkReader() {
  let shows: Map<string, Artwork> | undefined;
  return (item: LibraryItem): Artwork =>
    item.kind === "episode"
      ? ((shows ??= showFacts()).get(item.path) ?? {})
      : {
          poster: item.poster,
          posterRemote: item.art.poster,
          artAt: item.artAt,
          originalLanguage: item.tmdb?.originalLanguage,
        };
}

const filmOf = (
  item: LibraryItem,
  art: Artwork,
  offline: boolean,
): TaskFilm => ({
  path: item.path,
  kind: item.kind,
  // An episode's own title belongs beside its number, not where a name goes:
  // a list of eight rows all called "The One Where…" says nothing about which
  // show is being worked on.
  title: item.episode ? item.episode.showTitle : item.title,
  year: item.episode ? undefined : item.year,
  episode: item.episode ? episodeLabel(item.episode) : undefined,
  fileName: item.fileName,
  poster: art.poster,
  posterRemote: art.posterRemote,
  artAt: art.artAt,
  sizeBytes: item.sizeBytes,
  addedAt: item.addedAt,
  offline,
});

/**
 * Both lists, from one read of the library.
 *
 * Together rather than a function each because the two tabs are drawn on the
 * same request — the counts on the switch are the reason to open the tab you
 * are not on, so both are always wanted — and reading the library means parsing
 * a derived row per film. Once is enough.
 *
 * ---------------------------------------------------------------------------
 * Dolby Vision: every Profile 7 file worth converting to 8.1.
 *
 * The same verdict the film's own console reaches, and deliberately so: a
 * complex FEL is left out because converting it clips highlights the base layer
 * does not hold, and a film with the original still beside it is out because
 * its conversion has already happened and is waiting on a decision about the
 * backup rather than on this list.
 *
 * A film nothing has read yet stays in. The console starts with a full pass
 * when one is missing and re-checks the verdict against what that pass finds,
 * so listing it is an invitation to read it, not a promise about what the read
 * will say.
 *
 * Biggest first. Nothing here saves space — every one of these is the same
 * improvement, a file players can actually read — so the sort is by the size
 * of the job, which is the one thing that varies.
 *
 * ---------------------------------------------------------------------------
 * Audio: every file carrying audio in languages you have not asked to keep, and
 * what dropping those tracks would free.
 *
 * The proposal is your own preference applied across the library — the
 * languages set in Settings, plus the film's own language where "original" is
 * among them. It used to be "everything that is not English", which is one
 * household's answer written into the source; the queue asks the setting now,
 * on every read, so ticking a language takes its tracks off the list without
 * anything being rescanned.
 *
 * An untagged track is not evidence of anything — on an English-language
 * release it is usually the English one — so it is never counted as removable,
 * which also means a file whose tracks are all untagged never appears here.
 *
 * Two files are left out rather than listed. One whose every track would go:
 * the proposal would silence it, and a row promising eleven gigabytes that the
 * console will refuse to free is worse than no row. And, when the original
 * language is among the languages kept, one that TMDb has never matched —
 * there is no telling which of its tracks is the performance, and a rewrite is
 * not the place to guess.
 *
 * Sorted by what is freed, which is the whole reason to read the list.
 */
/**
 * The library is a parameter with a default rather than a call, because a page
 * that asks several of these questions at once should not read the table once
 * per question — four hundred rows of JSON parsed five times is four hundred
 * rows of JSON parsed four times too many. Every existing caller passes
 * nothing and behaves exactly as before.
 *
 * Deliberately not React `cache()`, which would look like the same fix: the
 * scanner calls these across its phases, after `deriveAll` has rewritten the
 * rows, and every phase has to see what the last one wrote.
 */
export function libraryTasks(items: LibraryItem[] = getLibrary()): {
  dovi: DoviTask[];
  audio: AudioTask[];
} {
  const dovi: DoviTask[] = [];
  const audio: AudioTask[] = [];
  const artworkOf = artworkReader();
  // Read once for the whole pass rather than per film: it is one setting, and
  // a queue built half under one answer and half under another would be a
  // queue nobody could act on.
  const preference = getAudioPreference();

  // One stat per folder, not per film. See `lib/reach.ts` for why that is the
  // only affordable way to ask this of a whole library.
  const plugged = reachabilityReader();
  // What the last readable pass found lying beside the films, built only if
  // something on this list turns out to be away.
  let remembered: Set<string> | undefined;
  const rememberedBackup = (backup: string) =>
    (remembered ??= knownBackups()).has(backup);

  for (const item of items) {
    const here = plugged(item.path);

    // Whether the file is where the row says, asked once and only of a film
    // that has already passed a cheap test — a library is thousands of rows,
    // and a stat per row is work nobody asked for. Never asked at all of a
    // film whose drive is away: that stat is the one that hangs.
    let found: boolean | undefined;
    const present = () => (found ??= filePresent(item.path));

    /**
     * Whether the rewrite has already happened.
     *
     * A film with its original still beside it is out of the queue — its
     * conversion is done and waiting on a decision about the backup, which is
     * the cleanup list's business rather than this one's. With the drive
     * plugged in that is a stat. With the drive away it is the last pass that
     * could read the folder, which recorded exactly this: the backups it
     * found, kept in `cleanup_files` for the two questions that need them.
     */
    const done = (backup: string, bytes: () => number | undefined) =>
      here ? !present() || bytes() !== undefined : rememberedBackup(backup);

    // A film's own, or the series' where the file is one episode of one.
    const facts = artworkOf(item);

    const el =
      item.dvProfile === 7
        ? classifyEnhancementLayer(item.dovi, item.hdr10)
        : undefined;
    if (
      item.dvProfile === 7 &&
      el?.kind !== "complex-fel" &&
      !done(backupPathFor(item.path), () => backupBytes(item.path))
    ) {
      dovi.push({
        ...filmOf(item, facts, !here),
        el: el?.kind,
        scanned: item.dovi?.depth === "full",
      });
    }

    const original = facts.originalLanguage;
    if (
      canStripAudio(item.path) &&
      item.audio.length > 1 &&
      !originalUnknown(preference, original)
    ) {
      const unwanted = removableTracks(item.audio, preference, original);

      if (unwanted.length > 0) {
        const { bytes, estimated } = savingsOf(item.audio, unwanted);
        // Sized by neither count nor bitrate: there is nothing to rank it by
        // and nothing to promise, so it waits for the file's own page.
        // Already stripped once, and what is left is what was kept on purpose.
        if (
          bytes > 0 &&
          !done(audioBackupPathFor(item.path), () =>
            audioBackupBytes(item.path),
          )
        ) {
          audio.push({
            ...filmOf(item, facts, !here),
            freedBytes: bytes,
            estimated,
            removing: unwanted.length,
            keeping: item.audio.length - unwanted.length,
            languages: unwanted.map(
              (ordinal) => item.audio[ordinal].language as string,
            ),
          });
        }
      }
    }
  }

  return {
    dovi: dovi.sort((a, b) => b.sizeBytes - a.sizeBytes),
    audio: audio.sort((a, b) => b.freedBytes - a.freedBytes),
  };
}

// ---------------------------------------------------------------------------
// What is left lying beside the films
// ---------------------------------------------------------------------------

/**
 * Everything this app has written beside a film and not taken away again.
 *
 * Two kinds, and they are not the same decision. An *original* is the copy a
 * rewrite set aside so it could be undone — it is doing a job until you decide
 * it is not, and deleting one is the single irreversible thing this app can do.
 * A *leftover* is the half-built output of a job that was cancelled or died,
 * and it is doing nothing at all: the tools clean up after themselves when they
 * are allowed to finish, so anything here outlived a crash or a kill.
 *
 * Every name is one this app or the tools it drives write, so the list is found
 * by reading each folder the library lives in rather than by walking the drive:
 * one directory read per folder, and a stat only on what matches.
 */

/** Where a conversion writes if it was pointed away from the library drive.
    The same setting key `lib/convert.ts` reads when it spawns the tool. */
const CONVERT_TEMP_KEY = "convertTempDir";

export type { CleanupKind } from "./cleanup-names";

export type CleanupFile = {
  /** The file itself. This is what gets deleted. */
  path: string;
  name: string;
  kind: CleanupKind;
  bytes: number;
  /** When it was last written — an old leftover is one nothing is coming for. */
  modifiedAt: number;
  /**
   * The folder this was found in is not readable now, so the row is the last
   * pass's word for it rather than this one's. The size still counts towards
   * what the library could reclaim — that is what the figure is for — but
   * nothing here may be deleted, because nothing here has been seen today.
   */
  offline: boolean;
  /**
   * The film it belongs to, when that film is still in the library. Absent on
   * an original whose film has since been renamed or removed, which is exactly
   * the case worth showing: nothing else in the app mentions those.
   */
  film?: TaskFilm;
};

/**
 * The films behind a set of paths, for a list that holds paths rather than
 * films — the job log, whose rows record what was done to a file and nothing
 * about the film it is.
 *
 * Goes through `filmOf` and `artworkReader` like every other list here, so a
 * poster is found the same way wherever it is drawn: from the file's own folder
 * when it is there, from TMDb when the drive is away, and from the show rather
 * than the episode where a file is one.
 *
 * A path with no film is simply absent from the map. A log outlives what it
 * describes — a film can be renamed, converted or removed after the row about
 * it was written — and a row that has lost its film is still a true record of
 * what ran.
 */
export function filmsByPath(
  paths: string[],
  library: LibraryItem[] = getLibrary(),
): Map<string, TaskFilm> {
  const wanted = new Set(paths);
  if (wanted.size === 0) return new Map();

  const artworkOf = artworkReader();
  const plugged = reachabilityReader();
  const films = new Map<string, TaskFilm>();

  for (const item of library) {
    if (!wanted.has(item.path)) continue;
    films.set(item.path, filmOf(item, artworkOf(item), !plugged(item.path)));
  }

  return films;
}

/** See `libraryTasks` for why the library arrives as a defaulted parameter. */
export function cleanupFiles(
  library: LibraryItem[] = getLibrary(),
): CleanupFile[] {
  const artworkOf = artworkReader();
  const byPath = new Map(library.map((item) => [item.path, item]));
  const byStem = new Map(library.map((item) => [stemOf(item.path), item]));
  // A conversion pointed at a scratch disk names its working file from the
  // film's basename alone, so that is all there is to match it back on.
  const byStemName = new Map(
    library.map((item) => [path.basename(stemOf(item.path)), item]),
  );

  const dirs = new Set(library.map((item) => path.dirname(item.path)));
  const temp = getSetting(CONVERT_TEMP_KEY);
  if (temp) dirs.add(temp);

  /** One row, from a directory entry or from what was written down about one. */
  const rowFor = (
    dir: string,
    name: string,
    bytes: number,
    modifiedAt: number,
    offline: boolean,
  ): CleanupFile | undefined => {
    const artefact = artefactOf(name);
    if (!artefact) return undefined;

    const base = path.join(dir, artefact.base);
    const item = artefact.fromStem
      ? (byStem.get(base) ?? byStemName.get(artefact.base))
      : byPath.get(base);

    return {
      path: path.join(dir, name),
      name,
      kind: artefact.kind,
      bytes,
      modifiedAt,
      offline,
      film: item ? filmOf(item, artworkOf(item), offline) : undefined,
    };
  };

  const found: CleanupFile[] = [];
  const read: string[] = [];
  const away: string[] = [];

  for (const dir of dirs) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      // An unplugged drive, or a folder removed since the last scan. The last
      // pass that could read it answers for it below.
      away.push(dir);
      continue;
    }
    read.push(dir);

    for (const entry of entries) {
      if (!entry.isFile() || isSidecar(entry.name)) continue;
      if (!artefactOf(entry.name)) continue;

      let stats;
      try {
        stats = statSync(path.join(dir, entry.name));
      } catch {
        continue;
      }

      const row = rowFor(dir, entry.name, stats.size, stats.mtimeMs, false);
      if (row) found.push(row);
    }
  }

  // What was just read replaces what was written down about the same folders,
  // and the folders that are away keep theirs untouched.
  remember(read, found, [...dirs]);

  for (const row of recall(away)) {
    const file = rowFor(row.dir, row.name, row.bytes, row.modifiedAt, true);
    if (file) found.push(file);
  }

  return found.sort((a, b) => b.bytes - a.bytes);
}

// ---------------------------------------------------------------------------
// Keeping the listing
// ---------------------------------------------------------------------------

/**
 * Why any of this is written down at all.
 *
 * Everything else the dashboard says survives an unplugged drive, because
 * everything else came out of the database. These files never did: they are
 * found by reading the folders, and a folder that will not open used to take
 * its share of "reclaimable" to zero along with it — which reads as "there is
 * nothing to clear up" rather than as "half the library is not here".
 *
 * So each readable pass leaves its listing behind. It is a cache of a
 * directory read and nothing depends on it being current: the rows it hands
 * back are marked `offline`, which is what turns the delete buttons off.
 */
type RememberedFile = {
  dir: string;
  name: string;
  bytes: number;
  modifiedAt: number;
};

function remember(read: string[], found: CleanupFile[], known: string[]): void {
  const now = Date.now();
  const clear = db.prepare("DELETE FROM cleanup_files WHERE dir = ?");
  const insert = db.prepare(
    `INSERT INTO cleanup_files (path, dir, name, kind, bytes, modified_at, seen_at)
     VALUES (@path, @dir, @name, @kind, @bytes, @modifiedAt, @seenAt)
     ON CONFLICT(path) DO UPDATE SET
       dir = excluded.dir, name = excluded.name, kind = excluded.kind,
       bytes = excluded.bytes, modified_at = excluded.modified_at,
       seen_at = excluded.seen_at`,
  );

  db.transaction(() => {
    for (const dir of read) clear.run(dir);

    for (const file of found) {
      insert.run({
        path: file.path,
        dir: path.dirname(file.path),
        name: file.name,
        kind: file.kind,
        bytes: file.bytes,
        modifiedAt: file.modifiedAt,
        seenAt: now,
      });
    }

    // A folder no film lives in any more is not this app's to clean up, so its
    // rows go with it. Guarded on the library having any folders at all: an
    // empty one is a database waiting for its first scan, not a library that
    // lost everything.
    if (known.length > 0) {
      db.prepare(
        `DELETE FROM cleanup_files WHERE dir NOT IN (${known.map(() => "?").join(",")})`,
      ).run(...known);
    }
  })();
}

/** What the folders that would not open held, last time they did. */
function recall(dirs: string[]): RememberedFile[] {
  if (dirs.length === 0) return [];

  return db
    .prepare(
      `SELECT dir, name, bytes, modified_at AS modifiedAt FROM cleanup_files
       WHERE dir IN (${dirs.map(() => "?").join(",")})`,
    )
    .all(...dirs) as RememberedFile[];
}

/**
 * Every original the last readable pass found, by path.
 *
 * The one question `libraryTasks` cannot answer from the database on its own:
 * whether a film has already been rewritten with its original kept beside it.
 * Leftovers are not in it — a half-written mux says nothing about whether the
 * job it came from finished.
 */
function knownBackups(): Set<string> {
  const rows = db
    .prepare("SELECT path FROM cleanup_files WHERE kind <> 'leftover'")
    .all() as { path: string }[];

  return new Set(rows.map((row) => row.path));
}

/**
 * Deletes files this module itself found.
 *
 * The allow-list is a fresh scan rather than the one the page was drawn from:
 * a path arriving from a browser is a path someone could have typed, and the
 * only paths worth honouring are the ones that still answer to the description
 * — beside a film in the library, named the way this app names its own
 * artefacts. Anything else fails the whole call rather than being skipped
 * quietly.
 *
 * A remembered file is not one of them. It counts towards what the library
 * could reclaim, because it is still on the drive taking up room, but the
 * folder it is in did not open on this pass — so there is nothing to check the
 * path against and nothing to delete.
 *
 * The originals among them are written to the job log as they go, the way the
 * same delete from a film's own page is. Which of these rows is an original is
 * this module's own reading of the name, and the answer decides whether
 * anything was lost: see `recordDiscardedBackup`.
 */
export async function deleteCleanupFiles(
  paths: string[],
): Promise<{ deleted: number; freed: number }> {
  const scan = cleanupFiles();
  const allowed = new Map(
    scan.filter((file) => !file.offline).map((file) => [file.path, file]),
  );
  const offline = new Set(
    scan.filter((file) => file.offline).map((file) => file.path),
  );

  let deleted = 0;
  let freed = 0;
  for (const target of paths) {
    const file = allowed.get(target);
    if (!file) {
      throw new Error(
        offline.has(target)
          ? `The drive this file lives on is not connected: ${target}`
          : `Not one of the files this page found: ${target}`,
      );
    }
    await rm(target, { force: true });
    // And the sidecar macOS keeps beside it on an exFAT drive, which the scan
    // above deliberately never lists: left alone it would outlive the file it
    // describes, as a hidden orphan nothing in this app would mention again.
    await rm(
      path.join(path.dirname(target), sidecarFor(path.basename(target))),
      {
        force: true,
      },
    );
    deleted += 1;
    freed += file.bytes;

    // Written after the delete rather than before it, so the log holds what
    // happened and not what was about to. A row that cannot be written is not a
    // reason to stop halfway through a sweep — `recordRun` swallows its own
    // errors for exactly this.
    if (file.kind !== "leftover") {
      recordDiscardedBackup({
        path: filmPathOf(file),
        name: file.name,
        bytes: file.bytes,
      });
    }
  }

  return { deleted, freed };
}

/**
 * The film an original was kept beside, as a path.
 *
 * Read back off the name rather than taken from `file.film`, which is only
 * filled in when the library still holds that film. The two agree wherever both
 * exist — the row was matched to its film by this same join — and where they do
 * not, the name is the one that still answers: an original whose film has been
 * renamed or removed is precisely the delete worth a record, and the log would
 * rather say which file it stood beside than say nothing.
 *
 * Undefined for a leftover named from a stem, which is not a path to anything.
 * No caller asks for one — only the originals are logged, and both of those are
 * named from the whole filename — but a stem joined onto a folder is a path
 * that looks real and points at nothing, which is worth refusing outright
 * rather than leaving for the next reader to notice.
 */
function filmPathOf(file: CleanupFile): string | undefined {
  const artefact = artefactOf(file.name);
  if (!artefact || artefact.fromStem) return undefined;
  return path.join(path.dirname(file.path), artefact.base);
}
