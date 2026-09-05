"use client";

import { Glass } from "./glass";

/**
 * The sheet the page is read off, once the backdrop is the whole window.
 *
 * With the picture held to a band the page had nothing behind it: content sat
 * on `--background`, which is what `--glass` is mixed from, and a pane of glass
 * over the page colour is invisible on purpose — see the note at the head of
 * globals.css. Fill the window with a frame of the film and that stops being
 * true. Text over artwork is text you read twice, and the honest fix is the one
 * the rail already uses: put a pane between them and let the picture arrive
 * through it, blurred and bent and still recognisably the picture.
 *
 * So this is Glacé's surface at the app's own tuning, exactly like the rail and
 * every dialog — the Glass setting moves it with the rest. What it is not is a
 * card: a rectangle of frosted glass with four hard edges laid over a photo is
 * a screenshot pasted onto a wallpaper. It is masked instead, fading in over
 * the foot of the hero and out at the sides and the bottom, so the page has no
 * edge to find and simply gets denser the further down it you read. The mask is
 * in globals.css, where `--hero-h` is, because where it starts is a fact about
 * which hero the page opened with.
 *
 * Rendered once in the root layout, after the page, and shown only where there
 * is a hero to stand under — `:has()` answers that in CSS, so a page still says
 * nothing about any of this. Decorative and inert: `pointer-events: none` and
 * `aria-hidden`, because it is a lighting condition rather than a thing.
 *
 * No sheen, for the reason the rail gives: the sweep is a highlight travelling
 * across something you are pointing at, and this is a sheet the size of the
 * page that nothing can point at.
 */
export function PageGlass() {
  return <Glass aria-hidden sheen={false} radius={0} className="page-glass" />;
}
