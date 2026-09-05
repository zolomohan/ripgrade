"use client";

import { useState, useTransition } from "react";

import type { GlassPoster } from "@/lib/glass";
import type { GlassTuning as Tuning } from "@/lib/glass";
import { PRIMARY, Status } from "./parts";
import { SettingDialog } from "./dialog";
import { GlassTuning } from "./glass-tuning";
import { resetGlassTuning } from "../actions";

/**
 * Glass, as a row like every other setting, opening onto the bench it needs.
 *
 * The odd one out on this page and the only one that could not simply sit in a
 * row: the other fourteen are a reading and a control, and this is a shelf of
 * posters with seven sliders beside it — a picture you drag a pane across to
 * find an edge worth watching. Seven hundred lines of workbench in the column
 * where the row beside it puts a toggle.
 *
 * So it keeps the row and hands the bench to a dialog, which is what this page
 * already does for the folder pickers and what the artwork chooser does from
 * the film page. Wide, because the preview is the point: judging a material by
 * a swatch is how you end up with a rail nobody can read.
 */
export function GlassPanel({
  tuning,
  posters,
  summary,
}: {
  tuning: Tuning;
  posters: GlassPoster[];
  /** The profile in force, in the words the tuner itself uses. */
  summary: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Status on label={summary} />

      <button type="button" onClick={() => setOpen(true)} className={PRIMARY}>
        Tune
      </button>

      <SettingDialog
        open={open}
        onClose={() => setOpen(false)}
        size="bench"
        action={<GlassReset />}
        title="Glass"
        lede="Carry the pane across the shelf, drag its corner to resize, double-click to put it back."
      >
        <GlassTuning tuning={tuning} posters={posters} />
      </SettingDialog>
    </div>
  );
}

/**
 * All seven back to how the app ships them.
 *
 * At the top of the dialog beside the close, which is where a thing that
 * undoes the whole window belongs. It was at the foot of the slider column —
 * the last item on a scroll, reading as the end of the list rather than as the
 * one control that acts on everything above it.
 */
function GlassReset() {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(async () => resetGlassTuning())}
      // On the button rather than in an `Explained`: that is a second tab stop
      // and a dotted underline, both wrong inside a control that already says
      // what it does.
      title="All seven at once, as the app ships them: a 5px lens on a bevelled 5% rim, split eight at the edge, blurred five, saturated to 150%, three quarters of the page behind it, and no sheen."
      className="h-7 shrink-0 rounded-full border border-line px-3 text-xs opacity-60 transition-opacity hover:opacity-100 disabled:opacity-25"
    >
      Reset
    </button>
  );
}
