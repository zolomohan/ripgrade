"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import {
  chooseArtwork,
  chooseShowArtwork,
  listArtwork,
  uploadArtwork,
  uploadShowArtwork,
  type ArtworkChoice,
} from "@/app/actions";
import { BUTTON, FIELD } from "@/app/controls";
import { Spinner } from "@/app/spinner";
import { imageUrl } from "@/lib/image-url";
import { HERO_BUTTON } from "./hero-button";
import { CloseButton, Modal } from "@/app/modal";

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

/**
 * Stands where a TMDb file path stands in `saving` and `saved`, for the one
 * image in the dialog that has no TMDb path: the one you supplied. Every real
 * path begins with a slash, so it cannot be mistaken for a tile.
 */
const UPLOAD = "upload";

/**
 * Either a film — identified by its file — or a show, identified by its key.
 * The two differ in where the image lands and which TMDb endpoint it comes
 * from; everything between the button and the download is the same.
 */
type Subject =
  | { moviePath: string; showKey?: never }
  | { showKey: string; moviePath?: never };

export function ArtworkEditor({
  moviePath,
  showKey,
  tmdbId,
  openAs,
  label,
}: Subject & {
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
  /**
   * How deep the pointer is into the drop zone, rather than whether it is in
   * it: dragging over the grid crosses into and out of every tile it passes,
   * and a boolean set by the last event to fire spends the whole drag
   * flickering. Enter adds, leave subtracts, and zero means gone.
   */
  const [dragDepth, setDragDepth] = useState(0);
  const [pending, startTransition] = useTransition();
  const trigger = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Escape closes the modal, as expected of a dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /**
   * A file dropped anywhere but the zone below is swallowed rather than
   * obeyed. The browser's default for a dropped file is to open it, which
   * would replace the app with a picture of a poster — a harsh answer to
   * missing the target by an inch, and one only worth guarding against
   * because this dialog is the thing that invited the drag.
   *
   * The zone's own handler runs first on the way up, so it is unaffected.
   */
  useEffect(() => {
    if (!open) return;
    const swallow = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", swallow);
    window.addEventListener("drop", swallow);
    return () => {
      window.removeEventListener("dragover", swallow);
      window.removeEventListener("drop", swallow);
      // A drag abandoned by closing the dialog leaves its count behind, and
      // the next opening would come up already showing the drop overlay.
      setDragDepth(0);
    };
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
        setImages(await listArtwork(tmdbId, showKey ? "tv" : "movie"));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  /**
   * Runs one write and lets the control that started it say so. `key` is the
   * tile's file path, or `UPLOAD` for the button — either way the spinner and
   * the tick land where you clicked, which is where you are already looking.
   */
  function write(
    key: string,
    work: () => Promise<{ ok: true } | { ok: false; error: string }>,
  ) {
    setError(null);
    setSaved(null);
    setSaving(key);
    startTransition(async () => {
      // A write that fails inside the action returns `{ ok: false }`. One that
      // fails before it ever runs — the request refused for its size, the
      // server restarting under you — rejects instead, and a rejection nobody
      // catches is a dialog that sits there having said nothing while the
      // failure goes to the console. To the person waiting they are one thing:
      // it did not work, and here is why.
      const result = await work().catch((err: unknown) => ({
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      }));
      setSaving(null);
      if (result.ok) {
        setSaved(key);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function save(filePath: string) {
    write(filePath, () =>
      showKey
        ? chooseShowArtwork(showKey, tab, filePath)
        : chooseArtwork(moviePath!, tab, filePath),
    );
  }

  /**
   * An image of your own, saved under the name TMDb's would have taken. It is
   * the same write with a different source, so it shows the same way and the
   * page behind it refreshes the same way.
   */
  function upload(chosen: File) {
    const form = new FormData();
    form.set("file", chosen);
    write(UPLOAD, () =>
      showKey
        ? uploadShowArtwork(showKey, tab, form)
        : uploadArtwork(moviePath!, tab, form),
    );
  }

  function drop(event: React.DragEvent) {
    event.preventDefault();
    setDragDepth(0);
    const dropped = event.dataTransfer.files[0];
    if (dropped) upload(dropped);
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
            className={BUTTON.small}
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
          <div className="row-enter absolute right-0 bottom-full z-30 mb-2 w-40 overflow-hidden glass-panel rounded-card border border-line py-1 shadow-2xl">
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

      {/* A fixed height rather than one that follows the contents: the grid
          runs from four images to twenty-four, and a dialog that resizes with
          it moves the close button and the sort control every time you switch
          kind. The images scroll inside instead. */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        label={`Choose ${KINDS[tab].label.toLowerCase()}`}
        panelClassName="flex h-[min(80vh,44rem)] w-full max-w-5xl flex-col glass-panel rounded-card border border-line shadow-2xl"
      >
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-3 px-5 pt-5 pb-4">
            <h2 className="text-lg font-semibold">{KINDS[tab].label}</h2>

            <div className="relative">
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                className={FIELD.select}
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

            <div className="ml-auto flex items-center gap-3">
              {/* Sits in the header rather than among the tiles: TMDb having
                  nothing for this film is the case that most wants an image of
                  your own, and a control in the grid would be missing from
                  exactly that grid. */}
              <input
                ref={picker}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const chosen = e.target.files?.[0];
                  // Cleared so that picking the same file again counts as a
                  // change again — which is what you do after one fails.
                  e.target.value = "";
                  if (chosen) upload(chosen);
                }}
              />
              <button
                type="button"
                onClick={() => picker.current?.click()}
                // Only while something is being written — not on `pending`,
                // which the tiles use and which also covers the wait for
                // TMDb's list. Owing nothing to TMDb is the point of this
                // button, and it is worth least when that request is slowest.
                disabled={saving !== null}
                className={BUTTON.small}
              >
                {saving === UPLOAD ? (
                  <Spinner className="h-3.5 w-3.5" />
                ) : saved === UPLOAD ? (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                    className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
                  >
                    <path d="m4 12.5 5 5 11-11" />
                  </svg>
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                    className="h-3.5 w-3.5"
                  >
                    <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
                    <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                  </svg>
                )}
                Upload
              </button>

              <CloseButton onClick={() => setOpen(false)} />
            </div>
          </div>

          {/* The floor the title stands on, in place of the border that used to
              rule the panel edge to edge — a thing no other line here does. */}
          <div aria-hidden className="rule-head mx-5 shrink-0" />

          {/* Dropping a file here is the same act as picking one above, so it
              writes the same way. The zone is the grid rather than the whole
              dialog: the header holds a select and a close button, and a drag
              that swallows those is a drag you cannot get out of. */}
          <div
            className="relative flex-1 overflow-hidden"
            onDragEnter={(e) => {
              e.preventDefault();
              setDragDepth((depth) => depth + 1);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={() => setDragDepth((depth) => Math.max(0, depth - 1))}
            onDrop={drop}
          >
            <div className="h-full overflow-y-auto p-5">
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
                        tab === "logo"
                          ? "grid place-items-center bg-black p-4"
                          : ""
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
                          <Spinner className="h-7 w-7" />
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

            {dragDepth > 0 && (
              // Not a drop target itself — it is drawn over the one, and a
              // child that accepts the pointer would fire the leave that
              // removes it.
              <div className="pointer-events-none absolute inset-3 grid place-items-center rounded-card border-2 border-dashed border-line-strong bg-background/85 text-sm">
                Drop to save as {KINDS[tab].file}
              </div>
            )}
          </div>

          <p className="shrink-0 border-t border-line px-5 py-3 text-xs opacity-45">
            The full-resolution image is written into the film&rsquo;s own
            folder. Any existing file of the same name is replaced. Drop a file
            here, or use Upload, to save one of your own instead.
          </p>
        </>
      </Modal>
    </>
  );
}
