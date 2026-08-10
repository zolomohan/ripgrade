"use client";

import { useEffect, useState, useTransition } from "react";

import {
  findReleasesFor,
  findReleasesForShow,
  findReleasesForTmdbEpisode,
  findReleasesForTmdbSeason,
  type UpgradeResponse,
} from "@/app/actions";
import { BUTTON, FIELD } from "@/app/controls";
import { Panel } from "@/app/panel";
import { NotConfigured, Result, SORTS } from "@/app/release-search";

/**
 * Every release the indexers have for one thing, as a panel.
 *
 * Its own component because it is asked more than once on a page: a series has
 * no single answer worth showing — you download television a season at a time —
 * so the panel sits under the season being looked at rather than at the top of
 * the page, and follows the switcher from one season to the next.
 *
 * Being rendered is the request. Each panel runs its own search and holds its
 * own sort and its own edited phrase, because those belong to the question
 * asked rather than to the page asking it.
 */

/** Which search this panel is: the four questions the indexers can be asked. */
export type DiscoverSubject =
  | { kind: "movie"; tmdbId: number }
  | { kind: "tv"; tmdbId: number }
  | { kind: "season"; tmdbId: number; season: number }
  | { kind: "episode"; tmdbId: number; season: number; episode: number };

/** How many releases the list shows before it stops; the dialog's own cut. */
const SHOWING = 25;

const searchFor = (subject: DiscoverSubject, term?: string) => {
  switch (subject.kind) {
    case "movie":
      return findReleasesFor(subject.tmdbId, term);
    case "tv":
      return findReleasesForShow(subject.tmdbId, term);
    case "season":
      return findReleasesForTmdbSeason(subject.tmdbId, subject.season, term);
    case "episode":
      return findReleasesForTmdbEpisode(
        subject.tmdbId,
        subject.season,
        subject.episode,
        term,
      );
  }
};

export function Downloads({
  subject,
  logName,
  posterPath,
  jackettReady,
  title = "Downloads",
}: {
  subject: DiscoverSubject;
  /** What the download log should call whatever is fetched from here. */
  logName: string;
  /** The poster the log shows beside it. */
  posterPath?: string;
  jackettReady: boolean;
  /** The panel's own name, where "Downloads" is not specific enough. */
  title?: string;
}) {
  const [response, setResponse] = useState<UpgradeResponse | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();

  function run(term?: string) {
    startTransition(async () => {
      setResponse(await searchFor(subject, term));
    });
  }

  // Re-runs when the subject changes under it, which is what flipping the
  // season switcher does: the panel stays mounted and is asked a new question.
  const subjectKey = JSON.stringify(subject);
  useEffect(() => {
    if (jackettReady) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectKey, jackettReady]);

  // A phrase edited for the previous subject belongs to it, so a fresh one
  // starts from its own constructed query. Adjusted during render rather than
  // in the effect, per React's own pattern for state that follows a prop.
  const [lastSubject, setLastSubject] = useState(subjectKey);
  if (lastSubject !== subjectKey) {
    setLastSubject(subjectKey);
    setEditing(false);
  }

  const search = response?.ok ? response.search : undefined;

  /*
   * Best score first, and only that.
   *
   * The dialog offers seeders as a second order, because there you are hunting
   * for a copy of a film you already hold and a dead tracker is a real answer.
   * Here the question is simply what the best release of this is — which is the
   * one thing the score already ranks — and a control offering to answer a
   * question nobody asked is a control to read past. Sorted before the cut, so
   * the twenty-five shown are the twenty-five best rather than the first
   * twenty-five the indexers happened to return. Copied because sort() would
   * otherwise reorder the response in place.
   */
  const showing = (search ? [...search.results].sort(SORTS.score) : []).slice(
    0,
    SHOWING,
  );

  const film = { title: logName, posterPath };

  /**
   * A search that came back with nothing. Distinct from one still running and
   * from one that never ran: those have an answer coming, this is the answer.
   */
  const empty = Boolean(search) && showing.length === 0;

  return (
    <Panel
      title={title}
      summary={
        pending
          ? "Searching…"
          : search
            ? `${search.results.length} release${
                search.results.length === 1 ? "" : "s"
              }`
            : !jackettReady
              ? "Jackett not connected"
              : response && !response.ok
                ? "Search failed"
                : "—"
      }
      /* Open, because this is the page's answer rather than a footnote to it —
         but a search that found nothing has no answer to hold open. It shuts
         itself when the results land empty, and the count in the summary is
         then the whole of what it has to say. The phrase it searched for is
         still inside, for when the wording is what went wrong. */
      open={!empty}
    >
      {/* The rows inside carry the dialog's own px-5, which is 20px more than
          a panel's column starts at — so every row is pulled back by that
          much. Text then lines up with the panel's title and the hover band
          still bleeds either side, which is what the bleed in globals.css
          exists for.

          Pulled up as well: a panel's body is spaced for prose set against its
          heading, and the first thing here is a row with padding of its own, so
          the two paddings stacked left the list floating clear of the header it
          belongs to. Taken back here rather than in the shared panel, where
          every other section really is prose. */}
      <div className="-mt-3 flex flex-col">
        {!jackettReady && <NotConfigured />}

        {jackettReady && pending && (
          <div className="flex flex-col gap-2 py-1">
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className="skeleton h-14 w-full" />
            ))}
          </div>
        )}

        {jackettReady && !pending && response && !response.ok && (
          <p className="py-10 text-center text-sm text-red-600 dark:text-red-400">
            {response.error}
          </p>
        )}

        {jackettReady && !pending && search && showing.length === 0 && (
          <p className="py-10 text-center text-sm opacity-55">
            Nothing came back for “{search.query}”.
            {search.discarded > 0 &&
              ` ${search.discarded} result${
                search.discarded === 1 ? " was" : "s were"
              } for something else.`}
          </p>
        )}

        {jackettReady && !pending && showing.length > 0 && (
          /* Rounded rows rather than the dialog's square ones. In a dialog a
             row runs wall to wall and a corner would be a corner cut off
             nothing; here each row is a band floating in the page's own
             column, and the hover — and the glow, which inherits this radius —
             has to be a shape rather than a stripe.

             No hairlines between them, for the same reason: a rule drawn
             across a rounded band is a straight line with its ends hanging
             past the corners. The rows are parted by the band itself, exactly
             as the episode cards on a show page are. */
          <ul className="-mx-5 flex flex-col [&>li]:rounded-card">
            {showing.map((release) => (
              <Result
                key={`${release.title}-${release.infoHash ?? release.indexer}`}
                release={release}
                referenceKind={search?.reference?.kind}
                film={film}
              />
            ))}
          </ul>
        )}

        {/* The phrase the indexers were actually asked, offered for rewriting.
            A search that misses is usually a wording problem — an alternate
            title, a misparsed year — and the fix is to say it differently
            rather than to go and look somewhere else. */}
        {jackettReady && !pending && search && (
          <div className="-mx-5 mt-1 border-t border-line px-5 pt-2.5">
            {editing ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const term = draft.trim();
                  if (!term) return;
                  setEditing(false);
                  run(term);
                }}
                className="flex items-center gap-2"
              >
                <input
                  autoFocus
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setEditing(false);
                  }}
                  aria-label="Search phrase"
                  className={`${FIELD.small} min-w-0 flex-1`}
                />
                <button type="submit" className={BUTTON.small}>
                  Search
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="shrink-0 text-xs opacity-40 transition-opacity hover:opacity-100"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <div className="flex items-center gap-3">
                <p
                  className="min-w-0 flex-1 truncate text-[11px] opacity-45"
                  title={search.query}
                >
                  Searched for <span className="font-mono">“{search.query}”</span>
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(search.query);
                    setEditing(true);
                  }}
                  className="shrink-0 text-xs underline decoration-line-strong underline-offset-4 opacity-50 transition-opacity hover:opacity-100"
                >
                  Edit
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
