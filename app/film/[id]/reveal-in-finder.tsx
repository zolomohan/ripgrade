"use client";

import { useState, useTransition } from "react";

import { reveal } from "@/app/actions";
import { Spinner } from "@/app/spinner";
import { HERO_BUTTON } from "./hero-button";

/**
 * Lives in the hero rather than with the issue controls: every film may need
 * revealing, not just the ones with something wrong.
 */
export function RevealInFinder({ moviePath }: { moviePath: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <span className="relative">
      <button
        type="button"
        disabled={pending}
        aria-label="Reveal in Finder"
        title="Reveal in Finder"
        onClick={() =>
          startTransition(async () => {
            const result = await reveal(moviePath);
            setError(result.ok ? null : result.error);
          })
        }
        className={HERO_BUTTON}
      >
        {pending ? (
          <Spinner className="h-4 w-4" />
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
        )}
      </button>

      {error && (
        <span className="absolute top-full right-0 mt-1 rounded-chip bg-background px-2 py-1 text-[11px] whitespace-nowrap text-red-600 shadow dark:text-red-400">
          {error}
        </span>
      )}
    </span>
  );
}
