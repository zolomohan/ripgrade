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
  size = "default",
  action,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** What happens when you save — the one thing worth knowing before you type. */
  lede: string;
  /** Set while a check is running, so a stray Escape cannot abandon it. */
  busy?: boolean;
  /**
   * How much room the thing inside actually needs.
   *
   * `default` is a pair of fields. `wide` is the folder tree, which needs the
   * width more than a pair of fields do. `bench` is the glass tuner, which is
   * not a form at all — a shelf of posters with a pane carried across it, and
   * seven sliders beside that. Judging a material through a letterbox is how
   * you end up with a rail nobody can read, so it gets the window.
   */
  size?: "default" | "wide" | "bench";
  /**
   * What belongs at the top right, beside the close.
   *
   * For the one thing a dialog can do to the whole of itself rather than to a
   * field in it — the tuner's reset, which used to sit at the foot of a column
   * of sliders, where it was the last thing on a scroll and read as the end of
   * the list rather than as something that undoes all of it.
   */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      label={title}
      dismissible={!busy}
      panelClassName={`flex w-full flex-col overflow-hidden ${
        size === "bench"
          ? "max-h-[min(94vh,68rem)] max-w-[min(96rem,94vw)]"
          : `max-h-[min(85vh,44rem)] ${size === "wide" ? "max-w-2xl" : "max-w-lg"}`
      }`}
    >
      <header className="flex shrink-0 items-start justify-between gap-4 px-6 pt-6 pb-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="mt-1 text-sm opacity-60">{lede}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          <CloseButton onClick={onClose} disabled={busy} />
        </div>
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
