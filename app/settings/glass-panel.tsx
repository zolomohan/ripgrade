"use client";

import { useState } from "react";

import type { GlassPoster } from "@/lib/glass";
import type { GlassTuning as Tuning } from "@/lib/glass";
import { PRIMARY, Status } from "./parts";
import { SettingDialog } from "./dialog";
import { GlassTuning } from "./glass-tuning";

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
        title="Glass"
        lede="The material every surface standing in front of the page is made of. Carry the pane across the shelf to find an edge worth watching, drag its corner to see the same numbers at another size, and double-click it to put it back."
      >
        <GlassTuning tuning={tuning} posters={posters} />
      </SettingDialog>
    </div>
  );
}
