"use client";

import { useTransition } from "react";

import { rederive, rescanUpgrades, rescanWishlist } from "@/app/actions";
import { useJobs } from "@/app/jobs-provider";
import { useScan } from "@/app/scan-provider";
import { toast } from "glaceui";

/** One pass: what it is called, what it costs, and how to start it. */
export type Pass = {
  key: string;
  label: string;
  detail: string;
  /** Whether it goes out to the indexers, and so needs Jackett set up. */
  searches: boolean;
  run: () => Promise<void>;
};

/**
 * Every way of asking the app to go and look at something, in one list.
 *
 * These lived inside the library shelf's Scan button, which was the only place
 * that offered them. They were lifted out when the dashboard began offering
 * them as well — four passes described in two files being four passes that
 * disagree about what a wishlist scan costs by the second time either is
 * edited — and the shelf's button has since gone, so this is now read by one
 * caller. It stays a module of its own regardless: what is in here is the list
 * of things the app can be asked to go and do, which is not a fact about the
 * corner of the dashboard that happens to ask.
 *
 * The refusals travel with the passes for the same reason: "connect Jackett
 * first" is a fact about the pass, not about the control offering it.
 *
 * They are one flat list. The shelf's button made the drive read its press and
 * kept the other three in a menu, on the argument that pressing Scan on a page
 * of films should read the films; nowhere is making that argument now, and the
 * dashboard is not a page of films.
 *
 * `run` wraps the transition rather than leaving it to the caller: what is
 * being tracked is the round trip that starts a pass and nothing after it. From
 * then on the job speaks for itself through the rail, like everything else.
 */
export function useScanPasses(jackettReady: boolean) {
  const { jobs, apply } = useJobs();
  const { start: startScan, busy: scanning } = useScan();
  const sweeping = jobs.sweep.status === "running";
  const [starting, start] = useTransition();

  const busy = scanning || sweeping || starting;

  /**
   * Reading the folders, which is the one pass that touches no network.
   *
   * Through the provider rather than the action, because the provider owns the
   * scan for the whole app: it applies the job, and it is what turns a refusal
   * — no library folder — into the line the rail shows.
   */
  const passes: Pass[] = [
    {
      key: "drive",
      label: "Scan library",
      detail: "Read the library folders for anything new or changed",
      searches: false,
      run: () => startScan({ driveOnly: true }),
    },
    {
      key: "upgrades",
      label: "Upgrade scan",
      detail:
        "Search for a better copy of every film, including today's checks",
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
      detail:
        "Search for every want, and fetch the discs they are scored against",
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
        toast.success(`${count} film${count === 1 ? "" : "s"} re-derived`);
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

  return {
    all: passes,
    refusal,
    busy,
    run: (pass: Pass) => start(async () => pass.run()),
  };
}
