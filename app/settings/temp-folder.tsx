"use client";

import { useEffect, useState, useTransition } from "react";

import { browse, clearConvertTempDir, setConvertTempDir } from "../actions";
import { FolderPicker } from "../folder-picker";
import type { DirListing } from "@/lib/browse";
import { SettingDialog } from "./dialog";
import { PRIMARY, QUIET, Status } from "./parts";

/**
 * Where dovi_convert writes its working video file.
 *
 * A conversion reads the source and writes the converted stream at the same
 * time. On one spinning drive those two compete for the same head, and the
 * whole job runs at whatever is left; pointing the intermediate at an SSD
 * splits them apart. The final file still lands beside the original, so this
 * changes the speed and nothing else.
 *
 * Choosing goes in a dialog. The tree is a scrolling list of folders with a
 * breadcrumb over it — the biggest thing on the Settings page while it was
 * open, and it grew downward out of a row whose whole job was to tell you the
 * one path in force. Asked for, it gets the width the paths in it want.
 */
export function TempFolder({
  current,
  defaultPath,
}: {
  current?: string;
  defaultPath: string;
}) {
  const [listing, setListing] = useState<DirListing | null>(null);
  // The browser is behind a button rather than opening with the panel: it reads
  // the drive, which is a request, and one made by arriving on this tab would be
  // made for everyone who came to change something else.
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open || listing) return;
    startTransition(async () =>
      setListing(await browse(current ?? defaultPath)),
    );
  }, [open, listing, current, defaultPath]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Status
        on={Boolean(current)}
        label={
          current ? "Working files go to" : "Working files stay beside the film"
        }
        detail={current}
      />

      <div className="flex shrink-0 items-center gap-3">
        {current && (
          <button
            type="button"
            onClick={() => startTransition(async () => clearConvertTempDir())}
            disabled={pending}
            className={QUIET}
          >
            Clear
          </button>
        )}
        <button type="button" onClick={() => setOpen(true)} className={PRIMARY}>
          {current ? "Change" : "Choose a folder"}
        </button>
      </div>

      <SettingDialog
        open={open}
        onClose={() => setOpen(false)}
        wide
        title={current ? "Change the scratch space" : "Choose a scratch folder"}
        lede="The working file is written here while a conversion runs. The film itself still lands beside the original."
      >
        {/* The listing is kept once fetched, so reopening the dialog shows the
            tree where you left it rather than paying for the walk again. */}
        {listing ? (
          <FolderPicker
            initialListing={listing}
            onSave={async (path) => {
              const result = await setConvertTempDir(path);
              if (result.ok) setOpen(false);
              return result;
            }}
            saveLabel="Use this folder for working files"
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
