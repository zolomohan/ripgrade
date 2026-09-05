"use client";

import { useEffect, useMemo, useState } from "react";

import { CloseButton, Modal } from "@/app/modal";
import { TaskHead, type HeadFilm } from "@/app/jobs/task-head";
import {
  RULE,
  ScoreHero,
  ScoreReading,
  ScoreSource,
  ScoreViewSwitch,
  scoreViews,
  type ScoreViewId,
} from "@/app/score-breakdown";
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
 * How far the reading can be trusted.
 *
 * The rubric scores every dimension whether or not the name mentioned it, which
 * is the only way to score anything at all — but a name that states one of the
 * four has been scored mostly on defaults, and the meters below look exactly as
 * confident either way. The film page's breakdown has no equivalent, because a
 * probed file has nothing to be unsure about.
 *
 * Only what was missing, and only when something was. A name that states all
 * four used to get a paragraph saying so, which is a dialog reporting that it
 * has nothing to report.
 */
function Confidence({ known }: { known: KnownDimension[] }) {
  const missing = (Object.keys(DIMENSION) as KnownDimension[])
    .filter((dimension) => !known.includes(dimension))
    .map((dimension) => DIMENSION[dimension]);

  if (missing.length === 0) return null;

  return (
    <p className="text-xs opacity-50">
      Not stated: {sentence(missing)} — scored on defaults.
    </p>
  );
}

/**
 * The chrome both readings share.
 *
 * Opened from inside other dialogs — the release search, the release details —
 * so it takes Escape in the capture phase and stops it there. Every dialog in
 * this app listens for Escape on the window, and without this one press would
 * dismiss the whole stack: you would ask why a release scored 84, read the
 * answer, press Escape, and find yourself back on the film with the search
 * gone. See app/modal.tsx, whose own handler is a bubble-phase listener on the
 * same target and so never runs once this has stopped the event.
 *
 * Everything between the head and the breakdown is the caller's, because it is
 * the one part that differs: a prediction has a name to show and a confidence to
 * admit to, and a measured file has neither and needs neither. The breakdown
 * itself is the same component either way — that is the whole point of a
 * predicted 84 being meant to mean what a measured 84 means.
 *
 * The head is the head every dialog in this app wears: one word, and the
 * controls that govern the whole panel held to the right of it. The switch
 * between the two readings is one of those, so it goes on the title line rather
 * than floating above the working it governs.
 *
 * Under it, the arrangement the top of a film's page has always used — ring,
 * rule, three meters. The dialog used to open on a small dial and four
 * sentences restating the number beside it, which is the one shape in the app
 * that showed a score without showing what it was made of.
 */
function WhyShell({
  open,
  onClose,
  label,
  ring,
  film,
  children,
  footer,
  scores,
  breakdown,
}: {
  open: boolean;
  onClose: () => void;
  /** The accessible name. Says the number the head does not print. */
  label: string;
  /** The verdict colour of the ring you pressed, carried onto the hero's. */
  ring?: string;
  /**
   * The film this is a reading of, for the head.
   *
   * Optional because a predicted score is read off a release name and has no
   * film behind it — nothing in the library, sometimes nothing anywhere. That
   * dialog keeps the plain title it always had.
   */
  film?: HeadFilm;
  /** Whatever the subject has to say for itself, above the working. */
  children?: React.ReactNode;
  /**
   * What this is a reading of, under everything it was read from.
   *
   * A release name is evidence, not a heading. It sat in a bordered card near
   * the top for a while, which gave the longest and least readable string in
   * the dialog the most emphatic frame in it — above the meters that actually
   * answer the question.
   */
  footer?: React.ReactNode;
  scores: { video: number; audio: number; release: number; overall: number };
  breakdown: Breakdown;
}) {
  const { rubric, vsDisc } = scoreViews(scores, breakdown);

  // The disc reading first where there is one: it is the number you pressed,
  // and the one that says whether there is anything to do about this file.
  const [showing, setShowing] = useState<ScoreViewId>("disc");
  const view = vsDisc && showing === "disc" ? vsDisc : rubric;
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

  return (
    <Modal
      open={open}
      onClose={onClose}
      label={label}
      /*
       * The panel holds still and the working scrolls inside it.
       *
       * It was the panel itself that scrolled, which put the scrollbar hard
       * against a rounded glass edge: the track is square and the corner is
       * not, so at the top and bottom right the bar stood outside the curve
       * and read as a faint border with a radius, drawn on two sides of the
       * dialog. Nothing was bordered — it was the scrollbar leaving the pane.
       *
       * `overflow-hidden` on the panel so the curve clips, and the scrolling
       * moved to the body below, which is square and inset. The head stays
       * still while the numbers move under it, which is what it is for.
       */
      panelClassName="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden"
    >
      <div className="shrink-0 px-6 pt-6">
        {/* The same head the conversion dialog and the track picker wear.
            All three are one question asked about one file, opened off the
            same picture, and the first thing each has to settle is which file
            — which a word reading "Score" never did. See `TaskHead`.

            The reading rides beside the close, because it is the one control
            the whole panel answers to: change it and every number below means
            something else. */}
        {film ? (
          <TaskHead
            film={film}
            onClose={onClose}
            action={
              vsDisc && (
                <ScoreViewSwitch value={view.id} onChange={setShowing} />
              )
            }
          />
        ) : (
          <header className="flex items-center gap-3">
            <h2 className="min-w-0 flex-1 truncate text-base font-semibold">
              Score
            </h2>
            {vsDisc && (
              <ScoreViewSwitch value={view.id} onChange={setShowing} />
            )}
            <CloseButton onClick={onClose} />
          </header>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-5 overflow-y-auto px-6 pb-6">
        {/*
         * The floor the title stands on.
         *
         * `rule-head` elsewhere, which is weighted at the left and gone by the
         * middle — right for a heading it underlines, and not for this panel,
         * where two more hairlines cross the full width below it and a third
         * that fades out halfway reads as a missing divider rather than a
         * quiet one. All three are the same line here.
         */}
        <div aria-hidden className={RULE} />

        {/* The pressed ring's colour is carried in, but only onto the reading
            it was a verdict about. The rubric total colours itself — see
            `ScoreHero`. */}
        <ScoreHero view={view} ring={view.id === "disc" ? ring : undefined} />

        <div aria-hidden className={RULE} />

        {/* `empty:hidden` because everything in here is conditional: a name
            that states all four dimensions and has not drifted has nothing to
            say, and an empty box would still take the panel's gap on both
            sides of itself. */}
        <div className="flex min-w-0 flex-col gap-2 empty:hidden">
          {children}
        </div>

        <ScoreReading
          view={view}
          breakdown={breakdown}
          tabbed={Boolean(vsDisc)}
        />

        {/* The foot of the dialog: what this was read from, where there is
            such a thing, and where the numbers themselves come from.
            Always drawn, because the second half always applies — a reading
            with no release name behind it still has a rubric behind it. */}
        <footer className="flex flex-col gap-3">
          <div aria-hidden className={RULE} />
          {footer && (
            <p className="font-mono text-[11px] break-all opacity-45">
              {footer}
            </p>
          )}
          <ScoreSource />
        </footer>
      </div>
    </Modal>
  );
}

/** The dialog for a release nobody has fetched: read off its name, never measured. */
function PredictedWhyModal({
  open,
  onClose,
  subject,
  ring,
}: {
  open: boolean;
  onClose: () => void;
  subject: PredictedScore;
  ring?: string;
}) {
  const {
    title,
    facts,
    sizeBytes,
    scores: stored,
    score,
    relative,
    discScore,
    discShape,
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
    <WhyShell
      open={open}
      onClose={onClose}
      label={`Why ${title} scores ${score}`}
      ring={ring}
      scores={reading.scores}
      breakdown={reading.breakdown}
      // The string every line above was read off, whole and wrapping, in the
      // face this app keeps for things you read character by character.
      footer={title}
    >
      <Confidence known={reading.known} />

      {reading.drifted && (
        <p className="text-xs opacity-50">
          Re-read from the name here. Without the film&rsquo;s runtime the lines
          below can sit under the figure above rather than adding up to it.
        </p>
      )}

      {reading.unanchored && (
        <p className="text-xs opacity-50">
          The disc&rsquo;s own score was not stored with this row, so the
          working below stops at the rubric total the share was taken from.
        </p>
      )}
    </WhyShell>
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
      <WhyButton
        srLabel={srLabel}
        onOpen={() => setOpen(true)}
        score={subject.score}
        theme={theme}
        title={title}
        size={size}
      />

      <PredictedWhyModal
        open={open}
        onClose={() => setOpen(false)}
        subject={subject}
        ring={theme?.stroke}
      />
    </>
  );
}

/** A file on the drive, already probed — what the rubric made of what is there. */
export type MeasuredScore = {
  /** What this copy is of, for the dialog to name itself after. */
  title: string;
  /**
   * The file itself, where the caller has it — a poster and a year for the
   * head, so the dialog opens on the same picture you pressed. See `TaskHead`.
   */
  film?: HeadFilm;
  scores: { video: number; audio: number; release: number; overall: number };
  breakdown: Breakdown;
};

function MeasuredWhyModal({
  open,
  onClose,
  subject,
  ring,
}: {
  open: boolean;
  onClose: () => void;
  subject: MeasuredScore;
  ring?: string;
}) {
  const { title, film, scores, breakdown } = subject;

  return (
    <WhyShell
      open={open}
      onClose={onClose}
      label={`Why ${title} scores ${scores.overall}`}
      ring={ring}
      film={film}
      scores={scores}
      breakdown={breakdown}
    />
  );
}

/**
 * A whole card as the way in, for the one page that already draws the reading.
 *
 * A film's page opens on the ring and the three meters the dialog now opens on
 * too, so it had no need of the dialog's copy of them — it had a "Why this
 * score" panel at the foot instead, and the ring at the top scrolled you down
 * to it. Two answers to the same question, a page apart, only one of which
 * looked like the answer everywhere else in the app.
 *
 * The panel is gone and the card it duplicated is the control: press the
 * scores and the working opens over them, exactly as pressing a release's ring
 * opens the working behind that. The markup stays with the page — it is that
 * page's layout, not this component's — and arrives here as children.
 */
export function ScoreWhyTrigger({
  subject,
  ring,
  label,
  className = "",
  children,
}: {
  subject: MeasuredScore;
  /** The verdict stroke the page already drew its own ring in. */
  ring?: string;
  label: string;
  /** The page's own spacing, which belongs outside the lit area. */
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        // The row hover this app uses everywhere, curved to the card it lights
        // up. `text-left` because a button centres its contents and this one
        // holds a layout rather than a word.
        //
        // The space above the card is the button's own margin and not the
        // card's. A button is its own formatting context, so a margin on the
        // section inside it cannot collapse out through it — it stayed within
        // the box and the hover lit forty pixels of nothing above the rings.
        className={`glow -mx-4 w-[calc(100%+2rem)] rounded-card px-4 text-left transition-colors hover:bg-surface ${className}`}
      >
        {children}
      </button>

      <MeasuredWhyModal
        open={open}
        onClose={() => setOpen(false)}
        subject={subject}
        ring={ring}
      />
    </>
  );
}

/**
 * The same gesture for a file you already hold.
 *
 * An episode's ring answered nothing when pressed, while a torrent's ring in
 * the search window opened the whole rubric — the same drawing, on the same
 * scale, behaving two different ways depending on which page it was on. The
 * working is better evidence on the measured side, not worse.
 */
export function MeasuredScoreDial({
  subject,
  theme,
  title,
  srLabel,
  size,
}: {
  subject: MeasuredScore;
  theme?: { stroke: string; text: string };
  title: string;
  srLabel: string;
  size?: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <WhyButton
        srLabel={srLabel}
        onOpen={() => setOpen(true)}
        score={subject.scores.overall}
        theme={theme}
        title={title}
        size={size}
      />

      <MeasuredWhyModal
        open={open}
        onClose={() => setOpen(false)}
        subject={subject}
        ring={theme?.stroke}
      />
    </>
  );
}

/**
 * The ring as a control.
 *
 * The press is stopped on its way up, because these sit on rows and tiles that
 * are themselves clickable and asking why is not the same gesture as opening
 * the thing.
 */
function WhyButton({
  score,
  theme,
  title,
  srLabel,
  size,
  onOpen,
}: {
  score: number;
  theme?: { stroke: string; text: string };
  title: string;
  srLabel: string;
  size?: number;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      aria-label={`${srLabel} — how this was scored`}
      // A disc that lights up under the ring, which is the row hover this app
      // already uses, curved to what it sits behind. The ring itself is left
      // alone: a second ring around a ring is a target drawn twice.
      className="rounded-full transition-colors hover:bg-surface-strong"
    >
      <ScoreDial
        score={score}
        theme={theme}
        size={size}
        // The tooltip stays on the dial rather than the button, where the
        // inner one would win the hover anyway — so it says both things.
        title={`${title} · press for the working`}
        srLabel={srLabel}
      />
    </button>
  );
}
