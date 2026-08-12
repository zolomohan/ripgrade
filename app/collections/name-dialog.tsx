"use client";

import { useState } from "react";

import { BUTTON } from "@/app/controls";
import { CloseButton, Modal } from "@/app/modal";
import { Spinner } from "@/app/spinner";

/**
 * Asking for a name, in the shape everything else here asks in.
 *
 * Naming a set and renaming it are one question with a different starting
 * value, so they are one dialog — and it is the confirm dialog's own frame,
 * because a question is a question whether the answer is a word or a yes.
 *
 * Enter submits. A dialog holding a single field where the only way on is to
 * reach for a button is a dialog that has forgotten what a form is.
 */
export function NameDialog({
  open,
  title,
  confirmLabel,
  initial = "",
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  title: string;
  confirmLabel: string;
  /** The name it already has, for a rename. */
  initial?: string;
  busy?: boolean;
  error?: string | null;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);

  /*
   * Set on the way in rather than on the way out: the dialog plays its exit
   * after `open` goes false, and resetting the field then rewrites it in front
   * of you as it leaves.
   *
   * Adjusted during render rather than in an effect, the way `useClosing` in
   * app/modal.tsx does it and for the same reason — an effect would paint one
   * frame of the old name before replacing it.
   */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setName(initial);
  }

  return (
    <Modal
      open={open}
      onClose={onCancel}
      dismissible={!busy}
      label={title}
      panelClassName="flex w-full max-w-md flex-col gap-3 glass-panel rounded-card border border-line p-6 shadow-2xl"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && name.trim()) onSubmit(name);
        }}
        className="flex flex-col gap-3"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="min-w-0 text-base font-semibold">{title}</h2>
          <CloseButton onClick={onCancel} disabled={busy} />
        </div>

        {/* The floor the title stands on, as under every other dialog's. */}
        <div aria-hidden className="rule-head" />

        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Christmas films"
          autoFocus
          disabled={busy}
          maxLength={80}
          /* Sans rather than the field's usual machine face: what goes in here
             is a heading you wrote, not a path or a key. */
          className="rounded-full border border-line bg-transparent px-4 py-2 text-sm outline-none transition-colors focus:border-line-strong disabled:opacity-40"
        />

        {error && (
          <p className="text-xs wrap-anywhere text-red-700 dark:text-red-300">
            {error}
          </p>
        )}

        <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className={BUTTON.secondary}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className={BUTTON.primary}
          >
            {busy && <Spinner />}
            {confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
