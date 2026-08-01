"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";

import { chooseArtwork, listArtwork, type ArtworkChoice } from "@/app/actions";
import { imageUrl } from "@/lib/image-url";

type Tab = "poster" | "fanart";
type Sort = "default" | "largest";

export function ArtworkEditor({
  moviePath,
  tmdbId,
}: {
  moviePath: string;
  tmdbId: number;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("poster");
  // Biggest first by default — the highest-resolution artwork is almost always
  // what you want to save.
  const [sort, setSort] = useState<Sort>("largest");
  const [images, setImages] = useState<{
    posters: ArtworkChoice[];
    backdrops: ArtworkChoice[];
  } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<HTMLElement | null>(null);
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

  function show() {
    setOpen(true);
    setError(null);
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
    setStatus(null);
    startTransition(async () => {
      const result = await chooseArtwork(moviePath, tab, filePath);
      if (result.ok) {
        setStatus(`Saved as ${result.saved.split("/").pop()}`);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  const listed = images
    ? tab === "poster"
      ? images.posters
      : images.backdrops
    : [];

  const choices =
    sort === "largest"
      ? [...listed].sort((a, b) => b.width * b.height - a.width * a.height)
      : listed;

  return (
    <>
      <button
        type="button"
        onClick={show}
        className="absolute top-6 right-6 rounded-md bg-background/80 px-3 py-1.5 text-sm backdrop-blur hover:bg-background"
      >
        Edit artwork
      </button>

      {open &&
        target &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-6"
            onClick={() => setOpen(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-5xl rounded-2xl border border-black/10 bg-background p-6 shadow-2xl dark:border-white/15"
            >
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-lg font-semibold">Artwork</h2>

                <div className="flex items-center gap-1.5">
                  {(["poster", "fanart"] as Tab[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTab(t)}
                      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                        tab === t
                          ? "border-transparent bg-foreground text-background"
                          : "border-black/10 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
                      }`}
                    >
                      {t === "poster" ? "Posters" : "Backdrops"}
                    </button>
                  ))}
                </div>

                <div className="relative">
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as Sort)}
                    className="cursor-pointer appearance-none rounded-lg border border-black/10 bg-transparent py-1.5 pr-8 pl-3 text-xs outline-none focus:border-black/30 dark:border-white/10 dark:focus:border-white/30"
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
                  saves as {tab === "poster" ? "poster.jpeg" : "fanart.jpeg"}
                </span>

                {pending && (
                  <span className="text-xs opacity-50">working…</span>
                )}

                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="ml-auto text-sm opacity-50 hover:opacity-100"
                >
                  Close
                </button>
              </div>

              {!images && !error && (
                <p className="mt-6 text-sm opacity-50">Loading artwork…</p>
              )}

              {images && choices.length === 0 && (
                <p className="mt-6 text-sm opacity-50">
                  TMDb has no {tab === "poster" ? "posters" : "backdrops"} for
                  this film.
                </p>
              )}

              {choices.length > 0 && (
                <div
                  className={`mt-5 grid gap-3 ${
                    tab === "poster"
                      ? "grid-cols-3 sm:grid-cols-6"
                      : "grid-cols-2 sm:grid-cols-3"
                  }`}
                >
                  {choices.map((choice) => (
                    <button
                      key={choice.filePath}
                      type="button"
                      onClick={() => save(choice.filePath)}
                      disabled={pending}
                      className="group relative overflow-hidden rounded-lg ring-1 ring-black/10 transition-transform hover:scale-[1.02] disabled:opacity-40 dark:ring-white/10"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={imageUrl(
                          choice.filePath,
                          tab === "poster" ? "w185" : "w300",
                        )}
                        alt=""
                        loading="lazy"
                        className="w-full object-cover"
                      />
                      <span className="absolute inset-x-0 bottom-0 bg-black/65 px-1.5 py-0.5 text-[10px] text-white">
                        {choice.width}×{choice.height}
                        {!choice.language && " · textless"}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {status && <p className="mt-4 text-sm opacity-60">{status}</p>}
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
