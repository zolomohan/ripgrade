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
      ←
    </button>
  );
}
