"use client";

import Link from "next/link";

import { Art } from "@/app/art";
import { BUTTON, Fact } from "@/app/controls";
import { CloseButton, Modal } from "@/app/modal";
import type { DoviTask } from "@/lib/queue-tasks";

/**
 * Everything this tab knows about one file, and the press that acts on it.
 *
 * The grid's tiles say three things and stop — which film, what its layer is,
 * how big it is — because that is the whole of what a poster is good at. The
 * click had nowhere to go but the film's own page, which is a long walk for the
 * two facts that decide this one: whether the enhancement layer is worth
 * keeping, and whether the frames have been read yet. Both are here, in the
 * words the rows print down their length, with the button that starts the work
 * underneath them.
 *
 * The rows do not open this. A row already prints every line in it — that is
 * the trade a row makes — and its click is the film's page, which is where
 * somebody reading the long form is headed anyway.
 */

export function DoviDetails({
  task,
  open,
  layer,
  layerTitle,
  size,
  /** True where the frames have not been read and a check must settle it first. */
  checkFirst,
  /** Why the button is off, where it is — the drive, or a rewrite already going. */
  refusal,
  href,
  onStart,
  onClose,
}: {
  task: DoviTask;
  open: boolean;
  layer?: string;
  layerTitle?: string;
  size: string;
  checkFirst: boolean;
  refusal?: string;
  /** The film's own page, which the poster and the name both go to. */
  href: string;
  onStart: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      label={`${task.title} — what converting it would do`}
      panelClassName="flex max-h-[85vh] w-full max-w-lg flex-col gap-4 overflow-y-auto glass-panel rounded-card border border-line p-6 shadow-2xl"
    >
      <>
        {/* The dialog is named for the work, not for the film.

            A film's name at the top made this look like the film's own page in
            a window — and the film is not what you opened it to decide. Every
            one of these dialogs is the same job asked about a different file,
            so the heading says which job, once, and the file it is about sits
            below with its poster. */}
        <header className="flex items-baseline justify-between gap-3">
          <h2 className="min-w-0 truncate text-base font-semibold">
            Dolby Vision P7 to P8 conversion
          </h2>
          <CloseButton onClick={onClose} />
        </header>

        <div aria-hidden className="rule-head mb-1" />

        {/* Which film, and what pressing the button would do to it — one block,
            because they are one thought. The artwork is small: you opened this
            off a poster you are already looking at, so it says which film this
            is rather than asking to be looked at again.

            The poster and the name are the way to the film. There was a button
            for it, and a button is what you give something with no handle of
            its own — a picture of the film and its name are the handle, and
            they were sitting inert an inch above one that said "Open the film".

            Anchors rather than a handler, so the browser can middle-click and
            preview them, and so the crumb that brings the poster home is left
            by the delegated listener in app/return-to.tsx, which only sees
            anchors. */}
        <div className="flex items-center gap-4">
          <Link
            href={href}
            aria-hidden
            tabIndex={-1}
            className="glow h-24 w-16 shrink-0 overflow-hidden rounded-control bg-surface-strong ring-1 ring-line"
          >
            <Art
              src={task.poster}
              remote={task.posterRemote}
              version={task.artAt}
              size="w92"
              className="h-full w-full object-cover"
            />
          </Link>

          <div className="flex min-w-0 flex-col gap-1">
            <Link
              href={href}
              className="min-w-0 text-sm font-semibold break-words hover:underline"
            >
              {task.episodeCode
                ? `${task.episodeCode} · ${task.title}`
                : task.title}
            </Link>

            {/* Under the name rather than beside it. A year set against a title
                that wraps to two lines ends up floating in the middle of the
                block, and it is the smallest fact here — it belongs on the
                muted line, which is where every shelf in the app puts it. */}
            {task.year && <p className="text-xs opacity-45">{task.year}</p>}

            {/* Said only where the press is not what the button appears to
                promise.

                A file whose frames have been read said "Ready to convert" over
                a paragraph about keeping the original — under a button reading
                Convert, beside a row reading "Frames read · Every frame". Three
                ways of saying the same thing, two of them prose. What is left
                is the case that genuinely surprises: the button says Check,
                because what a read finds can rule the conversion out. */}
            {checkFirst && (
              <>
                <p className="mt-1 text-sm font-medium">
                  Every frame is read first
                </p>
                <p className="text-xs opacity-55">
                  The layer has not been read, and what a read finds can rule
                  the conversion out. Nothing is written by it.
                </p>
              </>
            )}
          </div>
        </div>

        <dl className="overflow-hidden rounded-control border border-line">
          <Fact label="File" value={task.fileName} mono />
          <Fact label="Size" value={size} />
          <Fact label="Format" value="Dolby Vision Profile 7" />
          <Fact label="Enhancement layer" value={layer} title={layerTitle} />
          {/* No "Frames read" row. Whether the frames have been read is not a
              fact about the file worth filing between its layer and its
              episode — it is a fact about what the button is about to do, and
              the one case where it changes that is already said above in
              words. */}
          <Fact label="Episode" value={task.episode} />
        </dl>

        {/* No line here saying why the button is off. It is the button's own
            business — the mark is greyed and carries the reason, which is where
            somebody reaching for it will find it — and a sentence about an
            unplugged drive set above the facts read as a fact about the film.

            And one button below, because there is one decision. Going to the
            film is a press on the film itself, above. */}

        {/* The width of the dialog, because it is the width of the decision.
            A pill hugging its own word in the bottom-right corner is what a
            button looks like when it is one option among several; this is the
            only thing here to press, and a target you cannot miss is the
            honest drawing of that. */}
        <button
          type="button"
          onClick={onStart}
          disabled={Boolean(refusal)}
          title={refusal}
          className={`${BUTTON.primary} w-full`}
        >
          {checkFirst ? "Check" : "Convert"}
        </button>
      </>
    </Modal>
  );
}
