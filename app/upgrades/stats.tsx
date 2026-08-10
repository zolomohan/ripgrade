/**
 * What a list adds up to, said as figures rather than as a sentence.
 *
 * A tab's total was a paragraph — "237.4 GB of foreign-language audio across 58
 * files. The kept tracks are copied byte for byte…" — which buries the two
 * numbers you came for inside a clause each and asks you to read a line of prose
 * to find out whether the tab is worth your afternoon. The number is the answer.
 * It should look like one, and it should be the only thing here: the paragraph
 * under it explaining what a removal does was answering a question nobody had
 * got to yet, and the page it sits above says all of it in rows.
 *
 * The tile itself is `Stat` in `app/charts.tsx` — a hairline standing to the
 * left of a tracked micro-label with the figure under it, in the display face.
 * Nothing draws a border here either — the rule is the whole of the frame — so
 * what separates this band from the controls above and the list below is space,
 * and it needs enough of it to read as a band of its own rather than as the
 * first row.
 */
export function Stats({
  children,
  action,
}: {
  children: React.ReactNode;
  /** The one thing this list can do to all of itself, where there is one. */
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-10 gap-y-4 py-3">
      <div className="flex flex-wrap items-start gap-x-10 gap-y-4">
        {children}
      </div>
      {action}
    </div>
  );
}
