"use client";

import { useTransition } from "react";

import { Choice } from "./parts";
import type { Backdrop } from "@/lib/backdrop";
import { setBackdrop } from "../actions";

/**
 * How much of the window a page's artwork takes.
 *
 * A menu rather than a toggle, for the reason `ThemeChoice` and `ListLayout`
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
    <Choice<Backdrop>
      value={backdrop}
      label="Backdrop"
      // Dimmed rather than dead while the write is in flight: it is one row
      // and a repaint of the page it is standing on, and a control that went
      // grey for that would flicker on every press.
      disabled={pending}
      options={[
        { value: "band", label: "Band" },
        { value: "fixed", label: "Fixed" },
        { value: "scrolling", label: "Scrolling" },
      ]}
      onChange={(next) => startTransition(async () => setBackdrop(next))}
    />
  );
}
