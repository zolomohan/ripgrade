"use client";

import { useRef } from "react";

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
export function Tick({
  checked,
  disabled,
  refusal,
  onTick,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  /** Why this one will not tick, when that is a rule rather than a state. */
  refusal?: string;
  /** True when the click was shift-held, which extends rather than toggles. */
  onTick: (range: boolean) => void;
  label: string;
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
        (disabled ? undefined : "Shift-click to tick a run of tracks")
      }
      onMouseDown={(e) => {
        shifted.current = e.shiftKey;
        // Shift-click is also how a browser extends a text selection, so
        // without this the gesture ticks the run *and* drags a blue smear
        // across the table. Refused only when shift is held: an ordinary click
        // keeps the focus it would otherwise be giving the input.
        if (e.shiftKey) e.preventDefault();
      }}
      // px-4 py-2 rather than the cell's own, so the whole of the column is the
      // hit area: a checkbox you have to hit dead-on is a checkbox you miss.
      className={`flex select-none items-center px-4 py-2 ${
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
    </label>
  );
}
