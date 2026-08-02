"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";

import { chooseArtwork, listArtwork, type ArtworkChoice } from "@/app/actions";
import { imageUrl } from "@/lib/image-url";
import { HERO_BUTTON } from "./hero-button";

type Tab = "poster" | "fanart" | "logo";

/**
 * Per kind: what it is called, what it is saved as, and the shape it lays out
 * in — the last of which the placeholders borrow, so the grid that appears
 * while TMDb answers is the grid that will be there when it does. A column of
 * poster-shaped boxes standing in for a row of logos is a worse wait than no
 * placeholder at all.
 */
const KINDS: Record<
  Tab,
  { label: string; file: string; grid: string; shape: string; count: number }
> = {
  poster: {
    label: "Poster",
    file: "poster.jpeg",
    grid: "grid-cols-3 sm:grid-cols-6",
    shape: "aspect-[2/3]",
    count: 12,
  },
  fanart: {
    label: "Backdrop",
    file: "fanart.jpeg",
    grid: "grid-cols-2 sm:grid-cols-3",
    shape: "aspect-video",
    count: 6,
  },
  logo: {
    label: "Logo",
    file: "logo.png",
    grid: "grid-cols-2 sm:grid-cols-4",
    shape: "h-24",
    count: 8,
  },
};
type Sort = "default" | "largest";

function Spinner({ big }: { big?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden
      className={`motion-safe:animate-spin ${big ? "h-7 w-7" : "h-4 w-4"}`}
    >
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}

export function ArtworkEditor({
  moviePath,
  tmdbId,
  openAs,
  label,
}: {
  moviePath: string;
  tmdbId: number;
  /**
   * Skips the kind menu and opens straight onto one kind. For places that
   * already know which is missing — asking again there would be asking a
   * question the page just answered.
   */
  openAs?: Tab;
  /** A worded trigger instead of the icon, for use in a list. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [tab, setTab] = useState<Tab>("poster");
  // Biggest first by default — the highest-resolution artwork is almost always
  // what you want to save.
  const [sort, setSort] = useState<Sort>("largest");
  const [images, setImages] = useState<{
    posters: ArtworkChoice[];
    backdrops: ArtworkChoice[];
    logos: ArtworkChoice[];
  } | null>(null);
  /** Which image is downloading, and which one landed — both by file path, so
   *  the state shows on the tile you actually clicked. */
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const trigger = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTarget(document.body);
  }, []);

  // Escape closes the modal, as expected of a dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!trigger.current?.contains(e.target as Node)) setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  // Which kind you want is a decision you have already made by the time you
  // reach for this button, so it is asked first and the modal opens on that
  // tab — rather than opening on posters and making you switch.
  function openWith(kind: Tab) {
    setTab(kind);
    setMenu(false);
    show();
  }

  function show() {
    setOpen(true);
    setError(null);
    setSaved(null);
    if (images) return;

    startTransition(async () => {
      try {
        setImages(await listArtwork(tmdbId));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  function save(filePath: string) {
    setError(null);
    setSaved(null);
    setSaving(filePath);
    startTransition(async () => {
      const result = await chooseArtwork(moviePath, tab, filePath);
      setSaving(null);
      if (result.ok) {
        setSaved(filePath);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  const listed = images
    ? tab === "poster"
      ? images.posters
      : tab === "fanart"
        ? images.backdrops
        : images.logos
    : [];

  const choices =
    sort === "largest"
      ? [...listed].sort((a, b) => b.width * b.height - a.width * a.height)
      : listed;

  return (
    <>
      <div ref={trigger} className="relative">
      {label ? (
        <button
          type="button"
          onClick={() => openWith(openAs ?? "poster")}
          className="rounded-control border border-line px-2.5 py-1 text-xs transition-colors hover:bg-surface-strong"
        >
          {label}
        </button>
      ) : (
      <button
        type="button"
        onClick={() => (openAs ? openWith(openAs) : setMenu((v) => !v))}
        aria-label="Edit artwork"
        aria-expanded={openAs ? undefined : menu}
        title="Edit artwork"
        className={HERO_BUTTON}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="m21 15-5-5L5 21" />
        </svg>
      </button>
      )}

        {menu && (
          <div className="row-enter absolute right-0 bottom-full z-30 mb-2 w-40 overflow-hidden rounded-card border border-line bg-background py-1 shadow-2xl">
            {(
              [
                ["poster", "Poster"],
                ["fanart", "Backdrop"],
                ["logo", "Logo"],
              ] as [Tab, string][]
            ).map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                onClick={() => openWith(kind)}
                className="block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-surface-strong"
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {open &&
        target &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          >
            {/* A fixed height rather than one that follows the contents: the
                grid runs from four images to twenty-four, and a dialog that
                resizes with it moves the close button and the sort control
                every time you switch kind. The images scroll inside instead. */}
            <div
              onClick={(e) => e.stopPropagation()}
              className="flex h-[min(80vh,44rem)] w-full max-w-5xl flex-col rounded-card border border-line bg-background shadow-2xl"
            >
              <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line p-5">
                <h2 className="text-lg font-semibold">{KINDS[tab].label}</h2>

                <div className="relative">
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as Sort)}
                    className="cursor-pointer appearance-none rounded-control border border-line bg-transparent py-1.5 pr-8 pl-3 text-xs outline-none focus:border-line-strong"
                  >
                    <option value="largest">Largest dimensions</option>
                    <option value="default">TMDb order</option>
                  </select>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="pointer-events-none absolute top-1/2 right-2.5 h-3 w-3 -translate-y-1/2 opacity-40"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </div>

                <span className="text-xs opacity-40">
                  saves as {KINDS[tab].file}
                </span>


                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="ml-auto text-sm opacity-50 hover:opacity-100"
                >
                  Close
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5">
              {!images && !error && (
                <div className={`grid gap-3 ${KINDS[tab].grid}`}>
                  {Array.from({ length: KINDS[tab].count }, (_, i) => (
                    <div
                      key={i}
                      className={`skeleton w-full ${KINDS[tab].shape}`}
                    />
                  ))}
                </div>
              )}

              {images && choices.length === 0 && (
                <p className="text-sm opacity-50">
                  TMDb has no{" "}
                  {tab === "poster"
                    ? "posters"
                    : tab === "fanart"
                      ? "backdrops"
                      : "logos"}{" "}
                  for this film.
                </p>
              )}

              {choices.length > 0 && (
                <div className={`grid gap-3 ${KINDS[tab].grid}`}>
                  {choices.map((choice) => (
                    <button
                      key={choice.filePath}
                      type="button"
                      onClick={() => save(choice.filePath)}
                      disabled={pending}
                      // The same shape the placeholder held. Without it a tile
                      // has no height until its image arrives, so the grid
                      // collapsed to a row of lines between the skeletons
                      // disappearing and the pictures landing.
                      className={`group relative overflow-hidden rounded-control ring-1 ring-line transition-transform hover:scale-[1.02] disabled:opacity-40 ${KINDS[tab].shape} ${
                        // Logos are cut out against transparency and are
                        // usually white, so they need something behind them to
                        // be visible at all — and something dark, since that is
                        // what they are drawn to sit on.
                        tab === "logo" ? "grid place-items-center bg-black p-4" : ""
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={imageUrl(
                          choice.filePath,
                          tab === "poster" ? "w185" : "w300",
                        )}
                        alt=""
                        loading="lazy"
                        className={
                          tab === "logo"
                            ? "max-h-full w-auto object-contain"
                            : "h-full w-full object-cover"
                        }
                      />
                      <span className="absolute inset-x-0 bottom-0 bg-black/65 px-1.5 py-0.5 text-[10px] text-white">
                        {choice.width}×{choice.height}
                        {!choice.language && " · textless"}
                      </span>

                      {/* The tile you clicked says what it is doing, so the
                          answer to "did that work?" is where you were already
                          looking. */}
                      {saving === choice.filePath && (
                        <span className="absolute inset-0 grid place-items-center bg-black/60 text-white">
                          <Spinner big />
                        </span>
                      )}
                      {saved === choice.filePath && (
                        <span className="absolute inset-0 grid place-items-center bg-emerald-600/75 text-white">
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-7 w-7"
                          >
                            <path d="m4 12.5 5 5 11-11" />
                          </svg>
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {error && (
                <p className="mt-4 font-mono text-sm text-red-600 dark:text-red-400">
                  {error}
                </p>
              )}
              </div>

              <p className="shrink-0 border-t border-line px-5 py-3 text-xs opacity-45">
                The full-resolution image is downloaded into the film&rsquo;s
                own folder. Any existing file of the same name is replaced.
              </p>
            </div>
          </div>,
          target,
        )}
    </>
  );
}
