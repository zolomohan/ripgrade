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
export function Bar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-stretch divide-x divide-line rounded-full border border-line bg-surface/60 transition-colors focus-within:border-line-strong">
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
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  /** For a search that cannot run yet — no API key, nothing to search. */
  disabled?: boolean;
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
        placeholder={placeholder}
        disabled={disabled}
        className="h-11 w-full rounded-l-full bg-transparent pr-9 pl-11 text-sm outline-none placeholder:opacity-40 disabled:opacity-40"
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
 */
export function useSlider(active: string) {
  const track = useRef<HTMLDivElement>(null);
  const options = useRef<Record<string, HTMLElement | null>>({});
  const [thumb, setThumb] = useState<{ x: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const option = options.current[active];
      if (option) setThumb({ x: option.offsetLeft, width: option.offsetWidth });
    };

    measure();

    // The face may still be swapping, and a narrow window wraps the row; either
    // moves the option out from under the thumb.
    document.fonts?.ready.then(measure);
    const observer = new ResizeObserver(measure);
    if (track.current) observer.observe(track.current);
    return () => observer.disconnect();
  }, [active]);

  const register = (key: string) => (node: HTMLElement | null) => {
    options.current[key] = node;
  };

  // Hidden until measured, so it arrives in place rather than sliding in from
  // the left edge on first paint.
  const style = {
    transform: `translateX(${thumb?.x ?? 0}px)`,
    width: thumb?.width ?? 0,
    opacity: thumb ? 1 : 0,
  };

  // A tuple, so the ref reaches its element as a plain value: handed over as a
  // property of an object, it reads as a ref being dereferenced mid-render.
  return [track, register, style] as const;
}

export const SLIDE =
  "transition-[transform,width,opacity] duration-300 ease-[cubic-bezier(0.2,0.7,0.3,1)] motion-reduce:transition-none";

/**
 * A named choice between a few things, as one track with the chosen one raised
 * out of it. The library's two shelves and the stats page's two halves are the
 * same gesture, so they are the same control.
 */
export function Switch({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (key: string) => void;
  options: { key: string; label: string }[];
}) {
  const [track, register, thumbStyle] = useSlider(value);

  return (
    <div
      ref={track}
      className="relative flex shrink-0 gap-1 self-start rounded-full border border-line bg-surface/60 p-1"
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
          className={`glow relative rounded-full px-4 py-1.5 text-sm transition-colors ${
            value === option.key
              ? "text-background"
              : "opacity-60 hover:opacity-100"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** A segmented pair inside the bar, for a choice with two icons and no name. */
export function BarSegments({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (key: string) => void;
  options: { key: string; label: string; path: string }[];
}) {
  const [track, register, thumbStyle] = useSlider(value);

  // Only the outer end follows the bar round. A thumb curved on both sides
  // would be a lozenge floating in a slot it does not fill; curved on the side
  // that meets the bar's own cap, it reads as part of the bar.
  const atEnd = value === options[options.length - 1]?.key;

  return (
    <div ref={track} className="relative flex shrink-0 items-stretch">
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 bg-surface-strong ${
          atEnd ? "rounded-r-full" : ""
        } ${SLIDE}`}
        style={thumbStyle}
      />

      {options.map((option) => (
        <button
          key={option.key}
          ref={register(option.key)}
          type="button"
          onClick={() => onChange(option.key)}
          aria-label={`${option.label} view`}
          aria-pressed={value === option.key}
          title={`${option.label} view`}
          className={`glow relative grid w-11 place-items-center transition-opacity last:rounded-r-full ${
            value === option.key ? "" : "opacity-40 hover:opacity-100"
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <path d={option.path} />
          </svg>
        </button>
      ))}
    </div>
  );
}

export const ICONS = {
  filter: "M3 5h18l-7 8.2V19l-4 2v-7.8z",
  sort: "M3 6h13M3 12h9M3 18h5",
  group: "M4 5h16M4 10h16M8 15h12M8 19h12",
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
  buttonClassName = "",
  children,
}: {
  icon: string;
  label: string;
  value?: string;
  badge?: number;
  width?: string;
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
          className={`row-enter absolute top-full right-0 z-30 mt-2 ${width} overflow-hidden rounded-card border border-line bg-background shadow-2xl`}
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
          className="absolute top-full right-0 z-30 mt-1.5 w-60 rounded-control border border-line bg-background p-2.5 text-[11px] leading-relaxed shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
}
