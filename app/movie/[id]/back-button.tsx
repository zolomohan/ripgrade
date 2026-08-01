"use client";

import { useRouter } from "next/navigation";

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
      className="absolute top-6 left-6 grid h-8 w-8 place-items-center rounded-md bg-background/80 text-sm backdrop-blur hover:bg-background"
    >
      ←
    </button>
  );
}
