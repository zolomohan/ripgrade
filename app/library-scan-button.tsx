"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { rederive, rescanUpgrades, rescanWishlist } from "@/app/actions";
import { CONTROL_H, ICONS } from "@/app/controls";
import { useJobs } from "@/app/jobs-provider";
import { useScan } from "@/app/scan-provider";
import { Spinner } from "@/app/spinner";

/**
 * The library shelf's Scan, and the three passes standing behind it.
 *
 * One button used to mean four things. Pressing Scan on this page read the
 * drive and then, on the same press, asked the indexers about every film you
 * own and every film you want — four hundred searches for a word that promises
 * to look at your folders. The passes were worth having; being handed them
 * unasked was not, and there was no way to ask for one without the others.
 *
 * So the press is now exactly what it says, and the rest of what it used to do
 * is a menu beside it: the films, the wants, and the rebuild that needs neither.
 * Each is a whole pass with the freshness rule off — a menu item is somebody
 * naming the work, and "checked 20 h ago" is precisely the row they are trying
 * to get past. See `SweepScope` in lib/upgrade-sweep.ts for the halves.
 *
 * The shape is the library bar's: one rounded frame, ruled into slots, at the
 * height every other control on this line stands at. It reads as one control
 * with a second question in it, which is what it is — and it is the same
 * drawing the filter bar two feet to the left already makes, rather than a
 * split button invented for this row alone.
 */

/** One pass in the menu: what it is called, what it costs, and how to start it. */
type Pass = {
  key: string;
  label: string;
  detail: string;
  /** Whether it goes out to the indexers, and so needs Jackett set up. */
  searches: boolean;
  run: () => Promise<void>;
};

export function LibraryScanButton({ jackettReady }: { jackettReady: boolean }) {
  const { jobs, apply } = useJobs();
  const { start: startScan, busy: scanning } = useScan();
  const sweeping = jobs.sweep.status === "running";
  // Only the round trip that starts a pass; from then on the job speaks for
  // itself through the rail, like everything else here.
  const [starting, start] = useTransition();
  const [open, setOpen] = useState(false);
  /** What the last menu press did, for the one pass with no job to watch. */
  const [said, setSaid] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const busy = scanning || sweeping || starting;

  // Long enough to read, short enough that it is gone before it becomes part
  // of the furniture — the window a finished scan's summary gets in the rail.
  useEffect(() => {
    if (!said) return;
    const id = setTimeout(() => setSaid(null), 8000);
    return () => clearTimeout(id);
  }, [said]);

  // Click away or press Escape, exactly as `Popover` does — the same menu
  // behaviour the filter bar has, because this is the same kind of menu.
  useEffect(() => {
    if (!open) return;

    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const passes: Pass[] = [
    {
      key: "upgrades",
      label: "Upgrade scan",
      detail: "Search for a better copy of every film, including today's checks",
      searches: true,
      run: async () => {
        // The stream is a moment behind the action that caused it, and a menu
        // that stayed live in between would start a second sweep.
        apply({ sweep: await rescanUpgrades() });
      },
    },
    {
      key: "wishlist",
      label: "Wishlist scan",
      detail: "Search for every want, and fetch the discs they are scored against",
      searches: true,
      run: async () => {
        apply({ sweep: await rescanWishlist() });
      },
    },
    {
      key: "rederive",
      label: "Re-derive",
      detail: "Rebuild every score from the readings already stored",
      searches: false,
      run: async () => {
        // The only pass here that is over before the rail could draw it, so it
        // is the only one that has to report on itself.
        const count = await rederive();
        setSaid(`${count} film${count === 1 ? "" : "s"} re-derived`);
      },
    },
  ];

  /** Why a pass cannot run right now, or undefined when it can. */
  const refusal = (pass: Pass) =>
    busy
      ? "Something is already running — progress is in the sidebar"
      : pass.searches && !jackettReady
        ? "Connect Jackett on the Settings page first"
        : undefined;

  return (
    <div ref={wrap} className="relative flex shrink-0">
      <div
        className={`flex ${CONTROL_H} items-stretch divide-x divide-line rounded-full border border-line transition-colors`}
      >
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            start(async () => {
              setSaid(null);
              // The provider owns the scan for the whole app: it applies the
              // job, and it is what turns a refusal — no library folder — into
              // the line the rail shows.
              await startScan({ driveOnly: true });
            })
          }
          // Named in both states rather than by its contents: "Scanning…" is
          // enough on screen beside a turning wheel and no use at all read out
          // on its own. aria-busy is what says the wait is work, not a fault.
          aria-label={busy ? "Reading the folders" : "Scan"}
          aria-busy={busy}
          title={
            busy
              ? "Reading the folders — progress is in the sidebar"
              : "Read the library folders for anything new or changed"
          }
          // A fixed width, so what is inside can change completely without the
          // controls beside it moving. Faded while a pass runs, because it
          // really is unpressable then.
          className="flex w-28 shrink-0 items-center justify-center gap-2 rounded-l-full px-4 text-sm transition-colors hover:bg-surface-strong disabled:opacity-40"
        >
          {busy ? (
            <Spinner />
          ) : (
            /* A scanner's frame, corners and a beam: the app's mark for a file
               being read, and now honestly the whole of what this press does.
               See `ICONS.scan`. */
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              className="h-3.5 w-3.5"
            >
              <path d={ICONS.scan} />
            </svg>
          )}
          {busy ? "Scanning…" : "Scan"}
        </button>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Other scans"
          title="Other scans"
          // Never disabled with the half beside it. A running pass is exactly
          // when you want to read what the others are, and every item inside
          // says for itself that it cannot start yet.
          className={`flex shrink-0 items-center rounded-r-full px-2.5 transition-colors ${
            open ? "bg-surface-strong" : "hover:bg-surface-strong"
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className={`h-4 w-4 opacity-50 transition-transform duration-200 ${
              open ? "rotate-180" : ""
            }`}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>

      {open && (
        <div className="row-enter absolute top-full right-0 z-30 mt-2 w-80 overflow-hidden glass-panel rounded-card border border-line shadow-2xl">
          <div className="flex flex-col divide-y divide-line">
            {passes.map((pass) => {
              const why = refusal(pass);

              return (
                <button
                  key={pass.key}
                  type="button"
                  disabled={Boolean(why)}
                  title={why}
                  onClick={() =>
                    start(async () => {
                      setSaid(null);
                      setOpen(false);
                      await pass.run();
                    })
                  }
                  className="flex flex-col items-start gap-0.5 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-strong disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <span className="text-sm">{pass.label}</span>
                  {/* What it will actually go and do, because the difference
                      between these three is the cost rather than the word. */}
                  <span className="text-xs opacity-45">{pass.detail}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* The re-derive's receipt. It touches no disk and no indexer, so it is
          over in the time the menu takes to close and the rail never carries
          it — leaving the one pass here that would otherwise look like nothing
          happened. Sits under the control rather than inside the menu, which
          by then is shut. */}
      {said && !open && (
        <span className="glass-panel absolute top-full right-0 z-20 mt-2 rounded-chip border border-line px-2.5 py-1 text-[11px] whitespace-nowrap opacity-70 shadow">
          {said}
        </span>
      )}
    </div>
  );
}
