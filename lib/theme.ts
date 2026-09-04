import "server-only";

import { getSetting } from "./db";

/**
 * Which of the app's two colour schemes is drawn, as a question with three
 * answers rather than two.
 *
 * The app has had both since the beginning — the light palette is `:root` in
 * globals.css and the dark one is an override on top of it — but the only
 * thing ever allowed to choose between them was the machine. That is the right
 * default and a poor rule: a laptop set to follow the sun does not know that
 * this app is looked at in a dark room with the curtains shut, or that its
 * shelves of artwork read better on white.
 *
 * So `system` stays the default and stays first-class. It is not "no answer";
 * it is the answer that defers, and the one most people should keep.
 */
export type Theme = "light" | "dark" | "system";

export const THEME_KEY = "theme";

/** What goes on <html>, which is nothing at all when the machine decides. */
export const themeAttribute = (theme: Theme): "light" | "dark" | undefined =>
  theme === "system" ? undefined : theme;

export const readTheme = (): Theme => {
  const stored = getSetting(THEME_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
};
