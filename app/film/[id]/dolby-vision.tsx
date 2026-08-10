"use client";

import { useRouter } from "next/navigation";

import { Panel } from "@/app/panel";
import { useEffect, useRef, useState } from "react";

import {
  beginConvert,
  beginFullDoviScan,
  refreshAfterDoviScan,
  discardBackup,
  restoreOriginal,
  stopConvert,
  stopFullDoviScan,
} from "@/app/actions";
import { useJobs } from "@/app/jobs-provider";
import {
  BACKUP_SUFFIX,
  RPU_COVERAGE_TOLERANCE,
  classifyEnhancementLayer,
  type DoviScan,
  type ElVerdict,
  type Hdr10Static,
} from "@/lib/derive";
import { CloseButton, Modal, useClosing } from "@/app/modal";
import { BUTTON } from "@/app/controls";
import { ConfirmModal } from "./console";

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
          body: "Read every frame to settle it.",
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
      panelClassName="flex max-h-[min(85vh,46rem)] w-full max-w-2xl flex-col overflow-hidden rounded-card border border-line bg-background shadow-2xl"
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
  // Each confirm outlives its flag by the length of its exit animation.
  const convertMounted = useClosing(confirming);
  const restoreMounted = useClosing(confirmingRestore);
  const deleteMounted = useClosing(confirmingDelete);
  const [restoring, setRestoring] = useState(false);
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

        const wasReading =
          prev.dovi.status === "running" && prev.dovi.path === moviePath;
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
              apply({
                convert: {
                  status: "running",
                  path: moviePath,
                  step: 1,
                  steps: 3,
                },
              });
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

  const recipes: Recipe[] = [
    {
      id: "dovi_convert",
      title: "With dovi_convert",
      // Deliberately without --force, even on a film this page is advising
      // against converting: the tool runs the same brightness check and will
      // refuse on its own, which is a second opinion worth having.
      blurb:
        "Keeps the original, and refuses a complex FEL unless you add --force.",
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
   * A conversion decided on a sample is a conversion decided on the frames the
   * sample happened to cover, so the pass is the first step of converting
   * rather than a chore to remember beforehand. The subscription above picks it
   * up when it finishes and starts the conversion itself.
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
    apply({
      convert: { status: "running", path: moviePath, step: 1, steps: 3 },
    });
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

  // -------------------------------------------------------------------------
  // What the console says, and what it offers to do about it
  // -------------------------------------------------------------------------

  const converted = backupBytes !== undefined;
  const justConverted =
    convert?.status === "done" && convert.path === moviePath;
  /**
   * Whether there is an original to go back to. The filesystem is the authority
   * whenever it can be read; only with the drive away does the conversion this
   * server ran stand in for it, so an unplugged converted film still offers
   * restoring rather than falling back to offering a read.
   */
  const hasBackup = converted || (!present && justConverted);
  const canConvert =
    dvProfile === 7 && el?.kind !== "complex-fel" && !hasBackup;
  /** Set only when the drive is away, so it can override every other tooltip. */
  const offline = present ? undefined : "Drive not connected";
  // Reading and converting are one action now, so they are one busy state: the
  // pass that precedes a conversion is a step of it, not a separate job the
  // card has to narrate on its own.
  const busy = converting || running;
  const convertingNow = converting || readingToConvert;

  /**
   * The one sentence at the top of the console. Whatever is happening to the
   * file outranks the verdict about it — mid-conversion, and afterwards while
   * the original is still recoverable, the state of the file *is* the answer
   * to "is this safe".
   */
  const banner: Verdict = convertingNow
    ? {
        tone: "neutral",
        headline: "Converting to Profile 8.1…",
        body: "Cancelling never touches the original.",
        detail:
          "Every frame is read first, then the whole file is rewritten, so it takes a while. Leaving this page will not stop it.",
      }
    : hasBackup
      ? {
          tone: "ok",
          headline: "Converted to Profile 8.1",
          body: (
            <>
              Original kept as{" "}
              <code className="font-mono">
                {fileName}
                {BACKUP_SUFFIX}
              </code>
              {backupBytes !== undefined && <>, {size(backupBytes)}</>}.
            </>
          ),
          detail:
            justConverted && convert?.summary
              ? `${convert.summary} of enhancement layer discarded${convert.check ? `, ${convert.check}` : ""}.`
              : undefined,
        }
      : verdict;

  const showMeter = Boolean(el && el.kind !== "mel");

  /**
   * The way out of the card's own offer, kept beside it.
   *
   * Only a Profile 7 file has anything to convert, so only there is there a
   * recipe worth printing. On a film this page is advising against converting
   * it is not an alternative but a warning stepped past deliberately, and it
   * says so.
   */
  const manual = dvProfile === 7 && (
    <button
      type="button"
      onClick={() => setShowRecipes(true)}
      title="Shows the commands. Nothing runs until you run it."
      className={BUTTON.text}
    >
      {el?.kind === "complex-fel"
        ? "Convert it anyway, by hand"
        : "Run it yourself instead"}
    </button>
  );

  /**
   * One decision per state, so the card has one thing to press: convert while
   * there is something to convert, put it back while the original is still
   * there, and read the stream when neither applies.
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
        Restore original
      </button>
    </>
  ) : canConvert ? (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      disabled={!present}
      title={offline ?? "Reads every frame first, then rewrites the file."}
      className={BUTTON.primary}
    >
      Convert to Profile 8.1
    </button>
  ) : (
    <button
      type="button"
      onClick={start}
      disabled={!present}
      title={
        offline ??
        "Parses one RPU per frame — slower, but it measures the real peak."
      }
      className={scan ? BUTTON.secondary : BUTTON.primary}
    >
      {scan?.depth === "full" ? "Read again" : "Read every frame"}
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
          {/* The verdict and the button that acts on it, on one line. */}
          <div className="card-band flex flex-wrap items-center justify-between gap-3 px-4 py-5">
            {/* The reasoning hangs off the sentence as a tooltip: it is worth
                keeping and not worth reading every time the page opens. */}
            <div className="flex flex-col gap-0.5" title={banner.detail}>
              <p className="text-sm font-medium">{banner.headline}</p>
              {banner.body && (
                <p className="text-sm opacity-60">{banner.body}</p>
              )}
            </div>

            {/* Beside the verdict while there is one button and a short
                sentence to sit next to. A restorable film has neither — two
                buttons, and a line carrying the backup's full filename — so
                there it takes a band of its own below. */}
            {!busy && !hasBackup && (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {/* Leftmost, so the row reads as the alternative and then the
                    thing itself, and the primary button still ends the line. */}
                {manual}
                {actions}
              </div>
            )}
          </div>

          {!busy && hasBackup && (
            <div className="card-band flex flex-wrap items-center justify-end gap-2 px-4 py-5">
              {manual}
              {actions}
            </div>
          )}

          {/* The evidence, directly beneath the claim: only a FEL needs it — a
              MEL is safe whatever the brightness figures say. */}
          {showMeter && el && (
            <div className="card-band px-4 py-5">
              <BrightnessMeter el={el} />
            </div>
          )}

          {busy && (
            // One progress band for both jobs. Which of the two is running is
            // a detail of how the work is done; what is being waited for is
            // the same thing throughout.
            <div className="card-band flex flex-col gap-2 px-4 py-5">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm">
                  {converting
                    ? (convert?.label ?? "Working")
                    : readingToConvert
                      ? "Reading every frame before converting"
                      : "Reading every frame"}
                </p>
                <div className="flex items-baseline gap-3">
                  <p className="text-xs tabular-nums opacity-45">
                    {converting
                      ? `${convert?.percent !== undefined ? `${Math.round(convert.percent)}% · ` : ""}step ${convert?.step ?? 1} of ${convert?.steps ?? 3}`
                      : `${Math.round(job?.percent ?? 0)}% · ${count(job?.frames ?? 0)} frames`}
                  </p>
                  <button
                    type="button"
                    onClick={async () => {
                      // Cancelling the read cancels the conversion it was the
                      // first step of.
                      intend(false);
                      if (converting) {
                        apply({ convert: await stopConvert() });
                      } else {
                        apply({ dovi: await stopFullDoviScan() });
                      }
                    }}
                    className="text-xs underline underline-offset-4 opacity-50 hover:opacity-100"
                  >
                    Cancel
                  </button>
                </div>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-surface-strong">
                <div
                  className="h-full rounded-full bg-foreground/70 transition-[width] duration-500"
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
            el?.kind === "complex-fel"
              ? "Convert it anyway, by hand"
              : "Run it yourself"
          }
          lede={
            el?.kind === "complex-fel"
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
                  Every frame is read first, to be sure the enhancement layer
                  expands no brightness later in the film.
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
            confirmLabel={restoring ? "Restoring…" : "Restore original"}
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
            only copy. Going back to Profile 7 after this means ripping the disc
            again.
          </ConfirmModal>
        )}
      </div>
    </Panel>
  );
}
