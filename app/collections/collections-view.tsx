"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  ViewTransition,
} from "react";

import type { CollectionFilm, CollectionSet } from "@/lib/collections";
import type { CustomSet } from "@/lib/custom-collections";
import { Art } from "@/app/art";
import { Switch } from "@/app/controls";
import { EmptyState } from "@/app/empty-state";
import { stagger } from "@/app/stagger";
import {
  collectionMetaName,
  collectionTitleName,
  customCollectionKey,
  filmKey,
  posterName,
} from "@/lib/routes";
import { NewCollection } from "./new-collection";

/**
 * The sets, one line each.
 *
 * A grid of every film in every collection was a page you scrolled rather than
 * read: the answer it exists to give — which sets are short, and by how much —
 * was spread across screens of artwork. A row states that in one line and
 * carries just enough of the artwork to be recognised, with the set's own page
 * a click away for the films themselves.
 *
 * Two kinds of set live here, and the switch at the head is what says so. The
 * ones TMDb publishes are found rather than made: they appear because a film
 * you own belongs to one, and there is nothing to add to them. The ones you
 * make are the opposite in every respect and identical on the page, which is
 * the point — a set is a set, whoever drew up the list.
 */

/** How many paces the ladder in globals.css defines before it repeats. */
const PACE_STEPS = 6;

/**
 * Which pace a poster travels at, by its place in the set.
 *
 * Forwards the first is quickest; backwards the order inverts, so the poster
 * that arrived first is the last to leave. A fan that unfolds fastest-first and
 * folds back fastest-first would read as the same motion twice — reversing it
 * is what makes the way out feel like the way in undone.
 */
export const pace = (index: number, total: number) => ({
  default: `morph-in-${index % PACE_STEPS}`,
  "nav-back": `morph-out-${(total - 1 - index) % PACE_STEPS}`,
});

/**
 * The fan's geometry, in the units the classes below are written in: a poster
 * is 2.35rem wide and tucks 1rem under the one before it, and the fan holds
 * 1rem clear of the words on top of the row's own 1rem gap.
 *
 * Here rather than measured off the rendered tiles because there is a chicken
 * and an egg otherwise — how many to draw is the question, and a drawn tile is
 * the only thing there is to measure. Read against the root font size rather
 * than assumed to be sixteen pixels, so a set browser text size moves the count
 * along with everything else it moves.
 */
const POSTER_REM = 2.35;
const TUCK_REM = 1;
const CLEAR_REM = 2;

/**
 * How many posters fit in the row beside its name.
 *
 * The fan is what is left of a grid of every film in every collection, and it
 * was still the size of the set: forty films made forty posters, which on any
 * screen narrower than the fan itself squeezed the name it belongs to down to
 * an ellipsis. The artwork is there to make the row recognisable, and a row
 * whose name has been squeezed out is the opposite of recognisable.
 *
 * So the count is the answer to a question about this screen rather than about
 * the set: the posters run back from the right and stop where the name ends.
 * Which is not a number that can be written down — it depends on the width of
 * the window, the length of the name, and the face it is set in — so it is
 * measured, and measured again whenever any of the three changes.
 *
 * The name's *natural* width is what is reserved, not the width it has: the
 * <p> is `truncate`, so left to itself it would take the whole row and report
 * that as its due. `scrollWidth` is what it would like to be, which is the
 * thing the posters have to stay out of the way of.
 */
function useFanRoom(films: number, name: string, meta: string) {
  const row = useRef<HTMLAnchorElement>(null);
  const words = useRef<HTMLDivElement>(null);
  // Null until measured, drawn as none: a fan that arrives one frame too wide
  // and snaps back is a row that flinches as the page settles.
  const [shown, setShown] = useState<number | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const line = row.current;
      const block = words.current;
      if (!line || !block) return;

      const rem =
        parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const pad = getComputedStyle(line);
      const inside =
        line.clientWidth -
        parseFloat(pad.paddingLeft) -
        parseFloat(pad.paddingRight);

      const wanted = Math.max(
        ...[...block.querySelectorAll("p")].map((p) => p.scrollWidth),
      );
      const room = inside - wanted - CLEAR_REM * rem;

      // The first poster costs its whole width and every one after it only the
      // part that shows, which is what makes a fan cheaper than a row.
      const fits =
        Math.floor(
          (room - POSTER_REM * rem) / ((POSTER_REM - TUCK_REM) * rem),
        ) + 1;

      // At least one, where there is one to draw. A name long enough to leave
      // no room is already truncating against the full width of the row, and a
      // single poster costs it two characters to keep the row a picture of
      // something rather than a line of text.
      setShown(Math.min(films, Math.max(1, fits)));
    };

    measure();

    // The name is set in the display face, so its natural width changes under
    // the measurement when that face arrives — and again on every resize.
    document.fonts?.ready.then(measure);
    const observer = new ResizeObserver(measure);
    if (row.current) observer.observe(row.current);
    return () => observer.disconnect();
  }, [films, name, meta]);

  return { row, words, shown: shown ?? 0 };
}

function Fan({ films }: { films: CollectionFilm[] }) {
  /*
   * How many of these are paired with a tile on the set's own page — the held
   * ones, which the page lays out first and counts by itself. A set of your own
   * can hold films you do not own, and those travel nowhere: they are drawn in
   * the fan because a set you made is mostly recognised by the films in it, but
   * they carry no name and so no pace. Counting them would put the two sides of
   * the pairing on different rungs of the ladder.
   */
  const paced = films.filter((film) => film.owned).length;

  return (
    // Overlapped and laid right to left, so each poster tucks behind the one
    // before it and the leftmost stays whole.
    <div className="flex shrink-0 flex-row-reverse items-center pl-4">
      {films
        .map((film, order) => ({ film, order }))
        .reverse()
        .map(({ film, order }) => {
          const tile = (
            <div className="-ml-4 h-14 w-[2.35rem] shrink-0 overflow-hidden rounded-chip bg-surface-strong ring-1 ring-line">
              <Art
                src={film.owned?.poster}
                // The chosen artwork's own source before the record's default,
                // exactly as the library tile falls back — the fan and the
                // shelf must show the same picture.
                remote={film.owned?.posterSrc ?? film.posterPath}
                version={film.owned?.artAt}
                size="w92"
                loading="lazy"
                // At full strength whether or not the film is on a drive. The
                // fan is what the set *is* — the artwork you recognise it by —
                // and a poster held back to two-fifths reads as artwork that
                // failed to load rather than as a film you have not got yet.
                // Which of them are missing is a question the set's own page
                // answers, in a layout with the room to answer it.
                className="h-full w-full object-cover"
              />
            </div>
          );

          /*
           * Named with the film's own poster name, which is the name its tile
           * carries on the set's page and on the shelf and on its own page. One
           * name per film across the whole app means the fan does not need a
           * pairing of its own: each poster flies out from under the others to
           * the place it occupies in the grid, and back under them on the way
           * out. Only a held film has a path to be named by.
           */
          return film.owned ? (
            <ViewTransition
              key={filmKey(film)}
              name={posterName(film.owned.path)}
              share={pace(order, paced)}
              default="none"
            >
              {tile}
            </ViewTransition>
          ) : (
            <Fragment key={filmKey(film)}>{tile}</Fragment>
          );
        })}
    </div>
  );
}

/**
 * One set on one line, whoever drew up its list.
 *
 * Kept as one component rather than two that look alike: the row is where the
 * poster ladder starts, and two copies of it would be two copies of the pairing
 * to keep in step.
 */
function Row({
  href,
  name,
  meta,
  films,
  transitionKey,
  index,
}: {
  href: string;
  name: string;
  meta: string;
  films: CollectionFilm[];
  transitionKey: number | string;
  index: number;
}) {
  const { row, words, shown } = useFanRoom(films.length, name, meta);

  return (
    <Link
      ref={row}
      href={href}
      transitionTypes={["nav-forward"]}
      style={stagger(index)}
      className="glow row-enter -mx-3 flex items-center gap-4 rounded-card px-3 py-3 transition-colors hover:bg-surface"
    >
      <div ref={words} className="min-w-0 flex-1">
        <ViewTransition
          name={collectionTitleName(transitionKey)}
          share="title"
          default="none"
        >
          {/* `w-fit` so the box hugs the words. Left to fill the row, it
              is a 647px box holding 150px of text, and the heading it
              pairs with is only as wide as its own line — two boxes of
              different shape, which `contain` then scales by different
              amounts, so the fading title ends up larger than the one
              arriving. */}
          <p className="w-fit max-w-full truncate font-display leading-tight font-semibold tracking-tight">
            {name}
          </p>
        </ViewTransition>
        <ViewTransition
          name={collectionMetaName(transitionKey)}
          share="title"
          default="none"
        >
          <p className="mt-1 w-fit max-w-full text-xs leading-tight opacity-45">
            {meta}
          </p>
        </ViewTransition>
      </div>

      {/* The first however-many, which are the held ones and then the rest —
          the same order the set's own page lays them out in, so what travels
          is the front of the fan into the front of the grid. */}
      <Fan films={films.slice(0, shown)} />
    </Link>
  );
}

/** Fades out at both ends rather than ruling the full width: the rows are
    already separated by space, and this only has to mark where one ends
    without drawing a box around it. */
function Rule() {
  return (
    <div
      aria-hidden
      className="h-px bg-gradient-to-r from-transparent via-line-strong to-transparent"
    />
  );
}

const films = (count: number) => `${count} ${count === 1 ? "film" : "films"}`;

function Found({ sets }: { sets: CollectionSet[] }) {
  if (sets.length === 0) {
    return (
      <EmptyState
        icon={
          <>
            <rect x="3" y="7" width="13" height="14" rx="2" />
            <path d="M7 4h10a2 2 0 0 1 2 2v12" />
          </>
        }
        title="No collections yet"
      >
        These come from TMDb once films are matched, and only films that belong
        to one appear here.
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col">
      {sets.map((set, i) => (
        <Fragment key={set.id}>
          {i > 0 && <Rule />}
          <Row
            href={`/collections/${set.id}`}
            name={set.name}
            meta={films(set.owned.length)}
            films={set.owned}
            transitionKey={set.id}
            index={i}
          />
        </Fragment>
      ))}
    </div>
  );
}

function Yours({ sets }: { sets: CustomSet[] }) {
  if (sets.length === 0) {
    return (
      <EmptyState
        icon={
          <>
            <rect x="3" y="7" width="13" height="14" rx="2" />
            <path d="M7 4h10a2 2 0 0 1 2 2v12" />
            <path d="M9.5 14h4M11.5 12v4" />
          </>
        }
        title="No collections of your own"
        action={<NewCollection />}
      >
        A set of your own can hold anything — what you have, and what you have
        not got round to — and films join it from the library or straight from
        TMDb.
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col">
      {sets.map((set, i) => {
        // Held first, so the ones that travel to the set's page lead the fan
        // and their order matches the grid they are travelling into.
        const all = [...set.owned, ...(set.missing ?? [])];
        return (
          <Fragment key={set.id}>
            {i > 0 && <Rule />}
            <Row
              href={`/collections/custom/${set.id}`}
              name={set.name}
              meta={films(all.length)}
              films={all}
              transitionKey={customCollectionKey(set.id)}
              index={i}
            />
          </Fragment>
        );
      })}
    </div>
  );
}

export function CollectionsView({
  sets,
  custom,
}: {
  sets: CollectionSet[];
  custom: CustomSet[];
}) {
  /*
   * In the URL like every other tab in the app, so opening a set and coming
   * back returns you to the half you were reading. Written with the history API
   * rather than the router, exactly as the library's own switch does it: this
   * changes nothing the server has to answer for, and a navigation per tap
   * would put a stop on the back button for each one.
   */
  const searchParams = useSearchParams();
  /*
   * Yours is the half you arrive on, because it is the half you can act on:
   * the TMDb sets are a finding about the library and will be there whenever
   * you want them, and the ones you wrote are the ones you came to add to. The
   * address only carries the other one, which is what makes the plain
   * /collections the one your own sets answer.
   */
  const tab = searchParams.get("t") === "tmdb" ? "tmdb" : "custom";

  function select(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "tmdb") params.set("t", "tmdb");
    else params.delete("t");
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Switch
          value={tab}
          onChange={select}
          /* No counts on these. A count earns its place where it says
             something you would otherwise have to open the tab to learn — how
             many films are on a shelf — and here the number would only be the
             length of the list already under it. */
          options={[
            { key: "custom", label: "Yours" },
            { key: "tmdb", label: "TMDb" },
          ]}
          className="-ml-2"
        />

        {/* Only on the half it can act on, and not on the empty state, which
            offers the same button in the middle of the page where the eye
            already is. */}
        {tab === "custom" && custom.length > 0 && <NewCollection />}
      </div>

      {tab === "tmdb" ? <Found sets={sets} /> : <Yours sets={custom} />}
    </>
  );
}
