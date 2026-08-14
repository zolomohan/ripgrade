"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
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
 * How many posters a fan opens with when nothing better is known — see
 * `useFanRoom`, which explains why it may not open with none.
 *
 * The ladder's own length, for want of a measurement: it is about what a row of
 * ordinary width shows, so it is usually close and never absurd.
 */
const SEED = PACE_STEPS;

/**
 * And what each row measured the last time it was drawn.
 *
 * The seed above is a guess, and a guess is only good enough once. A fan that
 * opens at six and measures itself at thirty is twenty-four posters arriving a
 * frame after the twenty-four you were flying into were needed — the same
 * lateness that made this list impossible to arrive at in the first place, at a
 * smaller size. But the answer does not change between visits: the row is the
 * same width, the name is the same name, and the face has long since loaded. So
 * it is kept, and every visit after the first opens at the answer and re-measures
 * to confirm it.
 *
 * Outside the component on purpose. It is not state — nothing re-renders when it
 * changes — and it has to outlive the unmount, which is the whole point of it.
 * Keyed on what the measurement depends on, so a renamed set measures afresh.
 */
const measured = new Map<string, number>();

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
  const remembered = `${name}|${meta}`;

  /**
   * Null until measured — but drawn as a count rather than as none.
   *
   * It was none, and that was a fan that could not be arrived at. A poster only
   * flies between two pages if it is on both of them at the moment React works
   * out what pairs with what, and that moment is the commit the navigation
   * makes. The measurement below is a layout effect, so the posters it admits
   * mount one commit later — which is late enough to be a different page as far
   * as the transition is concerned. Coming *from* this list everything flew,
   * because by then the fan had been measured for as long as you had been
   * looking at it; arriving from the shelf, the row you were flying into was
   * empty and nothing moved at all.
   *
   * So the fan opens at what this row measured last time, and at `SEED` the
   * first time it is ever drawn — and either way is corrected before the frame
   * is painted. Nobody sees the opening count; what they see is that the posters
   * are there to be arrived at.
   */
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
      const next = Math.min(films, Math.max(1, fits));
      measured.set(remembered, next);
      setShown(next);
    };

    measure();

    // The name is set in the display face, so its natural width changes under
    // the measurement when that face arrives — and again on every resize.
    document.fonts?.ready.then(measure);
    const observer = new ResizeObserver(measure);
    if (row.current) observer.observe(row.current);
    return () => observer.disconnect();
  }, [films, name, meta, remembered]);

  return {
    row,
    words,
    shown: shown ?? Math.min(films, measured.get(remembered) ?? SEED),
  };
}

/**
 * Which fan may name which film, down a list of sets.
 *
 * A view-transition name is a promise that one element on the page is wearing
 * it, and the browser does not merely ignore a second claimant — it abandons the
 * whole transition, every pairing on the page with it.
 *
 * TMDb's sets could never break that: a film belongs to at most one franchise,
 * so the names down the Found list are unique by construction. A set of your own
 * is the opposite kind of thing — the same film can be on your Favourites and
 * your Rewatch list and two more besides — and every one of those rows drew the
 * same poster under the same name. One duplicate anywhere in the list and
 * nothing on the page flew at all, which is why this worked until the day the
 * second kind of collection arrived.
 *
 * So the first row to claim a film keeps it and the rest draw the same poster
 * unnamed, exactly as they already draw a film you do not own. What is lost is
 * that one poster flying out of one row; what it buys is every other poster in
 * the list flying at all.
 *
 * Claimed over each set's whole list rather than the part of the fan that fits,
 * because how many fit is measured in the browser after the first paint and this
 * has to be settled while rendering. The cost is a poster held back in a later
 * row for a film an earlier row is not actually showing; the guarantee is that
 * no two are ever wearing one name, which is the only part that is fatal.
 *
 * Worked out up front rather than accumulated through the map that draws the
 * rows: a set mutated while rendering is a set that goes on growing across
 * renders.
 */
function claimPosters(rows: CollectionFilm[][]): ReadonlySet<string>[] {
  const claimed = new Set<string>();

  return rows.map((films) => {
    const mine = new Set<string>();
    for (const film of films) {
      const key = film.owned?.path;
      if (!key || claimed.has(key)) continue;
      claimed.add(key);
      mine.add(key);
    }
    return mine;
  });
}

/**
 * The name a poster in a fan answers to, whether or not it has anywhere to go.
 *
 * A held film wears the name it wears everywhere in the app, because that is
 * what pairs it with the grid on the set's page and the tile on the shelf. A
 * film you do not own has no such counterpart and gets a name of its own
 * anyway — one that pairs with nothing, and is here purely so the poster is
 * *captured*.
 *
 * Which is the whole point of it. A transitioning element is lifted out of the
 * page into a layer painted above all of it, so a fan where four posters fly and
 * six stay behind is four posters sailing over the top of six and dropping back
 * into the stack at the last frame — the pile reassembling itself in front of
 * you. Nothing that overlaps a flyer may be left in the page layer, and in a fan
 * every poster overlaps its neighbour, so the answer is that all of them travel:
 * four of them across the page and six of them nowhere at all.
 *
 * Scoped to the row, which is what makes it safe to hand out freely. A film can
 * be on two of your lists, and a name is a promise that one element is wearing
 * it — so the name that pairs is claimed once (see `claimPosters`) and this one,
 * which pairs with nothing, is different in every row it appears in.
 */
const fanName = (scope: number | string, film: CollectionFilm) =>
  posterName(`fan-${scope}-${filmKey(film)}`);

/**
 * Which poster is over which, said out loud rather than left to fall out of the
 * document.
 *
 * At rest a fan stacks itself: flex items paint in document order, so writing
 * the posters left to right is the whole of it. In flight none of that survives.
 * Every captured element is lifted into one layer above the page, and the order
 * of that layer is the order the browser *registered the names in* — the ones
 * captured from the page you are leaving first, then the ones that exist only on
 * the page you are arriving at, appended after. In a fan where some posters pair
 * and some do not, that is never the fan's own order: it is "everything that
 * flew, then everything that did not", which is a stack the page never had and
 * never returns to. Whichever half was left out came back over the other at the
 * last frame.
 *
 * So the stacking is stated. Each poster carries its place in the fan as a pair
 * of classes, `::view-transition-group` works a `z-index` out of them, and the
 * flight stacks the way the row does because it has been told to rather than
 * because the capture happened to agree.
 *
 * A pair rather than one class per place because a fan is as long as it needs to
 * be — one of your lists holds thirty-eight films, and a wide row with a short
 * name shows most of them. Written the obvious way that is a stylesheet with
 * forty near-identical rules in it; written as two digits in base
 * `FAN_RADIX` it is sixteen, and the group multiplies them back out. See
 * globals.css.
 *
 * Beyond what two digits can count the last place is reused, which is a fan of
 * sixty-four posters in a row that could not draw a quarter of them.
 */
const FAN_RADIX = 8;

const FAN_Z = (order: number) => {
  const place = Math.min(order, FAN_RADIX * FAN_RADIX - 1);
  return `fan fan-hi-${Math.floor(place / FAN_RADIX)} fan-lo-${place % FAN_RADIX}`;
};

function Fan({
  films,
  travels,
  scope,
}: {
  films: CollectionFilm[];
  /** Which of them this row is the one to fly — see `claimPosters`. */
  travels: ReadonlySet<string>;
  /** This row's own key, so the posters going nowhere are named apart. */
  scope: number | string;
}) {
  /*
   * Whether a poster is paired with a tile on the set's own page. The held ones
   * are, and the page lays those out first; a set of your own can also hold
   * films you do not own, and those travel nowhere — they are drawn in the fan
   * because a set you made is mostly recognised by the films in it, but they
   * carry no name and so no pace.
   */
  const flies = (film: CollectionFilm) =>
    Boolean(film.owned && travels.has(film.owned.path));

  /*
   * How many of these actually fly, which is what the ladder is measured
   * against: counting the ones that do not would put the two sides of the
   * pairing on different rungs of it.
   */
  const paced = films.filter(flies).length;

  return (
    /* Overlapped, each poster laid over the one to its left.
     *
     * Written in the order it is read, which is the whole of why it is written
     * this way. It was laid `flex-row-reverse` over a reversed array — the same
     * fan, arrived at from the other end — and that put document order opposite
     * to visual order. At rest that is invisible and free: flex items paint in
     * document order, so the reversal simply decided the overlap. In flight it
     * is not free, because the browser stacks the snapshots it captures in
     * document order too — and the snapshots are of the *unreversed* elements.
     * The two orders disagreed, so the fan flew with its stack one way round and
     * landed with it the other, snapping over at the last frame.
     *
     * One order, stated once, and the two cannot disagree again. `pl-4` on this
     * pays back the first poster's own `-ml-4`, which every one of them carries
     * so the rule is the same for all of them.
     */
    <div className="flex shrink-0 items-center pl-4">
      {films.map((film, order) => {
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
         * Every poster travels, and only some of them go anywhere.
         *
         * A held one that this row is the first to claim wears the name it
         * wears everywhere in the app, so it flies out from under the others to
         * the place it occupies in the grid, and back under them on the way
         * out. Everything else — a film you do not own, or one an earlier row
         * already claimed — wears a name of its own that pairs with nothing,
         * and is captured only so that it stays in the same stack as the ones
         * that do fly. See `fanName`, and `FAN_STILL` in globals.css for what a
         * poster with nowhere to go does for the length of the flight, which is
         * nothing at all.
         *
         * `update` stays off. A row repainting because the library rescanned is
         * not a thing anybody asked to watch.
         */
        const ladder = pace(order, paced);
        const z = FAN_Z(order);

        return (
          <ViewTransition
            key={filmKey(film)}
            name={
              flies(film) ? posterName(film.owned!.path) : fanName(scope, film)
            }
            // Two classes on every state, and the second is the same one every
            // time: how fast this poster travels is a question about its place
            // in the fan, and so is what it is drawn over.
            share={{
              default: `${ladder.default} ${z}`,
              "nav-back": `${ladder["nav-back"]} ${z}`,
            }}
            enter={`fan-still ${z}`}
            exit={`fan-still ${z}`}
            update="none"
          >
            {tile}
          </ViewTransition>
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
  travels,
  transitionKey,
  index,
}: {
  href: string;
  name: string;
  meta: string;
  films: CollectionFilm[];
  /** Which of this row's films it is the one to fly — see `claimPosters`. */
  travels: ReadonlySet<string>;
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
      // `row-enter-still` rather than `row-enter`: this row holds a fan, and a
      // poster's flight is aimed at where it will be at the moment the
      // navigation commits. A row four pixels low and climbing is a row that
      // sends it four pixels low. See globals.css.
      className="glow row-enter-still -mx-3 flex items-center gap-4 rounded-card px-3 py-3 transition-colors hover:bg-surface"
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
      <Fan
        films={films.slice(0, shown)}
        travels={travels}
        scope={transitionKey}
      />
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

  // TMDb's sets cannot overlap — a film belongs to one franchise — so this
  // never actually holds a poster back here. It is run anyway, because "these
  // are disjoint" is a fact about somebody else's data and the failure it
  // guards against takes the whole page's transition down with it.
  const travels = claimPosters(sets.map((set) => set.owned));

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
            travels={travels[i]}
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

  // Held first, so the ones that travel to the set's page lead each fan and
  // their order matches the grid they are travelling into.
  const rows = sets.map((set) => [...set.owned, ...(set.missing ?? [])]);
  // And this is the list that needs it: your lists overlap, and until now one
  // film on two of them silently killed every transition on the page.
  const travels = claimPosters(rows);

  return (
    <div className="flex flex-col">
      {sets.map((set, i) => (
        <Fragment key={set.id}>
          {i > 0 && <Rule />}
          <Row
            href={`/collections/custom/${set.id}`}
            name={set.name}
            meta={films(rows[i].length)}
            films={rows[i]}
            travels={travels[i]}
            transitionKey={customCollectionKey(set.id)}
            index={i}
          />
        </Fragment>
      ))}
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
  /**
   * Which half is being read, held here as well as written to the address.
   *
   * The address is still the record — it is what a set's page comes back to —
   * but it cannot be the thing that renders, because a `replaceState` is not an
   * update React is holding the reins of. A view transition only happens for a
   * change React made inside `startTransition`, so the change has to be a piece
   * of state this component owns and hands to `startTransition` itself.
   *
   * Seeded from the address and never resynced, which is exactly right for a
   * switch written with `replaceState`: nothing else on this page moves the
   * parameter, and coming back from a set's page mounts this afresh and reads
   * it again.
   */
  const [tab, setTab] = useState<"tmdb" | "custom">(
    searchParams.get("t") === "tmdb" ? "tmdb" : "custom",
  );
  const [, startTransition] = useTransition();

  /**
   * Swapping halves, drawn as the same flight the rest of the page uses.
   *
   * A film can be in a franchise TMDb publishes *and* on a list you wrote, and
   * until now switching between the two halves was a cut: the row it was on
   * vanished and the row it was on appeared, with no way to see that it was the
   * same film in both. It is the same poster under the same name, which is all a
   * shared transition has ever needed — so it flies from the one row to the
   * other, at the ladder's own pace, and everything with nothing on the other
   * side simply changes over underneath it (`default="none"`, as everywhere).
   *
   * The address is written inside the same transition rather than beside it, so
   * the router's own repaint is part of the change being animated instead of a
   * second render arriving in the middle of it.
   */
  function select(next: string) {
    if (next === tab) return;

    startTransition(() => {
      setTab(next === "tmdb" ? "tmdb" : "custom");

      const params = new URLSearchParams(searchParams.toString());
      if (next === "tmdb") params.set("t", "tmdb");
      else params.delete("t");
      const qs = params.toString();
      window.history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
    });
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
