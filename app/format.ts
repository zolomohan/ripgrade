/**
 * How a figure reads, wherever it is written.
 *
 * Plain functions in a plain module, deliberately outside the client boundary:
 * a server component formats a number into the HTML it sends, and a formatter
 * that lived in a `"use client"` file could not be called there at all — the
 * boundary turns its exports into references the server can pass but not run.
 *
 * `ago` is here for the same reason from the other side. It reads the clock, so
 * a row rendered on the server and a line rendered in the browser ask two
 * different machines what time it is. They are the same machine, and where they
 * would not be, the figure is hours old and a minute of drift does not change
 * what it says.
 */

export const count = (n: number) => n.toLocaleString("en-GB");

/**
 * Terabytes above a terabyte, gigabytes below, and no decimal on the
 * gigabytes: this is storage on a drive you can see, and "1,847 GB" answers
 * the question "is that a lot" better than "1,847.3 GB" does.
 *
 * Megabytes below a gigabyte, which is not a case a shelf of remuxes ever
 * reaches and the thumbnail cache reaches immediately. Rounding 190 MB to
 * "0 GB" is not a coarser answer, it is a wrong one — it says there is nothing
 * there.
 */
export const size = (bytes: number) =>
  bytes >= 1e12
    ? `${(bytes / 1e12).toFixed(2)} TB`
    : bytes >= 1e9
      ? `${(bytes / 1e9).toFixed(0)} GB`
      : `${(bytes / 1e6).toFixed(0)} MB`;

/**
 * "3 h ago" — precise enough for "is this reading stale", and no more.
 *
 * Nothing in this app is stale by the minute: a scan is a thing you did this
 * morning or last week, and a check that says "2 h 14 min ago" is asking you to
 * do arithmetic to answer a question you could have answered by looking.
 */
export function ago(then: number): string {
  const mins = Math.max(1, Math.round((Date.now() - then) / 60_000));
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}
