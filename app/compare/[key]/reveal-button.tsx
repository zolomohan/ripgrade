"use client";

import { useState, useTransition } from "react";

import { reveal } from "@/app/actions";

/** On the compare page this is the point: find the loser and delete it. */
export function RevealButton({ moviePath }: { moviePath: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await reveal(moviePath);
            setError(result.ok ? null : result.error);
          })
        }
        className="rounded-chip px-1.5 text-[11px] leading-[18px] font-medium ring-1 ring-inset ring-line-strong hover:bg-surface-strong disabled:opacity-40"
      >
        Reveal in Finder
      </button>
      {error && (
        <span className="mt-1 block text-[11px] text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </>
  );
}
