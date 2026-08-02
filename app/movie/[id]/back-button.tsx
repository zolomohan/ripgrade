"use client";

import { useRouter } from "next/navigation";
import { HERO_BUTTON } from "./hero-button";

/**
 * Goes back through history rather than linking to "/", so the library's
 * filters, search and sort — which live in the URL — are still there on return.
 * Falls back to the library when this page was opened directly.
 */
export function BackButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push("/");
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
