"use client";

import { useState } from "react";

import { FolderSection } from "../folder-section";
import { SettingDialog } from "./dialog";
import { PRIMARY, Value } from "./parts";

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
 *
 * No Scan beside it. A scan runs when the app starts and again whenever a
 * folder is added or dropped, and the shelf has its own button for the times
 * you have moved a file by hand — so a third way to press it, filed under the
 * setting that lists the folders, was a verb parked in a row of nouns.
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
      {/* How many, and no more. The paths were under this — the whole of each
          library folder, run together — which is a machine string in a row
          whose left-hand side is already a sentence, and it grew a line every
          time a folder was added. They are in the dialog, which is where you
          go when the question is which folders rather than how many. The dot
          that stood in front of this is on the setting's name now. */}
      <Value>
        {roots.length
          ? `${roots.length} folder${roots.length === 1 ? "" : "s"}`
          : "None chosen"}
      </Value>


      <button type="button" onClick={() => setOpen(true)} className={PRIMARY}>
        {roots.length ? "Manage" : "Add"}
      </button>

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
