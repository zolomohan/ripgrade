"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { acknowledge } from "@/app/actions";

export function FileActions({
  moviePath,
  acknowledged,
  note,
  hasIssues,
}: {
  moviePath: string;
  acknowledged: boolean;
  note?: string;
  hasIssues: boolean;
}) {
  const [editingNote, setEditingNote] = useState(false);
  const [draft, setDraft] = useState(note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error ?? "Failed");
      else router.refresh();
    });
  }

  const button =
    "rounded-control border border-line px-3 py-1.5 text-sm hover:bg-surface-strong disabled:opacity-40";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {(hasIssues || acknowledged) && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(() => acknowledge(moviePath, !acknowledged, draft))
            }
            className={
              acknowledged
                ? "rounded-control border border-emerald-500/40 bg-emerald-500/[0.08] px-3 py-1.5 text-sm text-emerald-700 disabled:opacity-40 dark:text-emerald-300"
                : button
            }
          >
            {acknowledged ? "✓ Accepted as-is" : "Accept as-is"}
          </button>
        )}

        <button
          type="button"
          disabled={pending}
          onClick={() => setEditingNote((v) => !v)}
          className="text-sm opacity-50 hover:opacity-100"
        >
          {note ? "Edit note" : "Add note"}
        </button>

        {pending && <span className="text-xs opacity-50">working…</span>}
      </div>

      {note && !editingNote && (
        <p className="rounded-control border border-line px-3 py-2 text-sm opacity-70">
          {note}
        </p>
      )}

      {editingNote && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setEditingNote(false);
            run(() => acknowledge(moviePath, acknowledged, draft));
          }}
          className="flex gap-2"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Why you're keeping it, what to replace it with…"
            className="flex-1 rounded-control border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-line-strong"
          />
          <button type="submit" disabled={pending} className={button}>
            Save
          </button>
        </form>
      )}

      {error && (
        <p className="font-mono text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
