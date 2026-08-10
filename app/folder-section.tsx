"use client";

import { useEffect, useState, useTransition } from "react";

import { addLibraryFolder, browse, removeLibraryFolder } from "./actions";
import { FolderPicker } from "./folder-picker";
import { Spinner } from "./spinner";
import { DANGER, Failure, PRIMARY, QUIET } from "./settings/parts";
import type { DirListing } from "@/lib/browse";

/**
 * The folders the library is made of.
 *
 * More than one because a collection outgrows a drive. They are listed rather
 * than replaced: adding a second folder should not be indistinguishable from
 * moving the first.
 *
 * A plain list rather than a boxed table — the rows carry a hover band that
 * bleeds past the column, exactly as the queue's rows do, so a path reads as a
 * line in this app rather than as a cell in a form.
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
    <div className="flex flex-col gap-4">
      {roots.length > 0 && (
        <ul className="-mx-4 flex flex-col">
          {roots.map((root) => (
            <li
              key={root}
              className="flex flex-col gap-2 rounded-card px-4 py-2.5 transition-colors hover:bg-surface"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="min-w-0 truncate font-mono text-xs">
                  {root}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setConfirming(confirming === root ? null : root)
                  }
                  disabled={pending}
                  className={`${QUIET} ${
                    confirming === root
                      ? ""
                      : "text-red-700 dark:text-red-300"
                  }`}
                >
                  {confirming === root ? "Cancel" : "Remove"}
                </button>
              </div>

              {/* The consequence, said only once you have asked for it: what
                  goes with the folder is every film scanned from it, and that
                  is not something to learn from an undo. */}
              {confirming === root && (
                <div className="flex flex-wrap items-center gap-3 pb-1">
                  <p className="min-w-0 flex-1 text-[11px] opacity-55">
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
                    className={DANGER}
                  >
                    {pending && <Spinner className="h-3 w-3" />}
                    Remove folder
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className={open ? QUIET : PRIMARY}
        >
          {open
            ? "Cancel"
            : roots.length === 0
              ? "Select a library folder"
              : "Add another folder"}
        </button>
      </div>

      {error && <Failure>{error}</Failure>}

      {open &&
        (listing ? (
          <FolderPicker
            initialListing={listing}
            onSave={add}
            saveLabel="Add this folder"
          />
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-[11px] opacity-45">
              Reading the drive… this can take a moment if it was asleep.
            </p>
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="skeleton h-8 w-full" />
            ))}
          </div>
        ))}
    </div>
  );
}
