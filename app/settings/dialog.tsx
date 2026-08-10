"use client";

import { CloseButton, Modal } from "../modal";

/**
 * The window a setting is changed in.
 *
 * Three settings here are a state plus a form for changing it, and the form is
 * the larger half: two fields and a check that talks to a server, or a folder
 * tree deep enough to scroll. Left inline they push the state they describe up
 * the page and make an open panel mostly form — and the panel is already the
 * disclosure, so the form was a second thing to read past on the way to the
 * line that says whether the thing works.
 *
 * As a dialog the panel keeps its height and says one thing, and the form gets
 * asked for. It is the app's own `Modal`, dressed the way the film page's
 * recipes are: a title, a line under it saying what the change costs, and the
 * same close in the same corner.
 */
export function SettingDialog({
  open,
  onClose,
  title,
  lede,
  busy,
  wide,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** What happens when you save — the one thing worth knowing before you type. */
  lede: string;
  /** Set while a check is running, so a stray Escape cannot abandon it. */
  busy?: boolean;
  /** For the folder tree, which needs the width more than a pair of fields do. */
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      label={title}
      dismissible={!busy}
      panelClassName={`flex max-h-[min(85vh,44rem)] w-full ${
        wide ? "max-w-2xl" : "max-w-lg"
      } flex-col overflow-hidden glass-panel rounded-card border border-line shadow-2xl`}
    >
      <header className="flex shrink-0 items-start justify-between gap-4 px-6 pt-6 pb-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="mt-1 text-sm opacity-60">{lede}</p>
        </div>
        <CloseButton onClick={onClose} disabled={busy} />
      </header>

      {/* The floor the title stands on, the same one a section heading gets:
          weighted under the first word and gone by the far edge. Outside the
          scrolling body, so the form passes under it rather than past it. */}
      <div aria-hidden className="rule-head mx-6 mb-4 shrink-0" />

      <div className="flex flex-col gap-4 overflow-y-auto px-6 pb-6">
        {children}
      </div>
    </Modal>
  );
}
