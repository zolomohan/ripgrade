"use client";

import { useRouter } from "next/navigation";

import { HERO_BUTTON } from "@/app/film/[id]/hero-button";
import { markReturning, popListing } from "@/app/return-to";

/**
 * The film page's back, for the same reason it exists there: a history
 * restore is not a React transition, so `history.back()` leaves the poster to
 * cut rather than travel home to the queue row it came from. Replaying the
 * listing trail is a navigation React runs itself, which is what lets the
 * morph play backwards.
 */
export function BackButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        markReturning();
        router.replace(popListing(), {
          scroll: false,
          transitionTypes: ["nav-back"],
        });
      }}
      aria-label="Back"
      title="Back"
      className={`absolute top-6 left-6 ${HERO_BUTTON}`}
    >
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
