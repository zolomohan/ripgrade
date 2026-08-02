"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";

import { chooseArtwork, listArtwork, type ArtworkChoice } from "@/app/actions";
import { imageUrl } from "@/lib/image-url";
import { HERO_BUTTON } from "./hero-button";

type Tab = "poster" | "fanart" | "logo";

const KINDS: Record<Tab, { label: string; file: string }> = {
  poster: { label: "Poster", file: "poster.jpeg" },
  fanart: { label: "Backdrop", file: "fanart.jpeg" },
  logo: { label: "Logo", file: "logo.png" },
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
}: {
  moviePath: string;
  tmdbId: number;
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
      <button
        type="button"
        onClick={() => setMenu((v) => !v)}
        aria-label="Edit artwork"
        aria-expanded={menu}
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
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-6"
            onClick={() => setOpen(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-5xl rounded-card border border-line bg-background p-6 shadow-2xl"
            >
              <div className="flex flex-wrap items-center gap-3">
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

              {!images && !error && (
                <div className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-6">
                  {Array.from({ length: 12 }, (_, i) => (
                    <div key={i} className="skeleton aspect-[2/3] w-full" />
                  ))}
                </div>
              )}

              {images && choices.length === 0 && (
                <p className="mt-6 text-sm opacity-50">
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
                <div
                  className={`mt-5 grid gap-3 ${
                    tab === "poster"
                      ? "grid-cols-3 sm:grid-cols-6"
                      : tab === "logo"
                        ? "grid-cols-2 sm:grid-cols-4"
                        : "grid-cols-2 sm:grid-cols-3"
                  }`}
                >
                  {choices.map((choice) => (
                    <button
                      key={choice.filePath}
                      type="button"
                      onClick={() => save(choice.filePath)}
                      disabled={pending}
                      className={`group relative overflow-hidden rounded-control ring-1 ring-line transition-transform hover:scale-[1.02] disabled:opacity-40 ${
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
                            ? "max-h-16 w-auto object-contain"
                            : "w-full object-cover"
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

              <p className="mt-5 text-xs opacity-45">
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
