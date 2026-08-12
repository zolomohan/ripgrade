"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import {
  collectionsForFilm,
  createCollection,
  setFilmInCollection,
  type CollectionAdd,
  type FilmCollection,
} from "@/app/actions";
import { NameDialog } from "@/app/collections/name-dialog";
import { Spinner } from "@/app/spinner";
import { HERO_BUTTON } from "./hero-button";

/**
 * Filing a film into a set of your own, from the film.
 *
 * The collections page already answers "what goes in this set" — you open the
 * set and search. This is the same question from the end you are actually
 * standing at most of the time: you are reading a film, you have decided it
 * belongs with the others, and going to another page to say so means finding
 * the film again once you get there.
 *
 * A checklist rather than a picker, because a film belongs to as many sets as
 * it belongs to. Each row is the state you want and not the act — tick to file,
 * untick to take out — which is the only reading that survives a film being in
 * three sets already.
 *
 * Fetched when the menu opens rather than with the page. It is one small read,
 * and every film page in the app would otherwise carry a list nobody asked for.
 *
 * The film is named the way the page that drew this knows it — a path off the
 * shelf, a search hit on a discover page — and nothing below cares which. A set
 * has always been able to hold a film nobody has, so the only thing that made
 * this a page-of-your-own-films button was the argument it took.
 */
export function AddToCollection({ film }: { film: CollectionAdd }) {
  const [open, setOpen] = useState(false);
  const [sets, setSets] = useState<FilmCollection[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [naming, setNaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  /*
   * Re-read every time it opens, not once. Sets are made and filled from three
   * other places in the app, and a list cached on first open is a list that
   * quietly stops being true while the page stays put.
   *
   * Watched as a string rather than as the object it is: the film arrives
   * written out at the call site, so a parent re-rendering for its own reasons
   * hands down a new object saying the same thing — and this would re-read on
   * every one of them. The same trick the release panel plays on its subject.
   */
  const filmKey = JSON.stringify(film);
  useEffect(() => {
    if (!open) return;
    let live = true;
    collectionsForFilm(film)
      .then((found) => live && setSets(found))
      .catch(
        (err: unknown) =>
          live && setError(err instanceof Error ? err.message : String(err)),
      );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, filmKey]);

  function toggle(set: FilmCollection) {
    const next = !set.holds;
    setError(null);
    setBusy(set.id);

    // Ticked here as well as saved, so the row answers on the click rather than
    // after the round trip.
    setSets((current) =>
      (current ?? []).map((one) =>
        one.id === set.id ? { ...one, holds: next } : one,
      ),
    );

    startTransition(async () => {
      const result = await setFilmInCollection(set.id, film, next).catch(
        (err: unknown) => ({
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      setBusy(null);
      if (!result.ok) {
        setError(result.error);
        // Put back what the server would not accept, rather than leaving a tick
        // standing for something that did not happen.
        setSets((current) =>
          (current ?? []).map((one) =>
            one.id === set.id ? { ...one, holds: !next } : one,
          ),
        );
      }
    });
  }

  /** A set made for this film, which is the one case worth filing on creation. */
  function create(name: string) {
    setError(null);
    startTransition(async () => {
      const made = await createCollection(name).catch((err: unknown) => ({
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      }));
      if (!made.ok) {
        setError(made.error);
        return;
      }

      const filed = await setFilmInCollection(made.id, film, true).catch(
        (err: unknown) => ({
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      if (!filed.ok) {
        setError(filed.error);
        return;
      }

      setNaming(false);
      setSets(await collectionsForFilm(film));
    });
  }

  return (
    <>
      <div ref={wrap} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Add to a collection"
          aria-expanded={open}
          title="Add to a collection"
          className={HERO_BUTTON}
        >
          {/* The sidebar's own mark for collections — films stacked into sets,
              seen edge on — with the plus every "add" in this app wears. One
              icon per idea, so the button and the page it files into are
              recognisably about the same thing. */}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className="h-4 w-4"
          >
            <path d="M11 3 3 7l8 4 8-4z" />
            <path d="M3 12l8 4 4-2M3 16.5l8 4 2-1" />
            <path d="M18 14v6M15 17h6" />
          </svg>
        </button>

        {open && (
          <div className="row-enter absolute top-full right-0 z-30 mt-2 max-h-80 w-60 overflow-y-auto glass-panel rounded-card border border-line py-1 shadow-2xl">
            {sets === null ? (
              <p className="flex items-center gap-2 px-3 py-2 text-sm opacity-50">
                <Spinner />
                Reading your collections…
              </p>
            ) : (
              <>
                {sets.length === 0 && (
                  <p className="px-3 py-2 text-sm leading-relaxed opacity-50">
                    You have no collections of your own yet.
                  </p>
                )}

                {sets.map((set) => (
                  <button
                    key={set.id}
                    type="button"
                    onClick={() => toggle(set)}
                    disabled={busy !== null}
                    aria-pressed={set.holds}
                    className="glow flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-strong disabled:opacity-60"
                  >
                    <span className="min-w-0 truncate">{set.name}</span>

                    {busy === set.id ? (
                      <Spinner />
                    ) : (
                      /* A tick that is always there, drawn faint when the film
                         is not in the set: a row whose mark appears and
                         disappears is a row that jumps, and the box is what
                         says this is a thing with two states rather than a
                         command. */
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                        className={`h-3.5 w-3.5 shrink-0 transition-opacity ${
                          set.holds
                            ? "text-emerald-600 opacity-100 dark:text-emerald-400"
                            : "opacity-15"
                        }`}
                      >
                        <path d="m4 12.5 5 5 11-11" />
                      </svg>
                    )}
                  </button>
                ))}

                {/* The way out of an empty list, and the shortcut when the set
                    you want does not exist yet — which is most of the time you
                    are looking at a film and thinking about sets at all. */}
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setNaming(true);
                  }}
                  className="glow flex w-full items-center gap-2 border-t border-line px-3 py-2 text-left text-sm transition-colors hover:bg-surface-strong"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    aria-hidden
                    className="h-3.5 w-3.5 shrink-0 opacity-60"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  New collection…
                </button>

                {error && (
                  <p className="px-3 py-2 text-xs wrap-anywhere text-red-700 dark:text-red-300">
                    {error}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <NameDialog
        open={naming}
        title="New collection"
        confirmLabel={pending ? "Creating…" : "Create and add"}
        busy={pending}
        error={naming ? error : null}
        onSubmit={create}
        onCancel={() => setNaming(false)}
      />
    </>
  );
}
