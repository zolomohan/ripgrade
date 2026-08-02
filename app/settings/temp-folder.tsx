"use client";

import { useEffect, useState, useTransition } from "react";

import { browse, clearConvertTempDir, setConvertTempDir } from "../actions";
import { FolderPicker } from "../folder-picker";
import type { DirListing } from "@/lib/browse";

/**
 * Where dovi_convert writes its working video file.
 *
 * A conversion reads the source and writes the converted stream at the same
 * time. On one spinning drive those two compete for the same head, and the
 * whole job runs at whatever is left; pointing the intermediate at an SSD
 * splits them apart. The final file still lands beside the original, so this
 * changes the speed and nothing else.
 */
export function TempFolder({
  current,
  defaultPath,
}: {
  current?: string;
  defaultPath: string;
}) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open || listing) return;
    startTransition(async () => setListing(await browse(current ?? defaultPath)));
  }, [open, listing, current, defaultPath]);

  return (
    <div className="rounded-card border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm">
            {current ? "Working files go to" : "Working files stay beside the film"}
          </p>
          {current && (
            <p className="truncate font-mono text-xs opacity-45">{current}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {current && (
            <button
              type="button"
              onClick={() => startTransition(async () => clearConvertTempDir())}
              disabled={pending}
              className="text-xs opacity-50 hover:opacity-100 disabled:opacity-30"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-control border border-line px-3 py-1.5 text-sm hover:bg-surface-strong"
          >
            {open ? "Cancel" : current ? "Change" : "Choose a folder"}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-line p-4">
          {listing ? (
            <FolderPicker
              initialListing={listing}
              onSave={setConvertTempDir}
              saveLabel="Use this folder for working files"
            />
          ) : (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="skeleton h-8 w-full" />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
