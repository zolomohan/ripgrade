"use client";

import Link from "next/link";

import { CloseButton } from "@/app/modal";
import { Poster, type PosterFilm } from "./poster";

/**
 * The head of a dialog about one file: its poster, its name, and the way out.
 *
 * Every dialog on this page is the same shape of thing — a job, asked about a
 * particular file — so the first thing each has to settle is which file, and
 * they should settle it identically. They did not: the track picker opened on a
 * title over a filename, and the conversion dialog on the job's name over a
 * separate block holding a poster three times this size. Two answers to one
 * question, a tab apart.
 *
 * The film leads, because that is what a poster is for: you opened this off a
 * picture and this is the same picture, which is the whole of the check you
 * make before ticking anything. The job is not named here — the buttons and the
 * body say which job it is, and a heading reading "Dolby Vision P7 to P8
 * conversion" over a film that is not it is a heading you read once.
 *
 * The muted line is the year, and the episode where there is no year: a show's
 * episodes all carry the show's title above, so which episode is the fact that
 * tells one file here from another.
 */
/**
 * The least a thing has to be to have a head drawn for it.
 *
 * A `TaskFilm` satisfies it, and so does a row of the download log, which is
 * not one and never will be — it is a fetch, and the film behind it may not be
 * in the library at all. Written as the fields actually read rather than as a
 * union of the two, so a third caller needs no edit here.
 */
export type HeadFilm = PosterFilm & {
  title: string;
  year?: number;
  /** "S01E02 · Title", where the file is an episode. */
  episode?: string;
};

export function TaskHead({
  film,
  line,
  href,
  onClose,
  closeDisabled,
}: {
  film: HeadFilm;
  /**
   * The muted line, where the year is not the fact worth putting there. The
   * download log's own head says whether the film is in the library, which is
   * the thing that decides what the rest of its dialog can offer.
   */
  line?: React.ReactNode;
  /**
   * The film's own page, where this dialog offers a way to it. The poster and
   * the name are that way — an anchor rather than a handler, so the browser can
   * middle-click and preview it, and so the crumb that brings the poster home is
   * left by the delegated listener in app/return-to.tsx, which only sees
   * anchors.
   */
  href?: string;
  onClose: () => void;
  /** Set while something is running that a stray dismissal must not interrupt. */
  closeDisabled?: boolean;
}) {
  // No transition name on the poster: the row this was opened from is still
  // mounted behind the dialog, and two posters of one film claiming one name
  // abort the transition for both.
  const identity = (
    <>
      <Poster film={film} transition={false} box="h-12 w-8" />
      <div className="min-w-0">
        <h2 className="truncate text-base font-semibold group-hover:underline">
          {film.title}
        </h2>
        {(line ?? film.year ?? film.episode) !== undefined && (
          <p className="mt-0.5 truncate text-xs opacity-55">
            {line ?? film.year ?? film.episode}
          </p>
        )}
      </div>
    </>
  );

  return (
    <div className="mb-3 flex items-start justify-between gap-4">
      {href ? (
        <Link
          href={href}
          className="group flex min-w-0 items-center gap-3 rounded-control"
        >
          {identity}
        </Link>
      ) : (
        <div className="flex min-w-0 items-center gap-3">{identity}</div>
      )}

      <CloseButton onClick={onClose} disabled={closeDisabled} />
    </div>
  );
}
