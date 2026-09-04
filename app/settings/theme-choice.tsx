"use client";

import { useTransition } from "react";

import { Switch } from "@/app/controls";
import type { Theme } from "@/lib/theme";
import { setTheme } from "../actions";

/**
 * Light, dark, or the machine's answer.
 *
 * A switch rather than the toggles most of this page uses, for the reason
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
    <div
      // Dimmed rather than disabled, as the layout switch beside it is: a
      // `Switch` has no disabled state, and the write is one row and a repaint
      // of the page it is standing on. A second press before the first lands
      // should at least look like one.
      className={pending ? "opacity-60 transition-opacity" : undefined}
    >
      <Switch
        value={theme}
        onChange={(next) =>
          startTransition(async () => setTheme(next as Theme))
        }
        options={[
          { key: "light", label: "Light" },
          { key: "dark", label: "Dark" },
          { key: "system", label: "System" },
        ]}
      />
    </div>
  );
}
