/**
 * The heading a page's sections are parted by: a name, and the hairline the
 * rest of the app rules its headings with.
 *
 * Written for the downloads log — "Downloading", then "History" — and pulled
 * out of it the moment a second page wanted the same two-part shape. A section
 * heading is a thing this app has an opinion about, and two copies of that
 * opinion is one more than it can hold.
 */
export function SectionHeading({
  label,
  action,
}: {
  label: string;
  /**
   * What belongs on the heading's own line, at the end of it.
   *
   * A count, where the section holds a number worth saying before you have
   * scrolled it — which is what the wishlist's "Not found" carries, since the
   * total at the foot of the page is the whole list rather than that section's
   * share of it.
   */
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      {/* The row is always there and collapses to the name's own height when
          nothing is in it, so a heading with no controls sits exactly where it
          sat before this slot existed. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold tracking-tight">
          {label}
        </h2>
        {action}
      </div>
      <div aria-hidden className="rule-head" />
    </div>
  );
}

/**
 * The same heading, over a section that is shut until it is asked for.
 *
 * History is the one section on these pages that nobody arrives for. You come
 * to the jobs page to see what is running and what is left, and to the queue to
 * see what is coming down — and then scroll past a hundred rows of what already
 * happened to reach the end of either. Shut, the record is one line, and the
 * live half of the page is the whole of it again.
 *
 * The count is what makes the closed line honest, the way a `Panel`'s summary
 * is: a section that says nothing about its contents is a section you have to
 * open to find out whether it was worth opening.
 *
 * A native <details>, for the reasons `Panel` gives — and the same `ruled` class
 * it carries, which is what globals.css animates the opening on.
 */
export function CollapsibleSection({
  label,
  count,
  open,
  children,
}: {
  label: string;
  /** How many rows are inside, said on the line that stands in for them. */
  count?: number;
  /**
   * Whether it starts open, for the page whose record is half the subject.
   *
   * Shut is the rule and the reason is above: it holds wherever the log is an
   * appendix to something you actually came for. The downloads page is the
   * exception — what has arrived answers "is that film here yet" as squarely as
   * what is still arriving, so its history opens open. Uncontrolled either way:
   * this is the state it opens in, not a state it is held in, so the arrow
   * still works.
   */
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={open} className="ruled group">
      <summary className="flex cursor-pointer list-none flex-col gap-2 [&::-webkit-details-marker]:hidden">
        {/* The band is the heading's own, held to the width the rows below
            bleed to: the name sits exactly where an unopenable section's name
            sits, and what moved is only the light behind it. */}
        <div className="glow -mx-3 flex items-baseline gap-3 rounded-control px-3 py-1.5 transition-colors hover:bg-surface">
          <h2 className="font-display text-lg font-semibold tracking-tight">
            {label}
          </h2>
          {count !== undefined && (
            <span className="text-sm tabular-nums opacity-40">{count}</span>
          )}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className="ml-auto h-4 w-4 shrink-0 self-center opacity-40 transition-transform duration-200 group-open:rotate-180"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
        <div aria-hidden className="rule-head" />
      </summary>

      {/* The gap a section keeps between its heading and its list, which is the
          `gap-1` the open sections above set by hand. */}
      <div className="panel-body pt-1">{children}</div>
    </details>
  );
}
