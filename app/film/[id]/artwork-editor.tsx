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
import { BUTTON, FIELD, useDismiss, useOverlay } from "@/app/controls";
import { Spinner } from "@/app/spinner";
import { imageUrl } from "@/lib/image-url";
import { HERO_BUTTON } from "./hero-button";
import { CloseButton, Modal } from "@/app/modal";
import { Glass } from "@/app/glass";

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
  {
    label: string;
    file: string;
    /**
     * How many across, at every width the app has a name for.
     *
     * The dialog is the width of the screen now, so these are the screen's own
     * steps — `wide`, `ultra`, `cinema` from globals.css, the three the shelves
     * widen at — rather than the two guesses that were enough while it was
     * capped at 64rem.
     *
     * A column fewer than the shelf takes at the same step, and deliberately:
     * `POSTER_GRID` is five across a page column that stops at 72rem, and this
     * is four across a dialog that does not stop. A shelf is being scanned and
     * a tile only has to be recognised; here the tile is the decision — you are
     * judging a crop and reading the small print on a one-sheet — and that is
     * worth the width it costs.
     */
    grid: string;
    shape: string;
    count: number;
    /**
     * The TMDb bucket the tiles are drawn from. It follows the grid: a poster
     * laid out at 250 points is sampled at 500 by any screen worth owning, and
     * `w185` in a cell that size is a picture of a picture. Not the largest
     * either — these grids run to a couple of hundred images, and a backdrop
     * asked for at `w1280` is four times the file to answer a question you
     * settle at a glance.
     */
    bucket: string;
    /**
     * The mark beside the word in the menu that picks between these.
     *
     * Two of the three are a plain rectangle and differ only in their
     * proportions, which is not a shortage of invention: the proportions are
     * the whole difference. A poster is 2:3 and a backdrop is 16:9, and those
     * are the two shapes the dialog behind this menu lays out — `shape` above
     * says so in Tailwind and these say the same thing on a 24×24 grid. Tall
     * against wide is also about the easiest distinction there is at 14px,
     * where a picture-with-a-mountain in each would be one grey smudge twice.
     *
     * The logo is the odd one and gets the odd mark: not a frame at all, but
     * lettering, because a logo here is a film's title set as art rather than
     * a picture of it.
     */
    icon: string;
  }
> = {
  poster: {
    label: "Poster",
    file: "poster.jpeg",
    grid:
      "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 " +
      "wide:grid-cols-6 ultra:grid-cols-7 cinema:grid-cols-8",
    shape: "aspect-[2/3]",
    count: 18,
    bucket: "w500",
    // 12 × 18 on the grid, which is 2:3 exactly.
    icon: "M6 3h12v18H6z",
  },
  fanart: {
    label: "Backdrop",
    file: "fanart.jpeg",
    grid: "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 ultra:grid-cols-4",
    shape: "aspect-video",
    count: 9,
    bucket: "w780",
    // 18 × 10, near enough 16:9 at this size.
    icon: "M3 7h18v10H3z",
  },
  logo: {
    label: "Logo",
    file: "logo.png",
    grid:
      "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 " +
      "wide:grid-cols-5 ultra:grid-cols-6",
    shape: "h-32",
    count: 16,
    bucket: "w500",
    // A letter on a baseline — the type mark, and the only one of the three
    // with no box round it.
    icon: "M4 7V5h16v2M12 5v14M9.5 19h5",
  },
};
type Sort = "default" | "largest";

/**
 * What stands for "no language at all" in the filter. A textless image reports
 * `null`, which cannot be the value of an `<option>`, and every real code is
 * two letters — so this cannot collide with one.
 */
const TEXTLESS = "none";

/**
 * A language code as a word. `Intl.DisplayNames` is how the browser already
 * names languages to itself, so "ja" comes out as Japanese in English and as
 * 日本語 to somebody reading the app in Japanese — a table written here could
 * only ever have done the first, for the handful of codes somebody remembered.
 *
 * It throws on anything that is not a language tag, and TMDb does file the odd
 * oddity, so the code itself is the fallback.
 */
const named = (() => {
  let names: Intl.DisplayNames | undefined;
  try {
    names = new Intl.DisplayNames(undefined, { type: "language" });
  } catch {
    names = undefined;
  }

  return (code: string) => {
    try {
      return names?.of(code) ?? code.toUpperCase();
    } catch {
      return code.toUpperCase();
    }
  };
})();

/**
 * A select wearing the chevron this app draws over the platform's. There are
 * two of them in the header now — the order and the language — and the arrow
 * is the same eight lines both times.
 */
function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={FIELD.select}
      >
        {children}
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
  );
}

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
  /**
   * Which language the grid is cut down to, or `all`. Kept across a change of
   * kind rather than reset with it: a film whose posters you are reading in
   * French has backdrops you want in French too, and `shown` below quietly
   * ignores a language the new kind does not have.
   */
  const [language, setLanguage] = useState<string>("all");
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

  /**
   * A save, seen, and then the dialog leaves.
   *
   * Picking artwork is a one-shot errand: you came for a poster, the tile you
   * clicked has gone green, and the thing you actually want to look at is the
   * page underneath wearing it. Closing by hand after that is a step whose only
   * outcome is the one that was going to happen anyway.
   *
   * The pause is what makes it an answer rather than a disappearance. The tick
   * lands on the tile you clicked — or on the Upload button, for an image of
   * your own — and it has to be on screen long enough to be read as "that one,
   * saved" before the dialog takes it away.
   *
   * Not on a failure: an error is a reason to still be here.
   */
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setOpen(false), 800);
    return () => clearTimeout(timer);
  }, [saved]);

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

  useDismiss(menu, () => setMenu(false), trigger);
  const [shown, leaving] = useOverlay(menu);

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

  /**
   * The languages this kind actually has, in the order the tiles arrive in —
   * which is English and textless first, then whatever TMDb holds. Counted, so
   * the menu says how much is behind each word before you pick it, and so the
   * total on the first row says how much there is at all.
   */
  const languages = listed.reduce((tally, choice) => {
    const key = choice.language ?? TEXTLESS;
    return tally.set(key, (tally.get(key) ?? 0) + 1);
  }, new Map<string, number>());

  // A filter the current kind cannot honour is not an empty grid: switching to
  // logos with "French" held would otherwise show nothing and look broken,
  // when the truthful answer is that there are no French logos to hide behind.
  const inLanguage = languages.has(language) ? language : "all";

  const filtered =
    inLanguage === "all"
      ? listed
      : listed.filter((choice) => (choice.language ?? TEXTLESS) === inLanguage);

  const choices =
    sort === "largest"
      ? [...filtered].sort((a, b) => b.width * b.height - a.width * a.height)
      : filtered;

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

        {/* Downward, like every other menu in the app. It opened upward on
            `bottom-full` because the trigger sits low in the hero — but a menu
            that grows out of the top of its button is the one thing on the page
            that does, and the three items it holds are short enough to fall
            below it without reaching anything. Consistency is the whole of the
            argument: you learn where a menu appears once. */}
        {shown && (
          <Glass
            radius={14}
            className={`${leaving ? "pop-out" : "row-enter"} overlay-pane absolute top-full right-0 z-30 mt-2 w-40 overflow-hidden py-1`}
          >
            {/* From `KINDS` rather than from a list of its own. The three
                labels were written out here as well as up there, which is two
                places to rename a thing — and the mark each row needs is a
                fact about the kind, so it lives where the rest of them do. */}
            {(Object.entries(KINDS) as [Tab, (typeof KINDS)[Tab]][]).map(
              ([kind, { label, icon }]) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => openWith(kind)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-strong"
                >
                  {/* At the size of the word beside it and at the app's usual
                      stroke, like the rail's marks: a mark that outweighs its
                      label is a mark being asked to do the label's job. */}
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                    className="h-3.5 w-3.5 shrink-0 opacity-60"
                  >
                    <path d={icon} />
                  </svg>
                  {label}
                </button>
              ),
            )}
          </Glass>
        )}
      </div>

      {/* The screen, less the frame's own inch of margin.

          A fixed size rather than one that follows the contents: the grid runs
          from four images to a couple of hundred, and a dialog that resizes
          with it moves the close button and the sort control every time you
          switch kind. The images scroll inside instead.

          It was 80vh by 64rem, which was a dialog sized for the twenty-four
          tiles it used to be given. Now that it is given everything TMDb has,
          the width is what turns that from a long scroll into a wall you can
          read — and the tiles grow with it, because the grid adds columns at
          the screen's own steps rather than stretching the ones it has.

          `h-full` is exact: the frame is `inset-0` with `p-6`, so its content
          box is already the screen minus that margin, and a percentage height
          resolves against it. No `max-w`, for the same reason the shelves have
          none — a wall of posters is the one thing in this app that genuinely
          spends a 32-inch display. */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        label={`Choose ${KINDS[tab].label.toLowerCase()}`}
        panelClassName="flex h-full w-full flex-col"
      >
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-3 px-5 pt-5 pb-4">
            <h2 className="text-lg font-semibold">{KINDS[tab].label}</h2>

            <Select
              label="Order"
              value={sort}
              onChange={(value) => setSort(value as Sort)}
            >
              <option value="largest">Largest dimensions</option>
              <option value="default">TMDb order</option>
            </Select>

            {/* Only once there is a choice to make. One language is every film
                with a single set of artwork, and a menu whose only entry is the
                thing already on screen is a control that has never done
                anything. */}
            {languages.size > 1 && (
              <Select
                label="Language"
                value={inLanguage}
                onChange={setLanguage}
              >
                <option value="all">All languages ({listed.length})</option>
                {[...languages].map(([code, count]) => (
                  <option key={code} value={code}>
                    {code === TEXTLESS ? "Textless" : named(code)} ({count})
                  </option>
                ))}
              </Select>
            )}

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
                        src={imageUrl(choice.filePath, KINDS[tab].bucket)}
                        alt=""
                        loading="lazy"
                        className={
                          tab === "logo"
                            ? "max-h-full w-auto object-contain"
                            : "h-full w-full object-cover"
                        }
                      />
                      {/* Size, and language when it is worth saying. English
                          is not: it is most of the grid, and a label on nearly
                          every tile is one nobody reads. Textless and "this one
                          is Italian" are both the answer to the same question,
                          which is why you would be looking down here at all. */}
                      <span className="absolute inset-x-0 bottom-0 bg-black/65 px-1.5 py-0.5 text-[10px] text-white">
                        {choice.width}×{choice.height}
                        {choice.language === null
                          ? " · textless"
                          : choice.language !== "en" &&
                            ` · ${choice.language.toUpperCase()}`}
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
        </>
      </Modal>
    </>
  );
}
