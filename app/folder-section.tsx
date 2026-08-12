"use client";

import { useEffect, useState, useTransition } from "react";

import { addLibraryFolder, browse, removeLibraryFolder } from "./actions";
import { ConfirmModal } from "./confirm";
import { FolderPicker } from "./folder-picker";
import { useLingering } from "./modal";
import { Failure, PRIMARY, QUIET } from "./settings/parts";
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

  // The folder the question is about, kept for the frames the dialog spends
  // leaving — otherwise the path blanks out of the sentence mid-exit.
  const asking = useLingering(confirming);

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
              className="flex flex-wrap items-center justify-between gap-3 rounded-card px-4 py-2.5 transition-colors hover:bg-surface"
            >
              <span className="min-w-0 truncate font-mono text-xs">{root}</span>
              <button
                type="button"
                onClick={() => setConfirming(root)}
                disabled={pending}
                className={`${QUIET} text-red-700 dark:text-red-300`}
              >
                Remove
              </button>
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

      {/* Asked in the app's one confirmation shape, as every other irreversible
          thing here is. The consequence is the whole reason to ask: what goes
          with the folder is every film scanned from it, and that is not
          something to learn from an undo that does not exist. */}
      {asking !== null && (
        <ConfirmModal
          open={confirming !== null}
          title="Remove this library folder?"
          confirmLabel={pending ? "Removing…" : "Remove folder"}
          tone="danger"
          busy={pending}
          onConfirm={() =>
            startTransition(async () => {
              await removeLibraryFolder(asking);
              setConfirming(null);
            })
          }
          onCancel={() => setConfirming(null)}
        >
          <code className="font-mono text-xs">{asking}</code> is dropped from
          the library, and every film scanned from it is forgotten with it. The
          files themselves are untouched — adding the folder back and scanning
          finds them again.
        </ConfirmModal>
      )}
    </div>
  );
}
