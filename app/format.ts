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
 * Every byte count in the app, at four steps: terabytes, gigabytes, megabytes,
 * kilobytes.
 *
 * The one decimal on the gigabytes is what a film is told apart by. A shelf of
 * remuxes lives between 20 and 90 GB and a third of them round to the same
 * whole number, so "12 GB" and "12 GB" are two different films reporting the
 * same size — where "12.3" and "11.8" are the two facts you are comparing. The
 * terabytes keep two for the same reason a step up, and the megabytes keep none
 * because nothing is ever chosen between at that size.
 *
 * Megabytes and kilobytes below a gigabyte, which no film reaches and the
 * thumbnail cache reaches immediately. Rounding 190 MB to "0.2 GB" is not a
 * coarser answer, it is a wrong one — it says the cache is a fifth of a
 * gigabyte when it is a rounding error away from empty.
 *
 * This was twelve functions in twelve files and four of them disagreed: the
 * same film read "12 GB" on the dashboard and "12.3 GB" on its own page, and
 * an 800 MB file read "0.8 GB" on the library shelf. A figure that changes as
 * you navigate is a figure nobody can hold in their head.
 */
export const size = (bytes: number) =>
  bytes >= 1e12
    ? `${(bytes / 1e12).toFixed(2)} TB`
    : bytes >= 1e9
      ? `${(bytes / 1e9).toFixed(1)} GB`
      : bytes >= 1e6
        ? `${(bytes / 1e6).toFixed(0)} MB`
        : `${Math.ceil(bytes / 1e3)} KB`;

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
