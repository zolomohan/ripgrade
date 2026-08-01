"use client";

import { useEffect, useState, useTransition } from "react";

import { browse } from "./actions";
import { FolderPicker } from "./folder-picker";
import type { DirListing } from "@/lib/browse";

/**
 * Defers reading the drive until the picker is actually opened.
 *
 * Listing a folder on a spun-down external disk takes ~20 seconds, and doing it
 * eagerly to prime a collapsed panel made every page load wait for the drive.
 */
export function FolderSection({
  initialPath,
  hasRoot,
}: {
  initialPath: string;
  hasRoot: boolean;
}) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [pending, startTransition] = useTransition();

  function load() {
    if (listing || pending) return;
    startTransition(async () => {
      setListing(await browse(initialPath));
    });
  }

  useEffect(() => {
    // With no library chosen the panel starts open, so it has to load itself.
    if (!hasRoot) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRoot]);

  return (
    <details
      open={!hasRoot}
      onToggle={(e) => {
        if (e.currentTarget.open) load();
      }}
      className="rounded-xl border border-black/10 dark:border-white/10"
    >
      <summary className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3 text-sm">
        <span className="shrink-0 opacity-70">
          {hasRoot ? "Change library folder" : "Select library folder"}
        </span>
        <span className="truncate font-mono text-xs opacity-40">
          {initialPath}
        </span>
      </summary>
      <div className="border-t border-black/10 p-4 dark:border-white/10">
        {listing ? (
          <FolderPicker initialListing={listing} />
        ) : (
          <p className="text-sm opacity-50">
            Reading the drive… this can take a moment if it was asleep.
          </p>
        )}
      </div>
    </details>
  );
}
