/**
 * The tail of what a spawned tool has printed, kept in the shape a dialog can
 * draw.
 *
 * Every long job in this app is a command-line tool wearing a progress bar, and
 * when one of them stops making sense the answer is almost always in something
 * it said. Until now that went into a 4 kB `tail` string read only after the
 * fact, to explain a failure — so while the job was running, the one place the
 * truth was written down was the one place nobody could see.
 *
 * What this keeps is deliberately small. It rides the jobs snapshot to every
 * open tab several times a second, so it holds a window on the last few lines
 * rather than a log: enough to answer "what is it doing", not enough to scroll
 * through afterwards.
 */

/**
 * Colour and cursor control, which every one of these tools writes and none of
 * it means anything once the text is in a browser.
 *
 * Anchored on the escape character on purpose. Matching a bare `[…letter]`
 * would take a bite out of ordinary text — `[2160p]` in a release name reads
 * exactly like a control sequence to a pattern that does not insist on the
 * escape first.
 */
export const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

/**
 * How many lines are kept, counting the one still being written. Small because
 * every one of them is on the wire on every push, to every tab, for as long as
 * the job runs.
 */
export const OUTPUT_LINES = 30;

/**
 * Folds a chunk of a tool's output into the lines already held.
 *
 * The last element is the line in hand — a chunk arrives whenever the pipe
 * feels like delivering one, not when a line ends, so a line is routinely built
 * from several chunks and must be finished rather than started.
 *
 * The carriage return is what makes this more than a split. A spinner draws by
 * returning to the start of the line and writing over it, ten times a second;
 * treated as a line ending, one step of a conversion would push everything said
 * before it out of the buffer several times over and leave nothing but its own
 * last frame. Treated as what it is, it rewrites a single line in place and the
 * lines above it survive.
 */
export function appendOutput(
  lines: string[],
  chunk: string,
  limit = OUTPUT_LINES,
): string[] {
  const next = lines.length ? lines.slice() : [""];

  chunk
    .replace(ANSI, "")
    .split("\n")
    .forEach((segment, index) => {
      // Only a newline starts a line. Everything else continues the one open.
      if (index > 0) next.push("");

      const overwrites = segment.split("\r");
      if (overwrites.length > 1) next[next.length - 1] = "";
      next[next.length - 1] += overwrites[overwrites.length - 1];
    });

  return next.length > limit ? next.slice(next.length - limit) : next;
}

/**
 * The held lines as they should be read: without the empty one at the end that
 * is not a blank line but the next line, not yet written to.
 */
export function visibleOutput(lines: string[] | undefined): string[] {
  if (!lines?.length) return [];
  return lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;
}
