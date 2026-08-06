import { DiscReview } from "@/app/film/[id]/disc-review";
import { NoDisc } from "@/app/no-disc";
import { Panel } from "@/app/panel";
import { fetchDisc, getDisc } from "@/lib/disc";

/**
 * The disc this film was released on, which is what its release scores mean.
 *
 * The same panel a film on the drive gets, minus the one part that needs a
 * file: there is no copy here to fall short of the disc, so nothing says where
 * yours falls short. Shut like every other panel in the app — the release it
 * names is the line worth reading, and that is what the shut row already says.
 */

const label = (disc: Awaited<ReturnType<typeof fetchDisc>> | undefined) =>
  disc?.best
    ? [disc.best.title, disc.best.format].filter(Boolean).join(" · ")
    : "None found";

export async function DiscSection({
  tmdbId,
  title,
  year,
}: {
  tmdbId: number;
  title: string;
  year?: number;
}) {
  /*
   * Looked up here if nobody has looked yet, and cached exactly as a scanned
   * film's is — including the failure, so a film with no disc release is not
   * re-scraped on every visit. The release search does the same lookup for its
   * own scoring, so on a first visit the two can race; whichever lands first
   * is what the other reads, and the answer is the same either way.
   */
  let disc = getDisc(tmdbId);
  if (!disc) {
    try {
      disc = await fetchDisc(tmdbId, title, year);
    } catch {
      // Left as not-looked-up: the panel says so, and offers the manual link.
    }
  }

  return (
    <Panel title="Best disc available" summary={label(disc)}>
      <div>
        {!disc || disc.error || !disc.best ? (
          <div className="flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center">
            <NoDisc scope="film" lookedUp={Boolean(disc)} error={disc?.error} />
            <DiscReview tmdbId={tmdbId} title={title} year={year} inline />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-2">
              <a
                href={disc.best.url}
                target="_blank"
                rel="noreferrer"
                className="font-medium underline decoration-transparent underline-offset-4 transition-colors hover:decoration-current"
              >
                {disc.best.title}
                <span aria-hidden className="ml-1 opacity-40">
                  ↗
                </span>
              </a>
              <span className="rounded-chip px-1.5 text-[11px] leading-[18px] font-medium ring-1 ring-line-strong ring-inset">
                {disc.best.format}
              </span>
              {disc.best.nativeFourK === false && (
                <span className="rounded-chip px-1.5 text-[11px] leading-[18px] font-medium opacity-60 ring-1 ring-line-strong ring-inset">
                  Upscale
                </span>
              )}
            </div>

            <dl className="mt-4 grid grid-cols-[9rem_1fr] gap-x-6 gap-y-2.5 text-sm">
              {(
                [
                  [
                    "Video",
                    [
                      disc.best.videoCodec,
                      disc.best.videoBitrateMbps
                        ? `${disc.best.videoBitrateMbps} Mbps`
                        : null,
                      disc.best.resolution,
                    ]
                      .filter(Boolean)
                      .join(" · "),
                  ],
                  ["Dynamic range", disc.best.hdr.join(", ") || "SDR"],
                  ["Aspect ratio", disc.best.aspectRatio ?? "unknown"],
                  ["Audio", disc.best.audio.join(" · ") || "unknown"],
                  [
                    "Editions",
                    `${disc.releaseCount} on Blu-ray.com${
                      disc.uhdExists ? " · 4K available" : " · no 4K release"
                    }`,
                  ],
                ] as [string, string][]
              ).map(([name, value]) => (
                <div key={name} className="contents">
                  <dt className="opacity-50">{name}</dt>
                  <dd className="font-mono text-xs break-all">{value}</dd>
                </div>
              ))}
            </dl>

            <DiscReview
              tmdbId={tmdbId}
              title={title}
              year={year}
              currentUrl={disc.best.url}
              manual={disc.manual}
            />
          </>
        )}
      </div>
    </Panel>
  );
}

/**
 * What stands in while the scrape is running.
 *
 * The panel itself rather than something shaped like it: the row it becomes
 * has to sit in exactly the same place, and building a lookalike is how two
 * rows that must line up stop lining up. What it is waiting for is said where
 * the answer will appear — the summary is the one line a shut panel shows, so
 * it is also the honest place to say the line is not in yet.
 */
export function DiscPending() {
  return (
    <Panel
      title="Best disc available"
      summary={
        <span className="flex items-center justify-end gap-2">
          {/* The skeleton's own pulse, at the size of a full stop: enough to
              say this is moving, small enough not to be a second thing to
              read. */}
          <span aria-hidden className="skeleton h-1.5 w-1.5 shrink-0" />
          Looking it up on Blu-ray.com…
        </span>
      }
    >
      <p className="text-sm opacity-55">
        Blu-ray.com is being searched for the best release of this film. Every
        predicted score below is a percentage of whatever it finds.
      </p>
    </Panel>
  );
}
