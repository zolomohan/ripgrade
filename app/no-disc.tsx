/**
 * What the Best quality panel says when there is no disc.
 *
 * It used to be one dim sentence with two buttons under it, which read as a
 * failure notice rather than as a state: the panel said what it had not found
 * and left you to work out whether that mattered. It does matter — a film or a
 * season with no disc to be measured against is scored on the rubric alone,
 * which is a different scale — so that is what it says now, and the action to
 * fix it follows underneath.
 */
export function NoDisc({
  scope,
  lookedUp,
  error,
}: {
  scope: "film" | "season";
  /** False before a scan has been round; the two are not the same failure. */
  lookedUp: boolean;
  error?: string;
}) {
  const subject = scope === "season" ? "its episodes are" : "this copy is";

  // The lookup's own failure is usually the literal words "No release found",
  // which is the heading again in a smaller face. Only a reason that says
  // something the heading does not is worth printing.
  const reason =
    error && error.replace(/\.$/, "").toLowerCase() !== "no release found"
      ? error
      : undefined;

  return (
    <div className="flex flex-col gap-2">
      <p className="font-medium">
        {lookedUp ? "No release found" : "Not looked up yet"}
      </p>

      <p className="max-w-prose text-sm opacity-55">
        {lookedUp
          ? `Nothing on Blu-ray.com matches this ${scope}, so ${subject} scored on the rubric alone rather than against the best release. If you know the release you can link it by hand — and if there is no page for it at all, you can type its specs in instead.`
          : `A scan looks this up on Blu-ray.com automatically. Until it has, ${subject} scored on the rubric alone.`}
      </p>

      {/* The scraper's own words, kept small and last: it is the reason, not
          the point, and it is the only line here worth copying. */}
      {reason && <p className="font-mono text-xs opacity-35">{reason}</p>}
    </div>
  );
}
