"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

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
  sort: "M3 6h13M3 12h9M3 18h5",
  group: "M4 5h16M4 10h16M8 15h12M8 19h12",
  // The two shapes a list can be read in, drawn as what they produce rather
  // than as an idea about it: four tiles, and two bands running the width of
  // the page. Deliberately not a third set of horizontal lines — `sort` and
  // `group` are already two of those, and a third in the same bar would be a
  // button you have to click to find out what it was.
  grid: "M4 5h6v6H4zM14 5h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  rows: "M4 6h16v4H4zM4 14h16v4H4z",
};

/**
 * A small button that opens a panel under itself.
 *
 * All three controls behave the same way — click to open, click away or press
 * Escape to close — so the row stays a row of buttons rather than a mix of
 * native selects and a panel that pushed the list down the page.
 */
export function Popover({
  icon,
  label,
  value,
  badge,
  width = "w-64",
  align = "right",
  buttonClassName = "",
  children,
}: {
  icon: string;
  label: string;
  value?: string;
  badge?: number;
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

  useEffect(() => {
    if (!open) return;

    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

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
        {value && <span className="hidden sm:inline">{value}</span>}
        {badge !== undefined && badge > 0 && (
          <span className="rounded-full bg-foreground px-1.5 text-[10px] leading-[16px] font-medium text-background tabular-nums">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          className={`row-enter absolute top-full ${
            align === "left" ? "left-0" : "right-0"
          } z-30 mt-2 ${width} overflow-hidden glass-panel rounded-card border border-line shadow-2xl`}
        >
          {children(() => setOpen(false))}
        </div>
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

export function HelpTip({ text }: { text: string }) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  // A click-pinned tooltip has to be dismissable without going back to it.
  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setPinned(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPinned(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [pinned]);

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
        <span
          role="tooltip"
          className="absolute top-full right-0 z-30 mt-1.5 w-60 glass-panel rounded-control border border-line p-2.5 text-[11px] leading-relaxed shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
}

/**
 * One shape for every button that commits to something, so a row of them
 * lines up.
 *
 * This began as the console's own, on the film page, where a verdict band and
 * an action band needed their buttons to agree. It is here now because the
 * queue's rows and the dashboard's inline actions want the same four weights,
 * and a second set written from memory would drift from this one at the first
 * change to either.
 *
 * The shape is the pill. It was `--radius-control` here, `--radius-chip` on
 * the settings pages, and a full round on the shelf's own controls — three
 * answers to one question, which is how the app came to look like three apps
 * depending on which page you were standing on. The shelf's answer won,
 * because it was already the shape of the search field, the segmented tabs,
 * the filter chips and every icon button: the app was mostly pills and the
 * buttons were the holdout.
 *
 * `inline-flex` and a gap on all three of the boxed weights, so a label can be
 * joined by a `Spinner` — or an icon — without the button having to be rebuilt
 * around it. `justify-center` matters for the ones that are given a width:
 * their contents change size as they work, and centred is the only alignment
 * that does not make the button look like it is drifting.
 */
export const BUTTON = {
  primary:
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-foreground px-4 py-1.5 text-sm text-background transition-opacity hover:opacity-90 disabled:opacity-40",
  secondary:
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-line px-4 py-1.5 text-sm transition-colors hover:bg-surface-strong disabled:opacity-40",
  // Its colour arrives on hover, when you are reaching for it: sitting in the
  // row it is one button among several, and the dialog behind it is where the
  // red belongs.
  danger:
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-line px-4 py-1.5 text-sm transition-colors hover:border-red-500/40 hover:bg-red-500/[0.08] hover:text-red-700 disabled:opacity-40 dark:hover:text-red-300",
  // `danger`'s hover state, worn standing.
  //
  // For the one place the rule above does not fit: a card whose whole subject
  // is a file that is still on the drive, offering to delete it. There the
  // destructive thing is not one option among several that happens to be
  // reachable — it is half of what the card is for, and the other half is the
  // button beside it. Neutral until you reach for it would be hiding what it
  // does, which is the argument `confirm` makes below; but a card is not a
  // dialog, so it stops at the outline and leaves the fill to the dialog that
  // this button is going to open anyway.
  //
  // Written out in full for the reason `confirm` gives: two `border-*` colours
  // in one class string are settled by Tailwind's emit order, not by which was
  // written last.
  dangerStanding:
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-red-500/40 px-4 py-1.5 text-sm text-red-700 transition-colors hover:bg-red-500/[0.08] disabled:opacity-40 dark:text-red-300",
  // Words rather than a box: what it offers is an alternative to the button
  // beside it, and a second bordered button would read as a second decision of
  // equal weight. The app's own link treatment, underline arriving on hover.
  // No pill, because there is no box to round — but still a flex row, so a
  // spinner can sit beside the words like it does everywhere else.
  text: "inline-flex shrink-0 items-center gap-1.5 px-1 py-1.5 text-sm underline decoration-transparent underline-offset-4 opacity-60 transition hover:decoration-current hover:opacity-100 disabled:opacity-30",
  // The red a dialog wears, which is not the red a row wears. `danger` above
  // waits for hover because out on a page it is one option among several; by
  // the time a dialog is open, the destructive thing is the only thing being
  // asked about, and a button that looks neutral until you reach for it is
  // hiding what it does. Same pill, filled from the start.
  //
  // Written out rather than layered onto `secondary`, because two `border-*`
  // colours in one class string are settled by the order Tailwind emits them
  // in, not the order they are written — which is a coin toss dressed up as
  // an override.
  confirm:
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-red-500/40 bg-red-500/[0.10] px-4 py-1.5 text-sm text-red-700 transition-colors hover:bg-red-500/20 disabled:opacity-40 dark:text-red-300",
  // The same button at the size of the small print. Copy, Try again, Browse,
  // Edit poster: things offered beside a line of `text-xs` and sized to it, so
  // that a button next to a caption does not out-shout the caption. This one
  // existed already — six times, in six files, written from memory each time
  // and no two agreeing on radius or padding. Once, here.
  small:
    "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs transition-colors hover:bg-surface-strong disabled:opacity-40",
};

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
