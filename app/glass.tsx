"use client";

import {
  Glass as Pane,
  GlassButton as PaneButton,
  GlassCard as PaneCard,
  type GlassButtonProps,
  type GlassCardProps,
  type GlassProps,
} from "glaceui";
import { createContext, useContext, type Ref } from "react";

import { GLASS_DEFAULTS, type GlassTuning } from "@/lib/glass";

/**
 * Glass, as this app draws it — and the only door to Glacé it has.
 *
 * Nothing else imports `glaceui` directly, and that is the whole point of this
 * file. Glacé's surfaces take their look as props, so a pane built by hand is a
 * pane with seven numbers written on it; a second one built next month gets
 * seven more, chosen by whoever was there. What the app wants is one answer to
 * "what does glass look like here", set in Settings, obeyed by every surface —
 * including the ones that do not exist yet. That is only possible if there is a
 * single place the props are filled in, so this is it.
 *
 * `Glass`, `GlassButton` and `GlassCard` below are Glacé's, wearing the
 * preference. Import them from here, pass geometry — `radius`, `as`, a class —
 * and leave the optics alone. See lib/glass.ts for what the knobs are and why
 * they can be global at all.
 *
 * The tuning arrives from the root layout, which reads it on the server, so the
 * first paint is already the right glass rather than the default glass caught
 * changing its mind. See `useGlass`.
 */
const Tuning = createContext<GlassTuning>(GLASS_DEFAULTS);

/** What glass is set to, for anything that has to draw its own. */
export const useGlass = () => useContext(Tuning);

export function GlassProvider({
  tuning,
  children,
}: {
  tuning: GlassTuning;
  children: React.ReactNode;
}) {
  return <Tuning.Provider value={tuning}>{children}</Tuning.Provider>;
}

/**
 * The preference as the props Glacé actually takes.
 *
 * Two translations happen here. `refract: 0` is the lens off, which Glacé
 * spells `false` — a zero displacement would still build a map and still pay
 * for the filter, to bend nothing. And `fallbackBlur` is set to the same blur
 * rather than left at Glacé's 14: it is what Safari and Firefox get instead of
 * refraction, and a browser with no lens should at least be as frosted as the
 * one that has it. Opacity is not here — it is a colour, and it reaches the
 * surfaces as `--glass-opacity` from the root layout. See globals.css.
 */
const optics = (tuning: GlassTuning) => ({
  refract: tuning.refract === 0 ? (false as const) : tuning.refract,
  bezel: tuning.bezel,
  profile: tuning.profile,
  aberration: tuning.aberration,
  saturation: tuning.saturation,
  blur: tuning.blur,
  fallbackBlur: tuning.blur,
  sheen: tuning.sheen,
});

/*
 * The preference first and the call site's props after it, so an override is
 * still possible — but it is a thing to be able to do rather than a thing to
 * do. A pane that names its own blur is a pane the Glass setting cannot reach,
 * and the surface next to it will move without it.
 */

/** Any element, in glass. `as` chooses which. */
export function Glass({
  ref,
  ...rest
}: GlassProps & { ref?: Ref<HTMLElement> }) {
  return <Pane ref={ref} {...optics(useGlass())} {...rest} />;
}

/**
 * A button in glass, with the sheen and the press Glacé gives it.
 *
 * It takes the rim and the colour but not the blur: Glacé holds a button's own
 * at 2.5px and does not expose it, on the reasoning that something this small
 * is read as an object rather than as a window. So the frosting setting does
 * not reach here, and it is the one place in the app where that is true.
 */
export function GlassButton({
  ref,
  ...rest
}: GlassButtonProps & { ref?: Ref<HTMLButtonElement> }) {
  const { refract, bezel, profile, aberration, saturation } =
    optics(useGlass());
  return (
    <PaneButton
      ref={ref}
      refract={refract}
      bezel={bezel}
      profile={profile}
      aberration={aberration}
      saturation={saturation}
      {...rest}
    />
  );
}

/** A padded pane, for when the glass is the container rather than the chrome. */
export function GlassCard({
  ref,
  ...rest
}: GlassCardProps & { ref?: Ref<HTMLElement> }) {
  return <PaneCard ref={ref} {...optics(useGlass())} {...rest} />;
}
