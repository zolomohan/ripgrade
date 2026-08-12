/**
 * The heading a page's sections are parted by: a name, and the hairline the
 * rest of the app rules its headings with.
 *
 * Written for the downloads log — "Downloading", then "History" — and pulled
 * out of it the moment a second page wanted the same two-part shape. A section
 * heading is a thing this app has an opinion about, and two copies of that
 * opinion is one more than it can hold.
 */
export function SectionHeading({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-display text-lg font-semibold tracking-tight">
        {label}
      </h2>
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
  children,
}: {
  label: string;
  /** How many rows are inside, said on the line that stands in for them. */
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <details className="ruled group">
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
