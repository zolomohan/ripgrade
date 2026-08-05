import { notFound } from "next/navigation";

import { Art } from "@/app/art";
import { findDuplicateGroup, type LibraryItem } from "@/lib/library";
import { decodeId, posterName } from "@/lib/routes";
import { storedHitFor, type StoredHit } from "@/lib/upgrade-sweep";
import { BackButton } from "./back-button";

export const dynamic = "force-dynamic";

function bytes(n: number) {
  return n >= 1e12
    ? `${(n / 1e12).toFixed(2)} TB`
    : `${(n / 1e9).toFixed(1)} GB`;
}

function runtime(seconds?: number) {
  if (!seconds) return "unknown";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const RESOLUTION_RANK: Record<string, number> = {
  "2160p": 4,
  "1080p": 3,
  "720p": 2,
  SD: 1,
  unknown: 0,
};

const HDR_RANK: Record<string, number> = {
  "Dolby Vision": 4,
  "HDR10+": 3,
  HDR10: 2,
  SDR: 1,
};

const RELEASE_RANK: Record<string, number> = {
  REMUX: 4,
  "WEB-DL": 3,
  ENCODE: 2,
  UNKNOWN: 1,
};

/** The show page's verdict tones, for the score in the hero line. */
const SCORE_TONE = (score: number) =>
  score >= 78
    ? "text-emerald-600 dark:text-emerald-400"
    : score >= 62
      ? "text-amber-600 dark:text-amber-400"
      : "text-red-600 dark:text-red-400";

/**
 * A synopsis cut to a length the hero can hold, exactly as the show page cuts
 * its own — on a word, so it reads as a sentence that stops.
 */
const SYNOPSIS_WORDS = 34;

const trimSynopsis = (text: string) => {
  const words = text.split(/\s+/);
  return words.length <= SYNOPSIS_WORDS
    ? text
    : `${words
        .slice(0, SYNOPSIS_WORDS)
        .join(" ")
        .replace(/[,.;:]$/, "")}…`;
};

type Row = {
  label: string;
  values: string[];
  /**
   * What the queued release claims for this attribute — read off its name,
   * so most rows have nothing to say and say so with a dash.
   */
  predicted?: string;
  /** Column indices holding the best value, when one is meaningfully better. */
  best?: number[];
  /** True when every copy agrees — rendered quietly so differences stand out. */
  same: boolean;
  /** A rubric score rather than a measurement, and set in the score face. */
  scored?: boolean;
  /**
   * Signed distance from the first column, per copy — the overall row carries
   * it so a difference is read as a difference, not computed in your head.
   */
  deltas?: (number | null)[];
  predictedDelta?: number | null;
};

/** +N in the gain colour; a shortfall is stated but not celebrated. */
function Delta({ value }: { value: number }) {
  if (value === 0) return null;
  return (
    <span
      className={`ml-1.5 font-sans text-xs font-normal tabular-nums ${
        value > 0
          ? "text-emerald-600 dark:text-emerald-400"
          : "opacity-40"
      }`}
    >
      {value > 0 ? `+${value}` : `−${Math.abs(value)}`}
    </span>
  );
}

/** Marks the columns whose score is highest, unless everything ties. */
function rank(scores: (number | undefined)[]): number[] | undefined {
  const known = scores.filter((s): s is number => s !== undefined);
  if (known.length < 2) return undefined;

  const top = Math.max(...known);
  if (known.every((s) => s === top)) return undefined;
  return scores.flatMap((s, i) => (s === top ? [i] : []));
}

function buildRows(copies: LibraryItem[], hit: StoredHit | null): Row[] {
  const row = (
    label: string,
    render: (m: LibraryItem) => string,
    options: {
      score?: (m: LibraryItem) => number | undefined;
      scored?: boolean;
      predicted?: (h: StoredHit) => string | undefined;
    } = {},
  ): Row => {
    const values = copies.map(render);
    return {
      label,
      values,
      predicted: hit ? options.predicted?.(hit) : undefined,
      best: options.score ? rank(copies.map(options.score)) : undefined,
      same: new Set(values).size === 1,
      scored: options.scored,
    };
  };

  const bestAudio = (m: LibraryItem) =>
    m.audio.find((a) => a.atmos || a.dtsx) ??
    m.audio.find((a) => a.lossless) ??
    m.audio[0];

  const baseline = copies[0].scores.overall;

  return [
    {
      ...row("Overall score", (m) => String(m.scores.overall), {
        score: (m) => m.scores.overall,
        scored: true,
        predicted: (h) => String(h.score),
      }),
      // Against the copy in the first column — the one you would keep — so
      // every other figure answers "and how much better or worse is this?".
      deltas: copies.map((m, i) =>
        i === 0 ? null : m.scores.overall - baseline,
      ),
      predictedDelta: hit ? hit.score - baseline : null,
    },
    row("Video score", (m) => String(m.scores.video), {
      score: (m) => m.scores.video,
      scored: true,
      predicted: (h) => (h.scores ? String(h.scores.video) : undefined),
    }),
    row("Audio score", (m) => String(m.scores.audio), {
      score: (m) => m.scores.audio,
      scored: true,
      predicted: (h) => (h.scores ? String(h.scores.audio) : undefined),
    }),
    row("Release score", (m) => String(m.scores.release), {
      score: (m) => m.scores.release,
      scored: true,
      predicted: (h) => (h.scores ? String(h.scores.release) : undefined),
    }),
    row("Status", (m) => m.status),
    row("Resolution", (m) => `${m.width ?? "?"}×${m.height ?? "?"} (${m.resolution})`, {
      score: (m) => RESOLUTION_RANK[m.resolution],
      predicted: (h) => h.resolution,
    }),
    row("Codec", (m) => m.videoCodec ?? "unknown"),
    row("Bit depth", (m) => (m.bitDepth ? `${m.bitDepth}-bit` : "unknown"), {
      score: (m) => m.bitDepth,
    }),
    row(
      "Dynamic range",
      (m) =>
        m.hdr === "Dolby Vision" ? `Dolby Vision P${m.dvProfile ?? "?"}` : m.hdr,
      {
        score: (m) => HDR_RANK[m.hdr],
        predicted: (h) => h.hdr,
      },
    ),
    row(
      "Video bitrate",
      (m) =>
        m.videoBitrateKbps
          ? `${m.videoBitrateKbps.toLocaleString()} kbps`
          : "unknown",
      { score: (m) => m.videoBitrateKbps },
    ),
    row("Bitrate density", (m) => (m.bpp ? `${m.bpp.toFixed(3)} bpp` : "unknown"), {
      score: (m) => m.bpp,
    }),
    row("Release type", (m) => m.releaseType, {
      score: (m) => RELEASE_RANK[m.releaseType],
      predicted: (h) => h.releaseType,
    }),
    row("Encoder", (m) => m.encoder ?? "none (stream copied)"),
    row("Best audio", (m) => bestAudio(m)?.label ?? "none", {
      predicted: (h) => h.audio,
    }),
    row(
      "Audio channels",
      (m) =>
        bestAudio(m)?.channels ? `${bestAudio(m)!.channels}ch` : "unknown",
      { score: (m) => bestAudio(m)?.channels },
    ),
    row(
      "Object audio",
      (m) =>
        m.audio.some((a) => a.atmos)
          ? "Dolby Atmos"
          : m.audio.some((a) => a.dtsx)
            ? "DTS:X"
            : "none",
      { score: (m) => (m.audio.some((a) => a.atmos || a.dtsx) ? 1 : 0) },
    ),
    row("Lossless audio", (m) => (m.audio.some((a) => a.lossless) ? "yes" : "no"), {
      score: (m) => (m.audio.some((a) => a.lossless) ? 1 : 0),
    }),
    row("Audio tracks", (m) => String(m.audio.length), {
      score: (m) => m.audio.length,
    }),
    row(
      "Subtitles",
      (m) =>
        m.subtitleLanguages.length ? m.subtitleLanguages.join(", ") : "none",
      { score: (m) => m.subtitleLanguages.length },
    ),
    row("Runtime", (m) => runtime(m.durationSec)),
    // Bigger is not automatically better, so this is reported without a winner.
    row("File size", (m) => bytes(m.sizeBytes), {
      predicted: (h) =>
        h.sizeBytes !== undefined ? bytes(h.sizeBytes) : undefined,
    }),
    row(
      "Issues",
      (m) => (m.issues.length ? m.issues.map((i) => i.code).join(", ") : "none"),
      { score: (m) => -m.issues.length },
    ),
    row("Edition", (m) => m.edition ?? "—"),
    row("Folder", (m) => m.folder),
    // Facts only a listing has — meaningless for a file on the drive.
    ...(hit
      ? [
          row("Seeders", () => "—", {
            predicted: (h) =>
              h.seeders !== undefined ? String(h.seeders) : undefined,
          }),
          row("Indexer", () => "—", { predicted: (h) => h.indexer }),
        ]
      : []),
  ];
}

export default async function ComparePage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;

  let decoded: string;
  try {
    decoded = decodeId(key);
  } catch {
    notFound();
  }

  const copies = findDuplicateGroup(decoded!);
  if (!copies || copies.length === 0) notFound();

  const [keep, ...drop] = copies;
  const reclaim = drop.reduce((sum, m) => sum + m.sizeBytes, 0);

  // The upgrade sweep's best find for this film, standing in the last column
  // as everything its name claims — beside copies that were measured.
  const hit = storedHitFor(copies.map((c) => c.path));
  const rows = buildRows(copies, hit);

  return (
    <main className="flex flex-col pb-16">
      {/* The same hero a film and a show get, at the show page's own height —
          the backdrop is what says which film faster than any heading, and
          this page is about choosing between its copies. */}
      <div className="relative h-72 w-full overflow-hidden sm:h-96">
        {keep.fanart || keep.art.fanart ? (
          <>
            <Art
              src={keep.fanart}
              remote={keep.art.fanart}
              version={keep.artAt}
              size="original"
              className="enter-veil absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-background/20" />
          </>
        ) : (
          <div className="absolute inset-0 bg-surface-strong" />
        )}

        {/* Decorative — the h1 below is the real title. */}
        {(keep.logo || keep.art.logo) && (
          <Art
            src={keep.logo}
            remote={keep.art.logo}
            version={keep.artAt}
            size="original"
            className="enter-drop pointer-events-none absolute top-6 right-6 z-[5] max-h-16 w-auto max-w-[40vw] object-contain object-right drop-shadow-[0_2px_14px_rgba(0,0,0,0.6)] sm:max-h-20 sm:max-w-sm"
          />
        )}

        <BackButton />
      </div>

      <div className="relative z-10 mx-auto -mt-24 flex w-full max-w-6xl flex-col gap-8 px-6 sm:px-8">
        <header className="flex items-end gap-5">
          {keep.poster || keep.art.poster ? (
            <Art
              src={keep.poster}
              remote={keep.art.poster}
              version={keep.artAt}
              transitionName={posterName(keep.path)}
              size="w342"
              className="h-44 w-[7.5rem] shrink-0 rounded-card object-cover shadow-2xl ring-1 ring-line"
            />
          ) : (
            <div className="h-44 w-[7.5rem] shrink-0 rounded-card bg-surface-strong shadow-2xl ring-1 ring-line" />
          )}

          <div className="enter-rise flex min-w-0 flex-col gap-2 pb-1">
            <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              {keep.title}
              {keep.year && (
                <span className="ml-2 font-normal opacity-40">{keep.year}</span>
              )}
            </h1>

            {/* The show page's subtitle line, in this page's terms: what the
                copy you would keep amounts to, before the table itemises it. */}
            <p className="text-sm opacity-55">
              {[keep.resolution, keep.releaseType, bytes(keep.sizeBytes)]
                .filter(Boolean)
                .join(" · ")}{" "}
              ·{" "}
              <span className={`font-score ${SCORE_TONE(keep.scores.overall)}`}>
                {keep.scores.overall}/100
              </span>
            </p>

            {keep.tmdb?.overview && (
              <p
                className="max-w-prose pt-1 text-sm leading-relaxed opacity-65"
                title={keep.tmdb.overview}
              >
                {trimSynopsis(keep.tmdb.overview)}
              </p>
            )}
          </div>
        </header>

      {/* The verdict only means something with something to delete. */}
      {drop.length > 0 && (
        <div className="rounded-card border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3">
          <p className="text-sm">
            <span className="font-medium text-emerald-700 dark:text-emerald-300">
              Keep {keep.releaseType} · score {keep.scores.overall}
            </span>{" "}
            — deleting the {drop.length === 1 ? "other copy" : "other copies"}{" "}
            reclaims <span className="font-medium">{bytes(reclaim)}</span>.
          </p>
          <p className="mt-1 font-mono text-xs opacity-60">{keep.fileName}</p>
        </div>
      )}

      {/* mt on top of the column's gap: the table is the page's second act,
          and a touch more air under the hero says so. */}
      <div className="mt-12 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            {/* Real column titles, in the display face like every section
                heading here: what each column *is* deserves more than a tag.
                The verdict colours stay — emerald for the copy worth keeping,
                amber for a claim that is only a prediction. */}
            <tr className="border-b border-line-strong">
              <th className="w-40 px-3 py-3" />
              {copies.map((copy, i) => (
                <th
                  key={copy.path}
                  className="min-w-52 px-3 pt-1 pb-3 text-left align-bottom"
                >
                  <span
                    className={`font-display text-lg font-semibold tracking-tight ${
                      copies.length === 1
                        ? ""
                        : i === 0
                          ? "text-emerald-700 dark:text-emerald-300"
                          : "opacity-45"
                    }`}
                  >
                    {copies.length === 1
                      ? "Your copy"
                      : i === 0
                        ? "Keep"
                        : "Drop"}
                  </span>
                </th>
              ))}
              {hit && (
                <th className="min-w-52 px-3 pt-1 pb-3 text-left align-bottom">
                  <span className="font-display text-lg font-semibold tracking-tight text-amber-700 dark:text-amber-300">
                    Predicted
                  </span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {/* The name is the first fact about each column — a copy's file,
                the candidate's release title. */}
            <tr>
              <td className="px-3 py-2.5 text-[11px] tracking-widest uppercase opacity-45">
                File
              </td>
              {copies.map((copy) => (
                <td
                  key={copy.path}
                  className="px-3 py-2.5 font-mono text-xs break-all opacity-70"
                >
                  {copy.fileName}
                </td>
              ))}
              {hit && (
                <td className="px-3 py-2.5 font-mono text-xs break-all opacity-70">
                  {hit.title}
                </td>
              )}
            </tr>

            {rows.map((r) => (
              <tr key={r.label}>
                <td
                  className={`px-3 py-2.5 text-[11px] tracking-widest uppercase ${
                    r.same && !r.predicted ? "opacity-30" : "opacity-45"
                  }`}
                >
                  {r.label}
                </td>
                {r.values.map((value, i) => (
                  <td
                    key={i}
                    className={`px-3 py-2.5 ${r.scored ? "font-score" : ""} ${
                      r.same && !r.predicted
                        ? "opacity-40"
                        : r.best?.includes(i)
                          ? "font-medium text-emerald-700 dark:text-emerald-300"
                          : r.best
                            ? "opacity-60"
                            : ""
                    }`}
                  >
                    {value}
                    {r.deltas?.[i] != null && <Delta value={r.deltas[i]} />}
                  </td>
                ))}
                {hit && (
                  <td
                    className={`px-3 py-2.5 ${r.scored ? "font-score" : ""} ${
                      r.predicted === undefined ? "opacity-25" : "opacity-80"
                    }`}
                  >
                    {r.predicted ?? "—"}
                    {r.predicted !== undefined && r.predictedDelta != null && (
                      <Delta value={r.predictedDelta} />
                    )}
                  </td>
                )}
              </tr>
            ))}

            {/* What to do once the table has been read: fetch the candidate.
                Last, because acting comes after comparing. */}
            {hit && (
              <tr>
                <td className="px-3 py-3" />
                {copies.map((copy) => (
                  <td key={copy.path} className="px-3 py-3" />
                ))}
                <td className="px-3 py-3">
                  {hit.magnet ? (
                    <a
                      href={hit.magnet}
                      title={hit.magnet}
                      className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-1.5 text-sm text-background transition-opacity hover:opacity-90"
                    >
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
                        <path d="M12 4v11" />
                        <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
                        <path d="M5 19h14" />
                      </svg>
                      Download
                    </a>
                  ) : hit.detailsUrl ? (
                    <a
                      href={hit.detailsUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-1.5 text-sm text-background transition-opacity hover:opacity-90"
                    >
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
                      Details
                    </a>
                  ) : null}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

        <p className="text-xs opacity-45">
          Rows where every copy agrees are dimmed. Green marks the better value
        where one is meaningfully better — file size is shown without a winner,
        since a larger file is not automatically the better copy.
        {hit &&
          " The predicted column is read off the release's name, never measured, so most rows have nothing to say until the file is on the drive and scanned."}{" "}
          Nothing here deletes anything; removing a file is left to you.
        </p>
      </div>
    </main>
  );
}
