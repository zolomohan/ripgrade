"use client";

import { useEffect } from "react";

import { BUTTON } from "@/app/controls";
import { CloseButton, Modal } from "@/app/modal";
import { Spinner } from "@/app/spinner";

/**
 * The parts a console on this page is built from.
 *
 * A console is the shape the Dolby Vision card settled on and the audio card
 * then wanted too: a verdict band, an action band, and a dialog for anything
 * long or irreversible. Both sections rewrite a film that is tens of gigabytes,
 * both keep the original beside it, and both ask before they start — so the
 * buttons and the question live here rather than being written twice and
 * drifting apart at the first change to either.
 */

/**
 * Every confirmation on this page, in one shape.
 *
 * These all commit to something long or irreversible, and asking inside the
 * card meant the question appeared wherever the card happened to be — sometimes
 * below the fold, and always by pushing the rest of the section around. A
 * dialog asks in one place and puts the page back exactly as it was.
 *
 * Same portal-and-backdrop construction as the score breakdown, so the two
 * behave alike: click outside or press Escape to dismiss.
 */
export function ConfirmModal({
  open,
  title,
  confirmLabel,
  tone = "neutral",
  busy,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  confirmLabel: string;
  tone?: "neutral" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Not while the work is already under way — there is nothing to take back
      // by then, and dismissing would only hide it.
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <Modal
      open={open}
      onClose={onCancel}
      dismissible={!busy}
      label={title}
      panelClassName="flex w-full max-w-md flex-col gap-3 rounded-card border border-line bg-background p-6 shadow-2xl"
    >
      <>
        <div className="flex items-start justify-between gap-4">
          <h2 className="min-w-0 text-base font-semibold">{title}</h2>
          {/* Cancel below says the same thing, but the circle is where the
              hand goes on every other dialog here — and it goes grey with the
              rest once there is nothing left to take back. */}
          <CloseButton onClick={onCancel} disabled={busy} />
        </div>

        {/* The floor the title stands on, as under every other dialog's. */}
        <div aria-hidden className="rule-head" />

        {/* Wrapping anywhere, because half of what these dialogs say is a
            file name. A release name is one unbroken word of sixty characters
            — no space, no hyphen, nothing a line break is allowed to happen at
            — so the panel's own width does not contain it and the sentence
            runs out through the side of the dialog. Set here rather than on
            each caller's `<code>`: every one of these questions names the file
            it is about, and the next one will too. */}
        <div className="text-sm wrap-anywhere opacity-70">{children}</div>

        <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className={BUTTON.secondary}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            autoFocus
            className={tone === "danger" ? BUTTON.confirm : BUTTON.primary}
          >
            {/* The callers already swap the label for its participle —
                "Restoring…", "Deleting…" — and the wheel beside it is what
                says the work is still going rather than merely started. */}
            {busy && <Spinner />}
            {confirmLabel}
          </button>
        </div>
      </>
    </Modal>
  );
}
