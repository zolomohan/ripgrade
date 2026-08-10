"use client";

import { useTransition } from "react";

import { setKeepEnhancementLayer } from "../actions";
import { Status, Toggle } from "./parts";

/**
 * Whether a conversion keeps what it discards.
 *
 * A Profile 7 → 8.1 conversion throws the enhancement layer away, and the only
 * way back is the 90 GB original it leaves beside the film — which is the
 * first thing anyone deletes once the converted file plays. With this on, the
 * layer itself is packed into a `.dovi` archive first: a tenth to a quarter of
 * the film for a full enhancement layer, a couple of gigabytes for a minimal
 * one, and enough to rebuild the Profile 7 file long after the original has
 * gone.
 *
 * On by default, and off is the deliberate choice rather than the other way
 * round: what it costs is a pass over the film before each conversion — most
 * of an hour on a remux living on a spinning drive — and what it saves is the
 * only copy of a layer nobody misses until they want it back.
 */
export function EnhancementLayer({ keeping }: { keeping: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Status
        on={keeping}
        label={
          keeping
            ? "Kept beside the film, as a .dovi archive"
            : "Discarded with the conversion"
        }
      />

      <Toggle
        on={keeping}
        label="Keep the enhancement layer"
        disabled={pending}
        onChange={() =>
          startTransition(async () => setKeepEnhancementLayer(!keeping))
        }
      />
    </div>
  );
}
