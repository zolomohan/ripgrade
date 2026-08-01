"use client";

import { useState, useTransition } from "react";

import { browse, setLibraryRoot } from "./actions";
import type { DirListing } from "@/lib/browse";

function Breadcrumb({
  path,
  onNavigate,
}: {
  path: string;
  onNavigate: (path: string) => void;
}) {
  const segments = path.split("/").filter(Boolean);

  return (
    <div className="flex flex-wrap items-center gap-1 font-mono text-sm">
      <button
        type="button"
        onClick={() => onNavigate("/")}
        className="rounded-chip px-1 hover:bg-surface-strong"
      >
        /
      </button>
      {segments.map((segment, i) => (
        <span key={i} className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onNavigate("/" + segments.slice(0, i + 1).join("/"))}
            className="rounded-chip px-1 hover:bg-surface-strong"
          >
            {segment}
          </button>
          {i < segments.length - 1 && <span className="opacity-40">/</span>}
        </span>
      ))}
    </div>
  );
}

// The first listing is fetched on the server and passed in, so the picker opens
// with folders already on screen rather than flashing a loading state.
export function FolderPicker({
  initialListing,
}: {
  initialListing: DirListing;
}) {
  const [listing, setListing] = useState<DirListing>(initialListing);
  const [pathInput, setPathInput] = useState(initialListing.path);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function navigate(target: string) {
    setSaveError(null);
    startTransition(async () => {
      const next = await browse(target);
      setListing(next);
      setPathInput(next.path);
    });
  }

  function save() {
    startTransition(async () => {
      const result = await setLibraryRoot(listing.path);
      if (!result.ok) setSaveError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          navigate(pathInput);
        }}
        className="flex gap-2"
      >
        <input
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          spellCheck={false}
          placeholder="/Volumes/…"
          className="flex-1 rounded-chip border border-line bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-line-strong"
        />
        <button
          type="submit"
          className="rounded-chip border border-line px-3 py-2 text-sm hover:bg-surface-strong"
        >
          Go
        </button>
      </form>

      <div className="rounded-control border border-line">
        <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
          <Breadcrumb path={listing.path} onNavigate={navigate} />
          {pending && <span className="text-xs opacity-60">working…</span>}
        </div>

        <div className="max-h-96 overflow-y-auto">
          {listing.error && (
            <p className="px-3 py-4 font-mono text-sm text-red-600 dark:text-red-400">
              {listing.error}
            </p>
          )}

          {!listing.error && listing.entries.length === 0 && (
            <p className="px-3 py-4 text-sm opacity-60">
              No sub-folders here. You can still select this folder.
            </p>
          )}

          {listing.parent && (
            <button
              type="button"
              onClick={() => navigate(listing.parent!)}
              className="block w-full px-3 py-2 text-left font-mono text-sm opacity-60 hover:bg-surface-strong"
            >
              ../
            </button>
          )}

          {listing.entries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              onClick={() => navigate(entry.path)}
              className="block w-full px-3 py-2 text-left font-mono text-sm hover:bg-surface-strong"
            >
              {entry.name}/
            </button>
          ))}
        </div>
      </div>

      {saveError && (
        <p className="font-mono text-sm text-red-600 dark:text-red-400">
          {saveError}
        </p>
      )}

      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="self-start rounded-chip bg-foreground px-4 py-2 text-sm text-background disabled:opacity-40"
      >
        Use this folder
      </button>
    </div>
  );
}
