/**
 * One section of a page, shut until it is asked for.
 *
 * A film's page answers one question at a glance — is this copy good enough —
 * and then spends a screen and a half on the evidence. Shut, each part of that
 * evidence is a single row: what it covers on the left, and on the right the
 * one line worth knowing without opening it. That line is what makes a closed
 * row honest rather than merely tidy — you can tell from it whether there is
 * anything inside worth your time.
 *
 * A native <details>: no JavaScript to open, open to a screen reader and to the
 * browser's own find-in-page, and everything shows when the page is printed.
 * No "use client" and no hooks, so a server page and a client component can
 * both reach for it.
 */
export function Panel({
  title,
  summary,
  open = false,
  children,
}: {
  title: string;
  summary?: React.ReactNode;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="ruled group" open={open}>
      <summary className="glow -mx-3 flex cursor-pointer list-none items-center gap-4 rounded-control px-3 py-3.5 transition-colors hover:bg-surface [&::-webkit-details-marker]:hidden">
        {/* The display face, at the size a section head is set in everywhere
            else in this app. It was small tracked upper case for a long time,
            which reads as a label on a form field — and a panel is not a field:
            it is a section of the page, holding as much as any shelf does. */}
        <h2 className="shrink-0 font-display text-lg font-semibold tracking-tight">
          {title}
        </h2>

        {/* Pushed to the chevron and truncated rather than wrapped: a summary
            that grows to two lines is no longer a summary. */}
        <span className="ml-auto min-w-0 truncate text-sm opacity-55">
          {summary}
        </span>

        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="h-4 w-4 shrink-0 opacity-40 transition-transform duration-200 group-open:rotate-180"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>

      {/* Set apart from the row that names it, so an open panel reads as its
          own thing rather than as a line that grew. */}
      <div className="panel-body pt-5 pb-8">{children}</div>
    </details>
  );
}
