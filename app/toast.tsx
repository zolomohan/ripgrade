"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const DOT = {
  busy: "bg-blue-500 animate-pulse",
  ok: "bg-emerald-500",
  error: "bg-red-500",
};

export function Toast({
  tone,
  children,
  onDismiss,
  offset = 0,
}: {
  tone: keyof typeof DOT;
  children: React.ReactNode;
  onDismiss?: () => void;
  /** Stacking slot, so two toasts do not sit on top of each other. */
  offset?: number;
}) {
  // Callers live inside a `backdrop-blur` header, and backdrop-filter makes an
  // element a containing block for fixed-position descendants. Rendered in
  // place, this would anchor to the header rather than the viewport.
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // document.body is only reachable after mount. Rendering null on the server
    // and on the first client pass keeps hydration consistent, which is exactly
    // why this assignment has to happen in an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTarget(document.body);
  }, []);

  if (!target) return null;

  return createPortal(
    <div
      style={{ bottom: `${24 + offset * 96}px` }}
      className="fixed right-6 z-50 flex max-w-md min-w-72 items-start gap-3 rounded-xl border border-black/10 bg-background/95 px-4 py-3 shadow-lg backdrop-blur dark:border-white/15"
    >
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[tone]}`} />
      <div className="min-w-0 flex-1 text-sm">{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 text-sm opacity-40 hover:opacity-90"
        >
          ✕
        </button>
      )}
    </div>,
    target,
  );
}
