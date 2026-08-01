"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  linkDisc,
  linkDiscByUrl,
  searchDiscs,
  unlinkDisc,
  type DiscCandidate,
} from "@/app/actions";

/**
 * Picking the disc by hand. A film often has a dozen editions — regions,
 * steelbooks, remasters — and the automatic pick takes the first 4K result,
 * which is not always the one you own or the one worth comparing against.
 */
export function DiscReview({
  tmdbId,
  title,
  year,
  currentUrl,
  manual,
}: {
  tmdbId: number;
  title: string;
  year?: number;
  currentUrl?: string;
  manual?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<DiscCandidate[] | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setError(null);
    if (results) return;

    startTransition(async () => {
      const found = await searchDiscs(title, year);
      if (found.ok) setResults(found.results);
      else setError(found.error);
    });
  }

  function choose(candidate: DiscCandidate) {
    setError(null);
    startTransition(async () => {
      const result = await linkDisc(tmdbId, candidate);
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else setError(result.error);
    });
  }

  function linkUrl() {
    setError(null);
    startTransition(async () => {
      const result = await linkDiscByUrl(tmdbId, url);
      if (result.ok) {
        setOpen(false);
        setUrl("");
        router.refresh();
      } else setError(result.error);
    });
  }

  function unlink() {
    setError(null);
    startTransition(async () => {
      const result = await unlinkDisc(tmdbId);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  const button =
    "rounded-control border border-line px-3 py-1.5 text-sm hover:bg-surface-strong disabled:opacity-40";

  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          className={button}
        >
          {open ? "Cancel" : currentUrl ? "Wrong edition?" : "Find the disc"}
        </button>

        <button
          type="button"
          onClick={unlink}
          disabled={pending}
          className={button}
        >
          {manual ? "Unpin and search again" : "Look up again"}
        </button>

        {manual && (
          <span className="text-[11px] tracking-wide uppercase opacity-45">
            pinned by hand
          </span>
        )}
        {pending && <span className="text-xs opacity-50">working…</span>}
      </div>

      {open && (
        <div className="mt-3 flex flex-col gap-3">
          {/* Pasting the exact release is often faster than picking through a
              dozen near-identical editions. */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              linkUrl();
            }}
            className="flex gap-2"
          >
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              spellCheck={false}
              placeholder="Paste a Blu-ray.com release URL…"
              className="flex-1 rounded-control border border-line bg-transparent px-3 py-2 font-mono text-xs outline-none focus:border-line-strong"
            />
            <button
              type="submit"
              disabled={pending || !url.trim()}
              className={button}
            >
              Link
            </button>
          </form>

          {!results && !error && (
            <p className="text-sm opacity-50">Searching Blu-ray.com…</p>
          )}

          {results?.length === 0 && (
            <p className="text-sm opacity-50">
              No releases found for this title.
            </p>
          )}

          {results && results.length > 0 && (
            <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => choose(r)}
                    disabled={pending}
                    className={`flex w-full items-center gap-3 rounded-control px-2 py-2 text-left text-sm hover:bg-surface-strong disabled:opacity-40 ${
                      r.url === currentUrl
                        ? "ring-1 ring-line-strong ring-inset"
                        : ""
                    }`}
                  >
                    <span
                      className={`shrink-0 rounded-chip px-1.5 text-[11px] leading-[18px] font-medium ring-1 ring-inset ${
                        r.format === "4K"
                          ? "text-emerald-700 ring-emerald-500/40 dark:text-emerald-300"
                          : "ring-line-strong opacity-70"
                      }`}
                    >
                      {r.format}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{r.title}</span>
                    {r.url === currentUrl && (
                      <span className="shrink-0 text-[11px] opacity-50">
                        current
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <p className="mt-2 font-mono text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
