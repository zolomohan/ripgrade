"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { clearThumbs, rebuildThumbs } from "../actions";

/**
 * The thumbnail cache: how big it has grown, and the two things worth doing
 * to it. Clearing reclaims the disk — the cache refills itself as shelves
 * are browsed. Rebuilding is the opposite gesture: generate everything now,
 * which is what you want just before the drive leaves the desk.
 */

const size = (bytes: number) =>
  bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(1)} GB`
    : bytes >= 1e6
      ? `${(bytes / 1e6).toFixed(1)} MB`
      : `${Math.ceil(bytes / 1e3)} KB`;

export function Thumbs({ files, bytes }: { files: number; bytes: number }) {
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [rebuilding, setRebuilding] = useState(false);
  const router = useRouter();

  function clear() {
    setNote(null);
    startTransition(async () => {
      const removed = await clearThumbs();
      setNote(
        removed.files
          ? `Cleared ${removed.files} thumbnails · ${size(removed.bytes)} freed.`
          : "The cache was already empty.",
      );
      router.refresh();
    });
  }

  function rebuild() {
    setNote(null);
    setRebuilding(true);
    startTransition(async () => {
      const result = await rebuildThumbs();
      setRebuilding(false);
      setNote(
        result.ok
          ? `${result.ready} thumbnails ready.${
              result.failed
                ? ` ${result.failed} could not be read — is the drive connected?`
                : ""
            }`
          : result.error,
      );
      router.refresh();
    });
  }

  return (
    <div className="rounded-card border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm">
            {files
              ? `${files.toLocaleString("en-GB")} thumbnails · ${size(bytes)}`
              : "Nothing cached yet — thumbnails appear as shelves are browsed"}
          </p>
          {note && (
            <p className="mt-0.5 text-xs opacity-55" role="status">
              {note}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {files > 0 && (
            <button
              type="button"
              onClick={clear}
              disabled={pending}
              className="text-xs opacity-50 hover:opacity-100 disabled:opacity-30"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={rebuild}
            disabled={pending}
            title="Generate every poster's thumbnails now, so the whole library shows with the drive unplugged"
            className="rounded-control border border-line px-3 py-1.5 text-sm hover:bg-surface-strong disabled:opacity-40"
          >
            {rebuilding ? "Rebuilding…" : "Rebuild now"}
          </button>
        </div>
      </div>
    </div>
  );
}
