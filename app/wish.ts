"use client";

import { toast } from "glaceui";

import { addWish, removeWish, type SearchHit } from "./actions";

/**
 * One wishlist write, and the sentence for when it does not happen.
 *
 * Every heart in this app is optimistic — see app/heart.tsx: the mark moves on
 * the press and the write goes out behind it, because the wishlist is the one
 * thing here you alter without a page behind it and without waiting for
 * anything. That trade only holds while the write is watched. Four callers
 * each awaited it and read nothing back, so a failure left a filled heart
 * standing over a list that never got the film — the app's own confirmation,
 * saying the opposite of what happened.
 *
 * Returns whether it stuck, so the caller can put its mark back where it was.
 */
export async function saveWish(
  wanted: boolean,
  hit: SearchHit,
): Promise<boolean> {
  try {
    if (wanted) await addWish(hit);
    else await removeWish(hit.id, hit.kind);
    return true;
  } catch {
    /* Not the error's own words, which are a database's or a fetch's. This is
       one press on a poster, and all it has to say is that it did not take. */
    toast.error(
      wanted
        ? `${hit.title} could not be added to the wishlist.`
        : `${hit.title} could not be taken off the wishlist.`,
    );
    return false;
  }
}
