"use client";

import { useRouter } from "next/navigation";
import { lastListing, markReturning } from "@/app/return-to";
import { HERO_BUTTON } from "./hero-button";

/**
 * Returns to the listing this page was opened from, filters and all — see
 * app/return-to.tsx for why that is a navigation rather than `history.back()`.
 *
 * `replace` rather than `push`: the film is dropped from history on the way
 * out, so this leaves the same stack a real back would and the browser's own
 * back button does not walk into the film again.
 */
export function BackButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        markReturning();
        router.replace(lastListing());
      }}
      aria-label="Back to library"
      title="Back to library"
      className={`absolute top-6 left-6 ${HERO_BUTTON}`}
    >
      {/* A drawn arrow rather than the "←" character: it matches the stroke
          weight of every other icon here instead of inheriting the text face's
          own idea of one. */}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="h-4 w-4"
      >
        <path d="M11 6 5 12l6 6" />
        <path d="M5 12h14" />
      </svg>
    </button>
  );
}
