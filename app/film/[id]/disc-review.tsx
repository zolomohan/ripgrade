"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  enterDisc,
  enterSeasonDisc,
  linkDisc,
  linkDiscByUrl,
  linkSeasonDisc,
  linkSeasonDiscByUrl,
  searchDiscs,
  searchSeasonDiscs,
  unlinkDisc,
  unlinkSeasonDisc,
  type DiscCandidate,
} from "@/app/actions";
import { BUTTON, FIELD } from "@/app/controls";
import { CloseButton, Modal } from "@/app/modal";
import { Spinner } from "@/app/spinner";
import type { DiscEntry } from "@/lib/disc-entry";

import { DiscByHand } from "./disc-by-hand";

/**
 * Picking the disc by hand. A film often has a dozen editions — regions,
 * steelbooks, remasters — and the automatic pick takes the first 4K result,
 * which is not always the one you own or the one worth comparing against.
 *
 * Three ways in, in order of how much you have to know: pick one of the
 * editions the search found, paste the URL of the one it did not, or — when
 * Blu-ray.com has never heard of the film — type the specs in yourself.
 */
/**
 * A film, identified by its TMDb id, or one season of a show, identified by the
 * show key and the season number. The search differs — a season release is
 * titled "Show: The Complete Third Season" — but the picking is the same.
 */
type Subject =
  | { tmdbId: number; showKey?: never; season?: never }
  | { showKey: string; season: number; tmdbId?: never };

export function DiscReview({
  tmdbId,
  showKey,
  season,
  title,
  year,
  currentUrl,
  manual,
  entered,
  inline,
}: Subject & {
  title: string;
  year?: number;
  currentUrl?: string;
  manual?: boolean;
  /** The specs already typed in, if that is where the ceiling came from. */
  entered?: DiscEntry;
  /** Beside the text it answers rather than below it — see the empty state. */
  inline?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<DiscCandidate[] | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Whether the form is showing instead of the search. Something already typed
  // in opens straight back onto it: the search is not what you came for.
  const [byHand, setByHand] = useState(Boolean(entered));
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  /* Asking for the search is the request: you already said which film this is,
     so it runs on the way in rather than waiting to be asked a second time.
     Once per opening — the results outlive a trip through the form. */
  function search() {
    if (results) return;

    startTransition(async () => {
      const found =
        showKey === undefined
          ? await searchDiscs(title, year)
          : await searchSeasonDiscs(title, season!, year);
      if (found.ok) setResults(found.results);
      else setError(found.error);
    });
  }

  function begin() {
    setOpen(true);
    setError(null);
    setByHand(Boolean(entered));
    // Nothing to search for when the specs you typed are what opens.
    if (!entered) search();
  }

  /* The same dialog, opened past the search rather than at it — for a film
     Blu-ray.com has never heard of, the search is a formality you already know
     the answer to. Nothing is fetched until you go looking. */
  function beginByHand() {
    setOpen(true);
    setError(null);
    setByHand(true);
  }

  function choose(candidate: DiscCandidate) {
    setError(null);
    startTransition(async () => {
      const result =
        showKey === undefined
          ? await linkDisc(tmdbId!, candidate)
          : await linkSeasonDisc(showKey, season!, candidate);
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else setError(result.error);
    });
  }

  function linkUrl() {
    setError(null);
    startTransition(async () => {
      const result =
        showKey === undefined
          ? await linkDiscByUrl(tmdbId!, url)
          : await linkSeasonDiscByUrl(showKey, season!, url);
      if (result.ok) {
        setOpen(false);
        setUrl("");
        router.refresh();
      } else setError(result.error);
    });
  }

  function saveByHand(entry: DiscEntry) {
    setError(null);
    startTransition(async () => {
      const result =
        showKey === undefined
          ? await enterDisc(tmdbId!, entry)
          : await enterSeasonDisc(showKey, season!, entry);
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else setError(result.error);
    });
  }

  function unlink() {
    setError(null);
    startTransition(async () => {
      const result =
        showKey === undefined
          ? await unlinkDisc(tmdbId!)
          : await unlinkSeasonDisc(showKey, season!);
      // The pick is gone, so what is on screen is stale — and the next search
      // should be a fresh one rather than the list that produced the old pin.
      if (result.ok) {
        setResults(null);
        router.refresh();
      } else setError(result.error);
    });
  }

  /* Underlined words rather than boxed buttons, matching the match-review
     corrections: quiet, occasional actions carry no frame. */
  const textButton =
    "inline-flex items-center gap-1.5 text-sm underline underline-offset-4 opacity-60 transition-opacity hover:opacity-100 disabled:opacity-30";

  /*
   * What the button says, and what the dialog it opens says.
   *
   * The same phrase for both wherever it can be, so the dialog answers with the
   * words it was asked with — but a button is a verb and a heading is a subject,
   * and against specs already typed in the two part company: the button is Edit
   * and the dialog is the form, which names itself.
   */
  const trigger = entered
    ? "Edit"
    : currentUrl
      ? "Wrong edition?"
      : "Find the disc";

  const dialogTitle = byHand
    ? "Enter the specs by hand"
    : currentUrl || entered
      ? "Wrong edition?"
      : "Find the disc";

  /*
   * Nothing is standing over this film yet, which makes these two the thing to
   * do here rather than two things you could also do: a filled button for the
   * search and a bordered one beside it for typing the specs instead. Two ways
   * to the same end, one of them the usual one — which is exactly what primary
   * and secondary are for.
   *
   * Once there is a release, the same buttons are corrections to it — a rare
   * second thought about an answered question — and go back to being the quiet
   * underlined words every other correction in the app is.
   */
  const firstTime = !currentUrl && !entered;

  return (
    <div className={inline ? "" : "mt-6"}>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={begin}
          disabled={pending}
          className={firstTime ? BUTTON.primary : textButton}
        >
          {pending && !open && firstTime && <Spinner />}
          {trigger}
        </button>

        {/* Beside it rather than inside it. The search is the right first move
            for a film that was pressed, and useless for one that was not —
            somebody who already knows which they have should not have to open
            a search to say so. Absent once there are specs to edit: the button
            to its left already opens them. */}
        {!entered && (
          <button
            type="button"
            onClick={beginByHand}
            disabled={pending}
            className={firstTime ? BUTTON.secondary : textButton}
          >
            Manual entry
          </button>
        )}

        {/* Only where there is a hand-made pick to undo. Running the automatic
            lookup again was offered next to it and answered nothing: the search
            is deterministic, so a second run returns the release the first one
            did — the way to a different one is to pick it. */}
        {manual && (
          <>
            <button
              type="button"
              onClick={unlink}
              disabled={pending}
              className={textButton}
            >
              {entered ? "Discard" : "Unpin"}
            </button>

            {/* Only for a pick, which looks like any other release until
                something says otherwise. Typed-in specs already carry the same
                words as a chip beside the title they belong to, and saying it
                twice on one panel reads as two different facts. */}
            {!entered && (
              <span className="text-[11px] tracking-wide uppercase opacity-45">
                pinned by hand
              </span>
            )}
          </>
        )}
        {/* Where the trigger is a filled button it carries its own spinner, in
            the gap the button keeps for one. Beside the quiet words there is no
            such gap, so it goes at the end of the row instead. */}
        {pending && !open && !firstTime && (
          <Spinner className="h-3.5 w-3.5 opacity-50" />
        )}
      </div>

      {error && !open && (
        <p className="mt-2 font-mono text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        dismissible={!pending}
        label="Pick the disc to compare against"
        panelClassName="flex h-[min(80vh,42rem)] w-full max-w-2xl flex-col overflow-hidden rounded-card border border-line bg-background shadow-2xl"
      >
        <>
          <header className="flex shrink-0 items-start justify-between gap-4 px-6 pt-6 pb-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">{dialogTitle}</h2>
              <p className="mt-1 text-sm opacity-60">
                {showKey === undefined
                  ? "This copy is scored against whichever release is picked here."
                  : `Every episode of season ${season} is scored against whichever release is picked here.`}
              </p>
            </div>
            <CloseButton onClick={() => setOpen(false)} />
          </header>

          {/* The floor the title stands on, outside whichever half follows it
              so the search and the form are ruled off at the same place. */}
          <div aria-hidden className="rule-head mx-6 mb-4 shrink-0" />

          {byHand ? (
            <div className="flex-1 overflow-y-auto px-6 pb-6">
              {error && (
                <p className="mb-4 font-mono text-sm text-red-600 dark:text-red-400">
                  {error}
                </p>
              )}

              <DiscByHand
                initial={entered}
                defaultTitle={
                  showKey === undefined ? title : `${title}: Season ${season}`
                }
                pending={pending}
                onSave={saveByHand}
                onCancel={() => {
                  // Where the form was the way in, the search has not run yet.
                  setByHand(false);
                  search();
                }}
              />
            </div>
          ) : (
            <>
              {/* Pasting the exact release is often faster than picking through a
              dozen near-identical editions. */}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  linkUrl();
                }}
                className="flex shrink-0 gap-2 px-6 pb-4"
              >
                <input
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  spellCheck={false}
                  placeholder="Paste a Blu-ray.com release URL…"
                  className={`${FIELD.default} flex-1`}
                />
                <button
                  type="submit"
                  disabled={pending || !url.trim()}
                  className={BUTTON.secondary}
                >
                  {pending && <Spinner />}
                  Link
                </button>
              </form>

              <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-6 pb-6">
                {error && (
                  <p className="font-mono text-sm text-red-600 dark:text-red-400">
                    {error}
                  </p>
                )}

                {!results && !error && (
                  <p className="text-sm opacity-50">Searching Blu-ray.com…</p>
                )}

                {results?.length === 0 && (
                  <p className="text-sm opacity-50">
                    No releases found for this title. There may be no page for
                    it — close this and use Manual entry to type the specs in
                    instead.
                  </p>
                )}

                {results && results.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {results.map((candidate) => (
                      <li key={candidate.id}>
                        <button
                          type="button"
                          onClick={() => choose(candidate)}
                          disabled={pending}
                          className={`flex w-full items-center gap-3 rounded-control px-2 py-2 text-left text-sm hover:bg-surface-strong disabled:opacity-40 ${
                            candidate.url === currentUrl
                              ? "ring-1 ring-line-strong ring-inset"
                              : ""
                          }`}
                        >
                          {/* The cover, because a dozen editions of a film are
                          called the same thing and drawn differently — often
                          the artwork is the only thing you recognise. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={candidate.cover}
                            alt=""
                            loading="lazy"
                            className="h-16 w-11 shrink-0 rounded-chip bg-surface-strong object-cover"
                          />

                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline gap-2">
                              <span
                                className={`shrink-0 rounded-chip px-1.5 text-[11px] leading-[18px] font-medium ring-1 ring-inset ${
                                  candidate.format === "4K"
                                    ? "text-emerald-700 ring-emerald-500/40 dark:text-emerald-300"
                                    : "ring-line-strong opacity-70"
                                }`}
                              >
                                {candidate.format}
                              </span>
                              <span className="min-w-0 truncate">
                                {candidate.title}
                              </span>
                            </span>

                            {/* What actually tells this pressing from the next
                            one: the packaging, where it came out, and when. */}
                            <span className="mt-1 block truncate text-xs opacity-50">
                              {[
                                candidate.edition,
                                candidate.country,
                                candidate.released,
                              ]
                                .filter(Boolean)
                                .join(" · ") || "—"}
                            </span>
                          </span>

                          {candidate.url === currentUrl && (
                            <span className="shrink-0 text-[11px] opacity-50">
                              current
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </>
      </Modal>
    </div>
  );
}
