"use client";

import { useRouter } from "next/navigation";

import { Panel } from "@/app/panel";
import { useEffect, useRef, useState } from "react";

import {
  beginConvert,
  beginFullDoviScan,
  beginRebuildProfile7,
  refreshAfterDoviScan,
  discardBackup,
  discardEnhancementLayer,
  restoreOriginal,
  stopConvert,
  stopFullDoviScan,
} from "@/app/actions";
import { useJobs } from "@/app/jobs-provider";
import {
  BACKUP_SUFFIX,
  RPU_COVERAGE_TOLERANCE,
  classifyEnhancementLayer,
  elArchiveNameOf,
  type DoviScan,
  type ElVerdict,
  type Hdr10Static,
} from "@/lib/derive";
import { CloseButton, Modal, useClosing } from "@/app/modal";
import { BUTTON } from "@/app/controls";
import { ConfirmModal } from "@/app/confirm";

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
 * A headline, the reasoning kept for a tooltip, and a line under it only where
 * one adds something. "Keep Profile 7" needs no elaborating: what it would cost
 * to ignore it is measured on the meter directly below.
 */
type Verdict = {
  tone: "ok" | "danger" | "neutral";
  headline: string;
  body?: React.ReactNode;
  detail?: string;
};

/**
 * Stated in the same terms dovi_convert uses, so the two agree on a film. What
 * decides it for a FEL is whether the Dolby Vision grade peaks above what the
 * base layer holds — brightness the enhancement layer is reconstructing, and
 * that a conversion would therefore clip.
 *
 * A line to read and a paragraph to hover: the verdict is the answer, and the
 * reasoning behind it is worth keeping but not worth reading twice.
 */
function verdictFor(
  scan: DoviScan | undefined,
  el: ElVerdict | undefined,
  dvProfile?: number,
): Verdict {
  // Profile 8 is what a conversion produces, so on one of those the question
  // this section exists to answer is already answered.
  if (dvProfile !== 7) {
    return {
      tone: "neutral",
      headline: "Nothing to convert",
      body: "Only Profile 7 carries an enhancement layer to discard.",
    };
  }

  if (!scan || !el) {
    return {
      tone: "neutral" as const,
      headline: "Not read yet",
      body: "Read the stream to see what its enhancement layer carries.",
    };
  }

  if (el.kind === "mel") {
    return {
      tone: "ok" as const,
      headline: "Safe to convert",
      detail:
        "This is a minimum enhancement layer — it carries no picture data, so discarding it loses nothing.",
    };
  }

  if (el.kind === "complex-fel") {
    return {
      tone: "danger" as const,
      headline: "Keep Profile 7",
      detail:
        "The enhancement layer is reconstructing brightness the base layer does not hold. Discarding it clips those highlights, and the tone mapping below them was authored for the two layers combined.",
    };
  }

  if (el.kind === "simple-fel") {
    return el.provisional
      ? {
          tone: "neutral" as const,
          headline: "No brightness expansion so far",
          body: "Check every frame to settle it.",
          detail: `The grade stays inside the base layer across the ${count(scan.frames)} frames read, but a sample only proves what it saw.`,
        }
      : {
          tone: "ok" as const,
          headline: "Safe to convert",
          detail:
            "The enhancement layer carries data, but it refines the picture rather than reconstructing brightness. Converting costs that refinement and nothing structural.",
        };
  }

  return {
    tone: "neutral" as const,
    headline: "Enhancement layer type unknown",
    body: "dovi_tool reported no EL type for this stream.",
    detail:
      "Without an EL type there is nothing to say about what a conversion would cost.",
  };
}

/**
 * One file the conversion left beside the film: what it is, what it is called,
 * and what it costs.
 *
 * These were sentences — "Original kept as
 * 1917.2019.UHD.BluRay.2160p.TrueHD.Atmos.7.1.DV.HEVC.REMUX-FraMeSToR.mkv.bak.dovi_convert,
 * 74.0 GB. Enhancement layer kept too, 6.5 GB." — and a release name is ninety
 * characters with no space in it, so the prose wrapped around a block of
 * monospace and the two figures anyone actually came for ended up on different
 * lines of it. They are a table: two kept files, three facts each, and the
 * question they answer is which of them is worth the room.
 *
 * The name is cut rather than wrapped, and carries the whole of itself on its
 * hover. It is the least of the three: the film is named at the top of the page
 * and both of these are that name with a suffix — what tells them apart is the
 * word on the left, which is why that is what leads.
 */
function KeptFile({
  label,
  name,
  bytes,
}: {
  label: string;
  name: string;
  /** Undefined with the drive away: the file is known of but cannot be sized. */
  bytes?: number;
}) {
  return (
    // Spans throughout: this goes inside the verdict's own paragraph, and a
    // block element in a `<p>` is markup the browser silently rewrites.
    <span className="flex items-baseline gap-3">
      <span className="w-32 shrink-0">{label}</span>
      {/* Cut at the front, or these two rows are the same sixty characters
          twice — see `.cut-start`. The `bdi` is what keeps the right-to-left
          context to the cut instead of letting it reach the text. */}
      <span
        className="cut-start min-w-0 flex-1 truncate font-mono text-xs"
        title={name}
      >
        <bdi>{name}</bdi>
      </span>
      <span className="shrink-0 font-medium tabular-nums">
        {bytes !== undefined ? size(bytes) : "—"}
      </span>
    </span>
  );
}

type Recipe = {
  id: string;
  title: string;
  blurb: string;
  /** How to get the tool, where it is not something you would already have. */
  install?: string;
  command: string;
};

/**
 * The same conversion, written out to run yourself.
 *
 * It was a fold at the foot of the card, which put a screen of shell script
 * between the verdict and everything below it for anyone who opened it and
 * left it open. As a dialog it is asked for and then put away, and the card
 * keeps its height either way — and the commands get the width they want
 * rather than the width the card had left over.
 */
function RecipesModal({
  open,
  onClose,
  title,
  lede,
  recipes,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  lede: string;
  recipes: Recipe[];
}) {
  // Which command was last copied, so the button can say so. Lives here
  // because nothing outside this dialog has ever needed to know.
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(recipe: Recipe) {
    await navigator.clipboard.writeText(recipe.command);
    setCopied(recipe.id);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      label={title}
      panelClassName="flex max-h-[min(85vh,46rem)] w-full max-w-2xl flex-col overflow-hidden glass-panel rounded-card border border-line shadow-2xl"
    >
      <>
        <header className="flex shrink-0 items-start justify-between gap-4 px-6 pt-6 pb-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mt-1 text-sm opacity-60">{lede}</p>
          </div>
          <CloseButton onClick={onClose} />
        </header>

        {/* The floor the title stands on. Outside the scrolling column, so the
            recipes pass under it rather than past it. */}
        <div aria-hidden className="rule-head mx-6 mb-4 shrink-0" />

        <div className="flex flex-col gap-6 overflow-y-auto px-6 pb-6">
          {recipes.map((recipe) => (
            <div key={recipe.id} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-medium">{recipe.title}</h3>
                <button
                  type="button"
                  onClick={() => copy(recipe)}
                  className={BUTTON.small}
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
      </>
    </Modal>
  );
}

/**
 * One ratio against a limit, so a meter rather than a chart: the grade's peak
 * measured against the ceiling the base layer declares for itself. Everything
 * past the marker is brightness that only exists in the enhancement layer.
 *
 * Red only when the grade overruns the base layer; the safe fill is plain ink,
 * because a bar that clears its limit has nothing to announce. The state is
 * never carried by colour alone — the verdict above says it, and the caption
 * below repeats it in nits.
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
            over ? "bg-red-600" : "bg-foreground/55"
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

      <p
        className="text-xs opacity-60"
        title={
          over
            ? "Those nits exist only in the enhancement layer — a conversion clips them."
            : "The enhancement layer adds no brightness the base layer cannot reach."
        }
      >
        Base layer holds {nits(el.blPeak)} nits
        {el.blPeakAssumed && " (assumed)"} ·{" "}
        <span className="opacity-100">
          {count(difference)} nits {over ? "above it" : "inside it"}
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
      hdr10.maxFall !== undefined
        ? `MaxFALL ${nits(hdr10.maxFall)} nits`
        : null,
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
  elArchiveBytes,
  keepingEl = false,
  present = true,
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
  /**
   * Size of the enhancement layer a conversion kept aside, when one was kept.
   * The whole of what a Profile 7 rebuild has to work from once the original
   * has been deleted.
   */
  elArchiveBytes?: number;
  /** Whether a conversion started from here would keep that layer. */
  keepingEl?: boolean;
  /**
   * Whether the film itself could be found. False means its drive is away —
   * which is also why `backupBytes` is undefined, so without this the card
   * would read an unreachable converted film as an unconverted one.
   */
  present?: boolean;
}) {
  const { jobs, apply, subscribe } = useJobs();
  const { dovi: job, convert } = jobs;
  const [confirming, setConfirming] = useState(false);
  const [confirmingRestore, setConfirmingRestore] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingRebuild, setConfirmingRebuild] = useState(false);
  const [confirmingDiscardEl, setConfirmingDiscardEl] = useState(false);
  const [confirmingStop, setConfirmingStop] = useState(false);
  // Each confirm outlives its flag by the length of its exit animation.
  const convertMounted = useClosing(confirming);
  const restoreMounted = useClosing(confirmingRestore);
  const deleteMounted = useClosing(confirmingDelete);
  const rebuildMounted = useClosing(confirmingRebuild);
  const discardElMounted = useClosing(confirmingDiscardEl);
  const stopMounted = useClosing(confirmingStop);
  const [restoring, setRestoring] = useState(false);
  /** Set between asking the job to stop and it having stopped. */
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRecipes, setShowRecipes] = useState(false);
  const router = useRouter();

  // A conversion that has not reached the conversion yet: the full pass is
  // running as its first step. Held in a ref as well as in state because the
  // job subscription has to see it without resubscribing every time it moves.
  const [readingToConvert, setReadingToConvert] = useState(false);
  const wantsConvert = useRef(false);
  const intend = (want: boolean) => {
    wantsConvert.current = want;
    setReadingToConvert(want);
  };

  // Both jobs arrive over the job stream, which also covers a job that
  // outlived the page that started it: the connect-time snapshot already
  // carries anything running for this film.
  const running = job.status === "running" && job.path === moviePath;
  const converting = convert.status === "running" && convert.path === moviePath;

  // React only to the edge out of a run we saw on this film — `subscribe`
  // explains why the status alone cannot mean "just finished". Without the
  // edge, opening this page after an old failure would show its error as if
  // it had just happened.
  useEffect(
    () =>
      subscribe((next, prev) => {
        const wasConverting =
          prev.convert.status === "running" && prev.convert.path === moviePath;
        if (wasConverting) {
          if (next.convert.status === "done") {
            // The job re-probes and re-derives the rewritten file itself, so
            // the page only needs repainting.
            void refreshAfterDoviScan().then(() => router.refresh());
          } else if (next.convert.status === "error") {
            setError(next.convert.error ?? "Conversion failed");
          }
        }

        /**
         * The pass this page is waiting on, and — the half that was missing —
         * whether it has actually ended.
         *
         * The listener runs on every event, not only on the ones that end
         * something: a pass pushes progress several times a second, and every
         * one of those has a previous snapshot that was running too. Without
         * the second test the first progress line of a read counted as the
         * read stopping, and the branch below cleared the intent to convert
         * that the button had just set — so a card that said Convert read
         * every frame and then did nothing.
         *
         * Named endings rather than "no longer running", because idle is not
         * an ending: a snapshot already in flight when the pass started says
         * idle, and lands here just after the optimistic running one.
         */
        const ended =
          next.dovi.status === "done" ||
          next.dovi.status === "error" ||
          next.dovi.status === "cancelled";
        const wasReading =
          prev.dovi.status === "running" &&
          prev.dovi.path === moviePath &&
          ended;
        if (wasReading) {
          if (next.dovi.status === "done") {
            // The reading is stored against the probe; this is what folds it
            // into the derived row the page is rendered from.
            void refreshAfterDoviScan().then(async () => {
              router.refresh();
              if (!wantsConvert.current) return;
              // The second half of a conversion that began with a read. The
              // server re-checks the verdict against what the pass just wrote,
              // so a film that turns out to be a complex FEL is refused here
              // rather than converted on a promise made by a sample.
              intend(false);
              const result = await beginConvert(moviePath);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              apply({ convert: result.job });
            });
          } else {
            // Failed, or cancelled: either way the conversion it was the first
            // step of is off.
            intend(false);
            if (next.dovi.status === "error") {
              setError(next.dovi.error ?? "Full pass failed");
            }
          }
        }
      }),
    [subscribe, moviePath, router, apply],
  );

  async function start() {
    setError(null);
    const result = await beginFullDoviScan(moviePath);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    apply({
      dovi: { status: "running", path: moviePath, percent: 0, frames: 0 },
    });
  }

  const el = classifyEnhancementLayer(scan, hdr10);
  const verdict = verdictFor(scan, el, dvProfile);
  const cover = scan ? coverage(scan, durationSec, frameRate) : undefined;

  // Written out rather than run: this rewrites a 90 GB file, and choosing where
  // that lands is not a decision an audit tool should be making for you.
  const q = (s: string) => JSON.stringify(s);
  const dir = moviePath.replace(/\/[^/]+$/, "");
  const out = fileName.replace(/\.[^.]+$/, "");

  /**
   * On a converted film with its layer kept, the only rewrite left to describe
   * is the one back — so the recipes are that, and the conversion's are not
   * printed at all. Both halves are dovi_convert's own commands: the archive
   * is its format, and reading it back by hand means unpacking a tar and
   * driving dovi_tool through four steps.
   */
  const rebuildRecipes: Recipe[] = [
    {
      id: "restore",
      title: "With dovi_convert",
      blurb: `Reads ${elArchiveNameOf(fileName)} beside the film and writes ${out}.restored.mkv. The converted file is left where it is.`,
      install: "brew install dovi_convert",
      command: [`cd ${q(dir)}`, ``, `dovi_convert restore ${q(fileName)}`].join(
        "\n",
      ),
    },
    {
      id: "restore-by-hand",
      title: "By hand, with dovi_tool",
      blurb:
        "The same four steps. The archive is an uncompressed tar holding one file, so tar reads it.",
      command: [
        `cd ${q(dir)}`,
        ``,
        `# 1. base layer out of the converted file, without its 8.1 RPU`,
        `ffmpeg -i ${q(fileName)} -map 0:v:0 -c copy -f hevc ${q(`${out}.bl.hevc`)}`,
        `dovi_tool remove ${q(`${out}.bl.hevc`)} -o ${q(`${out}.bl-clean.hevc`)}`,
        ``,
        `# 2. the enhancement layer back out of the archive`,
        `tar -xf ${q(elArchiveNameOf(fileName))} el.hevc`,
        ``,
        `# 3. interleave the two layers again`,
        `dovi_tool mux --bl ${q(`${out}.bl-clean.hevc`)} --el el.hevc \\`,
        `  -o ${q(`${out}.p7.hevc`)}`,
        ``,
        `# 4. back into a container, keeping every other track`,
        `mkvmerge -o ${q(`${out}.P7.mkv`)} ${q(`${out}.p7.hevc`)} --no-video ${q(fileName)}`,
      ].join("\n"),
    },
  ];

  const convertRecipes: Recipe[] = [
    {
      id: "dovi_convert",
      title: "With dovi_convert",
      // Deliberately without --force, even on a film this page is advising
      // against converting: the tool runs the same brightness check and will
      // refuse on its own, which is a second opinion worth having.
      blurb:
        "Keeps the original, and refuses a complex FEL unless you add --force. Add --backup to keep the enhancement layer as well, in an archive small enough to live with once the original is gone.",
      install: "brew install dovi_convert",
      command: [`cd ${q(dir)}`, ``, `dovi_convert convert ${q(fileName)}`].join(
        "\n",
      ),
    },
    {
      id: "dovi_tool",
      title: "By hand, with dovi_tool",
      blurb: "The same two steps, run yourself. Nothing is overwritten.",
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

  /**
   * Reads every frame first, when every frame has not been read.
   *
   * Only reachable now on a film whose verdict the pass cannot change — a MEL,
   * which the `gate` above explains. There the read is a step of converting
   * rather than a decision to come back for, so it stays folded in here and the
   * subscription starts the conversion when it lands. Anything whose answer the
   * pass could still overturn is sent to the check instead.
   */
  async function runConvert() {
    setError(null);
    setConfirming(false);

    if (scan?.depth !== "full") {
      const started = await beginFullDoviScan(moviePath);
      if (!started.ok) {
        setError(started.error);
        return;
      }
      intend(true);
      apply({
        dovi: { status: "running", path: moviePath, percent: 0, frames: 0 },
      });
      return;
    }

    const result = await beginConvert(moviePath);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    apply({ convert: result.job });
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

  /**
   * The long way back: no original to rename, so the film is built again from
   * the layer that was kept. A job rather than an action, and followed the
   * same way the conversion is.
   */
  async function runRebuild() {
    setError(null);
    setConfirmingRebuild(false);
    const result = await beginRebuildProfile7(moviePath);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    apply({ convert: result.job });
  }

  /**
   * Stops whichever pass is running.
   *
   * One function for both, because the card asks one question: the read that
   * precedes a conversion is a step of it, so stopping there has to put the
   * intention down as well, or the conversion would start the moment the read
   * it was waiting on reported itself finished.
   */
  async function runStop() {
    setStopping(true);
    intend(false);
    if (converting) {
      apply({ convert: await stopConvert() });
    } else {
      apply({ dovi: await stopFullDoviScan() });
    }
    setStopping(false);
    setConfirmingStop(false);
  }

  async function runDiscardEl() {
    setError(null);
    setRestoring(true);
    const result = await discardEnhancementLayer(moviePath);
    setRestoring(false);
    setConfirmingDiscardEl(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  // -------------------------------------------------------------------------
  // What the console says, and what it offers to do about it
  // -------------------------------------------------------------------------

  const converted = backupBytes !== undefined;
  const justConverted =
    convert?.status === "done" && convert.path === moviePath;
  /**
   * Whether the enhancement layer is sitting beside the film, and whether
   * rebuilding from it is the thing to offer.
   *
   * Not on a film that is already Profile 7: after the original has been put
   * back the archive is a spare copy of a layer the file holds inline, and the
   * only thing worth offering about it is throwing it away.
   */
  const archive = elArchiveBytes !== undefined;
  const canRebuild = archive && dvProfile !== 7;

  /** Which set of commands "run it yourself" prints — see `manual` below. */
  const recipes = canRebuild ? rebuildRecipes : convertRecipes;
  /**
   * Whether there is an original to go back to. The filesystem is the authority
   * whenever it can be read; only with the drive away does the conversion this
   * server ran stand in for it, so an unplugged converted film still offers
   * restoring rather than falling back to offering a read.
   */
  const hasBackup = converted || (!present && justConverted);
  /**
   * Which of the two things a Profile 7 file has to offer: the conversion, or
   * the check that decides whether the conversion is on offer at all.
   *
   * Reading every frame is a step of converting a MEL — nothing the pass can
   * find changes the answer, so there is no decision to come back for and the
   * read stays folded inside the one button. On a FEL it *is* the decision: the
   * sample says "no expansion so far", and the full pass turns that into either
   * verdict. Offering that as a button labelled Convert promised a rewrite the
   * server then refused halfway through, which is what this splits apart. The
   * check is its own action, and the conversion appears once it has passed.
   */
  const gate: "convert" | "check" | "none" =
    dvProfile !== 7 || hasBackup || el?.kind === "complex-fel"
      ? "none"
      : el?.kind === "mel" || scan?.depth === "full"
        ? "convert"
        : "check";
  /** Set only when the drive is away, so it can override every other tooltip. */
  const offline = present ? undefined : "Drive not connected";
  // Reading and converting are one action now, so they are one busy state: the
  // pass that precedes a conversion is a step of it, not a separate job the
  // card has to narrate on its own.
  const busy = converting || running;
  /** The same job slot, going the other way — see `ConvertJob.mode`. */
  const rebuilding = converting && convert?.mode === "rebuild";
  const convertingNow = (converting && !rebuilding) || readingToConvert;

  /**
   * The question behind Cancel, and the answer to the only thing anyone hesitating
   * over it wants to know — what stopping costs, which is nothing.
   *
   * It was a line under the verdict, which is the one place on this card
   * reserved for what is true of the film rather than of the controls beside
   * it, and then a tooltip, which is not where a reassurance about pressing a
   * button belongs either: nobody hovers a button they have already decided
   * against. Asked at the moment of pressing, it is read.
   *
   * "Stopping" rather than "cancelling" now the sentence is inside a dialog
   * whose own dismiss button says Cancel — there, cancelling is what leaves the
   * job running, which is the opposite of what the sentence is about.
   */
  const stop = rebuilding
    ? {
        title: "Stop the rebuild?",
        note: "Stopping never touches the file that is there.",
      }
    : convertingNow
      ? {
          title: "Stop the conversion?",
          note: "Stopping never touches the original.",
        }
      : {
          title: gate === "check" ? "Stop the check?" : "Stop reading?",
          note: "Nothing is written by a read either way — the pass simply stops where it is.",
        };

  // A job that ends while the question is up takes the question with it: there
  // is nothing left to stop, and answering it would be answering about a job
  // that has already gone. Adjusted during render, the way the rail does it —
  // an effect would paint the stale frame first.
  if (confirmingStop && !busy) setConfirmingStop(false);

  /**
   * The one sentence at the top of the console. Whatever is happening to the
   * file outranks the verdict about it — mid-conversion, and afterwards while
   * the original is still recoverable, the state of the file *is* the answer
   * to "is this safe".
   */
  const banner: Verdict = rebuilding
    ? {
        tone: "neutral",
        headline: "Rebuilding Profile 7…",
        // What cancelling costs is on the Cancel button — see `stopNote`.
        detail:
          "The base layer comes out of the converted file, the kept enhancement layer goes back in beside it, and the two are remuxed with the film's own audio and subtitles. The Profile 8.1 file is replaced only once the result has been written in full and checked.",
      }
    : convertingNow
      ? {
          tone: "neutral",
          headline: "Converting to Profile 8.1…",
          detail: keepingEl
            ? "The enhancement layer is pulled out and kept first, then every frame is read, then the whole file is rewritten — so it takes a while. Leaving this page will not stop it."
            : "Every frame is read first, then the whole file is rewritten, so it takes a while. Leaving this page will not stop it.",
        }
      : // Any pass over this film outranks the verdict about it, whether or not
        // the pass could overturn one. It used to be only the check that did,
        // and the hole that left was the read half of a conversion started
        // somewhere else — the queue — which this page cannot tell from a plain
        // re-read: the card said "Safe to convert" in the middle of converting.
        running
        ? gate === "check"
          ? {
              tone: "neutral",
              headline: "Checking every frame…",
              body: "Nothing is written. The verdict below settles when it lands.",
              detail:
                "One RPU parsed per frame, measuring the peak the Dolby Vision grade actually reaches — which is what decides whether discarding the enhancement layer would clip anything.",
            }
          : {
              tone: "neutral",
              headline: "Reading every frame…",
              body: "Nothing is written.",
              detail:
                "One RPU parsed per frame, measuring what the stream carries across the whole film rather than across the sample the scan reads. A conversion started elsewhere reads the film this way first, so this is also what the first half of one looks like from here.",
            }
        : // An original beside the film says a conversion happened; the file's
          // own profile says whether it still is what happened. A rebuild run
          // while the original was kept leaves a Profile 7 file with a Profile
          // 7 original next to it — a state only the rebuild can produce, since
          // restoring takes the backup with it — and this is the sentence for
          // it. "Converted to Profile 8.1" over the top of that would be the
          // card describing the last thing it was asked to do rather than the
          // film in front of it.
          hasBackup && dvProfile === 7
          ? {
              tone: "ok",
              headline: "Rebuilt to Profile 7",
              body: (
                <>
                  This file is the rebuild — the original is the disc&rsquo;s
                  own bytes, where this one is those bytes taken apart and put
                  back together.
                  <span className="mt-2 flex flex-col gap-1 text-xs">
                    <KeptFile
                      label="Original"
                      name={`${fileName}${BACKUP_SUFFIX}`}
                      bytes={backupBytes}
                    />
                  </span>
                </>
              ),
              detail:
                "Restoring puts the original back under its own name and throws this rebuild away. Deleting it leaves the rebuild as the only Profile 7 copy.",
            }
          : hasBackup
            ? {
                tone: "ok",
                headline: "Converted to Profile 8.1",
                body: (
                  // Both, where both were kept: the original is the exact file
                  // and the archive is what survives deleting it, and anyone
                  // reclaiming space is about to need to know which is which —
                  // which is the other half of why these are rows now. Ordered
                  // as the buttons below are, and as they cost: the large one
                  // that can go, then the small one that buys the way back.
                  //
                  // No caption over them. "Kept beside this film" was a line of
                  // words introducing two rows that say what they are in their
                  // own first column, under a headline that has already said a
                  // conversion happened. The room it took is worth more empty.
                  <span className="mt-2 flex flex-col gap-1 text-xs">
                    <KeptFile
                      label="Original"
                      name={`${fileName}${BACKUP_SUFFIX}`}
                      bytes={backupBytes}
                    />
                    {archive && (
                      <KeptFile
                        label="Enhancement layer"
                        name={elArchiveNameOf(fileName)}
                        bytes={elArchiveBytes}
                      />
                    )}
                  </span>
                ),
                detail:
                  justConverted && convert?.summary
                    ? `${convert.summary} of enhancement layer discarded${convert.check ? `, ${convert.check}` : ""}.`
                    : undefined,
              }
            : // Converted, and the original gone — but the layer it discarded is
              // still here, which is the difference between a one-way conversion
              // and a reversible one.
              canRebuild && elArchiveBytes !== undefined
              ? {
                  tone: "ok",
                  headline: "Converted to Profile 8.1",
                  // The row and nothing else, as the state above it. What the
                  // kept layer is *for* is the rebuild, and the rebuild is a
                  // button four inches to the right saying so — a sentence
                  // explaining it was the card reading its own controls out.
                  body: (
                    <span className="mt-2 flex flex-col gap-1 text-xs">
                      <KeptFile
                        label="Enhancement layer"
                        name={elArchiveNameOf(fileName)}
                        bytes={elArchiveBytes}
                      />
                    </span>
                  ),
                  detail:
                    "The rebuild takes the base layer back out of this file, puts the kept layer beside it and remuxes the two. It costs the same hour the conversion did, and scratch space for a couple of copies of the video while it runs.",
                }
              : verdict;

  /**
   * Whether this film has a meter at all. Only a FEL does: a MEL carries no
   * picture data, so its brightness figures say nothing about what a conversion
   * would cost, and a stream with no measured peak has nothing to draw.
   */
  const hasMeter = Boolean(el && el.kind !== "mel" && el.elPeak !== undefined);

  /**
   * Whether it is showing, which is not the same question — the band stays in
   * the card and closes over it, so that it can open and shut rather than blink.
   *
   * The meter reads as a measurement of the film: a peak, a limit, and the
   * distance between them to a nit. Off a head scan it is a measurement of the
   * first few hundred frames drawn identically, and the figure moves once every
   * frame has been read — so it waits for the full pass. It also stands down
   * while any pass is running, because a number that is about to be replaced is
   * worse than no number, and while the file is being rewritten, because by
   * then it describes a film that is halfway to not existing.
   *
   * Which makes it the card's answer arriving: the meter opens when the read
   * that earned it finishes.
   */
  const showMeter = hasMeter && scan?.depth === "full" && !busy;

  /**
   * The way out of the card's own offer, kept beside it.
   *
   * A Profile 7 file has a conversion to print, and a converted one with its
   * layer kept has the rebuild — the two states where this card is offering to
   * rewrite a film, and so the two where the commands are worth having. On a
   * film this page is advising against converting the recipe is not an
   * alternative but a warning stepped past deliberately, and it says so.
   */
  const manual = (dvProfile === 7 || canRebuild) && (
    <button
      type="button"
      onClick={() => setShowRecipes(true)}
      title="Shows the commands. Nothing runs until you run it."
      className={BUTTON.text}
    >
      {canRebuild
        ? "Rebuild it yourself instead"
        : el?.kind === "complex-fel"
          ? "Convert it anyway, by hand"
          : "Run it yourself instead"}
    </button>
  );

  /**
   * Throwing the kept layer away.
   *
   * Beside the rebuild, and in the same weight as it: the two are the whole of
   * what this state can do about the layer, and they are the two directions —
   * spend it, or give it up. Not red, though what it does cannot be undone. The
   * red on this card is reserved for deleting the original, which is the one
   * step that costs a film its exact bytes; this costs the *option* of Profile
   * 7, and the dialog behind it is where that is spelled out and confirmed.
   */
  const discardLayer = canRebuild && !hasBackup && (
    <button
      type="button"
      onClick={() => setConfirmingDiscardEl(true)}
      disabled={!present}
      title={
        offline ??
        `Frees ${elArchiveBytes !== undefined ? size(elArchiveBytes) : "the space"}, and gives up going back to Profile 7 for good.`
      }
      className={BUTTON.secondary}
    >
      Discard layer
    </button>
  );

  /**
   * The rebuild, wherever the layer to rebuild from is still on the drive.
   *
   * Written once and used in both converted states, because it is one action
   * and the two states differ only in what else is on offer beside it. What the
   * tooltip says does differ: with the original still there, this is the long
   * way round to a file that is already sitting next to this one, and a button
   * that does not say so is a button that costs an hour to learn from.
   */
  const rebuildAction = canRebuild && (
    <button
      type="button"
      onClick={() => setConfirmingRebuild(true)}
      disabled={!present}
      title={
        offline ??
        (hasBackup
          ? "Builds Profile 7 again out of the kept layer. The original beside this film is the same answer in two renames — this is for when you would rather have the rebuild than the file it came from."
          : "Puts the enhancement layer back and makes the film Profile 7 again. About as long as the conversion took.")
      }
      className={BUTTON.secondary}
    >
      Rebuild Profile 7
    </button>
  );

  /**
   * What this state can do about the file, in one row.
   *
   * Before a conversion there is one decision and the card has one button:
   * convert while there is something to convert, and read the stream when the
   * verdict is not settled enough to offer that.
   *
   * Afterwards there are as many ways back as the conversion left behind, and
   * the card used to show only the first it found — a film that kept both its
   * original *and* its enhancement layer offered the two the original allows
   * and hid the rebuild until the original had been deleted, which is exactly
   * backwards: the rebuild is the thing you want to know works *before* you
   * throw the original away. So each way back is offered whenever the thing it
   * needs is still on the drive.
   *
   * Grouped by what each one is about rather than strung out in a row: the two
   * that answer for the backup stand together, and the rebuild — which is about
   * the kept layer and would still be there with no backup at all — stands
   * apart behind a hairline. Three buttons in an even row read as three degrees
   * of the same decision, which two of them are and the third is not.
   *
   * Within the pair, the irreversible one leads: it is furthest from where the
   * pointer comes to rest at the end of the row, and the quickest and most
   * exact way back is the one under it.
   *
   * Every one of them reaches the file itself, so with the drive away they all
   * go grey together. Still shown rather than hidden: an unplugged drive is a
   * temporary state, and a card that drops its buttons reads as one that never
   * had any.
   */
  const actions = hasBackup ? (
    <>
      <button
        type="button"
        onClick={() => setConfirmingDelete(true)}
        disabled={!present}
        title={
          offline ??
          `Frees ${backupBytes !== undefined ? size(backupBytes) : "the space"} — the one step here that cannot be undone.`
        }
        className={BUTTON.danger}
      >
        Delete backup
      </button>
      <button
        type="button"
        onClick={() => setConfirmingRestore(true)}
        disabled={!present}
        title={
          offline ??
          "Puts the Profile 7 file back under its own name. You can always convert again."
        }
        className={BUTTON.secondary}
      >
        Restore backup
      </button>

      {/* Parted rather than spaced: the two buttons on the left answer for the
          file kept beside this one, and the one on the right answers for the
          layer inside it. A gap alone does not say so.

          `rule-l` is the app's own rule stood on its end — fading out at both
          ends, the way every hairline here does — carried on a wrapper rather
          than on the button, so it stands off the button's edge instead of
          being ruled against it.

          Room either side, and the same room: a rule set closer to one button
          than the other belongs to that button rather than to the join. The
          left is the row's own `gap-2` and this margin together, which is what
          the padding on the right has to match. */}
      {rebuildAction && (
        <span className="rule-l ml-2 flex items-center pl-4">
          {rebuildAction}
        </span>
      )}
    </>
  ) : canRebuild ? (
    // The two things that can be done with a kept layer, in the order they
    // cost: give it up, or spend it. No hairline between them — the rule above
    // parts two subjects, and these are one.
    <>
      {discardLayer}
      {rebuildAction}
    </>
  ) : gate === "convert" ? (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      disabled={!present}
      title={
        offline ??
        (scan?.depth === "full"
          ? "Rewrites the file, keeping the original beside it."
          : "Reads every frame first, then rewrites the file.")
      }
      className={BUTTON.primary}
    >
      Convert to Profile 8.1
    </button>
  ) : (
    // The check and the plain re-read are the same pass. They are one button
    // because they are one piece of work; only what the reader is waiting to
    // learn from it differs, so only the label does.
    <button
      type="button"
      onClick={start}
      disabled={!present}
      title={
        offline ??
        (gate === "check"
          ? "Reads every frame and settles the verdict. Nothing is written, and the conversion is offered here if it passes."
          : "Parses one RPU per frame — slower, but it measures the real peak.")
      }
      className={gate === "check" || !scan ? BUTTON.primary : BUTTON.secondary}
    >
      {gate === "check"
        ? "Check if it can be converted"
        : scan?.depth === "full"
          ? "Read again"
          : "Read every frame"}
    </button>
  );

  return (
    // Open when there is something to answer — a verdict here is the reason
    // the section exists, and a folded verdict is one nobody reads.
    <Panel
      title="Dolby Vision"
      // What the stream is, not what to do about it: the verdict is a sentence,
      // and a sentence on a shut row is a paragraph pretending to be a summary.
      summary={
        scan
          ? [`Profile ${scan.profile ?? dvProfile ?? "?"}`, scan.elType]
              .filter(Boolean)
              .join(" · ")
          : "Not read yet"
      }
      open={verdict.tone === "danger"}
    >
      <div className="flex flex-col gap-10">
        {/* One console, in bands parted by the hairline the rest of the app
            parts its sections with: the verdict, the measurement it rests on,
            and every action that follows from it. The answer and the button
            that acts on the answer can no longer end up at opposite ends of a
            long section.

            Rounder than a card: at this size the corner is what tells you the
            bands inside are one object rather than a stack of them. */}
        <div className="overflow-hidden rounded-3xl border border-line">
          {/* The verdict and the button that acts on it, on one line.

              More room above the sentence than under it: it is the first thing
              in the card and the only band with an edge rather than a hairline
              over it, and a rounded corner needs answering with space or the
              text reads as having been pushed up against it. */}
          <div className="card-band flex flex-wrap items-center justify-between gap-3 px-4 pt-6 pb-5">
            {/* The reasoning hangs off the sentence as a tooltip: it is worth
                keeping and not worth reading every time the page opens.

                `flex-1` so the column reaches the far edge of the band: the
                kept files below are a table, and its last column is a set of
                sizes that have to end where the buttons under them do. Left to
                its content width the block stopped wherever the longest line
                of prose stopped, which put the figures in a different place on
                every film. */}
            <div
              className="flex min-w-0 flex-1 flex-col gap-0.5"
              title={banner.detail}
            >
              <p className="text-sm font-medium">{banner.headline}</p>
              {banner.body && (
                <p className="text-sm opacity-60">{banner.body}</p>
              )}
            </div>

            {/* Beside the verdict while there is one button and a short
                sentence to sit next to. A film that can be put back has
                neither — two buttons, and a line carrying the full filename of
                whatever it would be put back from — so there it takes a band
                of its own below. */}
            {!busy && !hasBackup && !canRebuild && (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {/* Leftmost, so the row reads as the alternative and then the
                    thing itself, and the primary button still ends the line. */}
                {manual}
                {actions}
              </div>
            )}

            {/* Where the card's buttons are when it has any: stopping is the
                one thing on offer while a pass is running, so it stands in the
                same place the offer it interrupted stood in — and the readings
                lead into it from the left, exactly as the manual alternative
                leads into the primary button on the row this replaces.

                Every reading the job has, in the order they answer "how far
                along": the fraction, whatever it has actually written where
                that is the figure moving, what it is doing this second, and
                the step that is in. The step name used to head the block as a
                line of its own, which set the one changing word of it a column
                away from the numbers it changes with. */}
            {busy && (
              <div className="flex shrink-0 items-center gap-3">
                <p className="text-xs tabular-nums opacity-45">
                  {converting
                    ? [
                        convert?.percent !== undefined &&
                          `${Math.round(convert.percent)}%`,
                        convert?.readout,
                        convert?.label ??
                          (rebuilding ? "Rebuilding Profile 7" : undefined),
                        `step ${convert?.step ?? 1} of ${convert?.steps ?? 3}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : `${Math.round(job?.percent ?? 0)}% · ${count(job?.frames ?? 0)} frames`}
                </p>
                <button
                  type="button"
                  onClick={() => setConfirmingStop(true)}
                  className={BUTTON.secondary}
                >
                  Cancel
                </button>
              </div>
            )}

            {/* One bar for both jobs, in the band the sentence it is measuring
                is in. Which of the two is running is a detail of how the work
                is done; what is being waited for is the same thing throughout,
                and it was never a separate section — parted off behind a
                hairline, the bar read as a second subject rather than as the
                state of the line above it.

                `w-full` is what puts it on its own line of the wrapping row,
                under both the headline and the readings. */}
            {busy && (
              <div className="bar-track bar-track-thin w-full">
                <div
                  className="bar-fill transition-[width] duration-500"
                  style={{
                    // Bytes written when they can be counted; otherwise the
                    // step is the only thing there is to show.
                    width: `${
                      converting
                        ? (convert?.percent ??
                          ((convert?.step ?? 1) / (convert?.steps ?? 3)) * 100)
                        : (job?.percent ?? 0)
                    }%`,
                  }}
                />
              </div>
            )}
          </div>

          {!busy && (hasBackup || canRebuild) && (
            /* The two ends of the band, not a huddle at the right: what the
               card will do sits where the buttons sit everywhere else, and the
               way out of its offer is ranged against the other edge — it is
               not one more button in the row, and packed in beside them it
               read as the first of four. `ml-auto` rather than
               `justify-between`, so the buttons stay right when there is no
               link beside them to be spaced against. */
            <div className="card-band flex flex-wrap items-center gap-3 px-4 py-5">
              {manual}
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {actions}
              </div>
            </div>
          )}

          {/* The evidence, directly beneath the claim: only a FEL needs it — a
              MEL is safe whatever the brightness figures say.

              The band is the thing that opens and shuts, so it is the band
              that carries `card-band`: hung on the inner element instead, the
              wrapper would sit between two bands and take the hairline that
              parts them with it. */}
          {hasMeter && el && (
            <div
              className={`card-band band-reveal ${showMeter ? "" : "is-shut"}`}
              // Shut, it is not absent — it is a section of the card that is
              // not being claimed at the moment, and reading a stale peak out
              // of a closed band is worse than not reaching it at all.
              aria-hidden={!showMeter}
            >
              {/* Three deep, and it has to be: the middle element is the one
                  clipped to the closing row, and padding on a clipped element
                  survives the close — `border-box` takes the height to zero
                  and leaves the two ends of the padding standing, which is a
                  band that shuts to forty pixels of nothing. So the padding
                  goes inside it, where there is nothing left to hold open. */}
              <div>
                <div className="px-4 py-5">
                  <BrightnessMeter el={el} />
                </div>
              </div>
            </div>
          )}

          {/* Its own band rather than a line under the verdict: a film whose
              RPU stops partway is a different problem from the one the verdict
              is answering. */}
          {cover && !cover.ok && (
            <div className="card-band px-4 py-5">
              <p className="text-sm text-amber-600 dark:text-amber-400">
                {cover.text}
              </p>
            </div>
          )}

          {/* A Profile 7 file with an archive beside it: the film was
              converted, restored from its original, and the layer that was
              kept for the conversion outlived it. Worth a sentence rather than
              silence — it is several gigabytes of something this file already
              holds — and worth keeping, because converting again reuses it
              instead of spending another pass extracting it. */}
          {!busy && archive && !canRebuild && !hasBackup && (
            <div className="card-band flex flex-wrap items-center justify-between gap-3 px-4 pb-5 pt-3">
              <p className="max-w-prose text-sm opacity-60">
                An earlier conversion&rsquo;s enhancement layer is still kept as{" "}
                <code className="font-mono">{elArchiveNameOf(fileName)}</code>,{" "}
                {elArchiveBytes !== undefined && size(elArchiveBytes)}. This
                file carries that layer itself — the archive only saves the
                extraction if you convert again.
              </p>
              <button
                type="button"
                onClick={() => setConfirmingDiscardEl(true)}
                disabled={!present}
                className={BUTTON.text}
              >
                Discard layer
              </button>
            </div>
          )}

          {error && (
            <div className="card-band px-4 py-5">
              <p className="font-mono text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            </div>
          )}
        </div>

        {scan && <Metadata scan={scan} hdr10={hdr10} />}

        {/* No mount gate: it reads props and runs nothing, so `Modal` playing
            itself out is the whole of what has to be kept alive. */}
        <RecipesModal
          open={showRecipes}
          onClose={() => setShowRecipes(false)}
          title={
            canRebuild
              ? "Rebuild it yourself"
              : el?.kind === "complex-fel"
                ? "Convert it anyway, by hand"
                : "Run it yourself"
          }
          lede={
            canRebuild
              ? "The same rebuild, on your own machine. Nothing here touches the file until you run it."
              : el?.kind === "complex-fel"
                ? "This film is the one case the card advises against converting — the enhancement layer is holding brightness the base layer cannot. The commands are here anyway."
                : "The same conversion, on your own machine. Nothing here touches the file until you run it."
          }
          recipes={recipes}
        />

        {convertMounted && (
          <ConfirmModal
            open={confirming}
            title="Rewrite this file as Profile 8.1?"
            confirmLabel="Convert"
            onConfirm={runConvert}
            onCancel={() => setConfirming(false)}
          >
            <ul className="list-disc space-y-1.5 pl-5">
              {scan?.depth !== "full" && (
                <li>
                  Every frame is read first, so the conversion is decided on the
                  whole film rather than on a sample of it.
                </li>
              )}
              <li>
                The original is renamed to{" "}
                <code className="font-mono text-xs">
                  {fileName}
                  {BACKUP_SUFFIX}
                </code>{" "}
                and kept beside it, so this needs room for both.
              </li>
              {keepingEl && (
                <li>
                  The enhancement layer is pulled out into{" "}
                  <code className="font-mono text-xs">
                    {elArchiveNameOf(fileName)}
                  </code>{" "}
                  first — a pass over the whole film before the conversion
                  starts, and the one thing that survives deleting the original.
                </li>
              )}
              <li>
                Secondary video tracks are dropped. Audio and subtitles are
                kept.
              </li>
              <li>
                It rewrites the whole file. Cancelling at any point leaves the
                original untouched.
              </li>
            </ul>
          </ConfirmModal>
        )}

        {restoreMounted && (
          <ConfirmModal
            open={confirmingRestore}
            title="Put the original Profile 7 file back?"
            confirmLabel={restoring ? "Restoring…" : "Restore backup"}
            busy={restoring}
            onConfirm={runRestore}
            onCancel={() => setConfirmingRestore(false)}
          >
            The Profile 8.1 file is deleted and{" "}
            <code className="font-mono text-xs">
              {fileName}
              {BACKUP_SUFFIX}
            </code>{" "}
            takes its place under the original name. You can always convert
            again.
          </ConfirmModal>
        )}

        {deleteMounted && backupBytes !== undefined && (
          <ConfirmModal
            open={confirmingDelete}
            title="Delete the original Profile 7 file?"
            confirmLabel={
              restoring ? "Deleting…" : `Delete ${size(backupBytes)}`
            }
            tone="danger"
            busy={restoring}
            onConfirm={runDeleteBackup}
            onCancel={() => setConfirmingDelete(false)}
          >
            Frees {size(backupBytes)} and leaves the Profile 8.1 file as the
            only copy.{" "}
            {archive && elArchiveBytes !== undefined ? (
              <>
                The enhancement layer stays where it is, so the Profile 7 file
                can still be rebuilt from it — an hour&rsquo;s work rather than
                two renames.
              </>
            ) : (
              <>
                Going back to Profile 7 after this means ripping the disc again.
              </>
            )}
          </ConfirmModal>
        )}

        {rebuildMounted && (
          <ConfirmModal
            open={confirmingRebuild}
            title="Put this film back to Profile 7?"
            confirmLabel="Rebuild"
            onConfirm={runRebuild}
            onCancel={() => setConfirmingRebuild(false)}
          >
            <ul className="list-disc space-y-1.5 pl-5">
              {/* First, because it is the one thing that might make the rest
                  not worth reading: with the original still on the drive this
                  is an hour spent reaching a reconstruction of a file that is
                  already there, and the reason to do it anyway is to see that
                  it works while the file it replaces is still recoverable. */}
              {hasBackup && (
                <li>
                  The Profile 7 original is still kept beside this film, and
                  restoring that is the same film back in seconds. This builds
                  it again from the kept layer instead — worth it to see the
                  rebuild work before the original goes, and not otherwise.
                </li>
              )}
              <li>
                The base layer comes back out of this file, the layer kept in{" "}
                <code className="font-mono text-xs">
                  {elArchiveNameOf(fileName)}
                </code>{" "}
                goes back beside it, and the two are remuxed with the
                film&rsquo;s own audio, subtitles and chapters.
              </li>
              {hasBackup && (
                <li>
                  The original is left exactly where it is — the rebuilt file
                  takes this one&rsquo;s place, and you will have both.
                </li>
              )}
              <li>
                It needs scratch space for a couple of copies of the video while
                it runs — the conversion&rsquo;s scratch folder, if one is set.
              </li>
              <li>
                The Profile 8.1 file is replaced only once the rebuild has been
                written in full and its runtime checked. Cancelling at any point
                leaves it untouched.
              </li>
            </ul>
          </ConfirmModal>
        )}

        {discardElMounted && elArchiveBytes !== undefined && (
          <ConfirmModal
            open={confirmingDiscardEl}
            title="Delete the kept enhancement layer?"
            confirmLabel={
              restoring ? "Deleting…" : `Delete ${size(elArchiveBytes)}`
            }
            tone="danger"
            busy={restoring}
            onConfirm={runDiscardEl}
            onCancel={() => setConfirmingDiscardEl(false)}
          >
            Frees {size(elArchiveBytes)}.{" "}
            {hasBackup ? (
              <>
                The Profile 7 original is still beside this film, so this only
                gives up the small way back and not the way back itself.
              </>
            ) : (
              <>
                This is the last copy of what the conversion discarded — after
                it, going back to Profile 7 means ripping the disc again.
              </>
            )}
          </ConfirmModal>
        )}

        {/* Asked, now, rather than acted on where the button is. Stopping is
            the one control here that undoes rather than commits, which is
            exactly why it is worth a question: an hour of a conversion is a
            real thing to lose to a stray click, even when the file it was
            working on is untouched by losing it. */}
        {stopMounted && (
          <ConfirmModal
            open={confirmingStop}
            title={stop.title}
            confirmLabel={stopping ? "Stopping…" : "Stop"}
            tone="danger"
            busy={stopping}
            onConfirm={runStop}
            onCancel={() => setConfirmingStop(false)}
          >
            {stop.note}
          </ConfirmModal>
        )}
      </div>
    </Panel>
  );
}
