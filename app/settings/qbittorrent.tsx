"use client";

import { useState, useTransition } from "react";

import { disconnectQb, saveQb, setQbStopSeeding } from "../actions";

/**
 * Connecting qBittorrent.
 *
 * The password is write-only from here, exactly as Jackett's key is: stored,
 * never handed back. The username and password stay optional because
 * qBittorrent installs commonly bypass authentication on localhost — the
 * address alone is a working setup there, and the live check on save is what
 * finds out whether more is needed.
 */
export function Qbittorrent({
  configured,
  url,
  managed,
  stopSeeding,
}: {
  configured: boolean;
  url?: string;
  managed: boolean;
  stopSeeding: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draftUrl, setDraftUrl] = useState(url ?? "http://localhost:8080");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveQb(draftUrl, username, password);
      if (result.ok) {
        setOpen(false);
        setUsername("");
        setPassword("");
      } else setError(result.error);
    });
  }

  if (managed) {
    return (
      <div className="rounded-card border border-line bg-surface">
        <div className="px-4 py-3">
          <p className="text-sm">Set by the environment</p>
          <p className="truncate font-mono text-xs opacity-45">{url}</p>
          <p className="mt-1 text-xs opacity-45">
            QBITTORRENT_URL is set, so this cannot be changed here.
          </p>
        </div>

      {configured && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm">Stop seeding once a download finishes</p>
            <p className="mt-0.5 text-xs opacity-45">
              Off if your trackers count ratio — a stopped torrent earns none.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={stopSeeding}
            aria-label="Stop seeding once a download finishes"
            disabled={pending}
            onClick={() =>
              startTransition(async () => setQbStopSeeding(!stopSeeding))
            }
            className={`relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
              stopSeeding
                ? "bg-foreground"
                : "bg-surface-strong ring-1 ring-line-strong ring-inset"
            }`}
          >
            <span
              className={`absolute top-1 h-4 w-4 rounded-full transition-[left] duration-200 ${
                stopSeeding ? "left-5 bg-background" : "left-1 bg-foreground/40"
              }`}
            />
          </button>
        </div>
      )}
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
              onClick={() => startTransition(async () => disconnectQb())}
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
            <span className="text-xs opacity-55">Address of the WebUI</span>
            <input
              type="url"
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              placeholder="http://localhost:8080"
              className="rounded-control border border-line bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-line-strong"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs opacity-55">
              Username — leave empty if localhost needs no login
            </span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="rounded-control border border-line bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-line-strong"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs opacity-55">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
              disabled={pending || !draftUrl}
              className="rounded-control border border-line px-3 py-1.5 text-sm hover:bg-surface-strong disabled:opacity-30"
            >
              {pending ? "Checking…" : "Test and save"}
            </button>
            <span className="text-xs opacity-45">
              Saved only if qBittorrent answers.
            </span>
          </div>
        </div>
      )}

      {configured && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm">Stop seeding once a download finishes</p>
            <p className="mt-0.5 text-xs opacity-45">
              Off if your trackers count ratio — a stopped torrent earns none.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={stopSeeding}
            aria-label="Stop seeding once a download finishes"
            disabled={pending}
            onClick={() =>
              startTransition(async () => setQbStopSeeding(!stopSeeding))
            }
            className={`relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
              stopSeeding
                ? "bg-foreground"
                : "bg-surface-strong ring-1 ring-line-strong ring-inset"
            }`}
          >
            <span
              className={`absolute top-1 h-4 w-4 rounded-full transition-[left] duration-200 ${
                stopSeeding ? "left-5 bg-background" : "left-1 bg-foreground/40"
              }`}
            />
          </button>
        </div>
      )}
    </div>
  );
}
