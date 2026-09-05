"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { ICONS, useDismiss } from "@/app/controls";
import { Glass } from "@/app/glass";
import { useScanPasses } from "@/app/scan-passes";
import { Spinner } from "@/app/spinner";

/** The mark's diameter, and so the radius that makes it an exact circle. */
const MARK = 56;

/** How wide the menu is once it has grown. */
const WIDE = 328;

/**
 * The corner, open and shut.
 *
 * Twenty-six rather than eighteen, and twenty-eight is half of `MARK` — which
 * is what makes the shut state a circle rather than a very rounded square. The
 * two being two pixels apart is the point: the radius has almost nothing to
 * travel, so it cannot arrive late. It used to run 999 → 18, and a value that
 * large is visually identical to any other value larger than half the box —
 * so nothing happened for most of the transition and then the corners squared
 * off at the end, which is what looked like a second animation after the first.
 */
const ROUND = { shut: MARK / 2, open: 26 };

/**
 * When the box has stopped moving and the lens is worth cutting again.
 *
 * The longer of the two transitions in globals.css — opening at 0.38s — plus a
 * beat. Shutting is quicker and finishes well inside it, which costs nothing:
 * the lens comes back a moment after a pane that is already the size it was.
 */
const SETTLE = 440;

/**
 * The dashboard's scan, as a pane that opens into its own menu.
 *
 * The dashboard is a reading taken of the whole library and the page the app
 * opens on — so it is the one place where "go and look again" is the obvious
 * next thing to do, and where the four passes are equals rather than one press
 * with three alternatives behind it. The library shelf keeps its split button,
 * because on a page of films Scan means read the films. Here nothing on screen
 * is a film, and the question is which of the four you want.
 *
 * It grows rather than opening something beside it, and it grows out of its
 * bottom right corner — which is to say out of the mark, which does not move.
 * Both the mark and the menu are pinned to that corner and crossfade there, so
 * the pane opens up and to the left around a point that stays put. Anchored
 * anywhere else, the icon slides off to somewhere it was not when you pressed
 * it, and a control that moves under the finger that pressed it is the thing
 * this arrangement exists to avoid.
 *
 * Both sizes are stated in pixels rather than one of them being `auto`. Height
 * to `auto` only interpolates on Chromium, so everywhere else the box jumped to
 * full height in the first frame while the width crawled — the top edge arrived
 * before the left one, which no amount of easing reads as one movement. The
 * menu is measured once and the number is animated.
 *
 * The passes are app/scan-passes.ts, shared with the shelf's button.
 */
export function ScanFab({ jackettReady }: { jackettReady: boolean }) {
  const { all, refusal, busy, run } = useScanPasses(jackettReady);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  /*
   * How tall the menu is, measured rather than guessed.
   *
   * It is in the document from the first render — clipped by the shut pane,
   * which is 56px of a 300-odd pixel column — so there is something to measure
   * before it is ever opened, and no frame in which the box is the right size
   * and the contents are not. Guessing was not an option: two of the four
   * details wrap to a second line at this width and one does not.
   */
  const [tall, setTall] = useState(MARK);

  useLayoutEffect(() => {
    const measure = () => {
      if (list.current) setTall(list.current.offsetHeight);
    };

    measure();
    // The face may still be swapping, which moves the second line of a detail
    // — the same reason `useSlider` in app/controls.tsx waits on it.
    document.fonts?.ready.then(measure);
  }, [all.length]);

  /*
   * Whether the box is on its way between the two sizes.
   *
   * Glacé regenerates its displacement map from a `ResizeObserver`, debounced
   * at 120ms — so a 550ms morph rebuilds the lens three or four times on the
   * way and swaps the `backdrop-filter` under each one. That is most of what
   * was glitchy: not the size, which springs cleanly, but the glass being
   * recut mid-flight at sizes nobody will ever see it at. The lens is off for
   * the length of the movement and comes back once the box has settled, which
   * is the one moment its size is worth measuring.
   */
  const [morphing, setMorphing] = useState(false);

  useEffect(() => {
    if (!morphing) return;
    const timer = setTimeout(() => setMorphing(false), SETTLE);
    return () => clearTimeout(timer);
  }, [morphing]);

  const toggle = (next: boolean) => {
    setMorphing(true);
    setOpen(next);
  };

  /*
   * The three ways out, shared with every other panel in the app — see
   * `useDismiss` in app/controls.tsx, which is where the scroll that used to be
   * written here now lives for all of them.
   *
   * Focus goes back to the mark, and only when it was Escape that closed it. A
   * menu that opens beside its trigger gets that for free and this does not:
   * while the pane is open the mark is not the thing being shown, so something
   * has to put the keyboard back on it. A pointer that clicked elsewhere has
   * already chosen where to be, and a scroll is not asking for the keyboard at
   * all.
   */
  useDismiss(
    open,
    (why) => {
      toggle(false);
      if (why === "escape") trigger.current?.focus();
    },
    wrap,
  );

  return (
    /*
     * Bottom right, which is the one corner of this layout that holds nothing.
     * The rail owns the left edge at every width and the toasts arrive top
     * right; a shelf runs off the foot of the page but the dashboard's does
     * not reach the corner.
     */
    <div ref={wrap} className="fixed right-6 bottom-6 z-40 print:hidden">
      <Glass
        morph
        radius={open ? ROUND.open : ROUND.shut}
        /* No lens while the box is in motion — see `morphing` above. Spread
           rather than passed, because `refract={undefined}` would override the
           setting with nothing rather than falling through to it. */
        {...(morphing ? { refract: false as const } : {})}
        /* Which way it is going, for the two curves in globals.css: a spring
           with a real bounce on the way out of the corner, and a plain ease-out
           on the way back into it. */
        data-open={open}
        style={{ width: open ? WIDE : MARK, height: open ? tall : MARK }}
        className="scan-fab overflow-hidden"
      >
        {/*
         * The menu, glued to the corner the pane grows out of. Its width is
         * stated and never changes, so nothing inside it reflows while the box
         * travels — it is revealed by the box widening past it rather than
         * being laid out again at every size on the way. That reflow was the
         * other half of the glitch: four items rewrapping thirty times.
         */}
        <div
          ref={list}
          aria-hidden={!open}
          /* `py-2` so the first and last rows clear the corner. At a radius
             of 26 the curve reaches a good way into the top line of text, and
             a row that starts where the pane is still turning reads as text
             falling out of the box. */
          className={`absolute right-0 bottom-0 flex flex-col divide-y divide-line py-2 transition-opacity duration-150 ${
            open ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          style={{ width: WIDE }}
        >
          {all.map((pass) => {
            const why = refusal(pass);

            return (
              <button
                key={pass.key}
                type="button"
                disabled={Boolean(why) || !open}
                tabIndex={open ? undefined : -1}
                title={why}
                onClick={() => {
                  toggle(false);
                  run(pass);
                }}
                className="flex flex-col items-start gap-0.5 px-5 py-3 text-left transition-colors hover:bg-surface-strong disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <span className="text-sm">{pass.label}</span>
                {/* What it will actually go and do, because the difference
                    between these four is the cost rather than the word. */}
                <span className="text-xs opacity-45">{pass.detail}</span>
              </button>
            );
          })}
        </div>

        {/* The mark, on the same corner and the same square of it whatever the
            pane is doing — so it is still under your pointer as the menu opens
            around it, and it fades rather than being swapped away. */}
        <button
          ref={trigger}
          type="button"
          onClick={() => toggle(!open)}
          aria-expanded={open}
          // Named as the question it opens rather than as one of the answers:
          // pressing this does not scan anything, it asks which scan.
          aria-label={busy ? "Scans — something is running" : "Scans"}
          aria-busy={busy}
          title={
            busy ? "Something is running — progress is in the sidebar" : "Scans"
          }
          /*
           * `inset-0` while it is the whole pane, which is the only way to be
           * exactly in the middle of it. A 56px box pinned to the corner is
           * not: an absolutely positioned child is laid out against the padding
           * box, and the pane's 1px border is inside its stated width — so the
           * square hung a pixel over the top and left edges and the mark sat a
           * pixel down and right of centre.
           *
           * Once the pane is a menu, `inset-0` would centre the mark in the
           * whole of it and it would slide off across the panel as it faded.
           * Then it goes back to the corner square it came from, where the
           * pixel does not matter because you are watching it disappear.
           */
          className={`absolute grid place-items-center transition-opacity duration-150 ${
            open
              ? "pointer-events-none right-0 bottom-0 opacity-0"
              : "inset-0 opacity-100"
          }`}
          style={open ? { width: MARK, height: MARK } : undefined}
        >
          {busy ? (
            <Spinner className="h-5 w-5" />
          ) : (
            /* A scanner's frame, corners and a beam — the app's own mark for a
               file being read. See `ICONS.scan`. */
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              className="h-5 w-5"
            >
              <path d={ICONS.scan} />
            </svg>
          )}
        </button>
      </Glass>
    </div>
  );
}
