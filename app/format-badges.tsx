import type { LibraryItem } from "@/lib/library";

/**
 * Format badges for the title block.
 *
 * Official marks are used wherever one exists as a public-domain vector on
 * Wikimedia Commons — below the threshold of originality for copyright, so only
 * a trademark restriction applies, which governs commercial use rather than a
 * private tool. Formats with no usable vector (DTS:X) stay typographic.
 */
type Badge = {
  key: string;
  label: string;
  className?: string;
  /** When set, the official mark replaces the text pill. */
  logo?: {
    src: string;
    height: string;
    invert?: boolean;
    /** For mixed-colour marks, where inverting would ruin the brand fills. */
    darkSrc?: string;
  };
};

/** Black wordmarks flip for dark mode; brand-coloured marks must not. */
const MARK = {
  dolbyVision: {
    src: "/formats/dolby-vision.svg",
    height: "h-3",
    invert: true,
  },
  dolbyAtmos: { src: "/formats/dolby-atmos.svg", height: "h-3", invert: true },
  dolbyTrueHd: {
    src: "/formats/dolby-truehd.svg",
    height: "h-4",
    invert: true,
  },
  dolbyDigitalPlus: {
    src: "/formats/dolby-digital-plus.svg",
    height: "h-4",
    invert: true,
  },
  dolbyDigital: {
    src: "/formats/dolby-digital.svg",
    height: "h-4",
    invert: true,
  },
  ultraHd: { src: "/formats/ultra-hd.svg", height: "h-4", invert: true },
  hdr10: { src: "/formats/hdr10.svg", height: "h-5", invert: true },
  hdr10plus: { src: "/formats/hdr10plus.svg", height: "h-5", invert: true },
  // Orange and blue brand marks — inverting these would wreck them.
  // The DTS wordmark itself has no fill of its own, so it defaults to black and
  // disappears on a dark background; a second file sets the inherited fill to
  // white while leaving the orange and grey brand fills alone.
  dtsX: {
    src: "/formats/dts-x.svg",
    darkSrc: "/formats/dts-x-dark.svg",
    height: "h-5",
  },
  dtsHdMa: {
    src: "/formats/dts-hd-ma.svg",
    darkSrc: "/formats/dts-hd-ma-dark.svg",
    height: "h-5",
  },
  uhdBluray: { src: "/formats/uhd-bluray.svg", height: "h-5" },
} as const;

export function FormatBadges({ movie }: { movie: LibraryItem }) {
  const OUTLINE = "ring-1 ring-inset ring-line-strong opacity-70";
  const badges: Badge[] = [];

  // The Ultra HD Blu-ray mark is a claim about the source, so it is only used
  // where that is actually true — a 2160p web pull gets the neutral text badge.
  if (movie.resolution === "2160p" && movie.releaseType === "REMUX") {
    badges.push({
      key: "src",
      label: "Ultra HD Blu-ray",
      logo: MARK.uhdBluray,
    });
  } else if (movie.resolution === "2160p") {
    badges.push({ key: "res", label: "Ultra HD", logo: MARK.ultraHd });
  } else if (movie.resolution !== "unknown") {
    badges.push({ key: "res", label: movie.resolution, className: OUTLINE });
  }

  if (movie.hdr === "Dolby Vision") {
    badges.push({ key: "dv", label: "Dolby Vision", logo: MARK.dolbyVision });
  } else if (movie.hdr === "HDR10+") {
    badges.push({ key: "hdr", label: "HDR10+", logo: MARK.hdr10plus });
  } else if (movie.hdr === "HDR10") {
    badges.push({ key: "hdr", label: "HDR10", logo: MARK.hdr10 });
  }

  const atmos = movie.audio.find((a) => a.atmos);
  const dtsx = movie.audio.find((a) => a.dtsx);
  const lossless = movie.audio.find((a) => a.lossless);
  const primary = movie.audio[0];

  if (atmos) {
    badges.push({ key: "atmos", label: "Dolby Atmos", logo: MARK.dolbyAtmos });
  } else if (dtsx) {
    badges.push({ key: "dtsx", label: "DTS:X", logo: MARK.dtsX });
  } else if (lossless && /TrueHD/i.test(lossless.label)) {
    badges.push({ key: "au", label: "Dolby TrueHD", logo: MARK.dolbyTrueHd });
  } else if (lossless && /DTS-HD Master/i.test(lossless.label)) {
    badges.push({
      key: "au",
      label: "DTS-HD Master Audio",
      logo: MARK.dtsHdMa,
    });
  } else if (lossless) {
    badges.push({
      key: "au",
      label: lossless.format.toUpperCase(),
      className: OUTLINE,
    });
  } else if (primary && /Digital Plus/i.test(primary.label)) {
    badges.push({
      key: "au",
      label: "Dolby Digital Plus",
      logo: MARK.dolbyDigitalPlus,
    });
  } else if (primary && /Dolby Digital/i.test(primary.label)) {
    badges.push({ key: "au", label: "Dolby Digital", logo: MARK.dolbyDigital });
  } else if (primary) {
    badges.push({
      key: "au",
      label: primary.format.toUpperCase(),
      className: OUTLINE,
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {badges.map((badge) =>
        badge.logo ? (
          badge.logo.darkSrc ? (
            <span key={badge.key} title={badge.label}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={badge.logo.src}
                alt={badge.label}
                className={`${badge.logo.height} w-auto dark:hidden`}
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={badge.logo.darkSrc}
                alt=""
                aria-hidden
                className={`hidden ${badge.logo.height} w-auto dark:block`}
              />
            </span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={badge.key}
              src={badge.logo.src}
              alt={badge.label}
              title={badge.label}
              className={`${badge.logo.height} w-auto ${
                badge.logo.invert ? "opacity-90 dark:invert" : ""
              }`}
            />
          )
        ) : (
          <span
            key={badge.key}
            className={`rounded-chip px-2 py-1 text-[10px] font-semibold tracking-[0.12em] ${badge.className}`}
          >
            {badge.label}
          </span>
        ),
      )}
    </div>
  );
}
