"use client";

import { useEffect, useState, useTransition } from "react";

import { addLibraryFolder, browse, removeLibraryFolder } from "./actions";
import { FolderPicker } from "./folder-picker";
import type { DirListing } from "@/lib/browse";

/**
 * The folders the library is made of.
 *
 * More than one because a collection outgrows a drive. They are listed rather
 * than replaced: adding a second folder should not be indistinguishable from
 * moving the first.
 */
export function FolderSection({
  roots,
  defaultPath,
}: {
  roots: string[];
  defaultPath: string;
}) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [open, setOpen] = useState(roots.length === 0);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open || listing) return;
    startTransition(async () => {
      setListing(await browse(roots[roots.length - 1] ?? defaultPath));
    });
  }, [open, listing, roots, defaultPath]);

  async function add(target: string) {
    const result = await addLibraryFolder(target);
    if (result.ok) {
      setOpen(false);
      setError(null);
    } else {
      setError(result.error);
    }
    return result;
  }

  return (
    <div className="flex flex-col gap-3">
      {roots.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {roots.map((root) => (
            <li key={root} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="min-w-0 truncate font-mono text-sm">
                  {root}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setConfirming(confirming === root ? null : root)
                  }
                  disabled={pending}
                  className="shrink-0 text-xs text-red-700 opacity-70 hover:opacity-100 disabled:opacity-30 dark:text-red-300"
                >
                  {confirming === root ? "Cancel" : "Remove"}
                </button>
              </div>

              {confirming === root && (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-xs opacity-60">
                    Removing it also forgets every film scanned from it. The
                    files themselves are untouched.
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      startTransition(async () => {
                        await removeLibraryFolder(root);
                        setConfirming(null);
                      })
                    }
                    disabled={pending}
                    className="rounded-control border border-red-500/40 bg-red-500/[0.08] px-2.5 py-1 text-xs text-red-700 disabled:opacity-40 dark:text-red-300"
                  >
                    Remove folder
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-card border border-line bg-surface">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left text-sm hover:bg-surface-strong"
        >
          <span className="opacity-70">
            {roots.length === 0
              ? "Select a library folder"
              : "Add another folder"}
          </span>
          <span className="shrink-0 opacity-40">{open ? "Cancel" : "+"}</span>
        </button>

        {open && (
          <div className="border-t border-line p-4">
            {error && (
              <p className="mb-3 font-mono text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            )}
            {listing ? (
              <FolderPicker
                initialListing={listing}
                onSave={add}
                saveLabel="Add this folder"
              />
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-sm opacity-50">
                  Reading the drive… this can take a moment if it was asleep.
                </p>
                {Array.from({ length: 5 }, (_, i) => (
                  <div key={i} className="skeleton h-8 w-full" />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
