"use client";

import { useTransition } from "react";

import { Switch } from "@/app/controls";
import type { Backdrop } from "@/lib/backdrop";
import { setBackdrop } from "../actions";

/**
 * How much of the window a page's artwork takes.
 *
 * A switch rather than a toggle, for the reason `ThemeChoice` and `ListLayout`
 * give either side of it: these are three named states and none of them is the
 * absence of the others. Band leads because it is what the app has always drawn
 * and what it still opens as; the two after it are the same picture filling the
 * window, and differ only in whether it stays there while you read.
 *
 * The press costs one row and a repaint. Every rule the full modes need is in
 * globals.css, keyed off an attribute the root layout writes, so what changes
 * on the way back is one character on <html> — see lib/backdrop.ts.
 */
export function BackdropChoice({ backdrop }: { backdrop: Backdrop }) {
  const [pending, startTransition] = useTransition();

  return (
    <div
      // Dimmed rather than disabled, as its two neighbours are: a `Switch` has
      // no disabled state, and a second press before the first has landed
      // should at least look like one.
      className={pending ? "opacity-60 transition-opacity" : undefined}
    >
      <Switch
        value={backdrop}
        onChange={(next) =>
          startTransition(async () => setBackdrop(next as Backdrop))
        }
        options={[
          { key: "band", label: "Band" },
          { key: "fixed", label: "Fixed" },
          { key: "scrolling", label: "Scrolling" },
        ]}
      />
    </div>
  );
}
