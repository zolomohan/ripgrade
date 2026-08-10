"use client";

import { BUTTON } from "./controls";
import { useScan } from "./scan-provider";
import { Spinner } from "./spinner";

/**
 * Just the trigger — progress and results are rendered by the provider in the
 * root layout, so they survive navigating away from this page.
 *
 * Secondary, and one word. Filled and glassed, it was the loudest thing on the
 * dashboard: a black pill with an icon, sitting beside the greeting, drawing
 * the eye before the six figures under it and before the work that needs doing.
 * A scan is maintenance — the app runs one at startup and sweeps after it — so
 * this is the button for the odd time you have moved a file by hand, not the
 * page's subject. An outline says "available" without claiming to be why you
 * came, and the app's other secondaries already say it in that shape.
 *
 * The glass went with the fill. It was borrowed from the search field, on the
 * argument that a scan is the other way of looking for films, which is a nice
 * sentence and a poor icon: the same mark meaning "search the shelf" in one
 * place and "read the drive" in another teaches the reader that it means
 * neither. "Scan" is unambiguous in a way no 14px picture is, and dropping the
 * word "library" costs nothing — there is one library, and the button is not on
 * a page where it could be scanning anything else.
 *
 * `BUTTON.secondary` rather than the shelf row's height: this stopped standing
 * in a row of controls when the library bar moved to `/library`, and its two
 * homes now are the foot of the rail and a settings row, where the thing to
 * agree with is every other button in the app.
 *
 * Those two homes want two widths, which is the whole of what `className` is
 * for: the rail's foot is a column and a button that stops short of its edges
 * reads as loose in it, while the settings row holds its button beside a
 * sentence and wants it the size of its own word.
 */
export function ScanButton({ className = "" }: { className?: string }) {
  const { state, start, busy } = useScan();

  const label =
    state.status === "scanning"
      ? "Scanning…"
      : state.status === "dovi"
        ? "Dolby Vision…"
        : state.status === "matching"
          ? "Matching…"
          : state.status === "discs"
            ? "Discs…"
            : "Scan";

  return (
    <button
      type="button"
      onClick={start}
      disabled={busy}
      className={`${BUTTON.secondary} ${className}`}
    >
      {/* The label already names the phase — Scanning, Matching, Discs. The
          wheel is only there to say it is still going, and it is the one mark
          this button carries, because a button that is working has something to
          report and a button at rest does not. */}
      {busy && <Spinner />}
      {label}
    </button>
  );
}
