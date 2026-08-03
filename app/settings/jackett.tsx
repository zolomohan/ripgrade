"use client";

import { useState, useTransition } from "react";

import { disconnectJackett, saveJackett } from "../actions";

/**
 * Connecting Jackett.
 *
 * The key is write-only from here: it is stored, but no action hands it back,
 * so a connected install shows the address and nothing else. Saving runs a live
 * check first and keeps the previous settings if it fails — a field that
 * accepts a typo silently is worse than one that refuses it.
 */
export function Jackett({
  configured,
  url,
  managed,
}: {
  configured: boolean;
  url?: string;
  managed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draftUrl, setDraftUrl] = useState(url ?? "http://localhost:9117");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveJackett(draftUrl, apiKey);
      if (result.ok) {
        setOpen(false);
        setApiKey("");
      } else setError(result.error);
    });
  }

  if (managed) {
    return (
      <div className="rounded-card border border-line bg-surface px-4 py-3">
        <p className="text-sm">Set by the environment</p>
        <p className="truncate font-mono text-xs opacity-45">{url}</p>
        <p className="mt-1 text-xs opacity-45">
          JACKETT_URL and JACKETT_API_KEY are set, so this cannot be changed
          here.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm">
            {configured ? "Connected to" : "Not connected"}
          </p>
          {configured && (
            <p className="truncate font-mono text-xs opacity-45">{url}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {configured && (
            <button
              type="button"
              onClick={() => startTransition(async () => disconnectJackett())}
              disabled={pending}
              className="text-xs opacity-50 hover:opacity-100 disabled:opacity-30"
            >
              Disconnect
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-control border border-line px-3 py-1.5 text-sm hover:bg-surface-strong"
          >
            {open ? "Cancel" : configured ? "Change" : "Connect"}
          </button>
        </div>
      </div>

      {open && (
        <div className="flex flex-col gap-3 border-t border-line p-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs opacity-55">Address</span>
            <input
              type="url"
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              placeholder="http://localhost:9117"
              className="rounded-control border border-line bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-line-strong"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs opacity-55">
              API key — from the top right of Jackett&rsquo;s own dashboard
            </span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="rounded-control border border-line bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-line-strong"
            />
          </label>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={pending || !draftUrl || !apiKey}
              className="rounded-control border border-line px-3 py-1.5 text-sm hover:bg-surface-strong disabled:opacity-30"
            >
              {pending ? "Checking…" : "Test and save"}
            </button>
            <span className="text-xs opacity-45">
              Saved only if Jackett answers.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
