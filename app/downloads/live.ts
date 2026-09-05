"use client";

import { useEffect, useMemo, useState } from "react";

import { listDownloadLog } from "@/app/actions";
import type { DownloadEntry } from "@/lib/qbittorrent";

/**
 * qBittorrent's present tense, for any page that wants it.
 *
 * The downloads page is where a transfer is watched, and for a long time it was
 * the only place that read the client at all — which is why the pacing, the
 * states and the reading of what "in flight" means all lived inside it. They
 * are here now because a transfer is a fact about a film rather than about that
 * page: a collection drawing a film it has not got has every reason to say the
 * film is on its way, and it should say it in the same words, at the same pace,
 * off the same read.
 *
 * Nothing here talks to qBittorrent itself. `listDownloadLog` is the one read,
 * and it answers with the log wearing whatever the client currently says — so a
 * page with no client configured gets rows with no `live` on them and shows
 * nothing, rather than having to ask first.
 */
export const POLL_MS = 3000;

/**
 * The same read, at the pace a page that is not watching a transfer deserves:
 * nothing is moving, and the only thing that can change is that something
 * starts. Slow enough not to be a request every few seconds for the length of a
 * browse, quick enough that a fetch sent from another tab turns up here while
 * you are still looking at the film you sent it for.
 */
export const IDLE_POLL_MS = 15_000;

export const PAUSED_STATES = new Set(["pausedDL", "stoppedDL"]);

/**
 * Listed, but not arriving and not going to without a person.
 *
 * A finished torrent whose files have since been moved or deleted reads as
 * `missingFiles` with its progress back at zero, which is the client saying
 * something about the drive rather than about a download. Under "Downloading"
 * that row is a fetch starting over — it is not one, and nothing is coming.
 *
 * Where it goes instead depends on whether the fetch ever finished, which is
 * `errored`'s business below: a completed torrent that has lost its files is a
 * record and nothing more, and one that broke on the way in is a job somebody
 * has to come back to.
 */
export const LOST_STATES = new Set(["error", "missingFiles"]);

/** Still on its way: the client lists it, it has not landed, and it can. */
export const inFlight = (entry: DownloadEntry) =>
  Boolean(entry.live && !entry.live.done && !LOST_STATES.has(entry.live.state));

/**
 * Stopped on a fault, with the client still holding it.
 *
 * The other half of `LOST_STATES`, and the half that has somebody waiting on
 * it. A fetch in one of these states is not arriving and will not start again
 * on its own — a disk that filled overnight, a partial file the client can no
 * longer write to — so it is neither in flight nor a fetch that was taken back.
 * Filed as cancelled it read as a decision somebody made, which is the one
 * thing it is not: nobody cancelled it, it broke, and the answer is a person
 * making room and pressing Resume.
 *
 * `completedAt` is what keeps a finished download out of this. A torrent whose
 * payload landed months ago says `missingFiles` the moment those files are
 * moved into the library or deleted, and that is a fact about the drive rather
 * than about the fetch — it finished, and the record of it stands. The stamp is
 * the log's own where this app was running for the finish, and qBittorrent's
 * remembered date where it was not, so a download that landed overnight and was
 * moved before morning reads as what it is. See `LOST_STATES` and
 * `Download.completedOn`.
 */
export const errored = (entry: DownloadEntry) =>
  Boolean(
    entry.live && !entry.completedAt && LOST_STATES.has(entry.live.state),
  );

/**
 * What is on its way, by the film it is on its way to.
 *
 * Keyed on TMDb's number because that is what a page drawing films it does not
 * hold knows them by — see `DownloadEntry.tmdbId`. Rows the log could not put a
 * film to are left out: a transfer that belongs to nothing in particular is the
 * downloads page's business, not a shelf's.
 *
 * Where a film has been fetched more than once — a send that stalled and a
 * second attempt beside it — the newest wins. It is the one the last button
 * press started, and the one whose progress answers "is it coming".
 *
 * `enabled` is the whole of the cost control: a page with nothing missing has
 * nothing to say about a transfer, and should not be reading the client every
 * fifteen seconds to find that out again.
 */
export function useTransfersByFilm(
  enabled: boolean,
): Map<number, DownloadEntry> {
  const [entries, setEntries] = useState<DownloadEntry[]>([]);

  /*
   * Two speeds, for the reason the downloads page gives: a transfer in flight
   * changes every second it runs, and a page with none is waiting on a person
   * pressing a button somewhere else. Read once on the way in either way, so
   * arriving at a page mid-download does not spend the first interval blank.
   */
  const moving = entries.some((entry) => entry.live && !entry.live.done);

  useEffect(() => {
    if (!enabled) return;

    let live = true;
    const read = async () => {
      const log = await listDownloadLog();
      // The page can go while the read is in the air, and a poll that writes
      // into a component nobody is looking at is React shouting about it.
      if (live) setEntries(log);
    };

    void read();
    const id = setInterval(read, moving ? POLL_MS : IDLE_POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [enabled, moving]);

  return useMemo(() => {
    const byFilm = new Map<number, DownloadEntry>();

    for (const entry of entries) {
      if (entry.tmdbId === undefined || !inFlight(entry)) continue;
      const held = byFilm.get(entry.tmdbId);
      if (!held || entry.addedAt > held.addedAt)
        byFilm.set(entry.tmdbId, entry);
    }

    return byFilm;
  }, [entries]);
}
