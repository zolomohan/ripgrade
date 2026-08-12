"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

import {
  addWish,
  removeWish,
  searchTorrents,
  universalSearch,
  type DiscoverHit,
  type LibraryHit,
  type UniversalResults,
  type UpgradeResponse,
} from "@/app/actions";
import { Art } from "@/app/art";
import { Bar, BarSearch, ICONS, MenuItem, Popover } from "@/app/controls";
import { EmptyState } from "@/app/empty-state";
import { Heart } from "@/app/heart";
import { Result, SORTS, type Sort } from "@/app/release-search";
import { scoreTheme, STATUS_THEME } from "@/app/score-circle";
import { stagger } from "@/app/stagger";
import { OVER_ART, WANTED_ART } from "@/app/tile-button";
import { posterName } from "@/lib/routes";

/**
 * One search for the whole app.
 *
 * Every shelf used to carry a field of its own that searched only itself: the
 * library filtered the films on the drive, the wishlist searched TMDb for films
 * that were not. Which field to type into depended on the answer — whether you
 * already own the thing — which is the question you opened a search to settle.
 *
 * So there is one field now, and it answers in four parts. What you have opens
 * where it lives. What you do not have can be wanted, or read up on first. And
 * the same words can be put to the indexers directly, which is what this page
 * used to be for on its own.
 *
 * Films and shows alike, and for the same reason: which of the two shelves a
 * title is on is another thing you should not have to know before typing it.
 * The tile says which it is and goes where it belongs.
 *
 * It is built out of what the rest of the app is built out of — the bar, the
 * poster grid, the empty card — and it is drawn in the window ⌘F opens, over
 * whatever you were looking at. It was a page for a while, and the page is
 * gone: a search is a thing you do in the middle of something else, and making
 * it a destination meant leaving that something else to reach it. See
 * app/search/dialog.tsx, which is the only thing that renders this.
 */

/** How long a pause in typing counts as "done typing". */
const DEBOUNCE_MS = 250;

/**
 * The indexers wait longer.
 *
 * A TMDb search is one request to one server that answers in milliseconds; an
 * indexer search fans out through Jackett to every tracker configured and each
 * one is asked in earnest. That is not a thing to do to them three times while
 * a title is being typed.
 */
const INDEXER_DEBOUNCE_MS = 700;

/**
 * Where the words are looked up. Three readings of one phrase rather than
 * three searches: the first two are one TMDb answer sorted into what you have
 * and what you do not. Only the last goes anywhere else.
 *
 * The library comes first because it answers the question most often asked of
 * a search box: do I already have this.
 *
 * Films and series are not tabs of their own. Which kind a title is is not a
 * question you asked — you typed a name — so the answer keeps them together
 * and rules them apart with a heading, the way every shelf in the app does.
 */
type Mode = "library" | "tmdb" | "indexer";

/** The one scope that is not read out of the TMDb answer. */
const INDEXER: Mode = "indexer";

/**
 * The three, in the order Tab walks them.
 *
 * They were a segmented switch when this was only a page and there was a row to
 * spare. In a dialog the row is the field, and three named segments in front of
 * it push the thing you came to type into a corner — so the scope is a word at
 * the head of the bar that opens a menu, the way every other choice in this app
 * is made. It reads as a preposition: in Library, "the abyss".
 *
 * The menu is for pointing at; the keyboard has Tab, because a hand already on
 * the field to type should not have to leave it to ask the same words of
 * somewhere else. See `cycle` below.
 */
const SCOPES: { key: Mode; label: string; icon: string }[] = [
  // The poster shelf: four tiles, which is what the drive looks like on every
  // other page of this app.
  {
    key: "library",
    label: "Library",
    icon: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  },
  // A globe for everything you do not have — TMDb is the world the library is
  // a small corner of.
  {
    key: "tmdb",
    label: "TMDb",
    icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M3.5 12h17M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9c-2.4-2.5-3.6-5.5-3.6-9s1.2-6.5 3.6-9",
  },
  // And a signal going out for the indexers, because that is the difference
  // that matters: this one is a question put to other people's machines.
  {
    key: INDEXER,
    label: "Indexers",
    icon: "M12 12h.01M8.6 15.4a4.8 4.8 0 0 1 0-6.8M15.4 8.6a4.8 4.8 0 0 1 0 6.8M5.6 18.4a8.9 8.9 0 0 1 0-12.8M18.4 5.6a8.9 8.9 0 0 1 0 12.8",
  },
];

/**
 * A scope's mark, at the size the bar's own controls draw theirs.
 *
 * Three marks rather than one for the idea of scope: the trigger shows only the
 * scope you are in, so a single icon there would say "this is a choice" and
 * never which choice. Repeated down the menu, so the mark on the bar is one you
 * have already been told the meaning of.
 */
function ScopeIcon({ path }: { path: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="h-4 w-4 shrink-0 opacity-50"
    >
      <path d={path} />
    </svg>
  );
}

/** How the releases can be ordered, in the app's own menu rather than a select. */
const SORT_OPTIONS: { key: Sort; label: string }[] = [
  { key: "score", label: "Best score" },
  { key: "seeders", label: "Most seeders" },
];

/** Both halves of TMDb in one key; see `wants` below. */
const wantKey = (hit: { kind: string; id: number }) => `${hit.kind}:${hit.id}`;

/**
 * What has already been asked, for as long as the tab is open.
 *
 * The page unmounts when you open a film from it and mounts again when you come
 * back, which takes its state with it — so a return used to be a fresh search
 * for words that had not changed, with the skeletons and the wait that implies.
 * The answers outlive the component instead: they hang off the module, which is
 * loaded once per tab and survives every client navigation between.
 *
 * Held here rather than in sessionStorage because that is exactly the lifetime
 * wanted. These answers are a reading of the drive and of TMDb at the moment
 * they were fetched; they are worth keeping while you are moving around inside
 * one session, and not worth restoring into a window opened tomorrow.
 *
 * The two searches are cached apart for the same reason they are held apart in
 * state: they are answers to the same words from different places, and having
 * asked TMDb is not having asked the indexers.
 */
const ANSWERS = new Map<string, UniversalResults>();
const RELEASES = new Map<string, UpgradeResponse>();

/** Hearts pressed on this page, kept over the same span and for the same reason. */
const WANTS = new Map<string, boolean>();

/** How the releases were last ordered. */
const PREFERENCE = { sort: "score" as Sort };

/**
 * Past this many terms the oldest is dropped. A search is small, but a session
 * spent typing is unbounded, and nothing here is worth an ever-growing map.
 * Insertion order is the eviction order — `remember` re-inserts on write, so
 * the term dropped is the one least recently asked rather than the oldest.
 */
const CACHE_LIMIT = 12;

function remember<T>(cache: Map<string, T>, term: string, value: T) {
  cache.delete(term);
  cache.set(term, value);
  for (const oldest of cache.keys()) {
    if (cache.size <= CACHE_LIMIT) break;
    cache.delete(oldest);
  }
}

/** The frame both halves are drawn in, so a film reads the same either side. */
function Tile({
  index,
  children,
}: {
  index: number;
  children: React.ReactNode;
}) {
  return (
    <div style={stagger(index)} className="row-enter group flex flex-col gap-2">
      {children}
    </div>
  );
}

function Caption({
  title,
  year,
  note,
}: {
  title: string;
  year?: number | string;
  /** What the year line says instead, where a show has more to report. */
  note?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-medium" title={title}>
        {title}
      </p>
      {(note ?? year) && (
        <p className="truncate text-[11px] opacity-45">
          {[year, note].filter(Boolean).join(" · ")}
        </p>
      )}
    </div>
  );
}

/**
 * The word for what a tile is, shown only on the shows: a poster is a film
 * until something says otherwise, and saying "Film" on the rest would be
 * labelling the default.
 */
function SeriesChip() {
  return (
    <span className="absolute bottom-2 left-2 rounded-chip bg-background/85 px-1.5 text-[10px] leading-[18px] font-medium opacity-70 backdrop-blur">
      Series
    </span>
  );
}

/** Something on the drive. The whole tile goes to its page — there is nothing
    else you would want from a film or a show you already have. */
function OwnedTile({ hit, index }: { hit: LibraryHit; index: number }) {
  const series = hit.kind === "tv";
  const theme = series
    ? scoreTheme(hit.score)
    : hit.status
      ? STATUS_THEME[hit.status]
      : undefined;

  const held =
    hit.episodeCount !== undefined
      ? `${hit.episodeCount} ${hit.episodeCount === 1 ? "episode" : "episodes"}`
      : undefined;

  return (
    <Tile index={index}>
      <Link
        href={series ? `/show/${hit.id}` : `/film/${hit.id}`}
        className="glow glow-over tilt relative aspect-[2/3] overflow-hidden rounded-card bg-surface-strong ring-1 ring-line"
      >
        <Art
          src={hit.poster}
          remote={hit.remotePoster}
          version={hit.artAt}
          loading="lazy"
          className="h-full w-full object-cover"
        />

        <span
          className={`absolute top-2 right-2 rounded-full bg-background/85 px-1.5 py-0.5 font-score text-[11px] font-semibold tabular-nums backdrop-blur ${
            theme?.text ?? ""
          }`}
          title={
            series
              ? `${hit.score} of 100 · average of ${hit.episodeCount} episodes`
              : `${hit.status} · ${hit.score} of 100`
          }
        >
          {hit.score}
        </span>

        {series && <SeriesChip />}
      </Link>

      <Caption title={hit.title} year={hit.year} note={held} />
    </Tile>
  );
}

/**
 * A film or show you do not have. Two things to do with it, and the tile
 * carries both: the poster opens its page, and the heart puts it on the want
 * list without going anywhere.
 *
 * The page rather than a dialog, since the dialog could only ever list
 * releases — and the question asked of something you have never seen is first
 * what it *is*. See app/discover.
 */
function DiscoverTile({
  hit,
  index,
  wanted,
  busy,
  onWant,
}: {
  hit: DiscoverHit;
  index: number;
  wanted: boolean;
  busy: boolean;
  onWant: () => void;
}) {
  return (
    <Tile index={index}>
      {/* The heart is inside the frame rather than pinned beside it, because
          the frame is what lifts under the pointer: a control anchored outside
          it sits still while the picture it belongs to moves, which reads as
          two objects that happen to overlap. That puts the link inside too —
          an anchor cannot hold a button, so the anchor is what gives way. */}
      <div className="glow glow-over tilt relative aspect-[2/3] overflow-hidden rounded-card bg-surface-strong ring-1 ring-line">
        <Link
          href={`/discover/${hit.kind}/${hit.id}`}
          aria-label={hit.title}
          className="block h-full"
        >
          {hit.posterPath && (
            <Art
              remote={hit.posterPath}
              // The same name the page's own poster answers to, so the tile
              // travels into it rather than being swapped for it.
              transitionName={posterName(`tmdb-${hit.kind}-${hit.id}`)}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          )}

          {hit.kind === "tv" && <SeriesChip />}
        </Link>

        {/* Always visible once it is on the list — a filled heart is the
            answer to "did I already want this", and an answer that only
            appears on hover is no answer at a glance. */}
        <button
          type="button"
          onClick={onWant}
          disabled={busy}
          aria-pressed={wanted}
          aria-label={
            wanted ? `Remove ${hit.title} from wishlist` : `Want ${hit.title}`
          }
          title={wanted ? "On the wishlist" : "Add to wishlist"}
          /* Off the plate it used to sit on, and larger for it: a mark drawn
             white over its own shadow carries on a poster without a disc under
             it, and the disc was most of what made the heart small. See
             OVER_ART. */
          className={`absolute top-1 right-1 z-10 grid h-9 w-9 place-items-center transition-opacity disabled:opacity-30 ${
            wanted
              ? WANTED_ART
              : `${OVER_ART} opacity-0 hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-70`
          }`}
        >
          <Heart filled={wanted} />
        </button>
      </div>

      <Caption title={hit.title} year={hit.year} />
    </Tile>
  );
}

/**
 * A run of results under its own name — the library's section head, rule and
 * all, because that is what a shelf looks like in this app.
 */
function Section({
  title,
  note,
  children,
}: {
  title: string;
  /** A count, where counting says something the heading does not. */
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-7">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-display text-lg font-semibold tracking-tight">
            {title}
          </h2>
          {note && <p className="shrink-0 text-[11px] opacity-40">{note}</p>}
        </div>
        <div aria-hidden className="rule-head" />
      </div>

      {children}
    </section>
  );
}

/** The shelf itself: the library's own grid, at the library's own gaps. */
function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
      {children}
    </div>
  );
}

/**
 * The marks the four empty answers wear.
 *
 * There was one shape for all of them before this: a bordered box with a grey
 * sentence lying along the top of it, left-aligned in a frame the width of the
 * window and nothing like the height. It read as a card that had failed to load
 * rather than as an answer — and it was the only card in here, three lines
 * below the note explaining that the releases get no box because "a bordered
 * box would say they are a different kind of thing rather than the same
 * question asked somewhere else". A sentence saying there is nothing is not a
 * different kind of thing either.
 *
 * So they are `EmptyState` now, like every other empty page in the app: mark,
 * heading, sentence, centred in the space going spare. Which also means each
 * one says what it is before it is read — four states that were four
 * indistinguishable grey paragraphs.
 *
 * A mark each, and deliberately not four variations on a magnifying glass: what
 * separates these is not that a search failed, it is *which* of the three
 * places was asked, and a lens with a different squiggle in it four times says
 * the opposite.
 */
/** Searched, and the lens came up empty. */
const NO_MATCH_ICON = (
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5M8.5 11h5" />
  </>
);

/** All present and accounted for — there was nothing new to bring back. */
const ALL_HELD_ICON = (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.4 12.2 2.4 2.4 4.8-5.4" />
  </>
);

/** A chain with its two ends apart: the connection is the thing missing. */
const UNLINKED_ICON = (
  <>
    <path d="m18.8 12.3 1.7-1.7a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="m5.2 11.7-1.7 1.7a5 5 0 0 0 7 7l1.7-1.7" />
  </>
);

/** Broadcast, for the one scope that is other people's machines answering. */
const NO_RELEASES_ICON = (
  <>
    <path d="M4.9 19.1a10 10 0 0 1 0-14.2M19.1 4.9a10 10 0 0 1 0 14.2" />
    <path d="M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4" />
    <path d="M12 12h.01" />
  </>
);

/**
 * What is being waited for, drawn where it will land: tiles the shape of the
 * tiles — poster at the card radius with two caption lines under it, on the
 * gaps `Grid` and `Tile` use. A placeholder that does not sit where its answer
 * will sit moves the whole shelf the moment the answer arrives.
 */
function ResultsSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className="skeleton aspect-[2/3] rounded-card" />
            <div className="flex flex-col gap-1.5">
              <div className="skeleton h-3 w-3/4" />
              <div className="skeleton h-2 w-2/5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The same idea for the other tab, in the other shape: releases are rows, so
 * what is being waited for is rows.
 */
function ReleasesSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-2">
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="skeleton h-14 w-full rounded-card" />
      ))}
    </div>
  );
}

export function SearchView() {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("library");

  // The term is held with its answer, so a result can say which question it
  // was the answer to: while the next one is in flight the last one stays on
  // screen, dimmed, rather than blinking out to skeletons at every keystroke.
  const [answer, setAnswer] = useState<{
    term: string;
    results: UniversalResults;
  } | null>(null);

  /**
   * The indexers' answer, held the same way and separately: the two are
   * answers to the same words from different places, and one arriving must not
   * throw the other away — flipping back to a tab you have already used should
   * show what it found, not ask for it again.
   */
  const [releases, setReleases] = useState<{
    term: string;
    response: UpgradeResponse;
  } | null>(null);
  const [sort, setSort] = useState<Sort>(PREFERENCE.sort);

  const [pending, startTransition] = useTransition();

  /**
   * What the heart says before the server has been asked again. Kept across
   * searches, because a film wanted in one search is still wanted when it comes
   * back in the next one — and keyed by kind as well as id, since TMDb numbers
   * films and series separately and the two sequences overlap.
   *
   * It outlives the page too. A cached answer carries the `wishlisted` flag it
   * was fetched with, so without this a heart pressed before opening a film
   * would come back empty on the way out.
   */
  const [wants, setWants] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(WANTS),
  );
  const [saving, startSaving] = useTransition();

  // Only the newest search may set the results: a slow request for two letters
  // must not land on top of the answer to five.
  const seq = useRef(0);

  /** The results, so the field can hand the keyboard down into them. */
  const shelf = useRef<HTMLDivElement>(null);

  const term = query.trim();

  /*
   * What has already been found for exactly these words, from the cache.
   *
   * Read here rather than seeded into state at mount, so it holds for words
   * typed a second time as well as for words the page was opened with — and so
   * there is one answer to "have these words been asked", not a copy of the
   * cache in state that has to be kept level with it.
   */
  const knownResults = term ? ANSWERS.get(term) : undefined;
  const knownResponse = term ? RELEASES.get(term) : undefined;

  // Whether the tab in front of you is already showing the answer to what is
  // in the field. Switching between the three TMDb tabs asks nobody anything:
  // they are one answer read three ways, so only the indexers are ever a
  // second request — and words asked once are not a request at all.
  const answered =
    mode === INDEXER
      ? Boolean(knownResponse) || releases?.term === term
      : Boolean(knownResults) || answer?.term === term;

  useEffect(() => {
    if (!term || answered) return;

    const timer = window.setTimeout(
      () => {
        const ticket = ++seq.current;
        startTransition(async () => {
          /*
           * Only an answer is kept. A search that failed — Jackett down, TMDb
           * refusing — is not a state worth restoring: cached, it would still
           * be on screen after you had gone to Settings and fixed the thing it
           * was complaining about, and only retyping would shift it.
           */
          if (mode === INDEXER) {
            const response = await searchTorrents(term);
            if (response.ok) remember(RELEASES, term, response);
            if (seq.current === ticket) setReleases({ term, response });
          } else {
            const results = await universalSearch(term);
            if (!results.error) remember(ANSWERS, term, results);
            if (seq.current === ticket) setAnswer({ term, results });
          }
        });
      },
      mode === INDEXER ? INDEXER_DEBOUNCE_MS : DEBOUNCE_MS,
    );

    return () => window.clearTimeout(timer);
  }, [term, mode, answered]);

  /** The next scope along, wrapping — Tab forwards, Shift+Tab back. */
  function cycle(step: number) {
    const at = SCOPES.findIndex((scope) => scope.key === mode);
    setMode(SCOPES[(at + step + SCOPES.length) % SCOPES.length].key);
  }

  /**
   * What the keys do while the field has the focus.
   *
   * Tab is taken because the field is where you already are: the same words
   * asked of somewhere else is the commonest thing to want next, and reaching
   * for the menu to do it means leaving the keyboard. Down takes its place as
   * the way out — it moves into the results, which is where Tab would otherwise
   * have gone, so the shelf stays reachable without a mouse.
   *
   * Both only from the field. Once the focus is in the results Tab is Tab again
   * and walks them one by one.
   */
  function onFieldKey(event: React.KeyboardEvent) {
    if (
      event.key === "Tab" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      event.preventDefault();
      cycle(event.shiftKey ? -1 : 1);
      return;
    }

    if (event.key === "ArrowDown") {
      const first = shelf.current?.querySelector<HTMLElement>("a, button");
      if (!first) return;
      event.preventDefault();
      first.focus();
    }
  }

  const wanted = (hit: DiscoverHit) => wants[wantKey(hit)] ?? hit.wishlisted;

  function want(hit: DiscoverHit) {
    const next = !wanted(hit);
    // Written to the module as well as to state, so it survives the page.
    WANTS.set(wantKey(hit), next);
    setWants({ ...wants, [wantKey(hit)]: next });
    startSaving(async () => {
      if (next) await addWish(hit);
      else await removeWish(hit.id, hit.kind);
    });
  }

  // An empty field has no answer, whatever the last one was.
  //
  // The cache first: it is the answer to the words in the field, where what is
  // in state may still be the answer to the last three letters. That is what
  // keeps a slow request for a shorter term from landing over a cached one.
  const results = term ? (knownResults ?? answer?.results ?? null) : null;
  const library = results?.library ?? [];
  const discover = results?.discover ?? [];
  // One answer, split the way the tabs read it.
  const films = discover.filter((hit) => hit.kind === "movie");
  const shows = discover.filter((hit) => hit.kind === "tv");
  // And the same split of what you have, for the headings on that shelf.
  const heldFilms = library.filter((hit) => hit.kind === "movie");
  const heldShows = library.filter((hit) => hit.kind === "tv");

  const response = term ? (knownResponse ?? releases?.response ?? null) : null;
  const search = response?.ok ? response.search : undefined;
  // All of it. A cut would mean the sort could only rearrange what the cut
  // already chose, and "most seeders" would never reach the rest.
  const showing = search ? [...search.results].sort(SORTS[sort]) : [];

  const stale = !answered;
  // Asked, but nothing back yet — the only state the skeletons stand in for.
  const loading = Boolean(term) && (mode === INDEXER ? !response : !results);

  // Counts as soon as there is an answer to count, so the menu says where the
  // results are rather than making you open each scope to find out. Each one
  // only once it has been asked: a blank beside "Indexers" is the honest
  // reading of a question nobody has put yet, and a nought would be a lie.
  const found: Record<Mode, number | undefined> = {
    library: results ? library.length : undefined,
    tmdb: results ? discover.length : undefined,
    indexer: response ? showing.length : undefined,
  };

  const scope = SCOPES.find((option) => option.key === mode) ?? SCOPES[0];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      {/* One instrument: where to look, what to look for, and — where they are
          releases — how to order what comes back. */}
      <Bar className="min-w-0 shrink-0">
        <Popover
          icon={scope.icon}
          label="Where to search"
          value={scope.label}
          width="w-56"
          // At the head of the bar, so it hangs from the same edge as the
          // button that opens it rather than reaching back off the left of it.
          align="left"
          // A stated width, because the three labels are of three lengths and
          // the field takes whatever is left: sized to the longest of them, so
          // cycling the scope does not drag the words you are typing sideways.
          // Narrow where the label is hidden anyway — the mark alone, at the
          // width of the mark. The bar's first slot, so the fill follows its
          // rounded end.
          buttonClassName="w-12 rounded-l-full sm:w-32"
        >
          {(close) => (
            <div className="py-1">
              {SCOPES.map((option) => (
                <MenuItem
                  key={option.key}
                  active={option.key === mode}
                  onClick={() => {
                    setMode(option.key);
                    close();
                  }}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <ScopeIcon path={option.icon} />
                    {option.label}
                  </span>
                  {found[option.key] !== undefined && (
                    <span className="ml-auto text-[11px] tabular-nums opacity-40">
                      {found[option.key]}
                    </span>
                  )}
                </MenuItem>
              ))}

              {/* Said once, under the menu it saves you opening. */}
              <p className="mt-1 border-t border-line px-3 py-2 text-[11px] opacity-40">
                Tab cycles these while you are typing.
              </p>
            </div>
          )}
        </Popover>

        <BarSearch
          value={query}
          onChange={setQuery}
          onKeyDown={onFieldKey}
          placeholder="Search every film and show — yours and everything else"
          autoFocus
        />

        {/* The sort belongs to the releases, so it is offered with them. */}
        {mode === INDEXER && showing.length > 0 && (
          <Popover
            icon={ICONS.sort}
            label="Sort"
            value={
              (SORT_OPTIONS.find((o) => o.key === sort) ?? SORT_OPTIONS[0])
                .label
            }
            // The bar's last slot, so the fill follows its rounded end.
            buttonClassName="rounded-r-full"
          >
            {(close) => (
              <div className="py-1">
                {SORT_OPTIONS.map((option) => (
                  <MenuItem
                    key={option.key}
                    active={option.key === sort}
                    onClick={() => {
                      setSort(option.key);
                      PREFERENCE.sort = option.key;
                      close();
                    }}
                  >
                    {option.label}
                  </MenuItem>
                ))}
              </div>
            )}
          </Popover>
        )}
      </Bar>

      {/* Dimmed while the next answer is on its way, rather than cleared: what
          is on screen is still the answer to nearly the same question.

          And the only thing that scrolls: the bar is the one part that must not
          move out from under the words being typed into it. */}
      <div
        ref={shelf}
        className={`flex min-h-0 flex-1 flex-col gap-10 overflow-y-auto px-1 pb-1 transition-opacity duration-150 ${
          pending && stale ? "opacity-50" : ""
        }`}
      >
        {!term && (
          <EmptyState
            icon={
              <>
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </>
            }
            title="Search everything"
          >
            Films and shows, whether or not you have them. What is on the drive
            is the first shelf, TMDb is everything else, and the indexers answer
            the same words themselves.
          </EmptyState>
        )}

        {loading &&
          (mode === INDEXER ? <ReleasesSkeleton /> : <ResultsSkeleton />)}

        {mode === "library" &&
          (library.length > 0 ? (
            <>
              {heldFilms.length > 0 && (
                <Section
                  title="Films"
                  note={`${heldFilms.length} on the drive`}
                >
                  <Grid>
                    {heldFilms.map((hit, i) => (
                      <OwnedTile
                        key={`${hit.kind}:${hit.id}`}
                        hit={hit}
                        index={i}
                      />
                    ))}
                  </Grid>
                </Section>
              )}

              {heldShows.length > 0 && (
                <Section
                  title="Shows"
                  note={`${heldShows.length} on the drive`}
                >
                  <Grid>
                    {heldShows.map((hit, i) => (
                      <OwnedTile
                        key={`${hit.kind}:${hit.id}`}
                        hit={hit}
                        index={i}
                      />
                    ))}
                  </Grid>
                </Section>
              )}
            </>
          ) : (
            results && (
              <EmptyState icon={NO_MATCH_ICON} title="No match on the drive">
                Nothing you have matches “{term}”. The other two scopes look
                past your own shelves.
              </EmptyState>
            )
          ))}

        {mode === "tmdb" && (
          <>
            {films.length > 0 && (
              <Section title="Films" note={`${films.length} you do not have`}>
                <Grid>
                  {films.map((hit, i) => (
                    <DiscoverTile
                      key={wantKey(hit)}
                      hit={hit}
                      index={i}
                      wanted={wanted(hit)}
                      busy={saving}
                      onWant={() => want(hit)}
                    />
                  ))}
                </Grid>
              </Section>
            )}

            {shows.length > 0 && (
              <Section title="Shows" note={`${shows.length} you do not have`}>
                <Grid>
                  {shows.map((hit, i) => (
                    <DiscoverTile
                      key={wantKey(hit)}
                      hit={hit}
                      index={i}
                      wanted={wanted(hit)}
                      busy={saving}
                      onWant={() => want(hit)}
                    />
                  ))}
                </Grid>
              </Section>
            )}

            {/* Only what is missing: anything TMDb turned up that is already on
                the drive is on the first shelf rather than offered again here. */}
            {results?.tmdb && discover.length === 0 && (
              <EmptyState icon={ALL_HELD_ICON} title="Nothing new to add">
                Nothing at TMDb matches “{term}” that you do not already have.
              </EmptyState>
            )}

            {results && !results.tmdb && (
              <EmptyState icon={UNLINKED_ICON} title="TMDb is not connected">
                Only your own library is searched. Connect it on the{" "}
                <Link href="/settings" className="underline underline-offset-4">
                  Settings page
                </Link>{" "}
                to reach everything else.
              </EmptyState>
            )}
          </>
        )}

        {mode !== INDEXER && results?.error && (
          <p className="font-mono text-sm text-red-600 dark:text-red-400">
            {results.error}
          </p>
        )}

        {/* What the indexers hold, in the rows the upgrade dialog uses. A
            release read one way on one screen and another way on the next would
            be two rubrics wearing the same clothes — and here there is neither
            a copy you hold nor a disc to weigh it against, so the score is what
            the name alone implies. */}
        {mode === INDEXER && search && showing.length > 0 && (
          /* No heading over these. The scope you are in already says they are
             releases, and the sort control sits beside it — a "Releases" rule
             under the Indexers scope is the same word twice. */
          /* And no card round them either. The other two scopes put their
             answers straight onto the page, so a bordered box here would say
             the releases are a different kind of thing rather than the same
             question asked somewhere else. Ruled apart instead, by the hairline
             this app parts everything with.

             `Result` is its own <li>, so the list is its parent and nothing
             else: wrapping each one put an <li> inside an <li>. */
          <ul>
            {showing.map((release) => (
              <Result
                key={`${release.title}-${release.infoHash ?? release.indexer}`}
                release={release}
                ruled
              />
            ))}
          </ul>
        )}

        {mode === INDEXER && search && showing.length === 0 && (
          <EmptyState icon={NO_RELEASES_ICON} title="Nothing from the indexers">
            No indexer returned a thing for “{search.query}”. Try fewer words —
            they match release names, and a name rarely says more than the title
            and the year.
          </EmptyState>
        )}

        {mode === INDEXER && response && !response.ok && (
          <p className="font-mono text-sm text-red-600 dark:text-red-400">
            {response.error}
          </p>
        )}
      </div>
    </div>
  );
}
