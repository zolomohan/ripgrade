"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  addToCollection,
  searchFilmsForCollection,
  type CollectionCandidate,
  type CollectionSearch,
} from "@/app/actions";
import { Art } from "@/app/art";
import { Bar, BarSearch } from "@/app/controls";
import { EmptyState } from "@/app/empty-state";
import { CloseButton, Modal } from "@/app/modal";
import { scoreTheme } from "@/app/score-circle";
import { Spinner } from "@/app/spinner";
import { stagger } from "@/app/stagger";

/**
 * What goes in a set, found the way anything in this app is found.
 *
 * One field asking both halves at once — what you have, and what you could
 * have — because which of the two a film is in is the thing a search is for
 * finding out, not something you should have to settle before typing. It is the
 * universal search's own bargain, narrowed to films and answered with tiles you
 * click to add rather than tiles you click to open.
 *
 * It stays open as you add. Filling a set is a handful of films at a time, and
 * a dialog that closed on each one would make the second one a fresh search for
 * the same word.
 */

const FRAME =
  "relative aspect-[2/3] overflow-hidden rounded-card bg-surface-strong ring-1 ring-line";

/** How long after the last keystroke the search actually runs. */
const DEBOUNCE_MS = 250;

/** The bar's own magnifier, at the size an empty state draws its mark. */
const SEARCH_ICON = (
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </>
);

/** The same, struck through: looked, and there was nothing there. */
const NOTHING_ICON = (
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
    <path d="m8.5 8.5 5 5M13.5 8.5l-5 5" />
  </>
);

function Tile({
  film,
  index,
  inSet,
  busy,
  onAdd,
}: {
  film: CollectionCandidate;
  index: number;
  inSet: boolean;
  busy: boolean;
  onAdd: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={inSet || busy}
      style={stagger(index)}
      aria-label={
        inSet
          ? `${film.title} is already in this collection`
          : `Add ${film.title}`
      }
      className="row-enter group flex flex-col gap-2 text-left disabled:cursor-default"
    >
      <div className={FRAME}>
        <Art
          src={film.poster}
          remote={film.posterPath}
          version={film.artAt}
          loading="lazy"
          className={`h-full w-full object-cover transition-opacity ${
            inSet ? "opacity-25" : "opacity-90 group-hover:opacity-100"
          }`}
        />

        {/* A film you hold wears its score, exactly as it does on every other
            shelf — which is also the quickest way to tell the two halves of
            this dialog apart while your eye is on the artwork. */}
        {film.score !== undefined && !inSet && (
          <span
            className={`absolute top-2 right-2 rounded-full bg-background/85 px-1.5 py-0.5 font-score text-[11px] font-semibold tabular-nums backdrop-blur ${scoreTheme(film.score).text}`}
          >
            {film.score}
          </span>
        )}

        {/* Already in, or going in. Either way the answer lands on the tile you
            clicked, which is where you are already looking. */}
        {(inSet || busy) && (
          <span className="absolute inset-0 grid place-items-center bg-background/50 backdrop-blur-[1px]">
            {busy ? (
              <Spinner className="h-5 w-5" />
            ) : (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
                className="h-6 w-6 text-emerald-600 dark:text-emerald-400"
              >
                <path d="m4 12.5 5 5 11-11" />
              </svg>
            )}
          </span>
        )}

        {!inSet && !busy && (
          <span className="pointer-events-none absolute inset-x-2 bottom-2 rounded-chip bg-background/85 py-1 text-center text-[10px] font-medium opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">
            Add
          </span>
        )}
      </div>

      <div className="min-w-0">
        <p className="truncate text-sm font-medium" title={film.title}>
          {film.title}
        </p>
        <p className="truncate text-[11px] opacity-45">{film.year || "—"}</p>
      </div>
    </button>
  );
}

function Shelf({
  label,
  films,
  inSet,
  busy,
  onAdd,
}: {
  label: string;
  films: CollectionCandidate[];
  inSet: Set<string>;
  busy: string | null;
  onAdd: (film: CollectionCandidate) => void;
}) {
  if (films.length === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h3 className="font-display text-sm font-semibold tracking-tight">
          {label}
        </h3>
        <div aria-hidden className="rule-head" />
      </div>

      <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
        {films.map((film, i) => (
          <Tile
            key={film.key}
            film={film}
            index={i}
            inSet={inSet.has(film.key)}
            busy={busy === film.key}
            onAdd={() => onAdd(film)}
          />
        ))}
      </div>
    </section>
  );
}

export function AddFilms({
  collectionId,
  open,
  onClose,
}: {
  collectionId: number;
  open: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CollectionSearch | null>(null);
  const [searching, setSearching] = useState(false);
  const [added, setAdded] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  /**
   * Which search the answer on screen belongs to. Typing outruns the network,
   * and without this a slow reply to "bla" lands after a fast reply to "blade"
   * and replaces it — the results going backwards as you type.
   */
  const latest = useRef(0);

  const term = query.trim();

  useEffect(() => {
    // An empty field is not a search, and what was on screen for the last one
    // is dropped in the render below rather than by clearing it here.
    if (!open || !term) return;

    const ticket = ++latest.current;
    const timer = setTimeout(() => {
      // Once the wait is over rather than at the keystroke: for the quarter
      // second the debounce is holding, nothing is being searched yet.
      setSearching(true);
      searchFilmsForCollection(collectionId, term)
        .then((found) => {
          if (ticket !== latest.current) return;
          setResults(found);
          setError(found.error ?? null);
        })
        .catch((err: unknown) => {
          if (ticket !== latest.current) return;
          setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (ticket === latest.current) setSearching(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [collectionId, open, term]);

  function add(film: CollectionCandidate) {
    setError(null);
    setBusy(film.key);
    startTransition(async () => {
      const result = await addToCollection(collectionId, film.add).catch(
        (err: unknown) => ({
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      setBusy(null);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      // Marked here as well as saved, so the tick settles immediately rather
      // than after the page behind has been rebuilt.
      setAdded((keys) => [...keys, film.key]);
      router.refresh();
    });
  }

  /*
   * What the field currently asks for. An answer to the last word typed stays
   * up while the next one is being fetched — a grid that blanks on every
   * keystroke is a grid you cannot read while typing — but an emptied field is
   * a question withdrawn, and there is nothing to keep showing for it.
   */
  const shown = term ? results : null;

  const inSet = new Set([...(shown?.inSet ?? []), ...added]);
  const nothing =
    shown !== null && shown.library.length === 0 && shown.discover.length === 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      label="Add films to this collection"
      /* A stated height rather than one that follows the contents: the answer
         runs from nothing to two dozen tiles, and a dialog that resizes with it
         moves the field you are typing in. What arrives inside it scrolls. */
      panelClassName="mt-[6vh] flex h-[min(78vh,44rem)] w-full max-w-4xl flex-col self-start overflow-hidden glass-panel rounded-panel border border-line p-4 shadow-2xl"
    >
      <>
        <div className="flex shrink-0 items-center gap-3">
          <Bar className="min-w-0 flex-1">
            <BarSearch
              value={query}
              onChange={setQuery}
              placeholder="Search your library and TMDb…"
              autoFocus
            />
          </Bar>
          {searching && <Spinner className="h-4 w-4 opacity-50" />}
          <CloseButton onClick={onClose} label="Done adding films" />
        </div>

        {error && (
          <p className="mt-3 shrink-0 text-xs wrap-anywhere text-red-700 dark:text-red-300">
            {error}
          </p>
        )}

        {/* `flex` so the two empty states can take the height and centre
            themselves in it, the way every other empty page in the app does —
            `EmptyState` fills the column it is in, and a box sized to its
            contents gives it nothing to fill. */}
        <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-y-auto pr-1">
          {shown === null ? (
            /* The one thing worth saying before anything has been typed, and
               the half of these sets that is not obvious: a film you do not own
               is as addable as one you do. */
            <EmptyState icon={SEARCH_ICON} title="Search for a film">
              Anything TMDb knows about can go in, whether or not it is on your
              drive — one you have not got yet simply waits on the second shelf
              until you rip it.
            </EmptyState>
          ) : nothing ? (
            <EmptyState icon={NOTHING_ICON} title={`Nothing for “${term}”`}>
              {shown.tmdb
                ? "No film of that name on your drive or at TMDb. Try fewer words."
                : "Only your library was searched — TMDb is not connected."}
            </EmptyState>
          ) : (
            <div className="flex flex-col gap-8">
              <Shelf
                label="In the library"
                films={shown.library}
                inSet={inSet}
                busy={busy}
                onAdd={add}
              />
              <Shelf
                label="From TMDb"
                films={shown.discover}
                inSet={inSet}
                busy={busy}
                onAdd={add}
              />
            </div>
          )}
        </div>
      </>
    </Modal>
  );
}
