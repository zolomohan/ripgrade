"use client";

import { useState, useTransition } from "react";

import { browse } from "./actions";
import { BUTTON, FIELD } from "./controls";
import { Spinner } from "./spinner";
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
        className="rounded-full px-1.5 hover:bg-surface-strong"
      >
        /
      </button>
      {segments.map((segment, i) => (
        <span key={i} className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onNavigate("/" + segments.slice(0, i + 1).join("/"))}
            className="rounded-full px-1.5 hover:bg-surface-strong"
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
  onSave,
  saveLabel = "Use this folder",
}: {
  initialListing: DirListing;
  /** What the chosen folder is for — the picker itself does not care. */
  onSave: (
    path: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  saveLabel?: string;
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
      const result = await onSave(listing.path);
      if (!result.ok) setSaveError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Enter navigates; typing a path is its own request and needed no
          button beside it. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          navigate(pathInput);
        }}
      >
        <input
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          spellCheck={false}
          placeholder="/Volumes/…"
          aria-label="Path — press Enter to open"
          className={`${FIELD.default} w-full`}
        />
      </form>

      <div className="rounded-control border border-line">
        <div className="flex items-center gap-2.5 border-b border-line px-2.5 py-2">
          {/* One step up the tree, as a control rather than a "../" row lost
              among the folders. */}
          <button
            type="button"
            onClick={() => listing.parent && navigate(listing.parent)}
            disabled={pending || !listing.parent}
            aria-label="Up one folder"
            title="Up one folder"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line opacity-60 transition-opacity hover:opacity-100 disabled:opacity-25"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              className="h-3.5 w-3.5"
            >
              <path d="M12 18V6" />
              <path d="m6 11 6-6 6 6" />
            </svg>
          </button>

          <div className="min-w-0 flex-1">
            <Breadcrumb path={listing.path} onNavigate={navigate} />
          </div>
          {/* The same wheel the buttons use, because a folder being read is
              the same kind of wait — it just happens not to have been
              started by anything you can point at. */}
          {pending && <Spinner className="h-3.5 w-3.5 opacity-50" />}
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
        className={`${BUTTON.primary} self-start`}
      >
        {pending && <Spinner />}
        {saveLabel}
      </button>
    </div>
  );
}
