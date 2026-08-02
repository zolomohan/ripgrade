"use client";

import { useEffect, useRef, useState } from "react";

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
 * A number set in the label's own colour reads as part of the label — "Movies
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
  children,
}: {
  icon: string;
  label: string;
  value?: string;
  badge?: number;
  width?: string;
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
    <div ref={wrap} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={label}
        title={label}
        className={`flex h-[42px] items-center gap-2 rounded-control border px-3 text-sm transition-colors ${
          open || badge
            ? "border-line-strong bg-surface-strong"
            : "border-line hover:bg-surface"
        }`}
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
          className={`row-enter absolute right-0 top-full z-30 mt-2 ${width} overflow-hidden rounded-card border border-line bg-background shadow-2xl`}
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
