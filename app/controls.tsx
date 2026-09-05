"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { Glass } from "./glass";

/**
 * The pieces the library bar is built from, shared with the show shelf.
 *
 * Films and shows are filtered on different things but in the same way, and a
 * second set of look-alike controls would drift from this one the first time
 * either changed.
 */
/**
 * The count on a pill, as a badge rather than loose text.
 *
 * A number set in the label's own colour reads as part of the label — "Films
 * 74" as a phrase. Enclosing it says it is a quantity, and the selected pill
 * inverts to stay legible against the filled background.
 */
export function PillCount({
  children,
  active,
}: {
  children: React.ReactNode;
  active: boolean;
}) {
  return (
    <span
      className={`rounded-full px-1.5 text-[10px] leading-[16px] font-medium tabular-nums ${
        active
          ? "bg-background/25 text-background"
          : "bg-surface-strong opacity-70"
      }`}
    >
      {children}
    </span>
  );
}

/**
 * The height every control on the shelf's row is drawn at.
 *
 * The switch, the bar and the scan button sit on one line, and a line of
 * controls that agree on nothing but their vertical centre reads as three
 * things that happened to land together. Named because it has to be the same
 * number in three files.
 */
export const CONTROL_H = "h-10";

/**
 * The library bar: one surface, divided.
 *
 * It was six outlined boxes in a row — a search field and four controls, each
 * with the same border at the same weight — and a row where everything is
 * emphasised is a row where nothing is. Drawing the frame once and ruling the
 * controls apart inside it says what they are: one instrument for narrowing a
 * shelf, whose parts happen to open different panels.
 *
 * `items-stretch` so every part is the bar's own height, and the dividers run
 * its full depth rather than floating between differently-sized boxes.
 */
export function Bar({
  children,
  className = "",
}: {
  children: React.ReactNode;
  /** A bar with no field in it has nothing to take up the slack, so the films
      shelf asks it to be only as wide as its controls. */
  className?: string;
}) {
  return (
    // A stated height rather than whatever the contents happen to come to: the
    // bar shares a line with the shelf switch and the scan button, and three
    // controls of three heights read as three unrelated things.
    <div
      className={`flex ${CONTROL_H} items-stretch divide-x divide-line rounded-full border border-line bg-surface/60 transition-colors focus-within:border-line-strong ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * The field at the head of the bar. Borderless — the bar is its frame — and
 * given all the room left over, because typing a title is the thing this row is
 * used for most.
 */
export function BarSearch({
  value,
  onChange,
  placeholder,
  disabled,
  autoFocus,
  onKeyDown,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  /** For a search that cannot run yet — no API key, nothing to search. */
  disabled?: boolean;
  /** For the page whose whole purpose is this field. */
  autoFocus?: boolean;
  /** For a field that answers keys of its own — see the universal search, where
      Tab moves between the places the words are put. */
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 opacity-35"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" strokeLinecap="round" />
      </svg>

      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        // `focus-quiet`: the bar around this answers focus by brightening its
        // own border, so the app-wide outline would be a second ring drawn
        // inside the first. See the rule in globals.css — a utility cannot
        // turn it off.
        className="focus-quiet h-full w-full rounded-l-full bg-transparent pr-9 pl-11 text-sm outline-none placeholder:opacity-40 disabled:opacity-40"
      />

      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute top-1/2 right-3.5 -translate-y-1/2 text-sm opacity-40 hover:opacity-80"
        >
          ✕
        </button>
      )}
    </div>
  );
}

/**
 * The measurements behind a switch whose selection slides.
 *
 * The filled part is one element that moves rather than a background that turns
 * on in one option and off in another — a switch you can watch change position
 * says the choices are one thing seen different ways. Measured rather than
 * declared, because the options are of different widths and those widths depend
 * on the face the browser has actually loaded: a hard-coded offset is right
 * until the webfont arrives.
 *
 * Down a column as well as along a row. The rail's marker is the same object
 * doing the same job — one mark that moves between the choices rather than a
 * background switched off here and on there — and it is a column of rows rather
 * than a row of options, which is the whole of the difference. See
 * `app/sidebar.tsx`.
 */
export function useSlider(active: string, axis: "x" | "y" = "x") {
  const track = useRef<HTMLDivElement>(null);
  const options = useRef<Record<string, HTMLElement | null>>({});
  const [thumb, setThumb] = useState<{ at: number; size: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const option = options.current[active];
      // Nothing chosen is a real state where the options are pages rather than
      // the settings of one control: an address with no row of its own leaves
      // the rail with nothing to mark, and a marker left on the last row it
      // knew would be pointing at a page you are not on.
      setThumb(
        option
          ? axis === "x"
            ? { at: option.offsetLeft, size: option.offsetWidth }
            : { at: option.offsetTop, size: option.offsetHeight }
          : null,
      );
    };

    measure();

    // The face may still be swapping, and a narrow window wraps the row; either
    // moves the option out from under the thumb.
    document.fonts?.ready.then(measure);
    const observer = new ResizeObserver(measure);
    if (track.current) observer.observe(track.current);
    return () => observer.disconnect();
  }, [active, axis]);

  const register = (key: string) => (node: HTMLElement | null) => {
    options.current[key] = node;
  };

  // Hidden until measured, so it arrives in place rather than sliding in from
  // the left edge on first paint.
  const style =
    axis === "x"
      ? {
          transform: `translateX(${thumb?.at ?? 0}px)`,
          width: thumb?.size ?? 0,
          opacity: thumb ? 1 : 0,
        }
      : {
          transform: `translateY(${thumb?.at ?? 0}px)`,
          height: thumb?.size ?? 0,
          opacity: thumb ? 1 : 0,
        };

  // A tuple, so the ref reaches its element as a plain value: handed over as a
  // property of an object, it reads as a ref being dereferenced mid-render.
  return [track, register, style] as const;
}

export const SLIDE =
  "transition-[transform,width,height,opacity] duration-300 ease-[cubic-bezier(0.2,0.7,0.3,1)] motion-reduce:transition-none";

/**
 * A named choice between a few things, as one track with the chosen one raised
 * out of it. The library's two shelves and the stats page's two halves are the
 * same gesture, so they are the same control.
 */
export function Switch({
  value,
  onChange,
  options,
  className = "",
}: {
  value: string;
  onChange: (key: string) => void;
  /** A count says how much is behind an option without having to open it. */
  options: { key: string; label: string; count?: number }[];
  /**
   * Where the track sits, for the callers that have an opinion.
   *
   * The tab rows at the head of a page pass `-ml-2` through this: the track's
   * own padding and the first label's stand between the word and the page's
   * left edge, so a switch set flush reads as indented against the list under
   * it. Passed in rather than built in, because that is a fact about a page's
   * margins and not about the control.
   */
  className?: string;
}) {
  const [track, register, thumbStyle] = useSlider(value);

  return (
    <div
      ref={track}
      className={`relative flex ${CONTROL_H} shrink-0 items-stretch gap-1 self-start rounded-full border border-line bg-surface/60 p-1 ${className}`}
    >
      <span
        aria-hidden
        className={`absolute top-1 bottom-1 left-0 rounded-full bg-foreground ${SLIDE}`}
        style={thumbStyle}
      />

      {options.map((option) => (
        <button
          key={option.key}
          ref={register(option.key)}
          type="button"
          onClick={() => onChange(option.key)}
          aria-pressed={value === option.key}
          className={`glow relative flex items-center gap-2 rounded-full px-4 text-sm transition-colors ${
            value === option.key
              ? "text-background"
              : "opacity-60 hover:opacity-100"
          }`}
        >
          {option.label}
          {option.count !== undefined && (
            <PillCount active={value === option.key}>{option.count}</PillCount>
          )}
        </button>
      ))}
    </div>
  );
}

export const ICONS = {
  filter: "M3 5h18l-7 8.2V19l-4 2v-7.8z",
  /**
   * Two arrows pointing opposite ways: an order, and the fact that it can be
   * turned round.
   *
   * It was a stack of shortening lines, which is a picture of a list that has
   * been sorted — indistinguishable at 16px from `group` above it, and from
   * the filter beside it, all three being horizontal rules in a row. The two
   * arrows say the thing the button actually does rather than what the list
   * looks like afterwards, and they are the only mark in the bar with a
   * vertical in it.
   */
  sort: "M3 9l4 -4l4 4m-4 -4v14M21 15l-4 4l-4 -4m4 4v-14",
  group: "M4 5h16M4 10h16M8 15h12M8 19h12",
  // The two shapes a list can be read in, drawn as what they produce rather
  // than as an idea about it: four tiles, and two bands running the width of
  // the page. Deliberately not another set of horizontal lines — `group` is
  // already one, and a second in the same bar would be a button you have to
  // click to find out what it was.
  grid: "M4 5h6v6H4zM14 5h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  rows: "M4 6h16v4H4zM4 14h16v4H4z",
  /**
   * A signal going out: a dot with arcs radiating either side of it.
   *
   * The app's word for the one thing that is not this machine answering — a
   * question put to other people's, which is what an indexer search is. It was
   * written for the search window's scope menu, where it stands against a shelf
   * of tiles for the library and a globe for TMDb, and it is here because a
   * second thing now needs it: the button that asks the indexers again.
   *
   * That button wore a circular arrow, which is the mark for "do that again"
   * and says nothing about what the again is. Two controls that reach the same
   * machines should carry the same mark; a reader who has met it once in ⌘F has
   * been told what it means, and a reload arrow could have meant re-reading the
   * drive — which was, then, a different button doing a different thing.
   *
   * It stays on the wishlist's button, which is still only that: a page of
   * films nobody has, asking other people's machines about them. The library
   * shelf's button has grown a drive pass in front of its search and wears
   * `scan` below, for the reason given there.
   */
  indexers:
    "M12 12h.01M8.6 15.4a4.8 4.8 0 0 1 0-6.8M15.4 8.6a4.8 4.8 0 0 1 0 6.8M5.6 18.4a8.9 8.9 0 0 1 0-12.8M18.4 5.6a8.9 8.9 0 0 1 0 12.8",
  /**
   * Four corners and a beam across them: something being read.
   *
   * For the button that stopped being a single question. It reads the library
   * folders and then asks the indexers — two places, one press — and no
   * picture of either half is honest about the other: a signal going out says
   * nothing about the drive, and a drive says nothing about the search. A
   * scanner's frame is not a picture of either place. It is a picture of the
   * act both halves are, which is the thing the press actually means.
   *
   * The corners are also the app's own shape for "what is inside this" — the
   * four brackets a viewfinder draws round whatever it is pointed at, here
   * pointed at the shelf underneath the button.
   */
  scan: "M5 12h14M3 7v-2a2 2 0 0 1 2 -2h2M3 17v2a2 2 0 0 0 2 2h2M17 3h2a2 2 0 0 1 2 2v2M17 21h2a2 2 0 0 0 2 -2v-2",

  /*
   * And the marks the action menus wear, which are a different kind of icon
   * from the five above: those name a question a bar asks of a list, these name
   * a thing that will happen when you let go of the mouse. They are here all
   * the same, and for the reason this list exists at all — a bin drawn twice is
   * a bin that comes to be drawn two ways, and the app had reached three
   * crosses before anybody counted them.
   */

  /** Rename: the pencil, with the line where the nib is bound to the shaft. */
  rename: "M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17zM14.5 7.5l3 3",
  /**
   * Delete: the bin the transfer tiles already wear, which is where this path
   * comes from — see `BinIcon` on the downloads page, which now draws it from
   * here rather than from its own copy.
   */
  bin: "M5 7h14M9.5 7V4.8h5V7M6.9 7l.8 11.5a1.7 1.7 0 0 0 1.7 1.6h5.2a1.7 1.7 0 0 0 1.7-1.6L17.1 7",
  /**
   * The two faces of the one control that undoes itself, in the shape a media
   * control has been for fifty years.
   */
  pause: "M9.5 5.5v13M14.5 5.5v13",
  play: "M8 5.5v13l11-6.5z",
  /**
   * The app's own cross, at the app's own weight: a cross should be one cross
   * however many lists draw it. What it means is left to the row around it.
   */
  cross: "M6 6l12 12M18 6L6 18",
};

/**
 * A small button that opens a panel under itself.
 *
 * All three controls behave the same way — click to open, click away or press
 * Escape to close — so the row stays a row of buttons rather than a mix of
 * native selects and a panel that pushed the list down the page.
 */
/**
 * A word replaced by turning it out of sight, rather than by being swapped.
 *
 * The search scope is the case this exists for. Tab cycles it while you are
 * typing — see `SearchView` — so the label under your eye changes without
 * anything being clicked, and a straight swap at that distance from the cursor
 * is a flicker you notice and cannot account for. Something has to say which
 * way the change went.
 *
 * So the two words are two faces of a solid turning on its long axis: the one
 * you were reading tips away from you and down, and the next comes up into its
 * place from the front. `perspective` is what makes that a rotation rather than
 * a vertical squash — without it the faces scale and the whole thing reads as a
 * blind being drawn. See `.flip` in globals.css.
 *
 * Both faces are on screen together for the length of the turn, which is what
 * the outgoing copy is for. It is `aria-hidden` and out of the flow: what a
 * reader should hear is the value, once, not the value it stopped being.
 */
function Flip({ children }: { children: string }) {
  const [shown, setShown] = useState(children);
  const [gone, setGone] = useState<string | null>(null);
  /* Bumped on every change, and used as a key on both faces. Two presses of
     Tab inside one turn are two turns, and without this the second would find
     the elements already mid-animation and let them finish the first. */
  const [turn, setTurn] = useState(0);

  if (shown !== children) {
    setGone(shown);
    setShown(children);
    setTurn((was) => was + 1);
  }

  useEffect(() => {
    if (gone === null) return;
    // The length of `flip-out`, after which there is nothing left to see and
    // the copy is only an element in the way.
    const timer = setTimeout(() => setGone(null), 320);
    return () => clearTimeout(timer);
  }, [gone, turn]);

  return (
    <span className="flip hidden sm:inline-block">
      {/* Not on the first render: a value that turns into place as the page
          arrives is a page that looks like it changed its mind. */}
      <span key={turn} className={turn === 0 ? undefined : "flip-in"}>
        {shown}
      </span>

      {gone !== null && (
        <span key={`${turn}-gone`} aria-hidden className="flip-out">
          {gone}
        </span>
      )}
    </span>
  );
}

export function Popover({
  icon,
  label,
  value,
  badge,
  caret = false,
  width = "w-64",
  align = "right",
  buttonClassName = "",
  children,
}: {
  /**
   * The mark on the trigger. Optional: in a bar every control is an icon and a
   * word, and the icon is what you find it by. A settings row already names
   * the thing to the left of the control, so a second mark beside the value is
   * a picture of a question that has already been asked.
   */
  icon?: string;
  label: string;
  value?: string;
  badge?: number;
  /**
   * A chevron at the trigger's end, for a control whose value is a word rather
   * than a mark: a scope named "Library" beside a shelf icon reads as a label
   * on the field until something says it can be changed. The rest of the bar's
   * popovers are named actions — Sort, Group — and a chevron on those would be
   * saying twice what the word already says, so they go without.
   */
  caret?: boolean;
  width?: string;
  /**
   * Which edge the panel hangs from. Right for everything that sits at the end
   * of a bar, which is most of them; left for a control at the head of one,
   * where a panel measured from its right edge would open off the side of it.
   */
  align?: "left" | "right";
  /** For the trigger — a control at the bar's end needs its rounded cap. */
  buttonClassName?: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useDismiss(open, () => setOpen(false), wrap);
  const [shown, leaving] = useOverlay(open);

  return (
    <div ref={wrap} className="relative flex shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={label}
        title={label}
        // No border and no corners of its own: the bar draws one frame and
        // rules its parts apart, so a control that keeps an outline — or a
        // radius — reads as a box that wandered in rather than a part of it.
        // The fill runs the bar's full depth, edge to edge of its own slot.
        className={`flex items-center gap-2 self-stretch px-3.5 text-sm transition-colors ${
          open || badge ? "bg-surface-strong" : "hover:bg-surface-strong"
        } ${buttonClassName}`}
      >
        {icon && (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4 opacity-50"
          >
            <path d={icon} />
          </svg>
        )}
        {value && <Flip>{value}</Flip>}
        {caret && (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            // Hidden wherever the value is: at the narrow width the trigger is
            // the mark alone, with no room for a second one beside it.
            //
            // `ml-auto` because these triggers are of a stated width and the
            // labels are of three lengths — pinned to the end, the chevron sits
            // still while the word beside it changes. It turns over when the
            // panel is up, so the mark is also the state.
            className={`ml-auto hidden h-3.5 w-3.5 shrink-0 opacity-40 transition-transform sm:block ${
              open ? "rotate-180" : ""
            }`}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        )}
        {badge !== undefined && badge > 0 && (
          <span className="rounded-full bg-foreground px-1.5 text-[10px] leading-[16px] font-medium text-background tabular-nums">
            {badge}
          </span>
        )}
      </button>

      {/*
       * The menu, and the best glass in the app after the rail.
       *
       * A dialog has a veil under it that has already taken most of the light
       * out of the page; this has nothing between it and the shelf. It opens
       * directly over posters, at the top of a listing, which is exactly the
       * case `--glass` was written for — so the rim has real edges to bend and
       * the saturation has real colour to lift. Whatever the Glass setting is
       * doing, this is where you see it doing it.
       *
       * `overlay` is only the shadow: a menu hangs off a control rather than
       * floating clear of the page, so it throws a shorter one than a dialog.
       * See globals.css.
       */}
      {shown && (
        <Glass
          radius={14}
          className={`${leaving ? "pop-out" : "row-enter"} overlay-pane absolute top-full ${
            align === "left" ? "left-0" : "right-0"
          } z-30 mt-2 ${width} overflow-hidden`}
        >
          {children(() => setOpen(false))}
        </Glass>
      )}
    </div>
  );
}

/** One option in a sort or grouping menu. */
export function MenuItem({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-strong ${
        active ? "font-medium" : ""
      }`}
    >
      {children}
      {active && (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3.5 w-3.5 shrink-0 opacity-60"
        >
          <path d="m4 12.5 5 5 11-11" />
        </svg>
      )}
    </button>
  );
}

/**
 * One action in a menu: the mark for it, then the word.
 *
 * `MenuItem` above is the other kind of row and they are not interchangeable.
 * That one offers a value out of a few — a sort order, a scope, a setting — and
 * carries a tick on whichever is in force, because what it is saying is what
 * the list *is*. This one is a verb: press it and something happens, once, and
 * there is no state for a tick to report. Renaming a set, throwing it away,
 * pausing a transfer, cancelling it, opening the artwork editor on one kind of
 * picture rather than another — all of them are this.
 *
 * The mark is the whole of the difference. A menu of verbs is read at the
 * moment you have decided to act and are looking for the one row that does it,
 * and a mark is found in a glance where a word has to be read; it is also the
 * only thing separating "Delete" from "Rename" in the second before you notice
 * the red. The three menus this replaces had each written the row out
 * themselves, and only one of them had thought to draw anything.
 *
 * At the size of the word beside it and at the app's usual stroke, like the
 * rail's marks: a mark that outweighs its label is a mark being asked to do
 * the label's job.
 *
 * Danger is a hover, not a state. The red arrives when you are reaching for it;
 * standing red on a row in a list of rows is a warning about a thing you have
 * not yet decided to do — the dialog behind it is where the colour belongs
 * standing. The same rule `BUTTON.danger` keeps.
 */
export function MenuAction({
  icon,
  label,
  danger,
  onClick,
}: {
  /** The `d` of a path in a 24×24 box, drawn stroked — as `ICONS` holds them. */
  icon: string;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`glow flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
        danger
          ? "hover:bg-red-500/[0.08] hover:text-red-700 dark:hover:text-red-300"
          : "hover:bg-surface-strong"
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="h-3.5 w-3.5 shrink-0 opacity-60"
      >
        <path d={icon} />
      </svg>
      {label}
    </button>
  );
}

/**
 * The three ways of saying "not this" to something opened over the page.
 *
 * Eight controls in this app open a panel and then have to decide when to put
 * it away: the two here, the dashboard's scan, and a menu each on the artwork
 * editor, the collections picker, a show, a set and a transfer. Every one of
 * them had written the same effect out — click away, press Escape — and they
 * had written it slightly differently, which is how the third way came to be
 * missing from all eight at once.
 *
 * Scrolling is that third way, and it is the one nobody thinks to add. A panel
 * is a question about the thing under it; scroll and the thing under it has
 * gone somewhere else, and what is left is a menu about nothing, hanging over
 * whatever happens to be there now. Every kit that gets this right closes on
 * scroll, and the reason is not fussiness — it is that the alternative is a
 * control that has quietly stopped referring to anything.
 *
 * `capture`, because the thing that scrolled is often a list inside the page
 * rather than the page itself, and a scroll event does not bubble to the window
 * from one of those. `passive`, because this never prevents the scroll — the
 * panel goes away and the page moves, which is what was asked for.
 *
 * And a distance rather than an event. A trackpad reports a scroll for the
 * smallest touch of two fingers, a phone fires one for the rubber band at the
 * end of a list, and a page that reflows by a pixel behind an open menu has
 * technically scrolled — closing on the first of those makes a menu that
 * cannot be held open on a laptop. `SCROLL_SHUT` is about two lines of text:
 * far enough that nothing but a deliberate move reaches it, near enough that a
 * deliberate move reaches it at once.
 *
 * Measured per scrolling element, because the first event is what sets the mark
 * — which also means an opening that scrolls the page itself is absorbed rather
 * than counted, whatever it moves by.
 *
 * Held off for a frame after opening, for the same kind of reason at a smaller
 * size: a panel shown at the foot of the window can shift the page before the
 * first event has anything to be measured against.
 *
 * The reason is handed back because one caller needs it: a panel that has
 * replaced its own trigger has to put focus back on Escape, and only on
 * Escape — a pointer that clicked elsewhere has already chosen where to be.
 */
/**
 * How long a panel is kept on screen after it has been shut, so it has time to
 * leave. Matches `pop-out` in globals.css, and is shorter than the 200ms these
 * arrive in — out is quicker than in, as everywhere else here.
 */
const LEAVE_MS = 140;

/**
 * A panel's two answers to "should I be drawn": whether at all, and whether on
 * the way out.
 *
 * Every menu in this app was mounted on a boolean and unmounted on the same
 * one, so it arrived over 200ms and left in no time at all — which reads less
 * like closing than like the menu having never been there. The state it needs
 * is the one `useClosing` gives a dialog in app/modal.tsx: keep it rendered a
 * beat past the decision, and let it animate in that beat.
 *
 * Two flags rather than one, because the caller has to know which of the two
 * it is drawing — `useClosing` can return a single boolean since a dialog's
 * leaving state is a class on a panel that is always in the markup, and these
 * are not in the markup at all when they are shut.
 */
export function useOverlay(
  open: boolean,
): [rendered: boolean, leaving: boolean] {
  const [leaving, setLeaving] = useState(false);
  const [was, setWas] = useState(open);

  if (open !== was) {
    setWas(open);
    setLeaving(!open);
  }

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setLeaving(false), LEAVE_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  return [open || leaving, leaving];
}

/** How far the page has to move before an open panel takes it as an answer. */
const SCROLL_SHUT = 32;

export function useDismiss(
  open: boolean,
  close: (why: "away" | "escape" | "scroll") => void,
  within: React.RefObject<HTMLElement | null>,
) {
  /* Kept in a ref so the effect depends on `open` alone. Callers write the
     handler inline, so it is a new function on every render, and an effect
     that took it as a dependency would tear its listeners down and put them
     back up for the length of the panel's life. */
  const latest = useRef(close);
  useEffect(() => {
    latest.current = close;
  });

  useEffect(() => {
    if (!open) return;

    const away = (event: MouseEvent) => {
      if (!within.current?.contains(event.target as Node))
        latest.current("away");
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") latest.current("escape");
    };
    /* Where each scrolling thing stood when it first moved under the panel. A
       map rather than one number: the page and a list inside it are two things
       that can scroll, and a run down one says nothing about the other. */
    const from = new Map<EventTarget, number>();

    const scrolled = (event: Event) => {
      const target = event.target;
      if (!target) return;
      const at =
        target === document || target === window
          ? window.scrollY
          : (target as Element).scrollTop;

      const was = from.get(target);
      if (was === undefined) from.set(target, at);
      else if (Math.abs(at - was) >= SCROLL_SHUT) latest.current("scroll");
    };

    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", key);

    const settle = requestAnimationFrame(() =>
      window.addEventListener("scroll", scrolled, {
        capture: true,
        passive: true,
      }),
    );

    return () => {
      cancelAnimationFrame(settle);
      document.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", key);
      window.removeEventListener("scroll", scrolled, { capture: true });
    };
  }, [open, within]);
}

/**
 * One value out of a few, as the menu this app already picks values with.
 *
 * These were segmented switches — every option on screen, the chosen one lit.
 * That control earns its place at the head of a page, where the choices are
 * the page's own divisions and seeing all of them is the point. In a settings
 * row it is wrong twice over: it puts three or four words where the row beside
 * it puts one, so the right-hand column never lines up, and it states the
 * alternatives with the same weight as the answer. A settings row is there to
 * say what the setting is; a switch says what it could be.
 *
 * `Popover` and `MenuItem` above, which is what every other menu in this app is made
 * of — the sort and grouping menus on a shelf, the scope on the search page.
 * It was briefly a native `<select>` on the reasoning that a menu a keyboard
 * and a phone already know how to open is not worth rebuilding, and that is
 * true and beside the point: this app draws its own menus, and one row of one
 * page rendering the platform's instead is the seam you notice.
 *
 * The trigger takes a border here, which is the one thing it does not have in
 * a bar. A bar draws one frame around all of its controls and rules them
 * apart; a settings row has no frame, so the control has to be its own edge or
 * it reads as a word floating at the end of a line.
 */
export function Choice<T extends string>({
  value,
  options,
  label,
  disabled,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  /** What is being chosen, for the readers that do not see the row's name. */
  label: string;
  disabled?: boolean;
  onChange: (next: T) => void;
}) {
  const current = options.find((option) => option.value === value);

  return (
    <div className={disabled ? "pointer-events-none opacity-50" : undefined}>
      <Popover
        label={label}
        // The value is the whole of what the trigger says — see `icon`.
        value={current?.label ?? value}
        caret
        align="right"
        width="w-44"
        buttonClassName="h-9 rounded-full border border-line"
      >
        {(close) => (
          <div className="py-1">
            {options.map((option) => (
              <MenuItem
                key={option.value}
                active={option.value === value}
                onClick={() => {
                  onChange(option.value);
                  close();
                }}
              >
                {option.label}
              </MenuItem>
            ))}
          </div>
        )}
      </Popover>
    </div>
  );
}

/**
 * A word that explains itself when you point at it.
 *
 * `HelpTip` below is the other half of this pair and the older one: a `?` you
 * click, for a control whose name cannot carry the explanation. This is for
 * the opposite case — where there is already a title standing over the thing,
 * and the explanation was a paragraph under it.
 *
 * Settings had eleven of those paragraphs, plus one on most of the rows
 * inside, and the page had turned into an essay you scrolled past to reach a
 * folder picker. The prose was not wrong; it was just always on, and a
 * sentence you have read nine times is furniture. Under the title it is there
 * the once you need it and gone the rest of the time.
 *
 * Dotted rather than solid, because a solid underline in this app is a link
 * and this goes nowhere. It comes down out of the title rather than appearing —
 * see `.tip-in` in globals.css for how far and how fast, and why nothing
 * animates on the way out.
 *
 * Hover, and focus, and deliberately not tap. On a touchscreen a `pointerenter`
 * arrives with the tap that is opening the panel, so a tooltip triggered by it
 * would flash up and be swept away by the same finger — worse than not being
 * there. It is a tab stop of its own so that a keyboard can reach what a
 * pointer can, and `aria-describedby` is what ties the two together for a
 * reader that announces neither.
 *
 * The bubble is put on the body rather than beside the word, and this is the
 * one thing about it that is not a matter of taste. It used to hang from the
 * word on `absolute … z-40`, which works right up until something between it
 * and the page makes a stacking context — and the panel headings it was
 * written for do exactly that: `.glow` sets `isolation: isolate` so that its
 * own `z-index: -1` glow lands behind the row and not behind the page. A
 * z-index inside a stacking context is only an order within it, so forty
 * counted for nothing against the next panel down, which simply came later in
 * the document and painted over the top. The tooltip on every settings panel
 * was half-swallowed by the heading beneath it.
 *
 * There is no z-index that fixes that, and lifting each ancestor that might
 * trap it is a rule you have to remember at every call site forever. A portal
 * leaves the question behind: on the body there is nothing above it to be
 * inside of.
 */
export function Explained({
  hint,
  children,
  className = "",
}: {
  hint: string;
  children: React.ReactNode;
  /** Extra classes for the bubble, for a caller that wants it drawn otherwise. */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const word = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLElement>(null);
  const id = useId();

  /**
   * Where to put it, in viewport coordinates.
   *
   * Under the word and aligned to its left edge, which is where it has always
   * been — the difference is that the sum is done here rather than by the
   * layout. Held off both edges of the window, and flipped above the word when
   * there is no room below it, both of which the old arrangement could only
   * answer by having the caller pass a class.
   */
  const place = useCallback(() => {
    const anchor = word.current?.getBoundingClientRect();
    if (!anchor) return;

    const GAP = 8;
    const EDGE = 8;
    const WIDTH = 288; // w-72
    const height = bubble.current?.offsetHeight ?? 0;

    const below = anchor.bottom + GAP;
    const flip = height > 0 && below + height > window.innerHeight - EDGE;

    setAt({
      left: Math.min(
        Math.max(EDGE, anchor.left),
        Math.max(EDGE, window.innerWidth - WIDTH - EDGE),
      ),
      top: flip ? Math.max(EDGE, anchor.top - GAP - height) : below,
    });
  }, []);

  /*
   * Measured before the browser paints, so it is never seen at the position it
   * has not been given yet. The place from the last time it was open is left
   * standing rather than cleared on the way out: this runs before paint, so on
   * the way back in the sum is redone and the stale one never reaches a frame,
   * where clearing it would cost a hidden frame on every open after the first.
   *
   * Re-measured while it is open because a trackpad can scroll the word out
   * from under a bubble that was placed against it.
   */
  useLayoutEffect(() => {
    if (!open) return;

    place();
    // Twice: the first pass has nothing on screen to measure, so it cannot
    // know whether there is room below. The second runs with a bubble to ask.
    const settle = requestAnimationFrame(place);

    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(settle);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  return (
    <span className="relative inline-flex">
      <span
        ref={word}
        tabIndex={0}
        aria-describedby={open ? id : undefined}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") setOpen(true);
        }}
        onPointerLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        // The gesture for leaving anything that has appeared over the page,
        // the same as every dialog here.
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        className="cursor-help underline decoration-line-strong decoration-dotted underline-offset-4"
      >
        {children}
      </span>

      {/* Rendered from the first frame it is open, invisible until it has been
          placed: it has to be in the document to be measured, and a bubble
          drawn at nought,nought for one frame is a flicker in the corner of
          the window. */}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <Glass
            as="span"
            ref={bubble}
            id={id}
            role="tooltip"
            radius={8}
            style={{
              left: at?.left ?? 0,
              top: at?.top ?? 0,
              visibility: at ? "visible" : "hidden",
            }}
            className={`tip-in overlay-pane fixed z-50 block w-72 p-2.5 text-[11px] leading-relaxed font-normal ${className}`}
          >
            {hint}
          </Glass>,
          document.body,
        )}
    </span>
  );
}

export function HelpTip({ text }: { text: string }) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  // A click-pinned tooltip has to be dismissable without going back to it.
  useDismiss(pinned, () => setPinned(false), wrap);

  const open = hovered || pinned;

  return (
    <span ref={wrap} className="relative inline-flex">
      <button
        type="button"
        aria-label={text}
        aria-expanded={open}
        onClick={() => setPinned((v) => !v)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        className="grid h-5 w-5 place-items-center rounded-full border border-line text-[10px] font-medium opacity-40 transition-opacity hover:opacity-100"
      >
        ?
      </button>

      {open && (
        <Glass
          as="span"
          role="tooltip"
          radius={8}
          className="tip-in overlay-pane absolute top-full right-0 z-30 mt-1.5 block w-60 p-2.5 text-[11px] leading-relaxed"
        >
          {text}
        </Glass>
      )}
    </span>
  );
}

/**
 * `BUTTON` now lives in app/button.ts and is re-exported here.
 *
 * Not a preference about where constants go: this file is a client module, and
 * a server component that imports a value from one gets a reference rather than
 * the value — `BUTTON.primary` came back undefined and the class simply did not
 * appear. Everything importing it from here is a client component and goes on
 * working; the two pages that are not now import it from the file itself.
 */
export { BUTTON } from "./button";

/**
 * One shape for everything you type into, for the same reason as `BUTTON`.
 *
 * The buttons were three radii until they were one; the fields were the same
 * story a page later — `--radius-control` in Settings and the film dialogs,
 * `--radius-chip` in the folder picker, a full round on the shelf's search —
 * and a form whose field is squarer than the button under it reads as two
 * controls borrowed from two apps. The pill wins here too, and for the plainest
 * of reasons: the search field was already one, so the app's most-used field
 * had already settled the question.
 *
 * The recipe under the radius was never in dispute — hairline border, no fill,
 * a machine face for the addresses, keys and paths these mostly hold, and focus
 * answered by the border brightening rather than by a ring. Written six times
 * from memory, it agreed six times on the colours and never once on the
 * padding. Once, here.
 *
 * No width: a field is either given the column (`w-full`) or given the slack in
 * a row (`flex-1`), and that is the caller's business, not the shape's.
 */
export const FIELD = {
  // The field with a label over it — Settings' keys and addresses, the film
  // details entered by hand. `px-4` rather than the `px-3` it carried as a
  // rounded box: the pill's corners eat the first few pixels of the line, and
  // text that starts inside the curve reads as text that is falling out of it.
  default:
    "rounded-full border border-line bg-transparent px-4 py-2 font-mono text-xs outline-none transition-colors focus:border-line-strong",
  // The same field at the size of the small print, for the rows where it sits
  // beside a `BUTTON.small` — a search phrase being corrected, a URL being
  // pasted. Its padding is that button's, so the two are one control's height
  // and the row does not step.
  small:
    "rounded-full border border-line bg-transparent px-3 py-1 font-mono text-xs outline-none transition-colors focus:border-line-strong",
  // A choice rather than a phrase, but the same shape, because it stands in the
  // same rows. `appearance-none` drops the platform's own chevron — every
  // engine draws a different one, and none of them a pill — so each caller
  // supplies the arrow that `pr-7` leaves room for. Sans, not mono: what these
  // hold is a written option, not a machine string.
  select:
    "cursor-pointer appearance-none rounded-full border border-line bg-transparent py-1 pr-7 pl-3 text-xs outline-none transition-colors focus:border-line-strong",
};

/**
 * One labelled fact, in the ruled block this app's dialogs set a table of facts
 * in.
 *
 * Written twice before this — once for the release dialog and once for the
 * conversion dialog, which copied it and then fixed it. Two things came out of
 * that fix and both are here: a fixed label column, so five labels of five
 * lengths do not give their values five different left edges; and `.rule-l`
 * between them, the app's own hairline fading out at both ends, where a plain
 * border was the one hard line in a dialog built out of soft ones.
 *
 * Nothing renders for an absent value, so a caller can write the whole table
 * out and let the facts it does not have fall away.
 */
export function Fact({
  label,
  value,
  mono,
  title,
}: {
  label: string;
  value?: string;
  /** A file or release name: monospace, and wrapped rather than cut. */
  mono?: boolean;
  title?: string;
}) {
  if (!value) return null;

  return (
    /* `items-stretch` rather than baselines, so the rule between the two runs
       the whole height of the row — on a release name that is three lines, and
       a divider that stopped after the first would read as a stray tick. */
    <div className="card-band flex items-stretch px-3 py-2">
      <dt className="w-32 shrink-0 pr-4 text-xs opacity-50">{label}</dt>
      <dd
        className={`rule-l min-w-0 flex-1 pl-4 text-right text-xs ${
          mono ? "font-mono break-all" : "break-words tabular-nums"
        }`}
        title={title}
      >
        {value}
      </dd>
    </div>
  );
}
