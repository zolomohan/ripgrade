/**
 * A page with nothing to show yet, saying so properly.
 *
 * These were bordered boxes holding one long grey sentence — a frame around
 * an apology. Unboxed, like every other part of a page here: a drawn mark so
 * the state reads before the words do, a heading that names the situation, a
 * sentence that says what changes it, and the action that does — in the empty
 * state itself, because "what do I do now" is the whole question an empty
 * page asks.
 */
export function EmptyState({
  icon,
  title,
  action,
  children,
}: {
  /** SVG innards — paths and circles on a 24×24 stroke grid. */
  icon: React.ReactNode;
  title: string;
  /** The way out of the empty state, when there is one. */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    /* `my-auto` centres it in whatever height the page has spare — the page's
       main grows to the viewport, so an empty page holds this at its middle
       rather than hanging it under the top edge. */
    <div className="row-enter my-auto flex flex-col items-center px-6 py-12 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-full border border-line bg-surface">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="h-6 w-6 opacity-45"
        >
          {icon}
        </svg>
      </span>

      <p className="mt-5 font-display text-lg font-semibold tracking-tight">
        {title}
      </p>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed opacity-50">
        {children}
      </p>

      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
