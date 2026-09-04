/**
 * What glass is made of, as one answer the whole app reads.
 *
 * Every frosted surface here is a Glacé pane — see app/glass.tsx — and Glacé
 * takes its look as props: how far the rim bends what is behind it, how wide
 * that bending band is, how much the bend splits into colour, how much blur
 * and saturation sit on top of it. Written at the call sites, those numbers
 * become an opinion per component: the rail says 44 and the bar says 26 and
 * nobody can say why, and the fourth pane somebody adds next year invents a
 * third set. So they are a preference instead, set once and obeyed everywhere.
 *
 * Which is possible because none of them are really facts about a particular
 * pane. The rim is a fraction of the shorter side, so it is the same rim on a
 * rail and on a chip. The displacement is in pixels, but Glacé clamps it to
 * half the element's shorter side before it builds the map — so one number
 * that suits a column the height of the window quietly becomes the largest
 * bend a 52px bar can take, rather than a broken one. Only the corner radius
 * is genuinely about the shape of the thing it is rounding, and that is why it
 * is not in here.
 *
 * Pure on purpose: no database and no `server-only`, because the settings page
 * needs these ranges to draw its sliders and the client needs the defaults to
 * render before the server has said anything. The reading and writing is in
 * app/actions.ts, where the rest of this app's settings are read and written.
 */

/**
 * How the surface bends across the rim.
 *
 * Convex is a lens laid on the page and magnifies outward; concave caves in;
 * bevel is the crisp cut edge of a thick sheet. Glacé's own three, named as it
 * names them.
 */
export type GlassProfile = "convex" | "concave" | "bevel";

export type GlassTuning = {
  /** Edge displacement in px. Zero is the lens off — blur and nothing else. */
  refract: number;
  /** The bending band, as a fraction of the pane's shorter side. */
  bezel: number;
  profile: GlassProfile;
  /** How far the bend splits into colour at the rim, in px. */
  aberration: number;
  /** Blur, in px, laid over the bend rather than instead of it. */
  blur: number;
  /** What the backdrop's colour is pushed to, as a percentage. Blur alone
   *  gives a grey smear; this is what makes a shelf of posters passing under
   *  a pane read as posters. */
  saturation: number;
  /** How much of the page's own background the pane holds, as a percentage.
   *  A hundred is opaque and nothing shows through at any blur. */
  opacity: number;
  /**
   * The light a surface catches: a streak that sweeps across it as the pointer
   * crosses, and a static highlight in its top left corner. Two flourishes and
   * one switch, because they are one thing to look at.
   *
   * The only one of these that is not a property of the material. The other six
   * say what glass is; this says whether it catches the light as you move past
   * it, which is a fact about the room rather than about the pane. It is in the
   * same record because it is the same question — what does glass do here — and
   * because a toggle in its own setting would be a panel with one switch in it.
   */
  sheen: boolean;
};

export const GLASS_KEY = "glass";

/**
 * One poster on the shelf behind the preview — the least of a film it takes to
 * draw its artwork, which is what `Art` in app/art.tsx asks for.
 *
 * No path and no title: nothing here is a film you can click, it is what the
 * rail passes over. Named in this file rather than beside the preview because
 * the settings page reads these on the server and the preview draws them on
 * the client, and a type is the one thing both halves can share.
 */
export type GlassPoster = {
  /** The file on the drive, which is the artwork proper. */
  poster?: string;
  /** The TMDb path it came from, for when the drive is unplugged. */
  posterRemote?: string;
  /** When the folder was last indexed, so a replaced poster is not cached. */
  artAt?: number;
};

/**
 * The look the app ships with, and the one Reset goes back to.
 *
 * These were the rail's numbers to begin with — the props that were written on
 * it a line at a time, lifted into a record. They are not any more. What is
 * here is the tuning arrived at by sitting in front of the thing and moving the
 * sliders until it looked right, which is the only way any of these could have
 * been chosen: nobody picks a chromatic fringe from a specification.
 *
 * It is a much quieter glass than the one it replaces. A 5px lens rather than
 * 44 — the rim bends what crosses it just enough to read as thickness, where
 * the old figure pulled a poster visibly sideways and made the edge of the rail
 * the most interesting thing on the page. Bevel rather than convex, so what the
 * rim does is a flat cut rather than a dome. 150% of saturation rather than
 * 180, and 8px of blur rather than 12, which together let more of the shelf
 * through while still keeping the links legible over it. And the sheen off:
 * no sweep on hover and no light in the corner of every dialog.
 *
 * The through-line is that a surface the whole app stands on should be quiet.
 * Every one of these was dialled *down* from the kit's own defaults, which is
 * what a UI kit's defaults are for — showing you the effect — and not what an
 * interface is for.
 */
export const GLASS_DEFAULTS: GlassTuning = {
  refract: 5,
  bezel: 0.05,
  profile: "bevel",
  aberration: 2,
  blur: 8,
  saturation: 150,
  opacity: 64,
  sheen: false,
};

/**
 * What each may be, read by the sliders that set them and by the clamp that
 * distrusts what comes back out of the database. One table, so a range cannot
 * be widened in the control and left narrow in the check.
 */
export const GLASS_RANGE = {
  refract: { min: 0, max: 80, step: 1 },
  // In hundredths, which is what the slider moves in — a fifth of the shorter
  // side is already a very fat rim and half is the whole pane bending.
  bezel: { min: 0.02, max: 0.5, step: 0.01 },
  aberration: { min: 0, max: 8, step: 1 },
  blur: { min: 0, max: 32, step: 1 },
  // Under 100 drains the backdrop rather than lifting it, which is a different
  // effect and not one this is for.
  saturation: { min: 100, max: 260, step: 5 },
  // Not down to nothing: a pane at zero is a rectangle of blur with a lit edge,
  // and the text standing on it has no ground of its own left.
  opacity: { min: 20, max: 100, step: 1 },
} as const;

/** The three profiles as the switch that picks between them wants them. */
export const GLASS_PROFILES: readonly { key: GlassProfile; label: string }[] = [
  { key: "convex", label: "Convex" },
  { key: "concave", label: "Concave" },
  { key: "bevel", label: "Bevel" },
];

const isProfile = (value: unknown): value is GlassProfile =>
  GLASS_PROFILES.some((profile) => profile.key === value);

const hold = (
  value: unknown,
  range: { min: number; max: number },
  fallback: number,
) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(range.max, Math.max(range.min, value))
    : fallback;

/**
 * The stored row, or the defaults for every part of it that is not there.
 *
 * Field by field rather than all or nothing: a tuning written before a knob
 * existed is missing exactly that knob, and throwing the whole preference away
 * over it would reset the six the reader did recognise.
 */
export function parseGlass(raw: string | undefined): GlassTuning {
  let stored: Partial<Record<keyof GlassTuning, unknown>> = {};

  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        stored = parsed as Partial<Record<keyof GlassTuning, unknown>>;
      }
    } catch {
      // A row that is not JSON is a row from a version that stored something
      // else, and the defaults are a better answer than a crash on every page.
    }
  }

  return {
    refract: hold(stored.refract, GLASS_RANGE.refract, GLASS_DEFAULTS.refract),
    bezel: hold(stored.bezel, GLASS_RANGE.bezel, GLASS_DEFAULTS.bezel),
    profile: isProfile(stored.profile)
      ? stored.profile
      : GLASS_DEFAULTS.profile,
    aberration: hold(
      stored.aberration,
      GLASS_RANGE.aberration,
      GLASS_DEFAULTS.aberration,
    ),
    blur: hold(stored.blur, GLASS_RANGE.blur, GLASS_DEFAULTS.blur),
    saturation: hold(
      stored.saturation,
      GLASS_RANGE.saturation,
      GLASS_DEFAULTS.saturation,
    ),
    opacity: hold(stored.opacity, GLASS_RANGE.opacity, GLASS_DEFAULTS.opacity),
    sheen:
      typeof stored.sheen === "boolean" ? stored.sheen : GLASS_DEFAULTS.sheen,
  };
}

/**
 * A change to one knob, against what is set now, clamped on the way in.
 *
 * The settings page sends one field at a time — a slider knows its own number
 * and nothing about the other six — and the round trip through `parseGlass`
 * is what keeps a value out of range from ever reaching the database.
 */
export const withGlass = (
  current: GlassTuning,
  next: Partial<GlassTuning>,
): GlassTuning => parseGlass(JSON.stringify({ ...current, ...next }));

export const serialiseGlass = (tuning: GlassTuning): string =>
  JSON.stringify(tuning);

/**
 * What the shut settings row says: the two numbers you would recognise the
 * look by, and the profile only when it is not the one everything else is.
 *
 * Here rather than beside the sliders because the row is drawn on the server
 * and the sliders are a client component — a function imported across that
 * boundary arrives as a reference to be rendered, not as something to call.
 */
export const glassSummary = (tuning: GlassTuning): string =>
  [
    tuning.refract === 0 ? "No lens" : `Lens ${tuning.refract}px`,
    tuning.blur === 0 ? "no blur" : `blur ${tuning.blur}px`,
    `${tuning.opacity}%`,
    tuning.profile === GLASS_DEFAULTS.profile ? null : tuning.profile,
    tuning.sheen ? null : "no sheen",
  ]
    .filter(Boolean)
    .join(" · ");
