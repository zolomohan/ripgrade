import "server-only";

import { getSetting } from "./db";

/**
 * The two shapes a list of films can be read in.
 *
 * A grid is for recognising and a list is for reading — the same division the
 * library shelf and the film page have always had between a poster and a row of
 * figures.
 */
export type Layout = "grid" | "rows";

export const LAYOUT_KEY = "listLayout";

/**
 * How every list in this app is drawn, answered once.
 *
 * This lived in the address, as `?v=`, and was asked again on each of the three
 * pages that draw a list both ways — the downloads log, the jobs page, the
 * wishlist's finds. That put it beside two questions it is not the same kind of
 * question as: a sort key and a cut are facts about one list, and whether you
 * read posters or rows is a fact about the person reading them. Answered in a
 * URL it was a preference you restated on every page you opened, and lost the
 * moment you shared the link.
 *
 * So it is a setting, under Themes, and the lists simply obey it. Grid is the
 * default for the reason it always led the toggle: every row on these pages is
 * a film, and a film is recognised by its artwork long before its filename.
 */
export const readLayout = (): Layout =>
  getSetting(LAYOUT_KEY) === "rows" ? "rows" : "grid";
