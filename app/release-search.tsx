"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";

import {
  findUpgradesForMovie,
  findUpgradesForSeason,
  findUpgradesForWish,
  type UpgradeResponse,
} from "@/app/actions";
import { ScoreDial } from "@/app/score-circle";
import type { DiscSummary, ScoredRelease, Standing } from "@/lib/upgrades";

/**
 * What the indexers have, read through the same rubric as the drive.
 *
 * Every number here is predicted from a release name, never measured — the
 * file has not been fetched and nothing about it has been probed. That is why
 * results are labelled "predicted", why a name that states little carries a
 * warning, and why the format pills are plain text rather than the official
 * Dolby and DTS marks the library uses: those marks assert a fact about a file,
 * and this is somebody's typing.
 *
 * The disc panel at the top is the point of the layout rather than decoration.
 * Scores here are a percentage of that disc, so a 71 means nothing at all until
 * you can see that the disc is a 4K Dolby Vision release and this release is
 * 1080p. Showing the yardstick above the measurements is what makes the column
 * of numbers legible.
 */

export type Subject =
  | { kind: "movie"; path: string }
  | { kind: "wish"; tmdbId: number }
  | { kind: "season"; showKey: string; season: number };

/**
 * Score first, because the question being asked is "what is the best copy".
 * Seeders answer the other one — the best release on a dead tracker is not a
 * copy you are going to end up with.
 */
type Sort = "score" | "seeders";

const SORTS: Record<Sort, (a: ScoredRelease, b: ScoredRelease) => number> = {
  score: (a, b) => b.score - a.score || (b.seeders ?? 0) - (a.seeders ?? 0),
  seeders: (a, b) => (b.seeders ?? 0) - (a.seeders ?? 0) || b.score - a.score,
};

const gigabytes = (bytes?: number) =>
  bytes === undefined ? "—" : `${(bytes / 1024 ** 3).toFixed(1)} GB`;

/**
 * The ring's colour answers "should I take this one?", not "is this a good
 * file?".
 *
 * Deliberately not the library's score palette. A 78 is a fine score in the
 * abstract, and a fine score is exactly the wrong thing to paint green when the
 * copy already on the drive is an 86. So the number is the score, the colour is
 * the verdict, and the two are allowed to disagree — `lib/upgrades.ts` decides
 * which is which, because the rule depends on what is being compared against.
 */
const STANDING: Record<Standing, { stroke: string; text: string }> = {
  good: {
    stroke: "stroke-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
  },
  fair: {
    stroke: "stroke-amber-500",
    text: "text-amber-600 dark:text-amber-400",
  },
  poor: { stroke: "stroke-red-500", text: "text-red-600 dark:text-red-400" },
  unknown: { stroke: "stroke-line-strong", text: "opacity-55" },
};

/** How far above or below the reference this release lands. */
function Delta({
  delta,
  standing,
  kind,
}: {
  delta: number;
  standing: Standing;
  kind: "copy" | "disc";
}) {
  // Against the disc a nil difference is the best outcome available: there is
  // nothing better to own, so "same" would undersell it.
  const label =
    delta === 0
      ? kind === "disc"
        ? "match"
        : "same"
      : delta > 0
        ? `+${delta}`
        : String(delta);

  return (
    <span className={`text-[11px] tabular-nums ${STANDING[standing].text}`}>
      {label}
    </span>
  );
}

function Chip({
  children,
  tone = "plain",
}: {
  children: React.ReactNode;
  tone?: "plain" | "strong";
}) {
  return (
    <span
      className={`rounded-chip px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] whitespace-nowrap ${
        tone === "strong"
          ? "bg-surface-strong ring-1 ring-line-strong ring-inset"
          : "opacity-70 ring-1 ring-line-strong ring-inset"
      }`}
    >
      {children}
    </span>
  );
}

/**
 * The disc the scores are a percentage of.
 *
 * Sits above the results because it is the denominator: every ring below is
 * "how close does this get to *this*". Without it a column of sixties reads as
 * a bad search rather than as a film whose disc nothing on the indexers comes
 * near.
 */
function DiscPanel({ disc }: { disc: DiscSummary }) {
  const specs = [
    [
      disc.resolution,
      disc.videoCodec,
      disc.videoBitrateMbps && `${disc.videoBitrateMbps} Mbps`,
    ]
      .filter(Boolean)
      .join(" · "),
    disc.hdr.join(", ") || "SDR",
    disc.audio.slice(0, 2).join(" · "),
  ].filter(Boolean) as string[];

  return (
    <div className="shrink-0 border-b border-line bg-surface px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[10px] font-semibold tracking-[0.12em] uppercase opacity-40">
          Scored against
        </p>
        <a
          href={disc.url}
          target="_blank"
          rel="noreferrer noopener"
          className="text-xs underline underline-offset-4 opacity-50 hover:opacity-100"
        >
          Blu-ray.com ↗
        </a>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <p className="font-medium">{disc.title}</p>
        <Chip tone="strong">{disc.format}</Chip>
        {disc.nativeFourK === false && <Chip>UPSCALE</Chip>}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] opacity-50">
        {specs.map((spec) => (
          <span key={spec}>{spec}</span>
        ))}
      </div>
    </div>
  );
}

/** Shown in place of the disc panel when there is no disc to measure against. */
function NoDiscPanel() {
  return (
    <div className="shrink-0 border-b border-line bg-surface px-5 py-3">
      <p className="text-[11px] opacity-45">
        No disc release was found for this film, so scores are the plain rubric
        total out of 100.
      </p>
    </div>
  );
}

function Result({
  release,
  referenceKind,
}: {
  release: ScoredRelease;
  referenceKind?: "copy" | "disc";
}) {
  const { facts, tags, confidence } = release.guess;
  const best = facts.audio[0];

  // A name that states two dimensions out of four has been scored partly on
  // defaults, and saying so is the difference between a guess and a claim.
  const thin = confidence < 0.5;

  const pills = [
    facts.resolution !== "unknown" ? facts.resolution : undefined,
    facts.hdr !== "SDR" ? facts.hdr : undefined,
    facts.releaseType !== "UNKNOWN" ? facts.releaseType : undefined,
    best?.atmos ? "Atmos" : best?.dtsx ? "DTS:X" : undefined,
    best && best.label !== "Assumed 5.1" ? best.label : undefined,
    tags.edition,
    tags.repack ? "REPACK" : undefined,
  ].filter(Boolean) as string[];

  return (
    <li className="group flex items-center gap-4 px-5 py-3 transition-colors hover:bg-surface">
      <div className="flex w-11 shrink-0 flex-col items-center gap-0.5">
        <ScoreDial
          score={release.score}
          theme={STANDING[release.standing]}
          title={
            release.relative
              ? `Predicted ${release.score}% of the disc`
              : `Predicted ${release.score} of 100`
          }
          srLabel={
            release.relative
              ? `Predicted ${release.score} percent of the disc`
              : `Predicted score ${release.score} of 100`
          }
        />
        {release.delta !== undefined && referenceKind && (
          <Delta
            delta={release.delta}
            standing={release.standing}
            kind={referenceKind}
          />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {pills.map((pill) => (
            <Chip key={pill}>{pill}</Chip>
          ))}
          {thin && (
            <span
              className="text-[10px] font-semibold tracking-[0.08em] text-amber-600 dark:text-amber-400"
              title="The name states little, so most of this score is assumed rather than read."
            >
              THIN NAME
            </span>
          )}
        </div>

        <p
          className="truncate font-mono text-[11px] opacity-55"
          title={release.title}
        >
          {release.title}
        </p>

        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] opacity-40">
          <span className="tabular-nums">{gigabytes(release.sizeBytes)}</span>
          {release.seeders !== undefined && (
            <span className="tabular-nums">{release.seeders} seeders</span>
          )}
          {tags.group && <span>{tags.group}</span>}
          {release.indexer && <span>{release.indexer}</span>}
          {release.sources > 1 && <span>on {release.sources} indexers</span>}
        </p>
      </div>

      {/* Held at full opacity for the row under the pointer and dimmed
          otherwise, so twenty-five rows of buttons do not compete with the
          scores for attention. */}
      <div className="flex shrink-0 items-center gap-2 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {release.detailsUrl && (
          <a
            href={release.detailsUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-control px-2 py-1 text-xs opacity-60 hover:bg-surface-strong hover:opacity-100"
          >
            Details
          </a>
        )}
        {release.magnet ? (
          // A plain link rather than a button: `magnet:` is a scheme the
          // browser hands straight to whatever the system has registered for
          // it, so there is nothing for the app to do beyond offering the href.
          // No target — a new tab for a protocol handoff only ever leaves an
          // empty tab behind.
          <a
            href={release.magnet}
            title={release.magnet}
            className="rounded-control border border-line px-2.5 py-1 text-xs whitespace-nowrap transition-colors hover:bg-surface-strong"
          >
            Download
          </a>
        ) : (
          <span
            className="text-xs opacity-30"
            title="This indexer publishes no magnet — open the details page for it."
          >
            No magnet
          </span>
        )}
      </div>
    </li>
  );
}

/**
 * Who actually answered.
 *
 * An indexer that failed inside Jackett is simply absent from the feed — no
 * error, no mention — so a search can quietly become a search of half your
 * trackers. Naming the ones that replied is the only honest signal available,
 * and it is the difference between "this release does not exist" and "the
 * tracker holding it never answered".
 */
function Answered({ indexers }: { indexers: string[] }) {
  if (indexers.length === 0) return null;

  return (
    <p className="text-[11px] opacity-40">
      Answered: {indexers.join(", ")}. An indexer that failed inside Jackett
      does not appear here.
    </p>
  );
}

function NotConfigured() {
  return (
    <p className="px-5 py-10 text-center text-sm opacity-55">
      Connect Jackett on the{" "}
      <a href="/settings" className="underline underline-offset-2">
        Settings page
      </a>{" "}
      to search for better releases.
    </p>
  );
}

/**
 * The dialog itself, open for as long as it is rendered.
 *
 * Controlled by the caller rather than owning a trigger, because what opens it
 * differs everywhere it is used: a button on a film, a whole tile on the
 * wishlist. Searching happens on mount — being rendered *is* the request.
 */
export function ReleaseSearchModal({
  subject,
  title,
  subtitle,
  configured,
  onClose,
}: {
  subject: Subject;
  title: string;
  subtitle?: string;
  configured: boolean;
  onClose: () => void;
}) {
  const [response, setResponse] = useState<UpgradeResponse | null>(null);
  const [sort, setSort] = useState<Sort>("score");
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTarget(document.body);
  }, []);

  // Escape closes the modal, as expected of a dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function run() {
    startTransition(async () => {
      setResponse(
        subject.kind === "movie"
          ? await findUpgradesForMovie(subject.path)
          : subject.kind === "wish"
            ? await findUpgradesForWish(subject.tmdbId)
            : await findUpgradesForSeason(subject.showKey, subject.season),
      );
    });
  }

  // Runs once per mount, and re-runs when the subject genuinely changes — which
  // it does on the wishlist, where clicking a second tile swaps the film under
  // an already-open dialog rather than remounting it. The previous film's
  // results are not cleared here: `pending` turns over to the skeletons for as
  // long as the new search is running, so they are never on screen under the
  // wrong title.
  const subjectKey = JSON.stringify(subject);
  useEffect(() => {
    if (configured) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectKey, configured]);

  // Sorted before the cut below, so "Most seeders" reaches past the 25 with the
  // best scores rather than merely rearranging them. Copied because sort()
  // would otherwise reorder the response in place.
  const results = response?.ok
    ? [...response.search.results].sort(SORTS[sort])
    : [];

  if (!target) return null;

  const search = response?.ok ? response.search : undefined;
  const showing = results.slice(0, 25);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* A fixed height rather than one that follows the contents: a search
          returns anything from nothing to twenty-five rows, and a dialog that
          resizes as results land moves the close button out from under the
          pointer. The results scroll inside instead. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Releases for ${title}`}
        onClick={(e) => e.stopPropagation()}
        className="flex h-[min(85vh,46rem)] w-full max-w-4xl flex-col overflow-hidden rounded-card border border-line bg-background shadow-2xl"
      >
        <header className="flex shrink-0 items-start gap-4 px-5 pt-5 pb-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold tracking-tight">
              {title}
              {subtitle && (
                <span className="ml-2 text-base font-normal opacity-40">
                  {subtitle}
                </span>
              )}
            </h2>
            <p className="mt-0.5 text-xs opacity-45">
              {pending
                ? "Searching every indexer Jackett knows…"
                : search
                  ? `${search.results.length} release${
                      search.results.length === 1 ? "" : "s"
                    } · predicted from the name, not measured`
                  : "Predicted from the release name, not measured"}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line opacity-50 transition-opacity hover:opacity-100"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="h-3.5 w-3.5"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        {search &&
          (search.disc ? <DiscPanel disc={search.disc} /> : <NoDiscPanel />)}

        {configured && (
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-5 py-2.5">
            <div className="relative">
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                aria-label="Sort releases"
                className="cursor-pointer appearance-none rounded-control border border-line bg-transparent py-1 pr-7 pl-2.5 text-xs outline-none focus:border-line-strong"
              >
                <option value="score">Best score</option>
                <option value="seeders">Most seeders</option>
              </select>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="pointer-events-none absolute top-1/2 right-2 h-3 w-3 -translate-y-1/2 opacity-40"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </div>

            <div className="flex-1" />

            {search && results.length > showing.length && (
              <span className="text-[11px] opacity-40">
                top {showing.length} of {results.length}
              </span>
            )}

            <button
              type="button"
              onClick={run}
              disabled={pending}
              className="rounded-control border border-line px-2.5 py-1 text-xs transition-colors hover:bg-surface-strong disabled:opacity-30"
            >
              {pending ? "Searching…" : "Search again"}
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!configured && <NotConfigured />}

          {configured && pending && (
            <div className="flex flex-col gap-2 p-5">
              {Array.from({ length: 7 }, (_, i) => (
                <div key={i} className="skeleton h-14 w-full" />
              ))}
            </div>
          )}

          {configured && !pending && response && !response.ok && (
            <p className="px-5 py-10 text-center text-sm text-red-600 dark:text-red-400">
              {response.error}
            </p>
          )}

          {configured && !pending && search && (
            <>
              {showing.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
                  <p className="text-sm opacity-55">
                    Nothing came back for “{search.query}”.
                    {search.discarded > 0 &&
                      ` ${search.discarded} result${
                        search.discarded === 1 ? " was" : "s were"
                      } for a different film.`}
                  </p>
                  <Answered indexers={search.indexers} />
                </div>
              ) : (
                <>
                  <ul className="divide-y divide-line">
                    {showing.map((release) => (
                      <Result
                        key={`${release.title}-${release.infoHash ?? release.indexer}`}
                        release={release}
                        referenceKind={search.reference?.kind}
                      />
                    ))}
                  </ul>
                  <div className="px-5 py-3">
                    <Answered indexers={search.indexers} />
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    target,
  );
}

/**
 * The primary action on a film: go and find a better copy of this.
 *
 * Filled rather than outlined, and sitting in the row with Reveal in Finder and
 * the artwork picker. Those two are icons because they are utilities you reach
 * for occasionally; this is the thing the app is for, so it gets the emphasis
 * and the word. The fill is the same inverted treatment the scan button uses —
 * the palette has no accent colour, so weight is what carries prominence here.
 */
export function UpgradeButton({
  subject,
  title,
  subtitle,
  configured,
  label = "Upgrade",
}: {
  subject: Subject;
  title: string;
  subtitle?: string;
  configured: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        // h-8 and rounded-chip to sit level with the icon buttons beside it.
        className="h-8 shrink-0 rounded-chip bg-foreground px-3.5 text-sm font-medium text-background transition-opacity duration-150 hover:opacity-90"
      >
        {label}
      </button>

      {open && (
        <ReleaseSearchModal
          subject={subject}
          title={title}
          subtitle={subtitle}
          configured={configured}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * A labelled card that opens the dialog. For the season blocks on a show page,
 * which have room for a heading and want to say what the button is for.
 */
export function ReleaseSearchButton({
  subject,
  title,
  subtitle,
  configured,
  label,
}: {
  subject: Subject;
  title: string;
  subtitle?: string;
  configured: boolean;
  label: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm">{label}</p>
          <p className="text-xs opacity-45">
            {configured
              ? "Scored against the best disc release — predicted, not measured."
              : "Connect Jackett on the Settings page to search."}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setOpen(true)}
          className="shrink-0 rounded-control border border-line px-3 py-1.5 text-sm transition-colors hover:bg-surface-strong"
        >
          Search
        </button>
      </div>

      {open && (
        <ReleaseSearchModal
          subject={subject}
          title={title}
          subtitle={subtitle}
          configured={configured}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
