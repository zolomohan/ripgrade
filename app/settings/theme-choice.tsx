"use client";

import { useTransition } from "react";

import { Choice } from "./parts";
import type { Theme } from "@/lib/theme";
import { setTheme } from "../actions";

/**
 * Light, dark, or the machine's answer.
 *
 * A menu rather than the toggles most of this page uses, for the reason
 * `ListLayout` gives beside it: a toggle is on and off, and these are three
 * named states of which none is the absence of the others. System least of all
 * — it is not "unset", it is the answer that defers, and it sits last because
 * that is where the thing you fall back to belongs rather than because it is
 * the least of the three.
 *
 * The whole app repaints on the press. Every colour in globals.css is written
 * three ways against `data-theme`, so what the server actually changes is one
 * attribute on <html> and one row in a table; the scheme you are looking at is
 * CSS answering a question differently, which costs a repaint and no reload.
 */
export function ThemeChoice({ theme }: { theme: Theme }) {
  const [pending, startTransition] = useTransition();

  return (
    <Choice<Theme>
      value={theme}
      label="Theme"
      // Dimmed rather than dead while the write is in flight: it is one row
      // and a repaint of the page it is standing on, and a control that went
      // grey for that would flicker on every press.
      disabled={pending}
      options={[
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
        { value: "system", label: "System" },
      ]}
      onChange={(next) => startTransition(async () => setTheme(next))}
    />
  );
}
