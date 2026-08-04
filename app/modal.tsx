"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * The shell every dialog in the app is drawn in.
 *
 * It exists for the closing animation. React removes a component the instant
 * its state says closed, which leaves nothing on screen to animate — so this
 * keeps rendering after `open` goes false, plays the dialog out, and only then
 * lets it go. Callers still just flip their own boolean; the waiting happens
 * here rather than in four different components that would drift apart.
 *
 * Escape and a click on the backdrop both close, since both are the same
 * gesture — "not this" — and a dialog that only answers one of them feels
 * broken in whichever hand you are using.
 */

/** Matches `--modal-out` in globals.css; the two have to agree. */
const EXIT_MS = 220;

/**
 * Whether a dialog should still be on screen: true while it is open, and for
 * `--modal-out` after it closes.
 *
 * Exported because the dialogs that are mounted by their parent — "being
 * rendered *is* the request", as the release search puts it — cannot be kept
 * alive by `Modal` itself. Those parents call this to hold the mount open for
 * exactly as long as the animation needs, and nothing longer: mounting them
 * early would fire a search nobody asked for.
 *
 * Adjusted during render rather than in an effect: an effect would paint the
 * closed frame first and re-render to bring the dialog back, which is a flicker
 * at the exact moment the exit is meant to start.
 */
export function useClosing(open: boolean): boolean {
  const [closing, setClosing] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);

  if (open !== wasOpen) {
    setWasOpen(open);
    setClosing(!open);
  }

  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => setClosing(false), EXIT_MS);
    return () => clearTimeout(timer);
  }, [closing]);

  return open || closing;
}

/**
 * The same window, for a dialog opened by a value rather than a flag: it keeps
 * the last subject on hand while the dialog plays out, so the contents do not
 * blank out a frame before it has finished leaving.
 */
export function useLingering<T>(value: T | null): T | null {
  const [held, setHeld] = useState(value);
  const alive = useClosing(value !== null);

  if (value !== null && value !== held) setHeld(value);

  return alive ? held : null;
}

export function Modal({
  open,
  onClose,
  label,
  panelClassName,
  dismissible = true,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Names the dialog for a screen reader — it has no visible title to borrow. */
  label: string;
  /** Size and shape; the frame, shadow and animation come from here. */
  panelClassName?: string;
  /** False while something is running that a stray click must not interrupt. */
  dismissible?: boolean;
  children: React.ReactNode;
}) {
  const rendered = useClosing(open);
  const leaving = rendered && !open;

  // Resolved once, and null on the server, where there is no body to portal to.
  const [target] = useState(() =>
    typeof document === "undefined" ? null : document.body,
  );

  useEffect(() => {
    if (!rendered || !dismissible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rendered, dismissible, onClose]);

  /*
   * The page behind stops scrolling while a dialog is up. Without it a trackpad
   * flick over the backdrop scrolls the library underneath, and closing leaves
   * you somewhere you never chose to be.
   */
  useEffect(() => {
    if (!rendered) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [rendered]);

  if (!rendered || !target) return null;

  return createPortal(
    <div
      className={`modal-veil fixed inset-0 z-50 flex items-center justify-center p-6 ${
        leaving ? "is-leaving" : ""
      }`}
      onClick={() => dismissible && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(event) => event.stopPropagation()}
        className={`modal-panel ${leaving ? "is-leaving" : ""} ${panelClassName ?? ""}`}
      >
        {children}
      </div>
    </div>,
    target,
  );
}
