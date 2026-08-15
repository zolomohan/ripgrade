"use client";

import { useEffect, useState, useTransition } from "react";

import {
  findUpgradesForMovie,
  findUpgradesForSeason,
  findReleasesFor,
  findReleasesForEpisode,
  findReleasesForShow,
  type UpgradeResponse,
} from "@/app/actions";
import { BUTTON, FIELD } from "@/app/controls";
import { qualityLabel } from "@/lib/disc-entry";
import { MagnetAction } from "@/app/magnet-action";
import type { DownloadSource, FilmContext } from "@/lib/qbittorrent";
import { ScoreDial } from "@/app/score-circle";
import type { DiscSummary, ScoredRelease, Standing } from "@/lib/upgrades";
import { CloseButton, Modal, useClosing } from "@/app/modal";

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
  | { kind: "tmdb"; tmdbId: number }
  /** A whole series nobody here owns — see findReleasesForShow. */
  | { kind: "tmdbShow"; tmdbId: number }
  | { kind: "season"; showKey: string; season: number }
  | { kind: "episode"; showKey: string; season: number; episode: number };

/**
 * Score first, because the question being asked is "what is the best copy".
 * Seeders answer the other one — the best release on a dead tracker is not a
 * copy you are going to end up with.
 */
/** Both row actions are the same circle; only what is inside them differs. */
const ROW_ACTION =
  "grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line transition-colors hover:border-line-strong hover:bg-surface-strong";

export type Sort = "score" | "seeders";

export const SORTS: Record<
  Sort,
  (a: ScoredRelease, b: ScoredRelease) => number
> = {
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

/**
 * The colour when there is nothing to compare against — the search page, where
 * a release is only what its own name claims.
 *
 * Grey said "not compared", which is true and useless: the number is the only
 * verdict available there, so it may as well carry one. The bands are strict on
 * purpose. A release scores 100 by claiming everything the rubric can pay for —
 * a remux at the resolution, lossless object audio, an untouched stream — and
 * anything short of that is something given up, which is worth seeing before
 * you download it rather than after.
 */
const bare = (score: number) =>
  score >= 100 ? STANDING.good : score >= 80 ? STANDING.fair : STANDING.poor;

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
        {/* Only where there is a page to open: a ceiling typed in by hand says
            so instead, since the numbers beside it came from you. */}
        {disc.url ? (
          <a
            href={disc.url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-xs underline underline-offset-4 opacity-50 hover:opacity-100"
          >
            Blu-ray.com ↗
          </a>
        ) : (
          <p className="text-xs opacity-40">entered by hand</p>
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <p className="font-medium">{disc.title}</p>
        <Chip tone="strong">{qualityLabel(disc)}</Chip>
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

export function Result({
  release,
  referenceKind,
  film,
  source,
  ruled,
}: {
  release: ScoredRelease;
  referenceKind?: "copy" | "disc";
  /** Which film the search was for, riding into the download log. */
  film?: FilmContext;
  /**
   * And which queue tab the search was opened from, where it was opened from
   * one — a fetch off this row is that tab's, wherever the row itself came
   * from. Unset everywhere else; see `MagnetAction`.
   */
  source?: DownloadSource;
  /**
   * For a list that is not inside a card: the row is parted from the one above
   * it by the app's own hairline rather than by a border ruled edge to edge,
   * and it gives up the inset the card's frame was there to hold it off.
   *
   * The universal search reads this way. There the releases are one answer
   * among four, shown in a window that is already a frame — a bordered box
   * inside it would be a second frame around a third of the results.
   */
  ruled?: boolean;
}) {
  const { facts, tags, confidence } = release.guess;
  const best = facts.audio[0];

  /*
   * A name that states two dimensions out of four has been scored mostly on
   * defaults. Such a release shows no chips at all rather than a warning: the
   * chips are what the name actually said, and a name that said almost nothing
   * has nothing to put in them. The bare title underneath is the honest thing
   * to read in that case, and its score already carries the doubt.
   */
  const thin = confidence < 0.5;

  const pills = thin
    ? []
    : ([
        facts.resolution !== "unknown" ? facts.resolution : undefined,
        facts.hdr !== "SDR" ? facts.hdr : undefined,
        facts.releaseType !== "UNKNOWN" ? facts.releaseType : undefined,
        best?.atmos ? "Atmos" : best?.dtsx ? "DTS:X" : undefined,
        best && best.label !== "Assumed 5.1" ? best.label : undefined,
        tags.edition,
        tags.repack ? "REPACK" : undefined,
      ].filter(Boolean) as string[]);

  return (
    <li
      className={`glow group flex items-center gap-4 py-3 transition-colors hover:bg-surface ${
        ruled ? "card-band px-2" : "px-5"
      }`}
    >
      <div className="flex w-11 shrink-0 flex-col items-center gap-0.5">
        <ScoreDial
          score={release.score}
          theme={
            release.standing === "unknown"
              ? bare(release.score)
              : STANDING[release.standing]
          }
          title={
            release.relative
              ? `Predicted ${release.score}% of the best release`
              : `Predicted ${release.score} of 100`
          }
          srLabel={
            release.relative
              ? `Predicted ${release.score} percent of the best release`
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

      {/* The name leads. It is what you are actually scanning for, and the
          chips beneath it are a reading of that name — put above, they were
          answering a question the row had not asked yet. */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
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

        {pills.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {pills.map((pill) => (
              <Chip key={pill}>{pill}</Chip>
            ))}
          </div>
        )}
      </div>

      {/* Held at full opacity for the row under the pointer and dimmed
          otherwise, so twenty-five rows of buttons do not compete with the
          scores for attention. Icons rather than words: the pair repeats down
          every row, and at that count a label is read once and skipped
          thereafter while the shape is recognised every time. */}
      <div className="flex shrink-0 items-center gap-1.5 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {release.detailsUrl && (
          <a
            href={release.detailsUrl}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Open the indexer's page for this release"
            title="Details on the indexer"
            className={ROW_ACTION}
          >
            {/* The arrow leaving the frame is the web's own mark for a link
                that takes you off the page, which this one does. */}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              className="h-3.5 w-3.5"
            >
              <path d="M14 5h5v5" />
              <path d="M19 5l-7.5 7.5" />
              <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
            </svg>
          </a>
        )}

        {release.magnet ? (
          // The download control: a handover when qBittorrent is connected,
          // the plain magnet link otherwise. See app/magnet-action.tsx.
          <MagnetAction
            magnet={release.magnet}
            film={film}
            source={source}
            size="sm"
          />
        ) : (
          <span
            className="grid h-8 w-8 place-items-center rounded-full text-[10px] opacity-25"
            title="This indexer publishes no magnet — open the details page for it."
          >
            —
          </span>
        )}
      </div>
    </li>
  );
}

export function NotConfigured() {
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
/**
 * The one search each kind of subject amounts to. Five questions with one
 * answer shape, so the dialog above asks without knowing which it is asking.
 */
function searchFor(subject: Subject, term?: string): Promise<UpgradeResponse> {
  switch (subject.kind) {
    case "movie":
      return findUpgradesForMovie(subject.path, term);
    case "tmdb":
      return findReleasesFor(subject.tmdbId, term);
    case "tmdbShow":
      return findReleasesForShow(subject.tmdbId, term);
    case "season":
      return findUpgradesForSeason(subject.showKey, subject.season, term);
    case "episode":
      return findReleasesForEpisode(
        subject.showKey,
        subject.season,
        subject.episode,
        term,
      );
  }
}

export function ReleaseSearchModal({
  open,
  subject,
  title,
  subtitle,
  posterPath,
  source,
  configured,
  onClose,
}: {
  open: boolean;
  subject: Subject;
  title: string;
  subtitle?: string;
  /** The film's TMDb poster path, for the download log. */
  posterPath?: string;
  /** The queue tab this was opened from, where it was opened from one. */
  source?: DownloadSource;
  configured: boolean;
  onClose: () => void;
}) {
  const [response, setResponse] = useState<UpgradeResponse | null>(null);
  const [sort, setSort] = useState<Sort>("score");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();

  // Escape closes the modal, as expected of a dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function run(term?: string) {
    startTransition(async () => {
      setResponse(await searchFor(subject, term));
    });
  }

  // Runs once per mount, and re-runs when the subject genuinely changes — which
  // it does on the wishlist, where clicking a second tile swaps the film under
  // an already-open dialog rather than remounting it. The previous film's
  // results are not cleared here: `pending` turns over to the skeletons for as
  // long as the new search is running, so they are never on screen under the
  // wrong title.
  const subjectKey = JSON.stringify(subject);

  // A phrase edited for the previous film belongs to it — a fresh subject
  // starts from its own constructed query. Adjusted during render rather than
  // in the effect, per React's own pattern for state that follows a prop.
  const [lastSubject, setLastSubject] = useState(subjectKey);
  if (lastSubject !== subjectKey) {
    setLastSubject(subjectKey);
    setEditing(false);
  }

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

  const search = response?.ok ? response.search : undefined;
  const showing = results.slice(0, 25);

  return (
    /* A fixed height rather than one that follows the contents: a search
       returns anything from nothing to twenty-five rows, and a dialog that
       resizes as results land moves the close button out from under the
       pointer. The results scroll inside instead. */
    <Modal
      open={open}
      onClose={onClose}
      label={`Releases for ${title}`}
      panelClassName="flex h-[min(85vh,46rem)] w-full max-w-4xl flex-col overflow-hidden glass-panel rounded-card border border-line shadow-2xl"
    >
      <>
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

          <CloseButton onClick={onClose} />
        </header>

        {/* The floor the title stands on, as under every other dialog's. What
            follows is a tinted band, so the rule doubles as its top edge. */}
        <div aria-hidden className="rule-head mx-5 shrink-0" />

        {search &&
          (search.disc ? <DiscPanel disc={search.disc} /> : <NoDiscPanel />)}

        {configured && (
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-5 py-2.5">
            <div className="relative">
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                aria-label="Sort releases"
                className={FIELD.select}
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
                className="pointer-events-none absolute top-1/2 right-2.5 h-3 w-3 -translate-y-1/2 opacity-40"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </div>

            <div className="flex-1" />

            {search && results.length > showing.length && (
              <span className="shrink-0 text-[11px] opacity-40">
                top {showing.length} of {results.length}
              </span>
            )}
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
                </div>
              ) : (
                <>
                  <ul className="divide-y divide-line">
                    {showing.map((release) => (
                      <Result
                        key={`${release.title}-${release.infoHash ?? release.indexer}`}
                        release={release}
                        referenceKind={search.reference?.kind}
                        film={{ title, posterPath }}
                        source={source}
                      />
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>

        {/* The phrase the indexers were actually asked, offered for rewriting.
            A search that misses is usually a wording problem — an alternate
            title, a misparsed year — and the fix is to say it differently, not
            to go and search somewhere else. An edited phrase is sent verbatim
            and everything it returns is kept: the wording is now yours, so the
            app stops second-guessing what it matches. */}
        {configured && !pending && search && (
          <footer className="shrink-0 border-t border-line bg-surface px-5 py-2.5">
            {editing ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const term = draft.trim();
                  if (!term) return;
                  setEditing(false);
                  run(term);
                }}
                className="flex items-center gap-2"
              >
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    // Escape backs out of the edit; only a second one, with
                    // the input gone, reaches the dialog and closes it.
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setEditing(false);
                    }
                  }}
                  aria-label="Search phrase"
                  className={`${FIELD.small} min-w-0 flex-1`}
                />
                <button type="submit" className={BUTTON.small}>
                  Search
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="shrink-0 text-xs opacity-40 transition-opacity hover:opacity-100"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <div className="flex items-center gap-3">
                <p
                  className="min-w-0 flex-1 truncate text-[11px] opacity-45"
                  title={search.query}
                >
                  Searched for{" "}
                  <span className="font-mono">“{search.query}”</span>
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(search.query);
                    setEditing(true);
                  }}
                  className="shrink-0 text-xs underline decoration-line-strong underline-offset-4 opacity-50 transition-opacity hover:opacity-100"
                >
                  Edit
                </button>
              </div>
            )}
          </footer>
        )}
      </>
    </Modal>
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
  posterPath,
  configured,
  label = "Upgrade",
}: {
  subject: Subject;
  title: string;
  subtitle?: string;
  posterPath?: string;
  configured: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const mounted = useClosing(open);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        // h-8 to sit level with the icon buttons beside it, which are the same
        // pill with equal sides. It agrees with the padding rather than
        // fighting it: 20px of line plus 6px either side is the 32px asked
        // for, so nothing here is overriding anything.
        className={`${BUTTON.primary} h-8 font-medium`}
      >
        {label}
      </button>

      {mounted && (
        <ReleaseSearchModal
          open={open}
          subject={subject}
          title={title}
          subtitle={subtitle}
          posterPath={posterPath}
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
  posterPath,
  configured,
  label,
}: {
  subject: Subject;
  title: string;
  subtitle?: string;
  posterPath?: string;
  configured: boolean;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const mounted = useClosing(open);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm">{label}</p>
          <p className="text-xs opacity-45">
            {configured
              ? "Scored against the best release available — predicted, not measured."
              : "Connect Jackett on the Settings page to search."}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setOpen(true)}
          className={BUTTON.secondary}
        >
          Search
        </button>
      </div>

      {mounted && (
        <ReleaseSearchModal
          open={open}
          subject={subject}
          title={title}
          subtitle={subtitle}
          posterPath={posterPath}
          configured={configured}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
