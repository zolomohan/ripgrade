import Link from "next/link";
import { notFound } from "next/navigation";

import { findDuplicateGroup, type LibraryItem } from "@/lib/library";
import { artUrl, decodeId, movieId } from "@/lib/routes";

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

type Row = {
  label: string;
  values: string[];
  /** Column indices holding the best value, when one is meaningfully better. */
  best?: number[];
  /** True when every copy agrees — rendered quietly so differences stand out. */
  same: boolean;
};

/** Marks the columns whose score is highest, unless everything ties. */
function rank(scores: (number | undefined)[]): number[] | undefined {
  const known = scores.filter((s): s is number => s !== undefined);
  if (known.length < 2) return undefined;

  const top = Math.max(...known);
  if (known.every((s) => s === top)) return undefined;
  return scores.flatMap((s, i) => (s === top ? [i] : []));
}

function buildRows(copies: LibraryItem[]): Row[] {
  const row = (
    label: string,
    render: (m: LibraryItem) => string,
    score?: (m: LibraryItem) => number | undefined,
  ): Row => {
    const values = copies.map(render);
    return {
      label,
      values,
      best: score ? rank(copies.map(score)) : undefined,
      same: new Set(values).size === 1,
    };
  };

  const bestAudio = (m: LibraryItem) =>
    m.audio.find((a) => a.atmos || a.dtsx) ??
    m.audio.find((a) => a.lossless) ??
    m.audio[0];

  return [
    row(
      "Overall score",
      (m) => String(m.scores.overall),
      (m) => m.scores.overall,
    ),
    row(
      "Video score",
      (m) => String(m.scores.video),
      (m) => m.scores.video,
    ),
    row(
      "Audio score",
      (m) => String(m.scores.audio),
      (m) => m.scores.audio,
    ),
    row(
      "Release score",
      (m) => String(m.scores.release),
      (m) => m.scores.release,
    ),
    row("Status", (m) => m.status),
    row(
      "Resolution",
      (m) => `${m.width ?? "?"}×${m.height ?? "?"} (${m.resolution})`,
      (m) => RESOLUTION_RANK[m.resolution],
    ),
    row("Codec", (m) => m.videoCodec ?? "unknown"),
    row(
      "Bit depth",
      (m) => (m.bitDepth ? `${m.bitDepth}-bit` : "unknown"),
      (m) => m.bitDepth,
    ),
    row(
      "Dynamic range",
      (m) =>
        m.hdr === "Dolby Vision"
          ? `Dolby Vision P${m.dvProfile ?? "?"}`
          : m.hdr,
      (m) => HDR_RANK[m.hdr],
    ),
    row(
      "Video bitrate",
      (m) =>
        m.videoBitrateKbps
          ? `${m.videoBitrateKbps.toLocaleString()} kbps`
          : "unknown",
      (m) => m.videoBitrateKbps,
    ),
    row(
      "Bitrate density",
      (m) => (m.bpp ? `${m.bpp.toFixed(3)} bpp` : "unknown"),
      (m) => m.bpp,
    ),
    row(
      "Release type",
      (m) => m.releaseType,
      (m) => RELEASE_RANK[m.releaseType],
    ),
    row("Encoder", (m) => m.encoder ?? "none (stream copied)"),
    row("Best audio", (m) => bestAudio(m)?.label ?? "none"),
    row(
      "Audio channels",
      (m) =>
        bestAudio(m)?.channels ? `${bestAudio(m)!.channels}ch` : "unknown",
      (m) => bestAudio(m)?.channels,
    ),
    row(
      "Object audio",
      (m) =>
        m.audio.some((a) => a.atmos)
          ? "Dolby Atmos"
          : m.audio.some((a) => a.dtsx)
            ? "DTS:X"
            : "none",
      (m) => (m.audio.some((a) => a.atmos || a.dtsx) ? 1 : 0),
    ),
    row(
      "Lossless audio",
      (m) => (m.audio.some((a) => a.lossless) ? "yes" : "no"),
      (m) => (m.audio.some((a) => a.lossless) ? 1 : 0),
    ),
    row(
      "Audio tracks",
      (m) => String(m.audio.length),
      (m) => m.audio.length,
    ),
    row(
      "Subtitles",
      (m) =>
        m.subtitleLanguages.length ? m.subtitleLanguages.join(", ") : "none",
      (m) => m.subtitleLanguages.length,
    ),
    row("Runtime", (m) => runtime(m.durationSec)),
    // Bigger is not automatically better, so this is reported without a winner.
    row("File size", (m) => bytes(m.sizeBytes)),
    row(
      "Issues",
      (m) =>
        m.issues.length ? m.issues.map((i) => i.code).join(", ") : "none",
      (m) => -m.issues.length,
    ),
    row("Edition", (m) => m.edition ?? "—"),
    row("Folder", (m) => m.folder),
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
  if (!copies || copies.length < 2) notFound();

  const [keep, ...drop] = copies;
  const reclaim = drop.reduce((sum, m) => sum + m.sizeBytes, 0);
  const rows = buildRows(copies);
  const differences = rows.filter((r) => !r.same).length;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8 sm:px-8">
      <div className="flex flex-col gap-2">
        <Link href="/" className="text-sm opacity-60 hover:opacity-100">
          ← Library
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          {keep.title}
          {keep.year && (
            <span className="ml-2 font-normal opacity-40">{keep.year}</span>
          )}
        </h1>
        <p className="text-sm opacity-60">
          {copies.length} copies · {differences} of {rows.length} attributes
          differ
        </p>
      </div>

      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3">
        <p className="text-sm">
          <span className="font-medium text-emerald-700 dark:text-emerald-300">
            Keep {keep.releaseType} · score {keep.scores.overall}
          </span>{" "}
          — deleting the {drop.length === 1 ? "other copy" : "other copies"}{" "}
          reclaims <span className="font-medium">{bytes(reclaim)}</span>.
        </p>
        <p className="mt-1 font-mono text-xs opacity-60">{keep.fileName}</p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-black/15 dark:border-white/15">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-black/10 dark:border-white/10">
            <tr>
              <th className="w-44 px-4 py-3 text-[11px] font-medium tracking-widest uppercase opacity-45">
                Attribute
              </th>
              {copies.map((copy, i) => (
                <th key={copy.path} className="px-4 py-3 align-top">
                  <div className="flex items-start gap-3">
                    {copy.poster ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={artUrl(copy.poster)}
                        alt=""
                        className="h-16 w-11 shrink-0 rounded object-cover ring-1 ring-black/10 dark:ring-white/10"
                      />
                    ) : (
                      <span className="h-16 w-11 shrink-0 rounded bg-black/[0.06] dark:bg-white/[0.08]" />
                    )}
                    <span className="min-w-0">
                      <span
                        className={`block text-[11px] font-semibold tracking-widest uppercase ${
                          i === 0
                            ? "text-emerald-700 dark:text-emerald-300"
                            : "opacity-45"
                        }`}
                      >
                        {i === 0 ? "Keep" : "Drop"}
                      </span>
                      <Link
                        href={`/movie/${movieId(copy.path)}`}
                        className="mt-0.5 block text-xs font-normal break-all opacity-70 hover:opacity-100"
                      >
                        {copy.fileName}
                      </Link>
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.label}
                className="border-b border-black/5 last:border-0 dark:border-white/5"
              >
                <td
                  className={`px-4 py-2 text-xs ${r.same ? "opacity-35" : "opacity-60"}`}
                >
                  {r.label}
                </td>
                {r.values.map((value, i) => (
                  <td
                    key={i}
                    className={`px-4 py-2 ${
                      r.same
                        ? "opacity-45"
                        : r.best?.includes(i)
                          ? "font-medium text-emerald-700 dark:text-emerald-300"
                          : r.best
                            ? "opacity-60"
                            : ""
                    }`}
                  >
                    {value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs opacity-45">
        Rows where every copy agrees are dimmed. Green marks the better value
        where one is meaningfully better — file size is shown without a winner,
        since a larger file is not automatically the better copy. Nothing here
        deletes anything; removing a file is left to you.
      </p>
    </main>
  );
}
