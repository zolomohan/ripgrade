"use client";

import { useState, useTransition, type CSSProperties } from "react";

import { setQueueRules } from "../actions";
import { Toggle } from "./parts";

/**
 * The bar a find has to clear to be worth listing.
 *
 * A sweep is indiscriminate on purpose — it stores the best release it can
 * find for every film, however modest that turns out to be. That is the right
 * thing to record and the wrong thing to read: a queue of four hundred rows,
 * most of them a two-point gain, hides the dozen that would actually change
 * an evening. The slider is where you say how good a find has to be before it
 * is worth your attention.
 *
 * Nothing is discarded by moving it. The queue is filtered as it is read, so
 * the searches stay paid for and dropping the bar brings everything straight
 * back — which is what makes it safe to set it high and find out.
 */
export function QueueThreshold({
  threshold,
}: {
  threshold: number;
}) {
  // Held locally so the number under the thumb keeps up with the drag; the
  // server only hears about it once the thumb is let go.
  const [value, setValue] = useState(threshold);
  const [, startTransition] = useTransition();

  const commit = (next: number) => {
    if (next === threshold) return;
    startTransition(async () => setQueueRules({ threshold: next }));
  };

  return (
    <div className="flex w-full flex-col gap-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm">Minimum predicted score</p>
          <span className="font-score text-sm font-semibold tabular-nums opacity-70">
            {value === 0 ? "Off" : value}
          </span>
        </div>

        {/* A range input rather than a row of buttons: the scale is the
            hundred-point one every score in the app is on, and picking a point
            on it is what this is. Styled in globals.css — see `.slider`. */}
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={value}
          aria-label="Queue threshold"
          aria-valuetext={
            value === 0 ? "Off, everything the sweep finds" : `${value} of 100`
          }
          onChange={(e) => setValue(Number(e.target.value))}
          // No commit-on-release event exists for a range, so all three ways of
          // letting go stand in for one: the mouse, the keyboard, and leaving.
          onPointerUp={(e) => commit(Number(e.currentTarget.value))}
          onKeyUp={(e) => commit(Number(e.currentTarget.value))}
          onBlur={(e) => commit(Number(e.target.value))}
          className="slider"
          // The thumb travels between its own two edges, not the full width, so
          // the fill is measured the same way or it runs ahead at both ends.
          style={
            {
              "--fill": `calc(0.5rem + (100% - 1rem) * ${value / 100})`,
            } as CSSProperties
          }
        />

        {/* Only the off case says anything. The other restated the number
            above it in a sentence, which is the slider explaining itself. */}
        {value === 0 && (
          <p className="text-[11px] opacity-45">
            Every find the last sweep turned up reaches the queue.
          </p>
        )}
    </div>
  );
}

/**
 * Whether a film with no disc behind it may reach the queue at all.
 *
 * Its own setting rather than a row under the threshold. It was filed there
 * because both are the queue's admissions policy, and that is a fact about the
 * code rather than about the page: one is a number you drag and the other is a
 * yes or no, and a row nested inside another setting is a control you find by
 * having already found something else.
 */
export function QueueDiscOnly({ discOnly }: { discOnly: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <Toggle
      on={discOnly}
      label="Only films scored against a disc"
      disabled={pending}
      onChange={() =>
        startTransition(async () => setQueueRules({ discOnly: !discOnly }))
      }
    />
  );
}
