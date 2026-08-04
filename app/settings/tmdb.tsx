"use client";

import { useState, useTransition } from "react";

import { disconnectTmdb, saveTmdbToken } from "../actions";

/**
 * Connecting TMDb.
 *
 * Write-only from here: the token is stored but no action hands it back, so a
 * connected install shows that it is connected and nothing else. This is the
 * only way to set it — the app does not read the environment for it. Saving runs a live search first and puts back whatever worked
 * before if it fails — a field that accepts a typo silently would leave every
 * title, poster and collection quietly broken.
 */
export function Tmdb({ configured }: { configured: boolean }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveTmdbToken(token);
      if (result.ok) {
        setOpen(false);
        setToken("");
      } else setError(result.error);
    });
  }


  return (
    <div className="rounded-card border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <p className="min-w-0 text-sm">
          {configured ? "Connected" : "Not connected"}
        </p>

        <div className="flex shrink-0 items-center gap-3">
          {configured && (
            <button
              type="button"
              onClick={() => startTransition(async () => disconnectTmdb())}
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
            <span className="text-xs opacity-55">
              Read access token — TMDb account settings, under API. The long
              one, not the v3 key.
            </span>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
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
              disabled={pending || !token.trim()}
              className="rounded-control border border-line px-3 py-1.5 text-sm hover:bg-surface-strong disabled:opacity-30"
            >
              {pending ? "Checking…" : "Test and save"}
            </button>
            <span className="text-xs opacity-45">
              Saved only if TMDb answers.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
