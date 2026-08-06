"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
import { Bar, BarSearch, ICONS, MenuItem, Popover, Switch } from "@/app/controls";
import { EmptyState } from "@/app/empty-state";
import { Result, SORTS, type Sort } from "@/app/release-search";
import { scoreTheme, STATUS_THEME } from "@/app/score-circle";
import { stagger } from "@/app/stagger";
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
 * It is a page like the others rather than a dialog over them, so it is built
 * out of what the others are built out of: the shelf switch, the bar, the
 * poster grid, the empty card.
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

/** The one tab that is not read out of the TMDb answer. */
const INDEXER: Mode = "indexer";

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

function Heart({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="h-3.5 w-3.5"
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
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
      {/* The heart is a sibling of the link rather than a child of it: a button
          inside an anchor is invalid, and one gesture would fire both. */}
      <div className="relative">
        <Link
          href={`/discover/${hit.kind}/${hit.id}`}
          className="glow glow-over tilt relative block aspect-[2/3] overflow-hidden rounded-card bg-surface-strong ring-1 ring-line"
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
          className={`absolute top-2 right-2 grid h-7 w-7 place-items-center rounded-full bg-background/85 backdrop-blur transition-opacity disabled:opacity-30 ${
            wanted
              ? "text-red-600 dark:text-red-400"
              : "opacity-0 hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-70"
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
 * What a tab says when it has nothing — the same card the library shows when
 * its filters match no film.
 */
function Nothing({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-surface px-4 py-12 text-center">
      <p className="text-sm opacity-50">{children}</p>
    </div>
  );
}

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
  /*
   * The words and the tab are mirrored into the URL, which is what makes this
   * page a place you can come back to: opening a film records the address you
   * left, and an address that said only "/search" would return you to an empty
   * field. See app/return-to.tsx.
   *
   * Read once, at mount, rather than held there. A field driven by the query
   * string would put a router round-trip between the keystroke and the letter
   * appearing; the state stays local and the URL follows it a render later.
   */
  const searchParams = useSearchParams();

  /** The words the page was opened with: an address is a search, here. */
  const opening = (searchParams.get("q") ?? "").trim();

  const [query, setQuery] = useState(opening);
  const [mode, setMode] = useState<Mode>(() => {
    const tab = searchParams.get("t");
    return tab === "tmdb" || tab === INDEXER ? tab : "library";
  });

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

  const term = query.trim();

  /*
   * The URL, kept level with the field. `replaceState` rather than a router
   * push: typing is not a series of pages to walk back through, and Next
   * threads its own history patch through this so `useSearchParams` stays true
   * without a server round-trip. Defaults are left out, so a search you have
   * not narrowed is a plain `/search?q=…`.
   */
  useEffect(() => {
    const params = new URLSearchParams();
    if (term) params.set("q", term);
    if (mode !== "library") params.set("t", mode);

    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
  }, [term, mode]);

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

  // Counts as soon as there is an answer to count, so the switch says where the
  // results are rather than making you open each shelf to find out. The
  // indexers carry none: theirs is a question that has not been asked yet.
  const tabs = [
    {
      key: "library",
      label: "Library",
      count: results ? library.length : undefined,
    },
    { key: "tmdb", label: "TMDb", count: results ? discover.length : undefined },
    { key: INDEXER, label: "Indexers" },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* The library's own row, asking the library's own question of it: which
          shelf on the left, the instrument that narrows it on the right. */}
      <div className="flex flex-wrap items-center gap-3">
        <Switch
          value={mode}
          onChange={(next) => setMode(next as Mode)}
          options={tabs}
        />

        <Bar className="ml-auto min-w-0 flex-1">
          <BarSearch
            value={query}
            onChange={setQuery}
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
      </div>

      {/* Dimmed while the next answer is on its way, rather than cleared: what
          is on screen is still the answer to nearly the same question. */}
      <div
        className={`mx-4 flex flex-1 flex-col gap-10 transition-opacity duration-150 ${
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
                <Section title="Films" note={`${heldFilms.length} on the drive`}>
                  <Grid>
                    {heldFilms.map((hit, i) => (
                      <OwnedTile key={`${hit.kind}:${hit.id}`} hit={hit} index={i} />
                    ))}
                  </Grid>
                </Section>
              )}

              {heldShows.length > 0 && (
                <Section title="Shows" note={`${heldShows.length} on the drive`}>
                  <Grid>
                    {heldShows.map((hit, i) => (
                      <OwnedTile key={`${hit.kind}:${hit.id}`} hit={hit} index={i} />
                    ))}
                  </Grid>
                </Section>
              )}
            </>
          ) : (
            results && <Nothing>Nothing on the drive matches “{term}”.</Nothing>
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
              <Nothing>
                Nothing at TMDb matches “{term}” that you do not already have.
              </Nothing>
            )}

            {results && !results.tmdb && (
              <Nothing>
                TMDb is not connected, so only your own library is searched.
                Connect it on the{" "}
                <Link href="/settings" className="underline underline-offset-4">
                  Settings page
                </Link>{" "}
                to reach everything else.
              </Nothing>
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
          /* No heading over these. The tab you are on already says they are
             releases, and the sort control sits beside it — a "Releases" rule
             under a Releases tab is the same word twice. */
          /* `Result` is its own <li>, so the list is its parent and nothing
             else: wrapping each one put an <li> inside an <li>. */
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <ul className="divide-y divide-line">
              {showing.map((release) => (
                <Result
                  key={`${release.title}-${release.infoHash ?? release.indexer}`}
                  release={release}
                />
              ))}
            </ul>
          </div>
        )}

        {mode === INDEXER && search && showing.length === 0 && (
          <Nothing>
            No indexer returned a thing for “{search.query}”. Try fewer words —
            they match release names, and a name rarely says more than the title
            and the year.
          </Nothing>
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
