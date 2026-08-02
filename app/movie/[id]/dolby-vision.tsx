"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import {
  beginConvert,
  beginFullDoviScan,
  convertJobStatus,
  doviJobStatus,
  refreshAfterDoviScan,
  discardBackup,
  restoreOriginal,
  stopConvert,
  stopFullDoviScan,
} from "@/app/actions";
import type { ConvertJob } from "@/lib/convert";
import {
  BACKUP_SUFFIX,
  RPU_COVERAGE_TOLERANCE,
  classifyEnhancementLayer,
  type DoviScan,
  type ElVerdict,
  type Hdr10Static,
} from "@/lib/derive";
import type { DoviJob } from "@/lib/dovi";

/**
 * What is inside the Dolby Vision stream, and for a Profile 7 file the one
 * question that follows from it: convert to 8.1, or keep it as it is?
 *
 * Ordered as that question is answered — the verdict first, the measurement it
 * rests on directly beneath it, and the rest of the metadata below as reference.
 * The RPU is described in level numbers (L1, L5, L6) that mean nothing to anyone
 * who has not read the spec, so each row is named for what it is and carries its
 * level quietly.
 */

/**
 * Explicit locale, not the ambient one: Node here defaults to a lakh grouping
 * that renders 148,008 frames as "1,48,008", and the server and the browser
 * need to agree on the string anyway or hydration complains.
 */
const count = (n: number) => n.toLocaleString("en-GB");

const nits = (n: number) => (n >= 1 ? count(Math.round(n)) : n);

/** Same two-tier form the library list and the title block use. */
const size = (bytes: number) =>
  bytes >= 1e12
    ? `${(bytes / 1e12).toFixed(2)} TB`
    : `${(bytes / 1e9).toFixed(1)} GB`;

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

/**
 * Stated in the same terms dovi_convert uses, so the two agree on a film. What
 * decides it for a FEL is whether the Dolby Vision grade peaks above what the
 * base layer holds — brightness the enhancement layer is reconstructing, and
 * that a conversion would therefore clip.
 */
function verdictFor(
  scan: DoviScan | undefined,
  el: ElVerdict | undefined,
  dvProfile?: number,
) {
  if (dvProfile !== 7) return undefined;

  if (!scan || !el) {
    return {
      tone: "neutral" as const,
      headline: "Not read yet",
      body: "Read this film's stream to find out whether its enhancement layer carries picture data.",
    };
  }

  if (el.kind === "mel") {
    return {
      tone: "ok" as const,
      headline: "Safe to convert",
      body: "This is a minimum enhancement layer — it carries no picture data. Discarding it loses nothing.",
    };
  }

  if (el.kind === "complex-fel") {
    return {
      tone: "danger" as const,
      headline: "Keep Profile 7 — converting would clip the highlights",
      body: "The enhancement layer is reconstructing brightness the base layer does not hold. Discarding it clips those highlights, and the tone mapping below them was authored for the two layers combined.",
    };
  }

  if (el.kind === "simple-fel") {
    return el.provisional
      ? {
          tone: "neutral" as const,
          headline: "No brightness expansion so far",
          body: `The grade stays inside the base layer across the ${count(scan.frames)} frames read. A sample only proves what it saw, though — read every frame to settle it.`,
        }
      : {
          tone: "ok" as const,
          headline: "Safe to convert",
          body: "The enhancement layer carries data, but the grade stays inside the base layer — it refines the picture rather than reconstructing brightness. Converting costs that refinement and nothing structural.",
        };
  }

  return {
    tone: "neutral" as const,
    headline: "Enhancement layer type unknown",
    body: "dovi_tool reported no EL type for this stream, so there is nothing to say about what a conversion would cost.",
  };
}

const TONES = {
  ok: "border-emerald-500/40 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-300",
  danger: "border-red-500/40 bg-red-500/[0.06] text-red-700 dark:text-red-300",
  neutral: "border-line bg-surface-strong",
};

/**
 * Every confirmation in this section, in one shape.
 *
 * These all commit to something long or irreversible, and asking inside the
 * card meant the question appeared wherever the card happened to be — sometimes
 * below the fold, and always by pushing the rest of the section around. A
 * dialog asks in one place and puts the page back exactly as it was.
 *
 * Same portal-and-backdrop construction as the score breakdown, so the two
 * behave alike: click outside or press Escape to dismiss.
 */
function ConfirmModal({
  title,
  confirmLabel,
  tone = "neutral",
  busy,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  confirmLabel: string;
  tone?: "neutral" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTarget(document.body);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Not while the work is already under way — there is nothing to take back
      // by then, and dismissing would only hide it.
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  if (!target) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-6"
      onClick={() => !busy && onCancel()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-md flex-col gap-3 rounded-card border border-line bg-background p-6 shadow-2xl"
      >
        <h2 className="text-base font-semibold">{title}</h2>
        <div className="text-sm opacity-70">{children}</div>

        <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-control border border-line px-3 py-1.5 text-sm hover:bg-surface-strong disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            autoFocus
            className={
              tone === "danger"
                ? "rounded-control border border-red-500/40 bg-red-500/[0.10] px-3 py-1.5 text-sm text-red-700 hover:bg-red-500/20 disabled:opacity-40 dark:text-red-300"
                : "rounded-control bg-foreground px-3 py-1.5 text-sm text-background hover:opacity-90 disabled:opacity-40"
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    target,
  );
}

/**
 * One ratio against a limit, so a meter rather than a chart: the grade's peak
 * measured against the ceiling the base layer declares for itself. Everything
 * past the marker is brightness that only exists in the enhancement layer.
 *
 * Both fills clear contrast and the lightness band in light and dark alike, so
 * the mode does not change them. The state is never carried by colour alone —
 * the verdict above says it, and the caption below repeats it in nits.
 */
function BrightnessMeter({ el }: { el: ElVerdict }) {
  if (el.elPeak === undefined) return null;

  const over = el.kind === "complex-fel";
  // Headroom past the taller of the two so the fill never runs to the edge and
  // the limit marker always has somewhere to sit.
  const domain = Math.max(el.elPeak, el.blPeak) * 1.12;
  const pct = (n: number) => `${Math.min(100, (n / domain) * 100)}%`;
  const difference = Math.abs(Math.round(el.elPeak - el.blPeak));

  return (
    <figure
      className="flex flex-col gap-2"
      title={`Dolby Vision grade ${nits(el.elPeak)} nits · base layer ${nits(el.blPeak)} nits`}
    >
      <figcaption className="flex items-baseline justify-between gap-4">
        <span className="text-xs opacity-60">Dolby Vision grade peaks at</span>
        <span className="text-base font-semibold">{nits(el.elPeak)} nits</span>
      </figcaption>

      <div className="relative h-2.5">
        <div className="absolute inset-0 rounded-r-[4px] bg-foreground/[0.08]" />
        <div
          className={`absolute inset-y-0 left-0 rounded-r-[4px] ${
            over ? "bg-red-600" : "bg-emerald-600"
          }`}
          style={{ width: pct(el.elPeak) }}
        />
        {/* The limit. Drawn over the fill, with a surface-coloured gap so it
            reads as a boundary rather than as part of the bar. */}
        <div
          className="absolute inset-y-[-3px] w-0.5 bg-foreground/70 ring-2 ring-surface"
          style={{ left: pct(el.blPeak) }}
        />
      </div>

      <p className="text-xs opacity-60">
        Base layer holds {nits(el.blPeak)} nits
        {el.blPeakAssumed && " (assumed)"} ·{" "}
        <span className="opacity-100">
          {over
            ? `${count(difference)} nits above it, carried only by the enhancement layer`
            : `the grade stays ${count(difference)} nits inside it`}
        </span>
      </p>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// The metadata, grouped
// ---------------------------------------------------------------------------

type Row = { label: string; level?: string; value: string; note?: string };

function groupsFor(scan: DoviScan, hdr10?: Hdr10Static) {
  const stream: Row[] = [
    {
      label: "Profile",
      value: scan.profile
        ? `${scan.profile}${
            scan.elType === "MEL"
              ? " · minimum enhancement layer"
              : scan.elType === "FEL"
                ? " · full enhancement layer"
                : ""
          }`
        : "unknown",
    },
  ];
  if (scan.cmVersion) {
    stream.push({ label: "Metadata version", value: scan.cmVersion });
  }
  if (scan.scenes !== undefined) {
    stream.push({ label: "Scene changes", value: count(scan.scenes) });
  }
  if (scan.hdr10plus) {
    stream.push({ label: "HDR10+", value: "also present in this stream" });
  }

  const brightness: Row[] = [];
  if (scan.mastering) {
    brightness.push({
      label: "Graded on a display of",
      value: `${scan.mastering.min} – ${nits(scan.mastering.max)} nits`,
    });
  }
  if (scan.l1) {
    brightness.push({
      label: "Brightest frame",
      level: "L1",
      value: `${nits(scan.l1.maxCll)} nits · ${nits(scan.l1.maxFall)} nits frame-average`,
      note: scan.depth === "head" ? "sampled" : undefined,
    });
  }
  if (hdr10) {
    const parts = [
      hdr10.masteringMax !== undefined
        ? `${hdr10.masteringMin ?? 0} – ${nits(hdr10.masteringMax)} nits`
        : null,
      hdr10.maxCll !== undefined ? `MaxCLL ${nits(hdr10.maxCll)} nits` : null,
      hdr10.maxFall !== undefined ? `MaxFALL ${nits(hdr10.maxFall)} nits` : null,
    ].filter(Boolean);
    if (parts.length) {
      brightness.push({ label: "Base layer", value: parts.join(" · ") });
    }
  }
  if (scan.l6) {
    brightness.push({
      label: "Fallback metadata",
      level: "L6",
      value: `MaxCLL ${nits(scan.l6.maxCll)} nits · MaxFALL ${nits(scan.l6.maxFall)} nits`,
    });
  }

  const grading: Row[] = [];
  if (scan.l5) {
    const { top, bottom, left, right } = scan.l5;
    grading.push({
      label: "Letterbox bars",
      level: "L5",
      value:
        top || bottom || left || right
          ? [
              top && `${top}px top`,
              bottom && `${bottom}px bottom`,
              left && `${left}px left`,
              right && `${right}px right`,
            ]
              .filter(Boolean)
              .join(" · ")
          : "none — full frame",
    });
  }
  if (scan.l2Trims?.length) {
    grading.push({
      label: "Display trims",
      level: "L2",
      value: `${scan.l2Trims.map((t) => count(t)).join(" · ")} nits`,
    });
  }
  if (scan.l8Trims?.length) {
    grading.push({
      label: "Display trims",
      level: "L8",
      value: `${scan.l8Trims.map((t) => count(t)).join(" · ")} nits`,
    });
  }
  if (scan.l9) {
    grading.push({ label: "Mastering primaries", level: "L9", value: scan.l9 });
  }
  if (scan.l11) {
    grading.push({ label: "Content type", level: "L11", value: scan.l11 });
  }

  return [
    { title: "The stream", rows: stream },
    { title: "Brightness", rows: brightness },
    { title: "Framing and grading", rows: grading },
  ].filter((g) => g.rows.length > 0);
}

function Metadata({ scan, hdr10 }: { scan: DoviScan; hdr10?: Hdr10Static }) {
  return (
    // Far more space between groups than between a heading and the rows it
    // belongs to, so each heading reads as belonging to what follows it.
    <div className="flex flex-col gap-9">
      {groupsFor(scan, hdr10).map((group) => (
        <div key={group.title} className="flex flex-col gap-1.5">
          <h3 className="text-[11px] tracking-widest uppercase opacity-40">
            {group.title}
          </h3>
          <dl className="divide-y divide-line">
            {group.rows.map((row) => (
              <div
                key={`${row.label}${row.level ?? ""}`}
                className="grid grid-cols-[11rem_1fr] items-baseline gap-4 py-1.5 first:pt-0 last:pb-0"
              >
                <dt className="text-sm opacity-55">
                  {row.label}
                  {row.level && (
                    <span className="ml-1.5 font-mono text-[10px] opacity-50">
                      {row.level}
                    </span>
                  )}
                </dt>
                <dd className="text-sm tabular-nums">
                  {row.value}
                  {row.note && (
                    <span className="ml-2 rounded-chip px-1.5 text-[10px] leading-[16px] opacity-45 ring-1 ring-inset ring-line">
                      {row.note}
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

/**
 * A full pass parses one RPU per frame, so the count is a coverage check: a
 * film whose RPU stops partway converts into something that loses Dolby Vision
 * halfway through, and nothing else here would reveal it.
 */
function coverage(scan: DoviScan, durationSec?: number, frameRate?: number) {
  if (scan.depth !== "full" || !durationSec || !frameRate) return undefined;

  const expected = Math.round(durationSec * frameRate);
  if (expected <= 0) return undefined;

  return scan.frames / expected >= RPU_COVERAGE_TOLERANCE
    ? { ok: true, text: `every frame carries an RPU` }
    : {
        ok: false,
        text: `only ${count(scan.frames)} of about ${count(expected)} frames carry an RPU — Dolby Vision would drop out partway through a converted file`,
      };
}

// ---------------------------------------------------------------------------

export function DolbyVision({
  moviePath,
  fileName,
  dvProfile,
  durationSec,
  frameRate,
  scan,
  hdr10,
  backupBytes,
}: {
  moviePath: string;
  fileName: string;
  dvProfile?: number;
  durationSec?: number;
  frameRate?: number;
  scan?: DoviScan;
  hdr10?: Hdr10Static;
  /** Size of the pre-conversion original, when one is still sitting beside it. */
  backupBytes?: number;
}) {
  const [job, setJob] = useState<DoviJob | null>(null);
  const [convert, setConvert] = useState<ConvertJob | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmingRestore, setConfirmingRestore] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const router = useRouter();

  const running = job?.status === "running" && job.path === moviePath;
  const converting =
    convert?.status === "running" && convert.path === moviePath;

  // Either job outlives the page that started it, so adopt one already running
  // for this film rather than looking idle until it is clicked again.
  useEffect(() => {
    void doviJobStatus().then((current) => {
      if (current.status === "running" && current.path === moviePath) {
        setJob(current);
      }
    });
    void convertJobStatus().then((current) => {
      if (current.status === "running" && current.path === moviePath) {
        setConvert(current);
      }
    });
  }, [moviePath]);

  useEffect(() => {
    if (!converting) return;

    const id = setInterval(async () => {
      const next = await convertJobStatus();
      setConvert(next);

      if (next.status === "done") {
        // The job re-probes and re-derives the rewritten file itself, so the
        // page only needs repainting.
        await refreshAfterDoviScan();
        router.refresh();
      } else if (next.status === "error") {
        setError(next.error ?? "Conversion failed");
      }
    }, 1000);

    return () => clearInterval(id);
  }, [converting, router]);

  useEffect(() => {
    if (!running) return;

    const id = setInterval(async () => {
      const next = await doviJobStatus();
      setJob(next);

      if (next.status === "done") {
        // The reading is stored against the probe; this is what folds it into
        // the derived row the page is rendered from.
        await refreshAfterDoviScan();
        router.refresh();
      } else if (next.status === "error") {
        setError(next.error ?? "Full pass failed");
      }
    }, 700);

    return () => clearInterval(id);
  }, [running, router]);

  async function start() {
    setError(null);
    const result = await beginFullDoviScan(moviePath);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setJob({ status: "running", path: moviePath, percent: 0, frames: 0 });
  }

  const el = classifyEnhancementLayer(scan, hdr10);
  const verdict = verdictFor(scan, el, dvProfile);
  const cover = scan ? coverage(scan, durationSec, frameRate) : undefined;

  // Written out rather than run: this rewrites a 90 GB file, and choosing where
  // that lands is not a decision an audit tool should be making for you.
  const q = (s: string) => JSON.stringify(s);
  const dir = moviePath.replace(/\/[^/]+$/, "");
  const out = fileName.replace(/\.[^.]+$/, "");

  const recipes = [
    {
      id: "dovi_convert",
      title: "With dovi_convert",
      // Deliberately without --force, even on a film this page is advising
      // against converting: the tool runs the same brightness check and will
      // refuse on its own, which is a second opinion worth having.
      blurb:
        "Runs the same brightness check itself and refuses a complex FEL unless you add --force. Backs up the enhancement layer first; -o writes elsewhere.",
      install: "brew install dovi_convert",
      command: [`cd ${q(dir)}`, ``, `dovi_convert convert ${q(fileName)}`].join(
        "\n",
      ),
    },
    {
      id: "dovi_tool",
      title: "By hand, with dovi_tool",
      blurb:
        "The same two steps, run yourself. Writes a new file beside the original — nothing is overwritten.",
      command: [
        `cd ${q(dir)}`,
        ``,
        `# 1. base layer + converted RPU, enhancement layer discarded`,
        `ffmpeg -i ${q(fileName)} -map 0:v:0 -c copy -f hevc - \\`,
        `  | dovi_tool -m 2 convert --discard -o ${q(`${out}.p8.hevc`)} -`,
        ``,
        `# 2. put it back in a container, keeping every other track`,
        `mkvmerge -o ${q(`${out}.P8.mkv`)} ${q(`${out}.p8.hevc`)} -D ${q(fileName)}`,
      ].join("\n"),
    },
  ];

  async function runConvert() {
    setError(null);
    setConfirming(false);
    const result = await beginConvert(moviePath);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setConvert({ status: "running", path: moviePath, step: 1, steps: 3 });
  }

  async function runRestore() {
    setError(null);
    setRestoring(true);
    const result = await restoreOriginal(moviePath);
    setRestoring(false);
    setConfirmingRestore(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function runDeleteBackup() {
    setError(null);
    setRestoring(true);
    const result = await discardBackup(moviePath);
    setRestoring(false);
    setConfirmingDelete(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function copy(id: string, command: string) {
    await navigator.clipboard.writeText(command);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <section className="mt-10 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-medium tracking-wide uppercase opacity-50">
          Dolby Vision
        </h2>
        {scan?.profile && (
          <span className="text-[11px] opacity-40">
            Profile {scan.profile}
            {scan.elType && ` · ${scan.elType}`}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-5 rounded-card border border-line bg-surface p-5">
        {verdict && (
          <div className="flex flex-col gap-4">
            <div className={`rounded-control border p-4 ${TONES[verdict.tone]}`}>
              <p className="text-sm font-medium">{verdict.headline}</p>
              <p className="mt-1 text-sm opacity-80">{verdict.body}</p>
            </div>
            {/* The evidence, directly beneath the claim but outside the tinted
                box: the fill carries the state, the numbers stay in plain ink
                where they are legible. Only a FEL needs it — a MEL is safe
                whatever the brightness figures say. */}
            {el && el.kind !== "mel" && <BrightnessMeter el={el} />}
          </div>
        )}

        {scan ? (
          <Metadata scan={scan} hdr10={hdr10} />
        ) : (
          <p className="text-sm opacity-50">
            This film&rsquo;s RPU has not been read yet.
          </p>
        )}

        {/* Shown whatever the film's profile now is: after a conversion it is
            Profile 8, and that is exactly when going back matters. */}
        {backupBytes !== undefined && !converting && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-line p-4">
            <p className="text-xs opacity-45">
              This file was converted. The original is still here as{" "}
              <code className="font-mono">
                {fileName}
                {BACKUP_SUFFIX}
              </code>
              , holding {size(backupBytes)}.
            </p>
            <div className="flex shrink-0 items-center gap-2">
              {/* Same shape as its neighbour so the two read as a pair, but
                  carrying its colour, and only warming up on hover — the
                  dialog behind it is where the red belongs. */}
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="rounded-control border border-line px-3 py-1.5 text-sm text-red-700 transition-colors hover:border-red-500/40 hover:bg-red-500/[0.08] dark:text-red-300"
              >
                Delete backup
              </button>
              <button
                type="button"
                onClick={() => setConfirmingRestore(true)}
                className="rounded-control border border-line px-3 py-1.5 text-sm hover:bg-surface-strong"
              >
                Restore original
              </button>
            </div>

            {confirmingRestore && (
              <ConfirmModal
                title="Put the original Profile 7 file back?"
                confirmLabel={restoring ? "Restoring…" : "Restore original"}
                busy={restoring}
                onConfirm={runRestore}
                onCancel={() => setConfirmingRestore(false)}
              >
                The converted Profile 8.1 file is deleted and{" "}
                <code className="font-mono text-xs">
                  {fileName}
                  {BACKUP_SUFFIX}
                </code>{" "}
                takes its place under the original name. You can always convert
                again — nothing about it is lost by going back.
              </ConfirmModal>
            )}

            {confirmingDelete && (
              <ConfirmModal
                title="Delete the original Profile 7 file?"
                confirmLabel={
                  restoring ? "Deleting…" : `Delete ${size(backupBytes)}`
                }
                tone="danger"
                busy={restoring}
                onConfirm={runDeleteBackup}
                onCancel={() => setConfirmingDelete(false)}
              >
                Frees {size(backupBytes)}, and the Profile 8.1 file becomes the
                only copy. This is the one step here that cannot be undone —
                after it, going back to Profile 7 means ripping the disc again.
              </ConfirmModal>
            )}
          </div>
        )}

        {dvProfile === 7 && el?.kind !== "complex-fel" && backupBytes === undefined && (
          <div className="flex flex-col gap-3 rounded-control border border-line p-4">
            {converting ? (
              <>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-medium">
                    Converting to Profile 8.1…
                  </p>
                  <div className="flex items-baseline gap-3">
                    <p className="text-xs tabular-nums opacity-45">
                      {convert?.percent !== undefined &&
                        `${Math.round(convert.percent)}% · `}
                      step {convert?.step ?? 1} of {convert?.steps ?? 4}
                    </p>
                    <button
                      type="button"
                      onClick={async () => setConvert(await stopConvert())}
                      className="text-xs underline underline-offset-4 opacity-50 hover:opacity-100"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
                <p className="text-xs opacity-45">
                  {convert?.label ?? "Working"} — this rewrites the whole file,
                  so it takes a while. Leaving this page will not stop it.
                </p>
                <div className="h-1 overflow-hidden rounded-full bg-surface-strong">
                  <div
                    className="h-full rounded-full bg-foreground/70 transition-[width] duration-500"
                    style={{
                      // Bytes written when they can be counted; otherwise the
                      // step is the only thing there is to show.
                      width: `${
                        convert?.percent ??
                        ((convert?.step ?? 1) / (convert?.steps ?? 3)) * 100
                      }%`,
                    }}
                  />
                </div>
              </>
            ) : convert?.status === "done" && convert.path === moviePath ? (
              <div className="flex flex-col gap-1">
                <p className="text-sm text-emerald-600 dark:text-emerald-400">
                  Converted to Profile 8.1
                  {convert.summary &&
                    ` — ${convert.summary} of enhancement layer discarded`}
                  {convert.check && `, ${convert.check}`}.
                </p>
                <p className="text-xs opacity-45">
                  The original is beside it as{" "}
                  <code className="font-mono">
                    {fileName}
                    {BACKUP_SUFFIX}
                  </code>
                  .
                </p>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs opacity-45">
                  Hand this to dovi_convert, which keeps the original and
                  verifies the result.
                </p>
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  disabled={running}
                  className="shrink-0 rounded-control border border-line px-3 py-1.5 text-sm hover:bg-surface-strong disabled:opacity-40"
                >
                  Convert to Profile 8.1
                </button>

                {confirming && (
                  <ConfirmModal
                    title="Rewrite this file as Profile 8.1?"
                    confirmLabel="Convert"
                    onConfirm={runConvert}
                    onCancel={() => setConfirming(false)}
                  >
                    <ul className="list-disc space-y-1.5 pl-5">
                      <li>
                        The converted file takes this one&rsquo;s place; the
                        original is renamed to{" "}
                        <code className="font-mono text-xs">
                          {fileName}
                          {BACKUP_SUFFIX}
                        </code>{" "}
                        and left beside it, so it needs room for both.
                      </li>
                      <li>
                        Any secondary video track — picture-in-picture
                        commentary, multi-angle — is dropped. Audio and
                        subtitles are kept.
                      </li>
                      <li>
                        It rewrites the whole file, so it takes a while. You can
                        cancel at any point without touching the original.
                      </li>
                    </ul>
                  </ConfirmModal>
                )}
              </div>
            )}
          </div>
        )}

        {dvProfile === 7 && (
          <details className="group rounded-control border border-line">
            <summary className="cursor-pointer list-none px-4 py-2.5 text-sm select-none hover:bg-surface-strong">
              <span className="mr-2 inline-block opacity-40 transition-transform group-open:rotate-90">
                ›
              </span>
              {el?.kind === "complex-fel"
                ? "Convert it anyway, by hand"
                : "Run it yourself instead"}
            </summary>
            <div className="flex flex-col gap-6 border-t border-line p-4">
              {recipes.map((recipe) => (
                <div key={recipe.id} className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-sm font-medium">{recipe.title}</h3>
                    <button
                      type="button"
                      onClick={() => copy(recipe.id, recipe.command)}
                      className="shrink-0 rounded-control border border-line px-2.5 py-1 text-xs hover:bg-surface-strong"
                    >
                      {copied === recipe.id ? "✓ Copied" : "Copy"}
                    </button>
                  </div>
                  <p className="text-xs opacity-45">{recipe.blurb}</p>
                  <pre className="overflow-x-auto rounded-control border border-line bg-surface-strong p-3 font-mono text-[11px] leading-relaxed">
                    {recipe.command}
                  </pre>
                  {recipe.install && (
                    <p className="text-xs opacity-40">
                      Not installed?{" "}
                      <code className="font-mono">{recipe.install}</code>
                    </p>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}

        {/* How much of the film these numbers describe, next to the control
            that changes it. */}
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs opacity-45">
              {running
                ? // What the file said before this pass is no longer the point;
                  // where the pass has got to is.
                  `Reading every frame — ${Math.round(job?.percent ?? 0)}% · ${count(job?.frames ?? 0)} frames`
                : !scan
                  ? "Not read yet."
                  : scan.depth === "full"
                    ? `Read in full — ${count(scan.frames)} frames${cover ? `, ${cover.text}` : ""}.`
                    : `Read from the first ${count(scan.frames)} frames. A full pass measures the real peak and confirms every frame carries an RPU.`}
            </p>
            <div className="flex shrink-0 items-center gap-3">
              {running && (
                <button
                  type="button"
                  onClick={async () => setJob(await stopFullDoviScan())}
                  className="text-xs underline underline-offset-4 opacity-50 hover:opacity-100"
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                onClick={start}
                disabled={running || converting}
                className="rounded-control border border-line px-3 py-1.5 text-sm hover:bg-surface-strong disabled:opacity-40"
              >
                {running
                  ? "Reading every frame…"
                  : scan?.depth === "full"
                    ? "Read again"
                    : "Read every frame"}
              </button>
            </div>
          </div>

          {cover && !cover.ok && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              {cover.text}
            </p>
          )}

          {running && (
            <div className="h-1 overflow-hidden rounded-full bg-surface-strong">
              <div
                className="h-full rounded-full bg-foreground/70 transition-[width] duration-300"
                style={{ width: `${job?.percent ?? 0}%` }}
              />
            </div>
          )}

          {error && (
            <p className="font-mono text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
