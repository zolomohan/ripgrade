"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
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
import { CloseButton, Modal } from "@/app/modal";

/**
 * Picking the disc by hand. A film often has a dozen editions — regions,
 * steelbooks, remasters — and the automatic pick takes the first 4K result,
 * which is not always the one you own or the one worth comparing against.
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
  inline,
}: Subject & {
  title: string;
  year?: number;
  currentUrl?: string;
  manual?: boolean;
  /** Beside the text it answers rather than below it — see the empty state. */
  inline?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<DiscCandidate[] | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  /* Opening is the request: you already said which film this is, so the search
     runs on the way in rather than waiting to be asked a second time. */
  function begin() {
    setOpen(true);
    setError(null);
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

  const button =
    "rounded-control border border-line px-3 py-1.5 text-sm hover:bg-surface-strong disabled:opacity-40";

  /* Underlined words rather than boxed buttons, matching the match-review
     corrections: quiet, occasional actions carry no frame. */
  const textButton =
    "text-sm underline underline-offset-4 opacity-60 transition-opacity hover:opacity-100 disabled:opacity-30";

  return (
    <div className={inline ? "" : "mt-6"}>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={begin}
          disabled={pending}
          className={textButton}
        >
          {currentUrl ? "Wrong edition?" : "Find the disc"}
        </button>

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
              Unpin
            </button>
            <span className="text-[11px] tracking-wide uppercase opacity-45">
              pinned by hand
            </span>
          </>
        )}
        {pending && !open && (
          <span className="text-xs opacity-50">working…</span>
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
              <h2 className="text-lg font-semibold">
                {currentUrl ? "Wrong edition?" : "Find the disc"}
              </h2>
              <p className="mt-1 text-sm opacity-60">
                {showKey === undefined
                  ? "This copy is scored against whichever release is picked here."
                  : `Every episode of season ${season} is scored against whichever release is picked here.`}
              </p>
            </div>
            <CloseButton onClick={() => setOpen(false)} />
          </header>

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
              className="flex-1 rounded-control border border-line bg-transparent px-3 py-2 font-mono text-xs outline-none focus:border-line-strong"
            />
            <button
              type="submit"
              disabled={pending || !url.trim()}
              className={button}
            >
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
                No releases found for this title.
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
      </Modal>
    </div>
  );
}
