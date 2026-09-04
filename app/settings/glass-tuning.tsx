"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { BUTTON } from "@/app/button";
import { Explained, FIELD } from "@/app/controls";
import { Art } from "@/app/art";
import { Glass } from "@/app/glass";
import {
  GLASS_PROFILES,
  GLASS_RANGE,
  type GlassPoster,
  type GlassProfile,
  type GlassTuning,
} from "@/lib/glass";
import { resetGlassTuning, setGlassTuning } from "../actions";
import { Toggle } from "./parts";

/**
 * One slider, and the number it is at.
 *
 * The same range input the queue threshold uses, and styled by the same
 * `.slider` in globals.css — six of them in a column is exactly the case for
 * not writing it six times. The value is held by the caller rather than here,
 * because what the caller has is one object with six numbers in it and a
 * slider that owned its own would have to be told when the reset moved it.
 *
 * The explanation is on the label, and it does two jobs in one sentence: what
 * the number is, and what to watch in the preview to the left of it while you
 * drag. Those were two separate things on the page for a while — a hint under
 * every slider and a legend under the picture — which is six paragraphs and a
 * list to say six things, in a column narrow enough that each was four lines
 * deep. The panel was mostly prose about a panel that is mostly a picture.
 *
 * The server only hears about a drag when it ends. A range has no event for
 * that, so the three ways of letting go stand in for one — the mouse, the
 * keyboard, and leaving.
 */
function Knob({
  label,
  hint,
  value,
  range,
  format,
  onDrag,
  onSettle,
}: {
  label: string;
  /** What it is, and what to look at while it moves. */
  hint: string;
  value: number;
  range: { min: number; max: number; step: number };
  /** What the number reads as, which is never the raw one: a fraction is a
   *  percentage and a length has "px" after it. */
  format: (value: number) => string;
  onDrag: (value: number) => void;
  onSettle: (value: number) => void;
}) {
  const travel = (value - range.min) / (range.max - range.min);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm">
          <Explained hint={hint}>{label}</Explained>
        </p>
        <span className="font-score text-sm font-semibold tabular-nums opacity-70">
          {format(value)}
        </span>
      </div>

      <input
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        aria-label={label}
        aria-valuetext={format(value)}
        onChange={(event) => onDrag(Number(event.target.value))}
        onPointerUp={(event) => onSettle(Number(event.currentTarget.value))}
        onKeyUp={(event) => onSettle(Number(event.currentTarget.value))}
        onBlur={(event) => onSettle(Number(event.target.value))}
        className="slider"
        // The thumb travels between its own two edges rather than the full
        // width, so the fill is measured the same way or it runs ahead at both
        // ends. Lifted from `QueueThreshold`, which has the same input.
        style={
          {
            "--fill": `calc(0.5rem + (100% - 1rem) * ${travel})`,
          } as CSSProperties
        }
      />
    </div>
  );
}

/**
 * The four knobs that make Glacé build a new lens, held back until you stop.
 *
 * Refraction, rim, fringe and profile are all in the key Glacé caches its
 * displacement maps under, so every intermediate value a drag passes through
 * builds a map, mounts an SVG filter for it, and leaves both in the document
 * for the rest of the session. Dragging the refraction slider end to end is
 * eighty of them. Blur, saturation and opacity are not in that key — they are
 * a filter string and a colour — so those stay live, which is why they are not
 * in here.
 *
 * A tenth of a second, which is under the pause between deciding and letting
 * go: in practice the pane has already moved by the time you look at it.
 */
function useSettled({ refract, bezel, profile, aberration }: GlassTuning) {
  const [lens, setLens] = useState({ refract, bezel, profile, aberration });

  useEffect(() => {
    const timer = setTimeout(
      () => setLens({ refract, bezel, profile, aberration }),
      100,
    );
    return () => clearTimeout(timer);
  }, [refract, bezel, profile, aberration]);

  return lens;
}

/**
 * Where the pane is standing and how big it is, which is not a setting.
 *
 * `null` for the position means it has not been picked up yet, and the pane is
 * centred by CSS rather than by arithmetic — so nothing has to be measured
 * before the first paint, and the preview is never briefly in the corner. The
 * first grab is what turns that into a pair of numbers, read off the pane's
 * own rectangle at the moment it is taken hold of.
 *
 * `null` for the height means the pane is as tall as what is inside it, which
 * is how it starts and how a double-click puts it back.
 */
type Box = { x: number | null; y: number | null; w: number; h: number | null };

const CENTRED: Box = { x: null, y: null, w: 256, h: null };

/** Small enough to be a chip, and not so small the lens has nothing to bend. */
const LEAST = { w: 120, h: 72 };

const within = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), Math.max(low, high));

/**
 * The material itself, over the thing it is actually laid over.
 *
 * A pane of glass on a flat page is invisible on purpose — that is the whole
 * argument of `--glass` in globals.css — so a preview standing on the settings
 * page would show six sliders moving nothing. What it stands on instead is
 * your own shelf: the posters the rail passes over every time you scroll the
 * library, which is the situation the setting is actually for. Invented
 * artwork would be a preview of a case that never arises.
 *
 * And a shelf answers the objection that argued for a ruled grid here first.
 * A displacement is only visible on something whose shape you already know —
 * a poster bent at the rim still looks like a poster — but a shelf is a grid
 * of rectangles with gaps between them, and those gaps are straight lines. It
 * is the poster edges you watch, not the pictures.
 *
 * The shelf covers the stage, and what shows between the posters is the page's
 * own black rather than a lighter panel — a preview standing on a surface this
 * app does not have is a preview of the wrong room. A library too small to
 * cover it is topped up from TMDb's trending; see `getGlassPosters`.
 *
 * The ruled stage is still here for the library that has none yet and no TMDb
 * to borrow from. It is the one case where invented lines are the only lines
 * there are. See `.glass-stage`.
 *
 * You can pick the pane up and carry it across the shelf, and drag its corner
 * to change its size. Neither is a toy. A lens over one poster is a lens over
 * one poster, and half of what these sliders do only shows where an edge runs
 * under the rim — so being able to go and find an edge is the difference
 * between a preview and a picture of a preview. Size matters for a harder
 * reason: Glacé builds the displacement at the element's real dimensions, and
 * the rim is a fraction of the shorter side, so the same seven numbers are a
 * different-looking pane at a chip's size and at a rail's. Dragging the corner
 * is the only way to see that without going and finding a surface of that size
 * in the app.
 *
 * Nothing about the box is stored. It is a way of looking at the setting, not
 * part of it, and a preview that remembered where you left it would be a
 * second piece of state on a panel whose whole subject is the first.
 *
 * The pane is the app's own `Glass`, not a drawing of one, and it is passed
 * the tuning being dragged rather than the tuning that is saved — the whole
 * point is to see the change before committing it. Opacity arrives as `--g-bg`
 * because it is normally inherited from the document, and this pane has to
 * disagree with the document until you let go.
 */
function Preview({
  tuning,
  posters,
}: {
  tuning: GlassTuning;
  posters: GlassPoster[];
}) {
  const lens = useSettled(tuning);
  const stage = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLElement>(null);
  const [box, setBox] = useState<Box>(CENTRED);

  /*
   * What was taken hold of, and where. A ref rather than state: it is read by
   * the move that follows and never drawn, and a re-render per pointer event
   * to store it would be a re-render per pixel.
   *
   * `hold` is where in the pane the pointer landed, so a drag carries it from
   * that point instead of snapping its corner under the cursor. `at` is the
   * pane's own place on the stage when the grab began, which is what a resize
   * measures out from.
   */
  const grip = useRef<{
    mode: "move" | "size";
    hold: { x: number; y: number };
    at: { x: number; y: number };
  } | null>(null);

  /* Takes the mode as an argument rather than returning a handler for it. A
     `begin("move")` in the JSX is a call during render, and the ref it reads
     is read during render as far as anything checking can tell — which is a
     rule worth keeping even where this particular reading happens later. */
  const begin = (
    mode: "move" | "size",
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    const floor = stage.current?.getBoundingClientRect();
    const held = pane.current?.getBoundingClientRect();
    if (!floor || !held) return;

    // The corner is inside the pane, so its own grab would otherwise start a
    // move as well as a resize.
    event.stopPropagation();
    // Or the pointer paints a selection across the words on the pane as it
    // goes; `touch-none` in the class list is the same argument for a finger.
    event.preventDefault();
    pane.current?.setPointerCapture(event.pointerId);

    const at = { x: held.left - floor.left, y: held.top - floor.top };
    grip.current = {
      mode,
      hold: { x: event.clientX - held.left, y: event.clientY - held.top },
      at,
    };

    // The grab is also what turns "centred, and as tall as its contents" into
    // four numbers — measured off the pane as it actually stands, so it does
    // not shift under the hand that just took hold of it.
    setBox({ x: at.x, y: at.y, w: held.width, h: held.height });
  };

  const drag = (event: ReactPointerEvent<HTMLElement>) => {
    const held = grip.current;
    const floor = stage.current?.getBoundingClientRect();
    if (!held || !floor) return;

    const x = event.clientX - floor.left;
    const y = event.clientY - floor.top;

    setBox((was) =>
      held.mode === "move"
        ? {
            ...was,
            x: within(x - held.hold.x, 0, floor.width - was.w),
            y: within(y - held.hold.y, 0, floor.height - (was.h ?? 0)),
          }
        : {
            ...was,
            w: within(x - held.at.x, LEAST.w, floor.width - held.at.x),
            h: within(y - held.at.y, LEAST.h, floor.height - held.at.y),
          },
    );
  };

  /* Held apart from the rest of the style rather than written inline with it,
     because the two branches are different shapes and a union of object
     literals will not go through the cast the custom property below needs. */
  const placed: CSSProperties =
    box.x === null
      ? { left: "50%", top: "50%", transform: "translate(-50%, -50%)" }
      : { left: box.x, top: box.y ?? 0 };

  const release = (event: ReactPointerEvent<HTMLElement>) => {
    grip.current = null;
    pane.current?.releasePointerCapture(event.pointerId);
  };

  return (
    <div
      ref={stage}
      className={`relative min-h-72 flex-1 overflow-hidden rounded-card border border-line ${
        posters.length ? "bg-background" : "glass-stage"
      }`}
    >
      {/*
       * The shelf. Decorative in the strict sense — these are the same posters
       * the library page draws, and here they are a backdrop with nothing to
       * open, so they are hidden from anything that reads the page aloud.
       *
       * Denser than a real shelf and cropped by the box: what the preview
       * needs is edges crossing the pane's rim, and a shelf of four large
       * posters can be arranged so that none of them do.
       */}
      {posters.length > 0 && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 grid grid-cols-4 gap-1.5 p-1.5 sm:grid-cols-6 lg:grid-cols-8"
        >
          {posters.map((poster, at) => (
            <Art
              key={`${poster.poster ?? poster.posterRemote}-${at}`}
              src={poster.poster}
              remote={poster.posterRemote}
              version={poster.artAt}
              size="w92"
              loading="lazy"
              className="aspect-[2/3] w-full rounded-chip object-cover"
            />
          ))}
        </div>
      )}

      <Glass
        ref={pane}
        radius={18}
        refract={lens.refract === 0 ? false : lens.refract}
        bezel={lens.bezel}
        profile={lens.profile}
        aberration={lens.aberration}
        blur={tuning.blur}
        fallbackBlur={tuning.blur}
        saturation={tuning.saturation}
        sheen={tuning.sheen}
        onPointerDown={(event) => begin("move", event)}
        onPointerMove={drag}
        onPointerUp={release}
        onPointerCancel={release}
        // Back to the middle at the size it started, for when it has been
        // carried into a corner and shrunk to a chip.
        onDoubleClick={() => setBox(CENTRED)}
        style={
          {
            ...placed,
            width: box.w,
            height: box.h ?? undefined,
            "--g-bg": `color-mix(in srgb, var(--background) ${tuning.opacity}%, transparent)`,
          } as CSSProperties
        }
        className="glass-preview flex touch-none flex-col gap-2 overflow-hidden p-4 select-none"
      >
        {/* Rows, because the panes this app actually has are rows of links on
            glass, and the question a preview has to answer is whether you can
            still read them over a poster. */}
        <p className="font-logo text-2xl leading-none lowercase">ripgrade</p>
        <p className="text-sm">Library</p>
        <p className="text-sm opacity-60">Collections</p>
        <p className="text-[11px] opacity-45">
          Small print, which is what goes first.
        </p>

        {/* Two strokes in the corner, which is the whole convention for this —
            no word, because the pane is already covered in words and this one
            would be the only one on it that was not part of the picture. */}
        <span
          aria-hidden
          onPointerDown={(event) => begin("size", event)}
          className="absolute right-0 bottom-0 grid h-6 w-6 cursor-nwse-resize place-items-center opacity-40 transition-opacity hover:opacity-100"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="h-3 w-3"
          >
            <path d="M20 10 10 20M20 16l-4 4" />
          </svg>
        </span>
      </Glass>
    </div>
  );
}

/**
 * What glass is, for every pane in the app at once.
 *
 * These are seven properties of one material, not seven settings — which is
 * why they are one panel rather than a row each in the Themes tab. You are not
 * deciding how much blur the rail has; you are deciding what glass looks like
 * here, and then everything made of it follows.
 *
 * Two panes, and the wide one is the picture. A column of sliders with numbers
 * beside them is a specification, and nobody knows what 5px of displacement or
 * a bevelled 5% rim is until they have seen one — so the sliders are the narrow half
 * and the thing they act on is the other seventy per cent of the row, drawn to
 * exactly the height of them. What to watch for each of them is on its label,
 * where it is asked for rather than standing there; a legend under the picture
 * said the same things always, and a picture with a key under it is a picture
 * that has given up. One column below the small breakpoint, preview first: on
 * a phone the choice is between a picture with no controls in view and
 * controls with no picture, and the picture is the half that cannot be guessed
 * at.
 *
 * Every commit is a write and a `refresh()`, which redraws the layout the rail
 * is drawn from — so the rail moves too, a moment behind the preview. The
 * numbers keep up locally in the meantime.
 */
export function GlassTuning({
  tuning,
  posters,
}: {
  tuning: GlassTuning;
  posters: GlassPoster[];
}) {
  // What the sliders show, which runs ahead of what is stored. Re-seeded from
  // the server whenever the props change — a reset moves seven of them at once,
  // and they are the same seven this is holding.
  const [shown, setShown] = useState(tuning);
  const [at, setAt] = useState(tuning);
  const [pending, startTransition] = useTransition();

  if (at !== tuning) {
    setAt(tuning);
    setShown(tuning);
  }

  const drag = (next: Partial<GlassTuning>) =>
    setShown((was) => ({ ...was, ...next }));

  const settle = (next: Partial<GlassTuning>) => {
    const key = Object.keys(next)[0] as keyof GlassTuning;
    if (next[key] === tuning[key]) return;
    startTransition(async () => setGlassTuning(next));
  };

  const px = (value: number) => `${value}px`;

  return (
    <div className="flex flex-col gap-6 sm:flex-row sm:items-stretch">
      {/* The picture. `items-stretch` above and `flex-1` on the stage inside,
          so the shelf is exactly as tall as the column of controls beside it —
          two panes of different heights read as two things that happened to be
          put next to each other, and these are one control and its subject. */}
      <div className="flex min-w-0 flex-col sm:w-[70%]">
        <Preview tuning={shown} posters={posters} />
      </div>

      {/* The controls. Narrow on purpose — see the note on this component. */}
      <div className="flex min-w-0 flex-col gap-4 sm:w-[30%]">
        <Knob
          label="Refraction"
          hint={
            shown.refract === 0
              ? "Off. The pane is frosted and nothing is bent — the poster edges run straight under it."
              : "How far the rim pulls what passes behind it. Watch the gaps between the posters where they cross the edge of the pane. Held to half a pane's shorter side, so one number suits every size."
          }
          value={shown.refract}
          range={GLASS_RANGE.refract}
          format={(value) => (value === 0 ? "Off" : px(value))}
          onDrag={(refract) => drag({ refract })}
          onSettle={(refract) => settle({ refract })}
        />

        <Knob
          label="Rim"
          hint="How wide the bending band is, as a share of the shorter side — how far in from the edge the poster gaps are still being pulled. Wide enough and the pane stops having an edge and becomes a lens."
          value={shown.bezel}
          range={GLASS_RANGE.bezel}
          format={(value) => `${Math.round(value * 100)}%`}
          onDrag={(bezel) => drag({ bezel })}
          onSettle={(bezel) => settle({ bezel })}
        />

        <Knob
          label="Fringe"
          hint="How far the bend splits into colour along those same bent edges, the way it does at the rim of a thick sheet. A little reads as glass; a lot reads as a printing error."
          value={shown.aberration}
          range={GLASS_RANGE.aberration}
          format={px}
          onDrag={(aberration) => drag({ aberration })}
          onSettle={(aberration) => settle({ aberration })}
        />

        <Knob
          label="Blur"
          hint="How far the artwork behind a pane is smeared, and so how much of it survives behind the words. Laid over the bend rather than instead of it — the rim goes on pulling what passes under it, softly once this is up. At none, a pane is a tinted hole in the page and the shelf reads straight through it."
          value={shown.blur}
          range={GLASS_RANGE.blur}
          format={(value) => (value === 0 ? "None" : px(value))}
          onDrag={(blur) => drag({ blur })}
          onSettle={(blur) => settle({ blur })}
        />

        <Knob
          label="Saturation"
          hint="What the backdrop's colour is pushed to. Compare the posters under the pane against the same posters beside it — blur alone gives a grey smear, and this is what keeps them reading as posters."
          value={shown.saturation}
          range={GLASS_RANGE.saturation}
          format={(value) => `${value}%`}
          onDrag={(saturation) => drag({ saturation })}
          onSettle={(saturation) => settle({ saturation })}
        />

        <Knob
          label="Opacity"
          hint="How much of the page's own background a pane holds — frosting smears the artwork, this covers it. At a hundred nothing shows through at any blur."
          value={shown.opacity}
          range={GLASS_RANGE.opacity}
          format={(value) => (value === 100 ? "Solid" : `${value}%`)}
          onDrag={(opacity) => drag({ opacity })}
          onSettle={(opacity) => settle({ opacity })}
        />

        {/*
         * Name and value on one line, which is what the six knobs above it do
         * with theirs — the profile in force stands where their numbers do, and
         * the column reads as seven settings rather than six and a paragraph.
         *
         * And nothing ruled over it, which is the other half of that. It was a
         * `border-t`, the join the rows inside a setting make, and it was
         * saying the dropdown is a different subject from the six numbers above
         * it. It is not: it is the seventh of them.
         *
         * What parts it from the reset below is `.rule-head`, weighted where
         * the labels begin and trailing off away from them. That is the rule
         * this app uses when the line belongs to the thing under it rather
         * than between two things of equal standing — the same one the sidebar
         * sets between its groups of links, and the same one a dialog's title
         * stands on. It belongs to the reset: everything above it is what glass
         * is, and the button under it is what to do about all of it.
         */}
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm">
            <Explained hint="How the surface curves across the rim, which is the shape of the bend you can see in the poster edges. Convex is a lens lying on the page and pushes them outward, concave caves in, bevel is the flat cut edge of a thick sheet.">
              Edge profile
            </Explained>
          </p>

          {/*
           * A dropdown, where the six above it are sliders and this was a
           * segmented switch. The switch is the app's control for a choice
           * between two or three words and it is the right one at the top of a
           * page — but this column is a third of the panel, and three words
           * laid along a track in it had to be scrolled sideways to be read.
           * A field that names the one in force and opens the other two is
           * what the width allows, and it is the shape every other named
           * choice in this app is set in. See `FIELD.select`.
           */}
          <div className="relative shrink-0">
            <select
              value={shown.profile}
              aria-label="Edge profile"
              onChange={(event) =>
                startTransition(async () =>
                  setGlassTuning({
                    profile: event.target.value as GlassProfile,
                  }),
                )
              }
              className={FIELD.select}
            >
              {GLASS_PROFILES.map(({ key, label }) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>

            {/* Every engine draws its own chevron and none of them a pill, so
                `FIELD.select` drops the platform's and leaves the room this
                fills — the same mark, in the same place, as the sort field on
                the release search. */}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              className="pointer-events-none absolute top-1/2 right-2.5 h-3 w-3 -translate-y-1/2 opacity-40"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </div>
        </div>

        {/* A rule and a button under it. The heading it had said in four words
            what the button says in one, and a title over a single control is a
            section with nothing in it but the control. */}
        {/* The odd one out, which is why it is last rather than among the
            sliders: the six above say what glass is made of, and this says what
            it does with the light in the room. Same row shape as the profile,
            so the column still reads as a list of settings and their values.

            Named for the thing rather than for what it looks like. "Shimmer" is
            the word anyone reaches for on seeing it and the wrong one to label
            it with: it describes the sweep and says nothing about the corner
            light, which is the same switch and the half you actually notice on
            a dialog. Sheen is what the kit calls it and what the field is, so
            the setting, the code and the CSS now agree. */}
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm">
            <Explained hint="The light a surface catches: a streak that sweeps across as the pointer crosses it, and a highlight sitting in its top left corner. Hover the pane on the left to see both. The rail never catches either, whatever you set here — it is the one surface you are not looking at, and a light at the corner of your eye asking to be looked at, several times a minute, about nothing, is the thing this switch exists to stop.">
              Sheen
            </Explained>
          </p>

          <Toggle
            on={shown.sheen}
            label="Sheen"
            disabled={pending}
            onChange={() =>
              startTransition(async () =>
                setGlassTuning({ sheen: !shown.sheen }),
              )
            }
          />
        </div>

        <div aria-hidden className="rule-head" />

        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => startTransition(async () => resetGlassTuning())}
            // On the button rather than in an `Explained`, which is a second
            // tab stop and a dotted underline — both wrong inside a control
            // that already says what it does.
            title="All of them at once, as the app ships them: a 5px lens on a bevelled 5% rim, blurred eight, saturated to 150%, a little under two thirds of the page behind it, and no sheen."
            className={`${BUTTON.secondary} self-start`}
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
