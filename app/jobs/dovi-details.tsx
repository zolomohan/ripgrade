"use client";

import { BUTTON, Fact } from "@/app/controls";
import { Modal } from "@/app/modal";
import type { DoviTask } from "@/lib/queue-tasks";
import { TaskHead } from "./task-head";

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
        {/* The same head the track picker wears, and for the same reason: both
            are one job asked about one file, opened off the same page, and the
            first thing either has to settle is which file.

            It replaced a heading that named the job — "Dolby Vision P7 to P8
            conversion" — over a separate block holding a poster three times
            this size. The job's name is not missed: the facts below say Profile
            7 and the button says Convert, which is the same sentence said by
            the things you are actually looking at.

            Carries the href, which the track picker does not: this dialog has
            always offered the film's page through its poster and its name, and
            there is nothing here to lose by leaving. */}
        {/* No rule under the head. The poster is the edge — a picture and a
            title against the top of a panel are already a header, and a line
            drawn under them was the dialog stating twice that this part is not
            the rest. */}
        <TaskHead film={task} href={href} onClose={onClose} />

        <dl className="overflow-hidden rounded-control border border-line">
          <Fact label="File" value={task.fileName} mono />
          <Fact label="Size" value={size} />
          <Fact label="Format" value="Dolby Vision Profile 7" />
          <Fact label="Enhancement layer" value={layer} title={layerTitle} />
          {/* No "Frames read" row. Whether the frames have been read is not a
              fact about the file worth filing between its layer and its
              episode — it is a fact about what the button is about to do, and
              the one case where it changes that is said in words below. */}
          <Fact label="Episode" value={task.episode} />
        </dl>

        {/* Said only where the press is not what the button appears to promise.

            A file whose frames have been read said "Ready to convert" over a
            paragraph about keeping the original — under a button reading
            Convert, beside a row reading "Frames read · Every frame". Three
            ways of saying the same thing, two of them prose. What is left is
            the case that genuinely surprises: the button says Check, because
            what a read finds can rule the conversion out.

            Directly over that button now rather than beside the poster. It was
            in the block that said which film this is, which is the one thing it
            is not about — and with the head down to a line it would have been
            hanging off the end of it. */}
        {checkFirst && (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Every frame is read first</p>
            <p className="text-xs opacity-55">
              The layer has not been read, and what a read finds can rule the
              conversion out. Nothing is written by it.
            </p>
          </div>
        )}

        {/* No line here saying why the button is off. It is the button's own
            business — the mark is greyed and carries the reason, which is where
            somebody reaching for it will find it — and a sentence about an
            unplugged drive set above the facts read as a fact about the film.

            And one button below, because there is one decision. Going to the
            film is a press on the film itself, above. */}

        {/* Parted from the facts by what the head is parted from them by —
            `mt-3` over the panel's gap, as in the download record next door.

            The width of the dialog, because it is the width of the decision.
            A pill hugging its own word in the bottom-right corner is what a
            button looks like when it is one option among several; this is the
            only thing here to press, and a target you cannot miss is the
            honest drawing of that. */}
        <button
          type="button"
          onClick={onStart}
          disabled={Boolean(refusal)}
          title={refusal}
          className={`${BUTTON.primary} mt-3 w-full`}
        >
          {checkFirst ? "Check" : "Convert"}
        </button>
      </>
    </Modal>
  );
}
