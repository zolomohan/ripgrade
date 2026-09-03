"use client";

import { useEffect, useMemo, useState } from "react";

import { CloseButton, Modal } from "@/app/modal";
import { ScoreBreakdown } from "@/app/score-breakdown";
import { ScoreDial } from "@/app/score-circle";
import { scoreFacts, type Breakdown, type ScorableFacts } from "@/lib/derive";
import { guessFromTitle, type KnownDimension } from "@/lib/release-title";

/**
 * Why a release scores what it scores.
 *
 * Every predicted number in this app is a claim with working behind it — the
 * rubric read a release name, awarded points line by line, and blended three
 * sub-scores into the figure on the dial. The working was only ever visible on
 * a film's own page, for the copy already on the drive. For the releases you
 * are choosing *between*, which is where the number actually decides something,
 * an 84 was a number and nothing else.
 *
 * So the dial becomes the way in. Not a "?" beside it: the score is the thing
 * being questioned, and a footnote next to it is a second target for the same
 * question — see app/score-breakdown.tsx, which was exactly that on the film
 * page before it became a panel. You press the number you do not believe.
 *
 * What opens is the same breakdown the film page draws, because it is the same
 * rubric and a predicted 84 is meant to mean what a measured 84 means. What is
 * added around it is the part that is only true of a release: the name it was
 * all read off, and how much of that name actually said anything.
 */

/** Everything the dial needs to explain itself. */
export type PredictedScore = {
  /** The release name. Every line of the breakdown was read off this string. */
  title: string;
  /**
   * What the rubric made of it, where the caller kept them.
   *
   * Passed rather than re-read because bitrate density needs the film's
   * runtime, which is known when a search runs and gone by the time a row is
   * being looked at. Re-reading the name without it would score the density
   * line at nought and quietly contradict the number on the dial.
   */
  facts?: ScorableFacts;
  /** Only used where `facts` is absent and the name has to be read again. */
  sizeBytes?: number;
  /**
   * The three sub-scores as they were stored, where they were.
   *
   * Only read when `facts` is absent: it is what a re-read of the name is
   * checked against, so the dialog can say when its own arithmetic has drifted
   * from the number on the dial rather than warning about it on every old row
   * whether or not anything actually moved.
   */
  scores?: { video: number; audio: number; release: number };
  /** The number on the dial — a share of the disc where `relative`. */
  score: number;
  relative: boolean;
  /** The disc's own rubric total, which is what `score` is a share of. */
  discScore?: number;
  /**
   * The disc itself on the same rubric, where the row kept it.
   *
   * Without it the breakdown can only mark the release against the best any
   * release could be, which under a disc-relative score is a different
   * question from the one the number answered — the meters would list Dolby
   * Vision as lost points on a film whose best disc is HDR10.
   */
  discShape?: ScorableFacts;
  /** What "better" is better than, where the list was measuring against one. */
  reference?: { kind: "copy" | "disc"; delta: number };
};

/** The four things a release name can state, in the words the breakdown uses. */
const DIMENSION: Record<KnownDimension, string> = {
  resolution: "resolution",
  hdr: "dynamic range",
  release: "release type",
  audio: "audio",
};

/** "a, b and c" — the list separator English uses and `join` does not. */
function sentence(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * How far the reading can be trusted, in a sentence.
 *
 * The rubric scores every dimension whether or not the name mentioned it, which
 * is the only way to score anything at all — but a name that states one of the
 * four has been scored mostly on defaults, and the meters below will look
 * exactly as confident as a name that states all four. This is the one thing
 * the film page's breakdown has no equivalent of, because a probed file has
 * nothing to be unsure about.
 */
function Confidence({ known }: { known: KnownDimension[] }) {
  const stated = known.map((dimension) => DIMENSION[dimension]);
  const missing = (Object.keys(DIMENSION) as KnownDimension[])
    .filter((dimension) => !known.includes(dimension))
    .map((dimension) => DIMENSION[dimension]);

  if (missing.length === 0) {
    return (
      <p className="text-xs opacity-50">
        The name states all four dimensions, so nothing below was assumed — but
        stating a thing and being it are still two different claims.
      </p>
    );
  }

  return (
    <p className="text-xs opacity-50">
      {stated.length === 0
        ? "The name states none of the four dimensions"
        : `The name states ${sentence(stated)}`}
      , so {sentence(missing)} {missing.length === 1 ? "was" : "were"} scored on
      the rubric&rsquo;s defaults rather than on anything this release actually
      said. Those lines are a floor, not a reading.
    </p>
  );
}

/**
 * The dialog itself.
 *
 * Opened from inside other dialogs — the release search, the release details —
 * so it takes Escape in the capture phase and stops it there. Every dialog in
 * this app listens for Escape on the window, and without this one press would
 * dismiss the whole stack: you would ask why a release scored 84, read the
 * answer, press Escape, and find yourself back on the film with the search
 * gone. See app/modal.tsx, whose own handler is a bubble-phase listener on the
 * same target and so never runs once this has stopped the event.
 */
function WhyModal({
  open,
  onClose,
  subject,
  theme,
}: {
  open: boolean;
  onClose: () => void;
  subject: PredictedScore;
  theme?: { stroke: string; text: string };
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  const {
    title,
    facts,
    sizeBytes,
    scores: stored,
    score,
    relative,
    discScore,
    discShape,
    reference,
  } = subject;

  const reading = useMemo(() => {
    // The name is read again either way, but only for the two things that do
    // not depend on the runtime: which dimensions it stated, and the tags it
    // carried. The scoring itself prefers the facts the caller kept.
    const guess = guessFromTitle(title, { sizeBytes });
    const scorable = facts ?? guess.facts;
    const { lines, scores, weighted, ceiling } = scoreFacts(scorable);

    // A row stored before the disc's own total was kept alongside it knows its
    // score is a share of something without knowing of what. The breakdown is
    // told the truth — no denominator, so no last step — and the header says
    // why the arithmetic stops one line early.
    const scaled = relative && discScore !== undefined && discScore > 0;

    const breakdown: Breakdown = {
      ...lines,
      relative: scaled,
      discScore: scaled ? discScore : undefined,
      // The same rubric read over the disc, which is what every meter is
      // measured against once the score is a share of one. A row stored before
      // the disc was kept has none, and falls back to the rubric's own maxima.
      disc: scaled && discShape ? scoreFacts(discShape).lines : undefined,
      absolute: scores.overall,
      weighted: Math.round(weighted * 10) / 10,
      ceiling,
      cappedByVideo: ceiling < weighted,
    };

    return {
      known: guess.known,
      // The figure on the dial rather than the rubric total: the breakdown's
      // last line has to be the number you pressed, or the working belongs to
      // some other score.
      scores: { ...scores, overall: score },
      breakdown,
      /** True where the score is a share of a disc nothing here can name. */
      unanchored: relative && !scaled,
      /**
       * Whether a re-read of the name has landed somewhere the stored row did
       * not — which is the only case worth warning about. A remux drifts
       * nowhere without the runtime, because its density line does not depend
       * on one; an encode can, and a row too old to carry sub-scores at all
       * cannot be checked either way.
       */
      drifted:
        facts === undefined &&
        (stored === undefined ||
          stored.video !== scores.video ||
          stored.audio !== scores.audio ||
          stored.release !== scores.release),
    };
  }, [title, facts, sizeBytes, stored, score, relative, discScore, discShape]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      label={`Why ${title} scores ${score}`}
      panelClassName="flex max-h-[85vh] w-full max-w-lg flex-col gap-5 overflow-y-auto glass-panel rounded-card border border-line p-6 shadow-2xl"
    >
      <>
        {/* No header bar, as the release dialog settled: a reading and the
            thing it is a reading of, against the top of the panel, already say
            where the dialog begins. The way out goes in the corner it goes in
            everywhere else. */}
        <div className="flex items-start gap-4">
          <ScoreDial
            score={score}
            theme={theme}
            size={56}
            title={
              relative
                ? `Predicted ${score}% of the best release`
                : `Predicted ${score} of 100`
            }
            srLabel={`Predicted score ${score}`}
          />

          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 className="text-sm font-semibold">
              {relative
                ? `${score}% of the best release there is`
                : `${score} out of 100`}
            </h2>

            <p className="text-xs opacity-45">
              Predicted from the name below, never measured — nothing about this
              file has been fetched or probed.
            </p>

            {reference && (
              <p className="text-xs opacity-45">
                {reference.delta === 0
                  ? reference.kind === "disc"
                    ? "Level with the disc, which is as far as anything gets."
                    : "Level with the copy on your drive."
                  : reference.delta > 0
                    ? `${reference.delta} above ${
                        reference.kind === "disc" ? "the disc" : "your copy"
                      }.`
                    : `${Math.abs(reference.delta)} short of ${
                        reference.kind === "disc" ? "the disc" : "your copy"
                      }.`}
              </p>
            )}
          </div>

          <div className="self-start">
            <CloseButton onClick={onClose} />
          </div>
        </div>

        {/* The string every line below was read off, set the way the release
            dialog sets it: whole, wrapping, in the face this app keeps for
            things you read character by character. */}
        <p className="rounded-control border border-line px-3 py-2 font-mono text-[11px] break-all opacity-60">
          {title}
        </p>

        <Confidence known={reading.known} />

        {reading.drifted && (
          <p className="text-xs opacity-50">
            This row was stored before the reading was kept with it, so the name
            has been read again here — and it has not landed where the row did.
            Bitrate density needs the film&rsquo;s runtime, which the row does
            not carry, so on an encode the lines below sit under the figure
            above rather than adding up to it.
          </p>
        )}

        {reading.unanchored && (
          <p className="text-xs opacity-50">
            The figure above is a share of the best disc for this film, but the
            disc&rsquo;s own score was not stored with this row — so the working
            below stops at the rubric total it was taken from, and signs off as
            though no disc were known. One is missing here; there was one.
          </p>
        )}

        <ScoreBreakdown scores={reading.scores} breakdown={reading.breakdown} />
      </>
    </Modal>
  );
}

/**
 * The dial, with the working behind it.
 *
 * A drop-in for `ScoreDial` wherever the number is predicted off a release
 * name: same drawing, same colours, same size — it simply answers when pressed.
 * The press is stopped on its way up, because these sit on rows and tiles that
 * are themselves clickable and asking why is not the same gesture as opening
 * the thing.
 */
export function PredictedScoreDial({
  subject,
  theme,
  title,
  srLabel,
  size,
}: {
  subject: PredictedScore;
  /** The list's own verdict colour, passed straight through to the dial. */
  theme?: { stroke: string; text: string };
  title: string;
  srLabel: string;
  size?: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        aria-label={`${srLabel} — how this was scored`}
        // A disc that lights up under the ring, which is the row hover this app
        // already uses, curved to what it sits behind. The ring itself is left
        // alone: a second ring around a ring is a target drawn twice.
        className="rounded-full transition-colors hover:bg-surface-strong"
      >
        <ScoreDial
          score={subject.score}
          theme={theme}
          size={size}
          // The tooltip stays on the dial rather than the button, where the
          // inner one would win the hover anyway — so it says both things.
          title={`${title} · press for the working`}
          srLabel={srLabel}
        />
      </button>

      <WhyModal
        open={open}
        onClose={() => setOpen(false)}
        subject={subject}
        theme={theme}
      />
    </>
  );
}
