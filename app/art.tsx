"use client";

import { useState, ViewTransition } from "react";

import { imageUrl } from "@/lib/image-url";
import { artUrl } from "@/lib/routes";

/**
 * An image that survives the drive being unplugged.
 *
 * The file on the drive is the artwork: it is what you chose, at full
 * resolution, and it needs no network. But the whole library lives on an
 * external disk, and with that disk unplugged every poster in the app was a
 * broken frame — the one case where a local file is worse than a URL.
 *
 * So the local file is tried first and TMDb is the fallback, swapped in when
 * the browser reports the load failed. Nothing is checked up front: the
 * failure is the signal, and it costs one request that was going to fail
 * anyway.
 *
 * The signal arrives two ways, and it has to. `onError` catches a failure that
 * happens once React holds the element — but the images at the top of a page
 * are fetched while the HTML is still being parsed, and they routinely finish
 * before hydration. A `load` or `error` that fired back then is gone: the
 * browser does not replay it, so those tiles used to sit broken forever while
 * every tile below the fold fell back correctly. The ref covers that window by
 * reading the state the lost event left behind.
 */
export function Art({
  src,
  remote,
  size = "w342",
  version,
  transitionName,
  alt = "",
  className,
  loading,
}: {
  /** Path to the file on disk, when one was found there. */
  src?: string;
  /** The TMDb path it came from, or the record's own image. */
  remote?: string;
  /** TMDb bucket for the fallback: w92, w342, w780, original… */
  size?: string;
  /**
   * When the artwork folder was last re-indexed — `artAt` on a film or a show.
   * Pass it wherever the image can be replaced from within the app, or the
   * replacement will not show until the browser drops its copy.
   */
  version?: number;
  /**
   * Identity across a navigation — `posterName(…)` from lib/routes. Given the
   * same name on a listing tile and on the page that tile opens, the browser
   * treats the two as one object and moves it between them instead of swapping
   * one image for another. Only worth naming the image a click is aimed at:
   * every name costs the browser a snapshot on every transition.
   */
  transitionName?: string;
  alt?: string;
  className?: string;
  loading?: "lazy" | "eager";
}) {
  const [failed, setFailed] = useState(false);

  /*
   * The local width asked for, from the same bucket the TMDb fallback uses —
   * a tile drawn at w342 wants the cached thumbnail, not a full scan of the
   * original off the external drive. Roughly 2× the drawn size, which is what
   * a retina screen samples. "original" maps to nothing: the heroes want the
   * file itself, full resolution being the point of owning it.
   */
  const thumbWidth = { w92: 160, w342: 640, w780: 1280 }[
    size as "w92" | "w342" | "w780"
  ];

  const local = src && !failed ? artUrl(src, version, thumbWidth) : undefined;
  const source = local ?? (remote ? imageUrl(remote, size) : undefined);
  if (!source) return null;

  /**
   * A load that already finished, judged after the fact. `complete` is true
   * whether it succeeded or failed, and only a failure leaves no intrinsic
   * width — so the pair together says "this one is already broken". An image
   * still in flight reports `complete` false and is left to `onError`.
   */
  const brokenOnArrival = (node: HTMLImageElement | null) => {
    if (local && node?.complete && node.naturalWidth === 0) setFailed(true);
  };

  const image = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={source}
      alt={alt}
      loading={loading}
      // Only the local attempt can fall back; a failed TMDb load has nowhere
      // left to go, and re-rendering on it would loop.
      ref={brokenOnArrival}
      onError={local ? () => setFailed(true) : undefined}
      className={className}
    />
  );

  // Wrapped rather than named unconditionally, so an image with nothing to
  // morph into is left as an ordinary <img>. `share="morph"` puts the pair in a
  // class the stylesheet can time; without it the browser picks its own.
  //
  // `default="none"` restricts it to that pairing. Every server action ends in a
  // refresh, and a refresh is a React transition — so saving artwork or a note
  // used to start a view transition on this poster with no second page
  // involved. Its snapshot paints in the view-transition layer, which is above
  // the whole document, so it flashed over any dialog that was open.
  return transitionName ? (
    <ViewTransition name={transitionName} share="morph" default="none">
      {image}
    </ViewTransition>
  ) : (
    image
  );
}
