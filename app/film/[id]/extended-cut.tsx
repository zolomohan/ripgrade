"use client";

import { useState, useTransition } from "react";

import { answerExtendedCut } from "@/app/actions";
import { BUTTON } from "@/app/controls";
import { Spinner } from "@/app/spinner";

/**
 * The one question the runtime check cannot answer for itself.
 *
 * TMDb lists the theatrical runtime, so a file that runs long is either a
 * different edition or a mistake — and nothing in the file says which. The
 * check raises `runtime-longer` and, in its own words, asks you to confirm the
 * edition is the one you wanted. This is where you answer.
 *
 * Answering yes is not dismissing the issue: it is supplying the fact the check
 * was missing, after which the extra runtime is a property of the copy rather
 * than a finding about it, and `openIssues` stops raising it everywhere at once.
 * Answering no keeps it standing — which is why "no" is stored rather than
 * treated as silence. Both are reversible, because an answer given to the wrong
 * file should not be permanent.
 *
 * The shape is the one this app already gives a thing to do: a bordered card,
 * what it is on the left with the reason under it, the buttons on the right —
 * the same card the upgrade prompt wears further down the page. Underlined
 * words in a bare row, which is what the match review below uses, is the right
 * weight for a correction sitting available in case you want it; it is the
 * wrong weight for a question being put to you, which is why this is a box.
 */
export function ExtendedCut({
  moviePath,
  answer,
  fileMinutes,
  listedMinutes,
}: {
  moviePath: string;
  /** Undefined while the question stands. */
  answer?: boolean;
  /**
   * The two runtimes the question is about, rounded as the issue rounds them.
   * Optional so that a film which loses its TMDb match after being answered
   * keeps its card, and with it the only way back to unanswering.
   */
  fileMinutes?: number;
  listedMinutes?: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reply(next: boolean | null) {
    setError(null);
    startTransition(async () => {
      const result = await answerExtendedCut(moviePath, next);
      if (!result.ok) setError(result.error);
    });
  }

  const asked = answer === undefined;

  return (
    /* Its own gap above rather than crowding the list: the card is about one
       line of that list, but it is a different kind of thing from it, and set
       tight underneath it read as the list's last row. */
    <div className="mb-10">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-card border border-line px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm">
            {asked
              ? "Is this an extended cut?"
              : answer
                ? "Marked as an extended cut"
                : "Not an extended cut"}
          </p>
          {/* The evidence while it is being asked, the consequence once it has
              been answered. The two runtimes are what the question is actually
              about, and the card is the loud thing in this stretch of the page
              — leaving them to the dim issue line above meant the one element
              you would read carried the question and none of the grounds for
              it. Once answered the numbers have done their work, and what
              matters is what the answer changed. */}
          <p className="max-w-prose text-xs opacity-45">
            {asked
              ? fileMinutes && listedMinutes
                ? `File runs ${fileMinutes} min against TMDb's ${listedMinutes} min. Likely an extended cut.`
                : "TMDb lists the theatrical runtime, so a longer file is usually a different edition rather than a fault."
              : answer
                ? "The extra runtime is expected of this edition, so it no longer counts against this copy."
                : "The runtime gap still counts against this copy."}
          </p>
        </div>

        {/* Kept to the right on a wide screen and wrapped underneath on a
            narrow one, as every other pairing of a sentence and its button
            here does. */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {pending && <Spinner className="h-3.5 w-3.5 opacity-50" />}

          {asked ? (
            <>
              {/* Weighted, because the app's own rubric says so: the check's
                  entry calls a long runtime "usually an extended or director's
                  cut". Two identical buttons would pretend it has no idea. */}
              <button
                type="button"
                onClick={() => reply(true)}
                disabled={pending}
                className={BUTTON.primary}
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => reply(false)}
                disabled={pending}
                className={BUTTON.secondary}
              >
                No
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => reply(null)}
              disabled={pending}
              className={BUTTON.text}
            >
              Undo
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="mt-2 font-mono text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
