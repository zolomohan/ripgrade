"use client";

import { useState } from "react";

import { FolderSection } from "../folder-section";
import { ScanButton } from "../scan-button";
import { SettingDialog } from "./dialog";
import { PRIMARY, Status } from "./parts";

/**
 * The folders a scan walks, as a row that opens onto the list.
 *
 * The list is the longest thing on this page — every root, each with a path
 * and a way to drop it, and a tree to browse when you add another — and it was
 * sitting open in a row beside settings that are a toggle. A row is a line
 * about one thing, and this is a collection: the row says how many and what
 * they are, and managing them is a thing you go and do.
 *
 * The same shape the scratch space and the artwork chooser already have, so
 * the page has one answer to "this needs more room than a row" rather than a
 * different one per setting.
 */
export function LibraryFolders({
  roots,
  defaultPath,
}: {
  roots: string[];
  defaultPath: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Status
        on={roots.length > 0}
        label={
          roots.length
            ? `${roots.length} folder${roots.length === 1 ? "" : "s"}`
            : "None chosen"
        }
        // The paths themselves, which is what you actually recognise a library
        // by — a count alone could be anybody's. Truncated by `Status`, and
        // the whole of each is in the dialog.
        detail={roots.join(" · ") || undefined}
      />

      <div className="flex shrink-0 items-center gap-3">
        {/* Only once there is something to walk: a scan of no folders is an
            error message dressed as a button. */}
        {roots.length > 0 && <ScanButton />}

        <button type="button" onClick={() => setOpen(true)} className={PRIMARY}>
          {roots.length ? "Manage" : "Add a folder"}
        </button>
      </div>

      <SettingDialog
        open={open}
        onClose={() => setOpen(false)}
        size="wide"
        title="Library folders"
        lede="Everything the app knows comes from scanning these. Add as many as the library is spread across — one scan walks all of them, and one runs every time the app starts."
      >
        <FolderSection roots={roots} defaultPath={defaultPath} />
      </SettingDialog>
    </>
  );
}
