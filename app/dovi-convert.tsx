"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  beginConvert,
  beginFullDoviScan,
  checkConvertible,
  refreshAfterDoviScan,
} from "@/app/actions";
import { ConfirmModal } from "@/app/confirm";
import { useJobs } from "@/app/jobs-provider";
import type { DoviTask } from "@/lib/queue-tasks";

/**
 * Starting a Profile 7 conversion, from wherever the file was found.
 *
 * The jobs page owned all of this while the jobs page was the only place a
 * conversion could be started from. The dashboard's queue shelf opens the same
 * dialog on the same task now, and a second copy of this would be a second copy
 * of the one part that is genuinely subtle: a check and a conversion are two
 * server calls with a full read of the file between them, and which of the two
 * a press means depends on facts about the file the button has to have already
 * settled.
 *
 * So the flow lives here and the lists draw themselves. What a caller gets is a
 * `busy` it can grey a button with, the two calls, and the wording of the
 * question — because the question is the same question wherever it is asked,
 * and a confirmation that promised something slightly different on one page
 * would be the page contradicting itself about what a button does.
 *
 * Only starting. Stopping a run belongs to the list that drew the tile it is
 * stopped from — see `halt` in app/jobs/task-list.tsx — because the mark that
 * ends a job is a mark on a film that is already running, and only the jobs
 * page draws those.
 */

/**
 * A full pass this page started, and what it started it for: the conversion the
 * pass is the first step of, or the answer the pass was run to get.
 */
type Errand = { path: string; fileName: string; then: "convert" | "report" };

/**
 * What a read enhancement layer is, in the names the tools use for it.
 *
 * MEL and FEL rather than a plain-English gloss: these are what dovi_tool
 * prints, what the film's own console names in its metadata table, and what
 * anyone reading about Profile 7 has already met. A chip is not the place to
 * teach the term — the tooltip does that, and the console spells it out in
 * full.
 *
 * No complex FEL among them: a file whose grade peaks above what the base layer
 * holds is never in this list, because converting it would clip those
 * highlights.
 */
export const EL_LABEL: Record<string, string> = {
  mel: "MEL",
  "simple-fel": "FEL",
  unknown: "Layer unread",
};

export const EL_TITLE: Record<string, string> = {
  mel: "Minimum enhancement layer — nothing in it, so converting loses nothing at all",
  "simple-fel":
    "Full enhancement layer, but graded within the base layer's range — what converting drops is refinement, not picture",
  unknown: "No pass has read the enhancement layer yet",
};

/**
 * Whether this file offers the question rather than the answer.
 *
 * A MEL has nothing a full read could turn up, so it converts on one click;
 * anything else with unread frames could still be ruled out, and a button
 * labelled Convert on one of those promises a rewrite the server would refuse
 * once the pass came back. Read the same way by every button that offers it,
 * which is the point of it being a function rather than a line each.
 */
export const checksFirst = (task: DoviTask) =>
  !task.scanned && task.el !== "mel";

export function useDoviConvert() {
  const { jobs, apply, subscribe } = useJobs();
  const { dovi: pass, convert, strip } = jobs;
  const router = useRouter();

  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * What a check found, which is not an error even when it rules the film out —
   * the row simply leaves the list, and a row that vanishes without a word is
   * the answer withheld.
   */
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(
    null,
  );

  /**
   * The pass this page is waiting on.
   *
   * Two errands for one job, because on a MEL the pass is a step of converting
   * — nothing it can find changes the verdict — while on a FEL it *is* the
   * verdict, and what follows it is a sentence rather than a rewrite.
   *
   * Held in a ref as well as in state because the job subscription has to see
   * it without resubscribing every time it changes.
   */
  const [pending, setPending] = useState<Errand | null>(null);
  const wants = useRef<Errand | null>(null);
  const intend = (next: Errand | null) => {
    wants.current = next;
    setPending(next);
  };
  /** Only a conversion has a hand-off to narrate; a check ends where it ends. */
  const queued = pending?.then === "convert" ? pending.path : null;

  // React only to the edge out of a run this page saw, exactly as the film's
  // own console does: the server reports "done" forever after, so a status
  // alone cannot mean "just finished" and a connect-time snapshot would look
  // identical to a fresh one.
  useEffect(
    () =>
      subscribe((next, prev) => {
        const wasConverting = prev.convert.status === "running";
        if (wasConverting && next.convert.status !== "running") {
          if (next.convert.status === "error") {
            setError(next.convert.error ?? "Conversion failed");
          } else {
            // The job re-probes and re-derives the rewritten file itself, so
            // the page only needs repainting — and the row falls out of the
            // list, because the film is not Profile 7 any more.
            void refreshAfterDoviScan().then(() => router.refresh());
          }
        }

        const errand = wants.current;
        const wasReading =
          prev.dovi.status === "running" && prev.dovi.path === errand?.path;
        // Named endings rather than "no longer running": a snapshot already in
        // flight when the pass started says idle, arrives just after the
        // optimistic running one, and would read as the pass stopping.
        const ended =
          next.dovi.status === "done" ||
          next.dovi.status === "error" ||
          next.dovi.status === "cancelled";
        if (!wasReading || !ended) return;

        if (next.dovi.status !== "done" || !errand) {
          // Failed or cancelled: whatever it was the first step of is off.
          intend(null);
          if (next.dovi.status === "error") {
            setError(next.dovi.error ?? "Full pass failed");
          }
          return;
        }

        void refreshAfterDoviScan().then(async () => {
          router.refresh();
          intend(null);

          // A check reports and stops. The verdict it just settled decides
          // whether the row keeps its Convert button or leaves the list, and
          // either way the reader asked a question and is owed the answer.
          if (errand.then === "report") {
            const verdict = await checkConvertible(errand.path);
            setNotice({
              ok: verdict.ok,
              text: verdict.ok
                ? `${errand.fileName} can be converted — its button is ready.`
                : verdict.error,
            });
            return;
          }

          // The server re-checks the verdict against what the pass just wrote,
          // so a film that turns out to be a complex FEL is refused here rather
          // than converted on the strength of a sample.
          const result = await beginConvert(errand.path);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          apply({ convert: result.job });
        });
      }),
    [subscribe, router, apply],
  );

  /**
   * Reads every frame and stops there, so the verdict is settled before
   * anything is offered on the strength of it.
   *
   * Nothing is written, so nothing is confirmed: a check costs time and no
   * film.
   */
  async function check(task: DoviTask) {
    setError(null);
    setNotice(null);

    const started = await beginFullDoviScan(task.path);
    if (!started.ok) {
      setError(started.error);
      return;
    }
    intend({ path: task.path, fileName: task.fileName, then: "report" });
    apply({
      dovi: { status: "running", path: task.path, percent: 0, frames: 0 },
    });
  }

  /**
   * Reads every frame first, when every frame has not been read.
   *
   * The same two-step the console runs, and reachable for the same reason: only
   * on a film whose verdict the pass cannot overturn. Anything a full read
   * could still rule out goes through `check` instead, and comes back here as a
   * separate click.
   *
   * The dialog that asked is not closed here — the caller owns it, and it is
   * closed either way, so a refusal is read on the list rather than under a
   * question that has already been answered.
   */
  async function run(task: DoviTask) {
    setError(null);
    setNotice(null);
    setStarting(true);

    if (!task.scanned) {
      const started = await beginFullDoviScan(task.path);
      setStarting(false);
      if (!started.ok) {
        setError(started.error);
        return;
      }
      intend({ path: task.path, fileName: task.fileName, then: "convert" });
      apply({
        dovi: { status: "running", path: task.path, percent: 0, frames: 0 },
      });
      return;
    }

    const result = await beginConvert(task.path);
    setStarting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    apply({ convert: result.job });
  }

  // One rewrite at a time, which the server enforces anyway — the buttons say
  // so rather than letting a click find out. A track removal counts: it is the
  // same drive and the same file being rewritten by a different tool.
  const busy =
    pass.status === "running" ||
    convert.status === "running" ||
    strip.status === "running" ||
    queued !== null;

  return {
    busy,
    /** The film whose pass is the first step of a conversion, while it runs. */
    queued,
    starting,
    error,
    setError,
    notice,
    setNotice,
    check,
    run,
  };
}

/**
 * Why a press cannot be made right now, in the words the dialog prints.
 *
 * The drive first: a file that is not there cannot be read whatever else is
 * going on, and a message about a queue would send somebody to wait for a job
 * that was never the problem.
 */
export const doviRefusal = (task: DoviTask, busy: boolean) =>
  task.offline
    ? "The drive this file lives on is not connected."
    : busy
      ? "Something is already rewriting a file — wait for it."
      : undefined;

/** What a check found or a job failed with, said above the list it happened in. */
export function DoviNotices({
  error,
  notice,
}: {
  error: string | null;
  notice: { text: string; ok: boolean } | null;
}) {
  return (
    <>
      {error && (
        <p className="font-mono text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {/* Amber when the check ruled the film out, because that row has just
          left the list and the sentence is all that is left of it. */}
      {notice && (
        <p
          className={`text-sm ${
            notice.ok ? "opacity-60" : "text-amber-600 dark:text-amber-400"
          }`}
        >
          {notice.text}
        </p>
      )}
    </>
  );
}

/**
 * The question a rewrite is worth stopping for, asked the same way everywhere.
 *
 * A check writes nothing and runs on the click; this is the other one. What it
 * has to say is what the press costs and what it leaves behind, and both are
 * facts about the app rather than about the page you happened to press it on.
 */
export function DoviConvertConfirm({
  task,
  open,
  keepingEl,
  busy,
  onConfirm,
  onCancel,
}: {
  task: DoviTask;
  open: boolean;
  /**
   * Whether a conversion keeps the enhancement layer it discards. Not a
   * per-film fact and not something a list can change — it is here so the
   * confirmation says what the job will actually do, since keeping the layer
   * puts a whole extra pass over the film in front of the conversion.
   */
  keepingEl: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmModal
      open={open}
      title="Convert to Profile 8.1?"
      confirmLabel={task.scanned ? "Convert" : "Read, then convert"}
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <span className="font-mono">{task.fileName}</span> is rewritten in place
      and the Profile 7 original is kept beside it, so this can be undone from
      the film&rsquo;s own page.{" "}
      {keepingEl &&
        "The enhancement layer is set aside in an archive of its own first, so it survives deleting that original. "}
      {task.scanned
        ? "It takes a while — the whole file is rewritten."
        : "Every frame is read first, so it takes a while."}{" "}
      Leaving this page will not stop it.
    </ConfirmModal>
  );
}
