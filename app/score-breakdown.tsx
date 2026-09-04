"use client";

import Link from "next/link";

import { Switch } from "@/app/controls";
import { ScoreRing, SubScore } from "@/app/score-card";
import { STATUS_THEME } from "@/app/score-circle";
import {
  asShareOfDisc,
  statusFor,
  VIDEO_CEILING_BONUS,
  WEIGHTS,
  type Breakdown,
  type ScoreLine,
  type Status,
} from "@/lib/derive";

/**
 * How the number on the ring was arrived at, line by line.
 *
 * It was a dialog behind a "?" in the corner of the score card — a footnote you
 * had to find, which then took the whole screen to answer. On the film's page
 * it is a panel at the foot instead: the same reading in the same order as
 * everything else there — shut it is one line, open it is the arithmetic.
 *
 * It lives here rather than under `app/film/[id]/` because the film is no
 * longer the only thing that carries a score worth explaining. A release on an
 * indexer is scored through the same rubric — that is the whole point of a
 * predicted number being on the same hundred-point scale — so the dial on a
 * torrent opens this same breakdown; see app/score-why.tsx, which supplies a
 * `Breakdown` built from a release name rather than from a probed file.
 *
 * It holds one piece of state and no dialog of its own — which of the two
 * readings you are looking at, where a disc makes two of them — and the callers
 * go on deciding whether it sits on a page or inside a modal.
 *
 * Two readings, because there are two honest answers and they disagree. A copy
 * scored against the best disc anyone pressed says what is left to *do* about
 * it; the same copy scored against the rubric's ideal says what it *is*. The
 * relative reading used to be the only one drawn, with the absolute total
 * mentioned in a closing sentence you could not open — so the number the ring
 * under a film's poster shows as "absolute" had no working anywhere. They are a
 * switch apart now, in the words that ring already uses.
 *
 * Each criterion is a meter rather than a bare fraction: 20/25 has to be
 * computed to be read, and a bar four-fifths full is read at a glance.
 *
 * They fill on the same clock as the hero's three, and for the same reason the
 * hero's do: the panel should read as one instrument settling rather than as a
 * card that has arrived and a list that has not. They were static for as long
 * as this lived in a `<details>` at the foot of a film's page, where a mount
 * animation would have played to nobody while the panel was shut. It opens in
 * a dialog now, and a dialog mounts when you ask for it.
 */

/**
 * The hairline that parts one thing from the next, fading at both ends.
 *
 * Exported because the dialog parts its own sections with it — under the hero,
 * and above the name in the footer. `rule-head` in globals.css is the other
 * one, weighted at the left because it belongs to the heading above it rather
 * than lying between two things.
 */
/**
 * The verdict palette in the weight a bar is drawn at.
 *
 * The same three colours the ring wears and grouped exactly as `STATUS_THEME`
 * groups them — this is the fill rather than the stroke, and a bar carries more
 * area than a 3px arc, so it is drawn back a little.
 */
const BAR_TONE: Record<Status, string> = {
  "Best Available": "bg-emerald-500/70",
  Reference: "bg-emerald-500/70",
  Excellent: "bg-emerald-500/70",
  Good: "bg-amber-500/70",
  "Upgrade Recommended": "bg-amber-500/70",
  "Must Upgrade": "bg-red-500/75",
};

/**
 * One rule for every bar in the panel: how full it is, banded the way the ring
 * above it bands the same fraction.
 *
 * The panel used to hold three rules at once. A criterion's meter was grey when
 * full and amber otherwise, so a line at 1/22 and a line at 21/22 were the same
 * colour. The hero's meters had a rule of their own — anything short was amber,
 * anything under four fifths of its mark was red — which put a red bar under an
 * amber ring reading the same 78. And the ring banded properly. Now the ring's
 * banding is the only one, and a bar says what a ring at that figure would.
 *
 * A criterion whose maximum is nought is parity by definition: the disc has
 * none of it either, and you cannot fall short of a blank.
 */
export function barTone(
  points: number,
  max: number,
  relative: boolean,
): string {
  const share = max > 0 ? Math.round((points / max) * 100) : 100;
  return BAR_TONE[statusFor(share, relative)];
}

export const RULE =
  "h-px shrink-0 bg-gradient-to-r from-transparent via-line-strong to-transparent";

function LineRow({ line, relative }: { line: ScoreLine; relative: boolean }) {
  // Measured against a disc, a line can beat what it is measured against —
  // better sound than the disc was pressed with. That is a full bar and then
  // some, and the bar stops at full while the figures say the rest.
  const full = line.points >= line.max;

  return (
    <div className="py-2.5">
      <div className="flex items-baseline justify-between gap-4">
        <span className="min-w-0 truncate text-sm">
          <span className="opacity-50">{line.label}</span>
          <span aria-hidden className="mx-2 opacity-30">
            ·
          </span>
          {line.detail}
        </span>
        <span
          className={`shrink-0 font-mono text-xs tabular-nums ${
            full ? "" : "opacity-50"
          }`}
        >
          {line.points}
          <span className="opacity-40">/{line.max}</span>
        </span>
      </div>

      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-strong">
        <div
          className={`score-bar h-full rounded-full ${barTone(line.points, line.max, relative)}`}
          style={{
            width: `${Math.min(100, line.max > 0 ? (line.points / line.max) * 100 : 100)}%`,
          }}
        />
      </div>
    </div>
  );
}

function Component({
  title,
  weight,
  score,
  lines,
  relative,
  unmeasured,
}: {
  title: string;
  weight: number;
  score: number;
  lines: ScoreLine[];
  /** Which scale these figures are on, for the meters to band against. */
  relative: boolean;
  /** Set where the disc scores nothing here, so there is no share to take. */
  unmeasured?: boolean;
}) {
  const lost = lines.reduce((sum, l) => sum + (l.max - l.points), 0);

  /* The ways back to those points, gathered from the lines that carry one.
     They used to sit as a subtitle under each row, which made every shortfall
     twice the height of a full mark and scattered the same message down the
     section — collected here, the total says how much and the list says how. */
  const notes = lines
    .map((line) => line.note)
    .filter((note): note is string => Boolean(note));

  return (
    <section className="flex flex-col">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="font-medium">
          {title}
          <span className="ml-2 text-xs font-normal opacity-50">
            {Math.round(weight * 100)}% of overall
          </span>
        </h3>
        <span className="font-score text-lg font-semibold tabular-nums">
          {score}
        </span>
      </div>

      {unmeasured && (
        <p className="mt-1 text-xs opacity-50">
          The disc lists nothing here — counted as parity.
        </p>
      )}

      <div className="mt-2">
        {lines.map((line) => (
          <LineRow key={line.label} line={line} relative={relative} />
        ))}
      </div>

      {/* On its own quiet surface, so the section ends with a verdict rather
          than trailing off — how many points are missing, and the way to each
          of them. */}
      {notes.length > 0 && (
        <div className="mt-3 rounded-card bg-surface px-4 py-3 text-xs">
          {lost > 0 && (
            <p className="flex items-baseline justify-between gap-4">
              <span className="tracking-wide uppercase opacity-45">
                Left on the table
              </span>
              <span className="font-mono tabular-nums opacity-60">−{lost}</span>
            </p>
          )}
          <ul
            className={`flex flex-col gap-1 opacity-70 ${lost > 0 ? "mt-2" : ""}`}
          >
            {notes.map((note) => (
              <li key={note} className="flex gap-2">
                <span className="opacity-40">—</span>
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** One step of the final arithmetic: what happened in words, the working in
    mono underneath, the result on the right. */
function Step({
  label,
  working,
  value,
}: {
  label: string;
  working?: string;
  value: number;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        {working && (
          <span className="mt-0.5 block font-mono text-xs opacity-45">
            {working}
          </span>
        )}
      </span>
      <span className="shrink-0 font-mono text-sm tabular-nums">{value}</span>
    </div>
  );
}

/**
 * One dimension as the panel draws it: against the disc where there is one,
 * against the rubric where there is not.
 *
 * `unmeasured` is the third case — a disc that scores nothing at all for this
 * dimension, a page that listed no audio. `relativeToDisc` reads a missing
 * denominator as parity, so the blend takes 100 for it while the meters go on
 * showing the rubric, which is the only reading left.
 */
type Section = { lines: ScoreLine[]; score: number; unmeasured: boolean };

function sectionOf(
  mine: ScoreLine[],
  score: number,
  disc?: ScoreLine[],
): Section {
  if (!disc) return { lines: mine, score, unmeasured: false };

  const share = asShareOfDisc(mine, disc);
  return share
    ? { ...share, unmeasured: false }
    : { lines: mine, score: 100, unmeasured: true };
}

/**
 * One complete reading of one file: three sets of meters and the sum they make.
 *
 * The two differ in what full marks mean. Against the disc, a criterion's
 * maximum is whatever the disc itself scored for it — so Dolby Vision is not
 * points lost on a film whose best disc is HDR10, and every share is capped at
 * parity. On the rubric, the maximum is the rubric's own, which no disc need
 * ever have reached.
 */
export type ScoreViewId = "disc" | "rubric";

export type ScoreView = {
  id: ScoreViewId;
  /** The word the ring under a film's poster already uses for this reading. */
  label: string;
  video: Section;
  audio: Section;
  release: Section;
  overall: number;
  /**
   * How far the disc reaches on each meter.
   *
   * The disc's own rubric totals on the absolute reading; a flat 100 on the
   * disc-relative one, where parity is the ceiling by construction. Always
   * present where a disc is known, because this is also what tells `SubScore`
   * it has something to grade against: without a ceiling it has no shortfall
   * to colour and draws every bar in the neutral grey it keeps for a bar that
   * is only a quantity.
   */
  ceilings?: { video: number; audio: number; release: number };
};

/**
 * The meters and the arithmetic for whichever reading is on screen.
 *
 * `tabbed` is not decoration: it decides whether the closing sentence can point
 * at the other reading as something one press away, or has to state it as a
 * figure the panel is not going to show its working for.
 */
export function ScoreReading({
  view,
  breakdown,
  tabbed,
}: {
  view: ScoreView;
  breakdown: Breakdown;
  tabbed: boolean;
}) {
  const vsDisc = view.id === "disc";

  /*
   * The one thing left to say, where the figures have not already said it.
   *
   * Each of these used to be two or three sentences, and the ceiling that did
   * not bind used to get a sentence explaining that nothing had happened — a
   * dialog talking to fill the space under its own working. What survives is
   * the fact you cannot read off a meter: what the other reading makes of the
   * same file, and why the number stopped where it did.
   */
  const note = vsDisc
    ? view.overall === 100
      ? "Nothing better exists to upgrade to."
      : `Shares are capped at parity. On the rubric alone: ${breakdown.absolute}.`
    : breakdown.cappedByVideo
      ? `Capped: sound and container cannot lift a file more than ${VIDEO_CEILING_BONUS} points above its picture.`
      : undefined;

  return (
    <div className="flex flex-col gap-8">
      <Component
        title="Video"
        weight={WEIGHTS.video}
        score={view.video.score}
        lines={view.video.lines}
        relative={vsDisc}
        unmeasured={view.video.unmeasured}
      />
      <div aria-hidden className={RULE} />

      <Component
        title="Audio"
        weight={WEIGHTS.audio}
        score={view.audio.score}
        lines={view.audio.lines}
        relative={vsDisc}
        unmeasured={view.audio.unmeasured}
      />
      <div aria-hidden className={RULE} />

      <Component
        title="Release"
        weight={WEIGHTS.release}
        score={view.release.score}
        lines={view.release.lines}
        relative={vsDisc}
        unmeasured={view.release.unmeasured}
      />
      <div aria-hidden className={RULE} />

      <section className="flex flex-col gap-1">
        <h3 className="font-medium">Final calculation</h3>

        {/* The same arithmetic that was one line of formula soup, told a step
            at a time: what each number is in words, how it was made in mono
            underneath, and the figure it produced on the right.

            Against a disc it is one step, because the three shares above are
            already the whole of it: no rubric total, and no video ceiling —
            nothing can outscore the picture when the picture's own share is
            what is being weighed. The old reading showed both scales at once
            and closed on "78 ÷ 93", a division that did not produce the number
            printed beside it. */}
        <div className="mt-2 flex flex-col divide-y divide-line">
          {vsDisc ? null : (
            <>
              <Step
                label="The three, blended"
                working={`${view.video.score} × ${WEIGHTS.video} + ${view.audio.score} × ${WEIGHTS.audio} + ${view.release.score} × ${WEIGHTS.release}`}
                value={breakdown.weighted}
              />
              <Step
                label="Video ceiling"
                working={`picture quality ${view.video.score} + ${VIDEO_CEILING_BONUS}`}
                value={breakdown.ceiling}
              />
              <Step
                label={
                  breakdown.cappedByVideo
                    ? "Capped at the ceiling — sound cannot outscore the picture"
                    : "Lower of the two — the ceiling did not bind"
                }
                value={breakdown.absolute}
              />
            </>
          )}

          <div className="flex items-center justify-between gap-4 pt-3">
            <span className="min-w-0">
              <span className="block text-sm font-medium">
                {vsDisc
                  ? "The three shares, blended"
                  : tabbed
                    ? "The rubric alone, with no disc in it"
                    : "No disc data — scored on the rubric alone"}
              </span>
              {vsDisc && (
                <span className="mt-0.5 block font-mono text-xs opacity-45">
                  {view.video.score} × {WEIGHTS.video} + {view.audio.score} ×{" "}
                  {WEIGHTS.audio} + {view.release.score} × {WEIGHTS.release}
                </span>
              )}
            </span>
            <span className="shrink-0 font-score text-xl font-semibold tabular-nums">
              {view.overall}
            </span>
          </div>
        </div>

        {note && <p className="mt-3 text-xs opacity-50">{note}</p>}
      </section>

      <p className="text-xs opacity-50">
        Every threshold is on{" "}
        <Link href="/how-it-works" className="underline underline-offset-4">
          How it works
        </Link>
        .
      </p>
    </div>
  );
}

const totalOf = (lines: ScoreLine[]) =>
  lines.reduce((running, line) => running + line.points, 0);

/**
 * The readings available for one file — both where a disc is known, one where
 * it is not.
 *
 * A plain function rather than a hook, because two very different callers need
 * the same arithmetic: the panel at the foot of a film's page, which keeps its
 * own state and draws its own switch, and the dialog, which puts the switch in
 * its header and has to own the state to do it.
 */
export function scoreViews(
  scores: { video: number; audio: number; release: number; overall: number },
  breakdown: Breakdown,
): { rubric: ScoreView; vsDisc?: ScoreView } {
  const disc = breakdown.disc;

  const rubric: ScoreView = {
    id: "rubric",
    label: "Absolute",
    video: sectionOf(breakdown.video, scores.video),
    audio: sectionOf(breakdown.audio, scores.audio),
    release: sectionOf(breakdown.release, scores.release),
    /*
     * The rubric's own total — except where it is the only reading there is.
     *
     * A row whose score is a share of a disc it cannot name still has to close
     * on the number you pressed, or the working belongs to some other score.
     * With a disc in hand that number is under `vs disc`, and this reading is
     * free to be what it says it is. See the `unanchored` note in
     * app/score-why.tsx.
     */
    overall: disc ? breakdown.absolute : scores.overall,
    ceilings: disc && {
      video: totalOf(disc.video),
      audio: totalOf(disc.audio),
      release: totalOf(disc.release),
    },
  };

  if (!disc) return { rubric };

  return {
    rubric,
    vsDisc: {
      id: "disc",
      label: "vs disc",
      // Every meter measured against whatever the score itself was measured
      // against. A disc-relative number explained against the rubric's ideal is
      // working for some other number: it lists points the score never charged
      // for, and the two disagree in front of you.
      video: sectionOf(breakdown.video, scores.video, disc.video),
      audio: sectionOf(breakdown.audio, scores.audio, disc.audio),
      release: sectionOf(breakdown.release, scores.release, disc.release),
      overall: scores.overall,
      // Parity, on every meter. `asShareOfDisc` has already capped each one
      // there, so 100 is both the mark and the truth: it is what "as good as
      // the disc" looks like, and it is what makes a bar green at parity and
      // amber below it rather than grey at either.
      ceilings: { video: 100, audio: 100, release: 100 },
    },
  };
}

/**
 * Which reading you are looking at.
 *
 * Its own export because it does not always sit above the working it governs:
 * in the dialog it goes on the title line, where every other dialog in this app
 * keeps the controls that apply to the whole panel.
 */
export function ScoreViewSwitch({
  value,
  onChange,
}: {
  value: ScoreViewId;
  onChange: (id: ScoreViewId) => void;
}) {
  /* The names alone. The two scores were on the track as counts for a while,
     which made the switch a third place the numbers are printed — after the
     ring beside it and the sign-off at the foot of whichever reading is open —
     and a figure on an unselected tab reads as a tally of what is behind it
     rather than as the score itself. */
  return (
    <Switch
      value={value}
      onChange={(key) => onChange(key as ScoreViewId)}
      options={[
        { key: "disc", label: "vs disc" },
        { key: "rubric", label: "Absolute" },
      ]}
    />
  );
}

/**
 * The reading at a glance: the ring, and the three meters it is made of.
 *
 * The same arrangement the top of a film's page has always used — ring, rule,
 * three bars — so a score explained in a dialog is laid out the way the same
 * score is laid out on the page it belongs to. The dialog used to open on a
 * small dial and a paragraph instead, which is the one shape in the app that
 * showed a score without showing what it was made of.
 */
export function ScoreHero({
  view,
  ring,
}: {
  view: ScoreView;
  /**
   * The colour of the ring that was pressed to get here, where there was one.
   *
   * Only ever honoured for the reading it belongs to. A list's verdict colour
   * is a verdict about the score on the ring — a share of the disc, where the
   * list was measuring against one — and repainting the rubric total with it
   * would be answering a question nobody asked of that number.
   */
  ring?: string;
}) {
  /*
   * Failing that, the number colours itself — on the scale it was measured on.
   *
   * The two scales band differently: 91 is a reference copy on the rubric and
   * a copy visibly short of its disc as a share of one, which is what
   * `statusFor` exists to keep straight. The absolute ring used to be a flat
   * neutral grey, borrowed from the film page where it sits *beside* the
   * relative one and greys precisely to stay out of its way. Here only one
   * ring is on screen at a time, so grey was the ring declining to say
   * anything at all.
   */
  const relative = view.id === "disc";
  const banded = STATUS_THEME[statusFor(view.overall, relative)];

  /*
   * Each meter banded exactly as the ring beside it — one rule for every bar
   * in the panel. See `barTone`.
   *
   * Out of a hundred and not out of the ceiling, because a hundred is what the
   * bar's own width is drawn against: the mark on the track says how far the
   * disc reaches, and the colour says how good the figure is. Banding it
   * against the ceiling instead would paint a bar four fifths full in the
   * colour of one nearly full.
   */
  const tone = (section: Section) => barTone(section.score, 100, relative);

  return (
    <section className="flex flex-col items-center gap-6 sm:flex-row sm:items-stretch">
      <div className="flex shrink-0 items-center justify-center">
        <ScoreRing
          score={view.overall}
          ring={ring ?? banded.stroke}
          caption={view.label}
        />
      </div>

      {/* A vertical rule on wide screens keeps the ring and the meters reading
          as two halves of one card rather than a loose stack. */}
      <div
        aria-hidden
        className="hidden w-px shrink-0 bg-gradient-to-b from-transparent via-line-strong to-transparent sm:block"
      />

      <div className="flex w-full flex-1 flex-col justify-center gap-3">
        <SubScore
          label="Video"
          value={view.video.score}
          ceiling={view.ceilings?.video}
          tone={tone(view.video)}
        />
        <SubScore
          label="Audio"
          value={view.audio.score}
          ceiling={view.ceilings?.audio}
          tone={tone(view.audio)}
        />
        <SubScore
          label="Release"
          value={view.release.score}
          ceiling={view.ceilings?.release}
          tone={tone(view.release)}
        />
      </div>
    </section>
  );
}
