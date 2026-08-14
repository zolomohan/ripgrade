"use client";

import { useRef } from "react";

import { OVER_ART } from "@/app/tile-button";

/**
 * The box that decides whether a track survives.
 *
 * Drawn rather than left to the browser: the platform checkbox is the one
 * control on these pages that arrives in the operating system's own blue with
 * the operating system's own corners, and a table of them under a card built
 * out of hairlines and rounded rectangles reads as a form that wandered in.
 * This is the app's own square — the surface and the line every other control
 * stands on, filled with the foreground colour when it is ticked.
 *
 * A real input underneath, only invisible: it keeps the label, the focus ring,
 * the space bar and every assistive technology working, which a div with a role
 * would have to reimplement one behaviour at a time.
 *
 * Here rather than beside the film's own audio console because the queue asks
 * the same question of the same tracks now — see app/jobs/audio-picker.tsx —
 * and a second hand-drawn checkbox would be the app's second checkbox.
 */
/**
 * The corner of a row a box appears in, and the way it appears.
 *
 * A column that is there or not there would move every row's contents sideways
 * the instant a list turned selectable, which on forty rows is the whole page
 * jumping. So it is always in the layout and its width is what animates — the
 * grid trick, because the width it opens to is the box's own and nothing here
 * should have to know what that is in pixels. The negative margin closes the
 * row's gap while it is shut, and travels with it.
 *
 * `inert` rather than only hidden: a checkbox at zero width is still a checkbox
 * the tab key finds, and a list you cannot tab through is a worse fault than the
 * one this is fixing.
 *
 * The row's own click is stopped here. Every list that has one of these makes
 * the whole row answer the tick as well, and a box that let its click through
 * would toggle twice and land back where it started.
 *
 * Shared by the two lists that offer this — the work rows and the cleanup rows
 * — because it is one gesture with one look, and two copies of it would start
 * identical and end up animating at different speeds.
 */
export function TickColumn({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      inert={!open}
      className={`-mt-1 grid shrink-0 self-start overflow-hidden transition-[grid-template-columns,opacity,margin] duration-300 ease-[cubic-bezier(0.2,0.7,0.3,1)] motion-reduce:transition-none ${
        open ? "grid-cols-[1fr] opacity-100" : "-mr-5 grid-cols-[0fr] opacity-0"
      }`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="min-w-0 overflow-hidden">{children}</div>
    </div>
  );
}

export function Tick({
  checked,
  disabled,
  refusal,
  onTick,
  label,
  hint,
  // px-4 py-2 rather than the cell's own, so the whole of the column is the
  // hit area: a checkbox you have to hit dead-on is a checkbox you miss.
  pad = "px-4 py-2",
  art = false,
}: {
  checked: boolean;
  disabled?: boolean;
  /** Why this one will not tick, when that is a rule rather than a state. */
  refusal?: string;
  /** True when the click was shift-held, which extends rather than toggles. */
  onTick: (range: boolean) => void;
  label: string;
  /** What a run of these is, where it is not a run of tracks. */
  hint?: string;
  /**
   * The hit area around the box, where a column of them is not what this is in.
   *
   * The table this was written for gives it a whole cell to fill, and a
   * checkbox you have to hit dead-on is a checkbox you miss. A box in the
   * corner of a row has a corner to sit in instead, and sixteen pixels of
   * padding there is sixteen pixels of the poster it would sit over.
   */
  pad?: string;
  /**
   * Whether this one is standing on a photograph.
   *
   * The box above is drawn out of the surface and the line every other control
   * in the app stands on — which is exactly what it must not be over artwork. A
   * grid of posters with a grey plate pinned to every corner is a grid of
   * checkboxes with pictures behind them, which is the case app/tile-button.tsx
   * makes about the cross and the heart it draws there. So the same input keeps
   * the same label, the same shift-held run and the same refusals, and the mark
   * changes: white over its own shadow, a ring while it is empty and a filled
   * disc once it is answered.
   *
   * A variant rather than a second component, because this is the app's one
   * checkbox — two of them would be a stroke weight apart before anything asked
   * them to agree.
   */
  art?: boolean;
}) {
  /**
   * Whether the change now arriving came from a shift-held click.
   *
   * Taken from the label's own mousedown, which is the last event in the
   * sequence that still knows. A change event carries no modifier keys, and
   * neither does the click the label forwards to the input it labels — that one
   * is synthesised by the label's activation behaviour, and a synthetic click
   * is created without modifier state. Read and cleared by the change handler,
   * so a later press of the space bar cannot inherit a shift held minutes ago.
   */
  const shifted = useRef(false);

  return (
    <label
      title={
        refusal ??
        (disabled ? undefined : (hint ?? "Shift-click to tick a run of tracks"))
      }
      onMouseDown={(e) => {
        shifted.current = e.shiftKey;
        // Shift-click is also how a browser extends a text selection, so
        // without this the gesture ticks the run *and* drags a blue smear
        // across the table. Refused only when shift is held: an ordinary click
        // keeps the focus it would otherwise be giving the input.
        if (e.shiftKey) e.preventDefault();
      }}
      className={`flex select-none items-center ${pad} ${
        disabled ? "cursor-not-allowed" : "cursor-pointer"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={() => {
          onTick(shifted.current);
          shifted.current = false;
        }}
        className="peer sr-only"
      />

      {art ? (
        /* Two marks, one shown at a time. The `[&>svg:…]` reach is the same
           trick the box below uses to colour its own tick: `peer-checked:`
           styles a *sibling* of the input, and the drawing is a child of that
           sibling. Both are laid over each other rather than swapped, so the
           ring does not blink out and the disc in before the disc arrives. */
        <span
          aria-hidden
          className={`relative grid h-6 w-6 place-items-center rounded-full ${OVER_ART} peer-disabled:opacity-30 peer-focus-visible:ring-2 peer-focus-visible:ring-white/70 peer-checked:[&>svg:first-child]:opacity-0 peer-checked:[&>svg:last-child]:opacity-100`}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
            className="absolute h-[22px] w-[22px] opacity-90 transition-opacity"
          >
            <circle cx="12" cy="12" r="9" />
          </svg>

          {/* Filled, and the check knocked out of it in a fixed dark rather
              than in the app's own background colour: the disc is white in
              both themes — that is the whole of `OVER_ART` — so a mark drawn
              in `background` would be white on white every daylit morning. */}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
            className="absolute h-[22px] w-[22px] opacity-0 transition-opacity"
          >
            <circle cx="12" cy="12" r="10" fill="currentColor" />
            <path
              d="m7.6 12.3 3 3 5.8-6"
              stroke="#171717"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      ) : (
        <span
          aria-hidden
          className="grid size-[18px] place-items-center rounded-[6px] border border-line-strong bg-surface transition-colors peer-checked:border-transparent peer-checked:bg-foreground peer-disabled:opacity-30 peer-focus-visible:ring-2 peer-focus-visible:ring-foreground/40 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background peer-checked:[&>svg]:opacity-100"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3 w-3 text-background opacity-0 transition-opacity"
          >
            <path d="m4 12.5 5 5 11-11" />
          </svg>
        </span>
      )}
    </label>
  );
}
