"use client";

import { useState, useTransition } from "react";

import { reprobeMovie } from "@/app/actions";
import { BUTTON, ICONS } from "@/app/controls";
import { Failure } from "@/app/settings/parts";
import { Spinner } from "@/app/spinner";

/**
 * Read this one file again, from the panel that is showing what was read last
 * time.
 *
 * Everything in the grid above is a probe, and a probe is only taken when the
 * file's size or mtime has moved — which is the rule that keeps opening the app
 * from re-reading four hundred files, and the rule that leaves this page with
 * no way to correct a reading that is simply wrong. A file touched by something
 * other than this app, a probe from before mediainfo could see the Dolby Vision
 * layer, a track list that never matched what plays: the drive knows, the scan
 * will not ask, and the shelf's Scan button would sweep the whole library to
 * settle one film.
 *
 * So it is here, at the foot of the panel it corrects, rather than in the hero
 * beside Upgrade and Reveal in Finder. Those act on the film; this acts on the
 * page's own facts, and a button that only means anything once you have read
 * the rows above it belongs under them. `BUTTON.small` for the same reason —
 * it is sized to the caption beside it, not to the decisions in the hero.
 *
 * A press says so afterwards even when nothing changed. Most re-reads confirm
 * what was already there, and a button that goes quiet and leaves an identical
 * grid behind it is indistinguishable from one that did nothing at all.
 */
export function RescanSpecs({
  moviePath,
  present = true,
}: {
  moviePath: string;
  /** Off an unplugged drive there is nothing to read; see `filePresent`. */
  present?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // The transition stays pending until the refreshed page has rendered, so the
  // wheel stops at the moment the rows above it are the new reading rather than
  // a moment before.
  const [pending, start] = useTransition();

  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line pt-4">
      {/* The caption and the failure stand in the same slot rather than one
          under the other: they answer the same question — where these rows came
          from — and a reason printed below a line still claiming the last scan
          would have the panel disagreeing with itself. */}
      {error ? (
        <div className="min-w-0">
          <Failure>{error}</Failure>
        </div>
      ) : (
        <p className="min-w-0 text-xs opacity-45">
          {done
            ? "Read from the drive just now."
            : "Read from the drive when the file was last scanned."}
        </p>
      )}

      <button
        type="button"
        disabled={pending || !present}
        title={
          present
            ? "Read this file's streams again and re-derive everything on this page from them"
            : "Drive not connected"
        }
        onClick={() =>
          start(async () => {
            setDone(false);
            const result = await reprobeMovie(moviePath);
            setError(result.ok ? null : result.error);
            setDone(result.ok);
          })
        }
        className={BUTTON.small}
      >
        {pending ? (
          <Spinner />
        ) : (
          /* The shelf's own mark for a file being read — four corners and a
             beam. Same act, one film. */
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className="h-3 w-3"
          >
            <path d={ICONS.scan} />
          </svg>
        )}
        {pending ? "Reading…" : "Rescan file"}
      </button>
    </div>
  );
}
