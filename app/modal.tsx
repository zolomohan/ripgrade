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

/**
 * The way out, in the corner every dialog keeps it in.
 *
 * Escape and a click outside both dismiss, but neither is visible, and on a
 * touchscreen only one of them exists at all — so every dialog draws the same
 * small circle in the same place rather than each inventing its own word for
 * leaving. It was already three identical copies before it was this.
 *
 * Not rendered by `Modal` itself: a dialog with a header wants it on the title
 * line, and one without wants it floating over the corner. Where it goes is
 * the dialog's business; what it looks like is not.
 */
export function CloseButton({
  onClick,
  disabled,
  label = "Close",
}: {
  onClick: () => void;
  /** Set while something is running that a stray dismissal must not interrupt. */
  disabled?: boolean;
  /** Where "Close" alone does not say what is being left. */
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line opacity-50 transition-opacity hover:opacity-100 disabled:opacity-20"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden
        className="h-3.5 w-3.5"
      >
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
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

  /*
   * Three elements where two would do, and the third one is the whole reason
   * every dialog in the app is frosted glass rather than a flat pane.
   *
   * A `backdrop-filter` filters what is painted behind it *within its backdrop
   * root* — and an element that has one becomes the backdrop root for its own
   * descendants. The veil has one: it is what puts the page out of focus. So
   * while the panel was a child of the veil, its own blur was reaching for a
   * backdrop that held nothing but the veil's flat dark fill. It blurred a
   * plain colour, changed nothing, and the page underneath came through the
   * panel's translucency exactly as sharp as it was drawn — the one surface in
   * the app that said "glass" and did not do it. The filter menu never had the
   * problem: it hangs over the page directly, with no veil above it.
   *
   * A sibling is not in the veil's backdrop root, so the veil's *result* —
   * page, dimmed and softened — is part of what the panel gets to filter, and
   * it diffuses like every other pane here. Hence the empty div: the sheet is
   * a layer of its own now, and this outer box is only the frame that centres
   * the dialog and catches the click outside it.
   */
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      onClick={() => dismissible && onClose()}
    >
      <div
        aria-hidden
        className={`modal-veil absolute inset-0 ${leaving ? "is-leaving" : ""}`}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(event) => event.stopPropagation()}
        // `relative` only so it is painted after the sheet it stands on: both
        // are positioned, so the order is the one they are written in.
        className={`modal-panel relative ${leaving ? "is-leaving" : ""} ${panelClassName ?? ""}`}
      >
        {children}
      </div>
    </div>,
    target,
  );
}
