"use client";

import { useEffect, useState, useTransition } from "react";

import { browse, moveDataFolder } from "../actions";
import type { DataLocation } from "../actions";
import { FolderPicker } from "../folder-picker";
import type { DirListing } from "@/lib/browse";
import { SettingDialog } from "./dialog";
import { Note, PRIMARY, Status } from "./parts";

/**
 * Where the database, the thumbnail cache and your own sets are kept.
 *
 * Drawn like the scratch space and chosen the same way — a path, a button, and
 * the folder tree in a dialog — because to the person changing it that is what
 * it is. What is different is everything after the click, and the row says so
 * rather than pretending otherwise: the store is copied rather than moved, the
 * running server goes on using the old one, and the new one is not read until
 * the server is started again.
 *
 * That is not timidity about the copy. This server has the database open, and
 * renaming a live SQLite file and its log out from under it is how a library
 * ends up half in each of two places. A copy is a thing that either finished
 * or did not, and until the restart nothing has changed at all.
 *
 * So the old copy is left where it is, and the note says to delete it by hand
 * once the library has come back up. The app will not delete the database it
 * is currently being served from on the strength of a copy nothing has opened.
 */
export function DataFolder({ location }: { location: DataLocation }) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [open, setOpen] = useState(false);
  const [moved, setMoved] = useState<{ to: string; warning?: string } | null>(
    null,
  );
  const [, startTransition] = useTransition();

  // The environment has the last word, and a container is the case that sets
  // it. Offering a folder tree that could not be honoured would be the page
  // asking a question it already knows it will refuse the answer to.
  const fixed = location.source === "environment";

  useEffect(() => {
    if (!open || listing) return;
    startTransition(async () => setListing(await browse(location.path)));
  }, [open, listing, location.path]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Status
          on={location.source !== "default"}
          label={
            fixed
              ? "Set by RIPGRADE_DATA_DIR"
              : location.source === "chosen"
                ? "Kept in"
                : "Kept in the project's own folder"
          }
          detail={location.path}
        />

        {!fixed && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={PRIMARY}
          >
            Move
          </button>
        )}
      </div>

      {/* Stays until the page is left, on purpose: it is an instruction with
          two steps left in it, and the second one is a path to delete. A line
          that faded would take the path with it. */}
      {moved && (
        <div className="flex flex-col gap-1">
          <Note>
            Copied to <span className="font-mono">{moved.to}</span>. Restart the
            server to use it — then delete{" "}
            <span className="font-mono">{location.path}</span>, which is still
            the one being read right now.
          </Note>
          {moved.warning && <Note>{moved.warning}</Note>}
        </div>
      )}

      <SettingDialog
        open={open}
        onClose={() => setOpen(false)}
        wide
        title="Move the data folder"
        lede="The database, the thumbnail cache and the artwork for your own sets. Copied there now; read from there after a restart. Nothing is deleted."
      >
        {listing ? (
          <FolderPicker
            initialListing={listing}
            onSave={async (target) => {
              const result = await moveDataFolder(target);
              if (result.ok) {
                setMoved({ to: result.to, warning: result.warning });
                setOpen(false);
              }
              return result;
            }}
            saveLabel="Copy the data here"
          />
        ) : (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="skeleton h-8 w-full" />
            ))}
          </div>
        )}
      </SettingDialog>
    </div>
  );
}
