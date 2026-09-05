import { ViewTransition } from "react";

import { ScoreRing } from "@/app/score-card";
import { collectionTheme, ScoreDial } from "@/app/score-circle";
import { collectionScoreName } from "@/lib/routes";
import type { CollectionFilm } from "@/lib/collections";

/**
 * How a set scores, in the two places it is read.
 *
 * The number was worked out twice — once on TMDb's collection page, once on a
 * set of your own — and drawn in one of them. It is now the head of every row
 * in the list as well, which is a third copy of the same arithmetic and the
 * first time the two drawings have had to agree pixel for pixel. So both the
 * sum and the dial live here, and the row and the page ask this for them.
 */

/**
 * The set's standing: the average of what you actually hold.
 *
 * The films you have not got score nothing, and counting them would only drag
 * the number toward zero for being absent — which is the other question these
 * pages already answer, in a shelf of its own with the word "missing" over it.
 *
 * Null rather than zero where you hold none of it. A set of films you have not
 * got yet has nothing to grade, and 0 is a grade — the worst one there is.
 */
export function collectionAverage(owned: CollectionFilm[]): number | null {
  if (owned.length === 0) return null;

  return Math.round(
    owned.reduce((sum, film) => sum + (film.owned?.score ?? 0), 0) /
      owned.length,
  );
}

/** The dial at the head of a row, in pixels and in the rem the row measures in. */
export const SCORE_DIAL_PX = 44;
export const SCORE_DIAL_REM = SCORE_DIAL_PX / 16;

/**
 * The set's standing at the head of its row.
 *
 * Small, because the row is a line of text and this is the first thing on it —
 * but the same ring in the same proportions as the one it opens into, which is
 * what lets it simply grow into place rather than being swapped for it.
 *
 * Drawn even where there is nothing to grade, as an empty ring. The names down
 * the list line up under each other, and a row that skipped the dial would be
 * a name starting three-quarters of an inch to the left of every other one.
 */
export function SetScoreDial({
  score,
  transitionKey,
}: {
  score: number | null;
  /** The set's own key, which is what pairs this with the page's ring. */
  transitionKey: number | string;
}) {
  if (score === null) {
    return (
      <div
        aria-hidden
        style={{ width: SCORE_DIAL_PX, height: SCORE_DIAL_PX }}
        className="grid shrink-0 place-items-center rounded-full border border-dashed border-line text-xs opacity-35"
      >
        —
      </div>
    );
  }

  return (
    <ViewTransition
      name={collectionScoreName(transitionKey)}
      // The poster's own flight: two square boxes, so the snapshot scales
      // uniformly and the blur across the middle hides the interpolation
      // between a 44px ring and a 112px one. See `.morph` in globals.css.
      share="morph"
      default="none"
    >
      <ScoreDial
        score={score}
        // A shelf is only green when there is nothing left to better in it —
        // see `collectionTheme`, which is why this is not the library's own
        // banding.
        theme={collectionTheme(score)}
        size={SCORE_DIAL_PX}
        title={`${score} of 100 on average`}
        srLabel={`Average score ${score} of 100`}
      />
    </ViewTransition>
  );
}

/**
 * And the same reading at the head of the set's own page.
 *
 * The ring a film carries, at the size a film carries it: one number for the
 * shelf, drawn the way every other score in the app is. It wears the row's name
 * so the dial you clicked is the thing that arrives here.
 */
export function SetScoreRing({
  score,
  transitionKey,
}: {
  score: number | null;
  transitionKey: number | string;
}) {
  if (score === null) return null;

  return (
    <ViewTransition
      name={collectionScoreName(transitionKey)}
      share="morph"
      default="none"
    >
      <ScoreRing
        score={score}
        ring={collectionTheme(score).stroke}
        caption="average"
      />
    </ViewTransition>
  );
}
