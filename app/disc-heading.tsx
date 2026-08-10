import type { DiscSpec } from "@/lib/bluray";
import { qualityLabel } from "@/lib/disc-entry";

/**
 * The release a copy is measured against, named.
 *
 * The film page, the show page and the discover page each had their own copy of
 * this line, and each had to grow the same exception when a ceiling could be
 * typed in rather than scraped: there is no page behind a hand-entered disc, so
 * there is nothing to link to, and the words that were a link become just
 * words. Said once, so the three cannot drift.
 */
export function DiscHeading({
  best,
  entered,
}: {
  best: DiscSpec;
  /** Typed in rather than found, which the row says rather than hides. */
  entered?: boolean;
}) {
  const chip =
    "rounded-chip px-1.5 text-[11px] leading-[18px] font-medium ring-1 ring-line-strong ring-inset";

  return (
    <div className="flex flex-wrap items-baseline gap-2">
      {best.url ? (
        <a
          href={best.url}
          target="_blank"
          rel="noreferrer"
          className="font-medium underline decoration-transparent underline-offset-4 transition-colors hover:decoration-current"
        >
          {best.title}
          <span aria-hidden className="ml-1 opacity-40">
            ↗
          </span>
        </a>
      ) : (
        <p className="font-medium">{best.title}</p>
      )}

      <span className={chip}>{qualityLabel(best)}</span>

      {best.nativeFourK === false && (
        <span className={`${chip} opacity-60`}>Upscale</span>
      )}

      {/* Where the numbers came from, because it changes how much to trust
          them: everything below this line is what you said, not what a disc
          was measured at. */}
      {entered && (
        <span className="text-[11px] tracking-wide uppercase opacity-45">
          entered by hand
        </span>
      )}
    </div>
  );
}
