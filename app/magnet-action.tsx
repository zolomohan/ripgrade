"use client";

import { useEffect, useState, useTransition } from "react";

import { browse, getLibraryFolders, sendToQb } from "@/app/actions";
import { useCapabilities } from "@/app/capabilities";
import { FolderPicker } from "@/app/folder-picker";
import { CloseButton, Modal, useClosing } from "@/app/modal";
import { Failure } from "@/app/settings/parts";
import { Spinner } from "@/app/spinner";
import { stagger } from "@/app/stagger";
import type { DirListing } from "@/lib/browse";
import type { FilmContext } from "@/lib/qbittorrent";

/**
 * The download control, wherever a release appears.
 *
 * With qBittorrent connected it is a real handover: the click opens a small
 * dialog asking where the download should land — qBittorrent's own default,
 * or any library folder, remembered for next time — and picking one sends it.
 * The mark turns into a tick; progress lives on the Downloads page. Without a
 * client, the same control is the plain magnet link it always was.
 *
 * `film` rides along so the log knows which film the release was fetched
 * for — the Downloads page shows the poster, and a bare magnet could never
 * say.
 */

const CIRCLE =
  "grid shrink-0 place-items-center rounded-full border transition-colors";

const SIZES = {
  sm: { button: "h-8 w-8", icon: "h-3.5 w-3.5" },
  md: { button: "h-9 w-9", icon: "h-4 w-4" },
};

/** The last destination picked, offered first the next time. */
const LAST_PATH_KEY = "ripgrade:downloadPath";

function DownArrow({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M12 4v11" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M5 19h14" />
    </svg>
  );
}

const basename = (path: string) =>
  path.split("/").filter(Boolean).pop() ?? path;

function FolderIcon({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

/**
 * One place a download could land: the mark in a circle, the name in words,
 * the path in mono underneath — the anatomy every list row in the app has.
 */
function Destination({
  icon,
  label,
  detail,
  mono = false,
  remembered = false,
  disabled,
  index = 0,
  onPick,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
  mono?: boolean;
  remembered?: boolean;
  disabled: boolean;
  /** Its place in the cascade, like every other list row here. */
  index?: number;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      style={stagger(index)}
      className="glow row-enter flex w-full items-center gap-3.5 px-5 py-3 text-left transition-colors hover:bg-surface-strong disabled:opacity-40"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line opacity-60">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{label}</span>
        <span
          className={`mt-0.5 block truncate text-[11px] opacity-45 ${
            mono ? "font-mono" : ""
          }`}
        >
          {detail}
        </span>
      </span>
      {remembered && (
        <span className="shrink-0 rounded-chip px-1.5 text-[10px] leading-[18px] font-semibold tracking-widest uppercase opacity-45 ring-1 ring-line-strong ring-inset">
          Last used
        </span>
      )}
    </button>
  );
}

function Check({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="m4 12.5 5 5 11-11" />
    </svg>
  );
}

export function MagnetAction({
  magnet,
  film,
  size = "sm",
  pill = false,
}: {
  magnet: string;
  /** Which film this release is for, for the download log's poster. */
  film?: FilmContext;
  size?: keyof typeof SIZES;
  /** The compare page's filled button; circles everywhere else. */
  pill?: boolean;
}) {
  const { qb } = useCapabilities();
  const [open, setOpen] = useState(false);
  const mounted = useClosing(open);
  const [roots, setRoots] = useState<string[] | null>(null);
  /** The browse view inside the dialog, for a folder the list does not offer. */
  const [browsing, setBrowsing] = useState(false);
  /** True once the browser has been opened this visit — the list slides back
      in from the left on return, but sits still on the dialog's own open. */
  const [visitedBrowse, setVisitedBrowse] = useState(false);
  const [listing, setListing] = useState<DirListing | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const { button, icon } = SIZES[size];

  // The folders are the same few strings every time; fetched once per dialog.
  useEffect(() => {
    if (!open || roots) return;
    void getLibraryFolders().then(setRoots);
  }, [open, roots]);

  if (!qb) {
    // The magnet as itself: `magnet:` is a scheme the browser hands straight
    // to whatever the system has registered, so there is nothing for the app
    // to do beyond offering the href — and no location to choose either.
    return pill ? (
      <a
        href={magnet}
        title={magnet}
        className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-1.5 text-sm text-background transition-opacity hover:opacity-90"
      >
        <DownArrow className="h-3.5 w-3.5" />
        Download
      </a>
    ) : (
      <a
        href={magnet}
        onClick={(e) => e.stopPropagation()}
        aria-label="Download"
        title={magnet}
        className={`${CIRCLE} ${button} border-line-strong hover:bg-surface-strong`}
      >
        <DownArrow className={icon} />
      </a>
    );
  }

  function begin(event: React.MouseEvent) {
    event.stopPropagation();
    if (sent || pending) return;
    setError(null);
    setBrowsing(false);
    setVisitedBrowse(false);
    setOpen(true);
  }

  /** Opens the in-dialog browser, starting from the likeliest place. */
  function beginBrowse() {
    setBrowsing(true);
    setVisitedBrowse(true);
    if (!listing) {
      void browse(lastPath ?? roots?.[0] ?? "/").then(setListing);
    }
  }

  /**
   * Picking a destination is the send — no second confirmation to find.
   *
   * The dialog closes on success and stays open on failure. Closing on both
   * left the whole answer in a red circle's tooltip: something had gone wrong,
   * on a button that had already given up the one place with room to say what.
   * A send that did not happen is still the dialog's business, so it holds its
   * ground and prints the reason where the click was made.
   *
   * Returns the result as well as showing it — the folder browser has its own
   * place for a failure, and reporting `ok` there while the send failed made a
   * download that never happened look like one that did.
   */
  function send(savePath?: string) {
    try {
      if (savePath) localStorage.setItem(LAST_PATH_KEY, savePath);
      else localStorage.removeItem(LAST_PATH_KEY);
    } catch {
      // A private window forgets the preference; the send still works.
    }

    return new Promise<{ ok: true } | { ok: false; error: string }>(
      (resolve) => {
        startTransition(async () => {
          const result = await sendToQb(magnet, savePath, film);
          if (result.ok) {
            setSent(true);
            setOpen(false);
          } else {
            setError(result.error);
          }
          resolve(result);
        });
      },
    );
  }

  const lastPath = (() => {
    try {
      return localStorage.getItem(LAST_PATH_KEY) ?? undefined;
    } catch {
      return undefined;
    }
  })();

  const label = sent
    ? "Sent to qBittorrent"
    : (error ?? "Send to qBittorrent");

  const trigger = pill ? (
    <button
      type="button"
      onClick={begin}
      disabled={pending}
      title={label}
      className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm transition-opacity disabled:opacity-60 ${
        sent
          ? "bg-emerald-600 text-white dark:bg-emerald-500"
          : error
            ? "bg-red-600 text-white"
            : "bg-foreground text-background hover:opacity-90"
      }`}
    >
      {/* The mark says which of the three things has happened; while the
          client is being handed the magnet, the wheel stands in its place so
          the button does not change width on its way to an answer. */}
      {pending ? (
        <Spinner />
      ) : sent ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <DownArrow className="h-3.5 w-3.5" />
      )}
      {sent ? "Sent" : error ? "Retry" : "Download"}
    </button>
  ) : (
    <button
      type="button"
      onClick={begin}
      disabled={pending}
      aria-label={label}
      title={label}
      className={`${CIRCLE} ${button} ${
        sent
          ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400"
          : error
            ? "border-red-500/60 text-red-600 dark:text-red-400"
            : "border-line-strong hover:bg-surface-strong"
      } disabled:opacity-50`}
    >
      {pending ? (
        <Spinner className={icon} />
      ) : sent ? (
        <Check className={icon} />
      ) : (
        <DownArrow className={icon} />
      )}
    </button>
  );

  return (
    /* The span fences the dialog's clicks off from whatever row holds this
       control — portal events bubble through the React tree, and several of
       these rows navigate on click. */
    <span onClick={(e) => e.stopPropagation()} className="contents">
      {trigger}

      {mounted && (
        <Modal
          open={open}
          onClose={() => setOpen(false)}
          dismissible={!pending}
          label="Where should this download land?"
          panelClassName="w-full max-w-lg overflow-hidden glass-panel rounded-card border border-line shadow-2xl"
        >
          <>
            <header className="flex items-center gap-3 px-5 pt-5 pb-4">
              {/* The hero pages' own back mark, worn while the browser is
                  open — stepping out of it is a navigation, not a link. */}
              {browsing && (
                <button
                  type="button"
                  onClick={() => setBrowsing(false)}
                  aria-label="Back to the folder list"
                  title="Back to the folder list"
                  className="row-enter grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line opacity-60 transition-opacity hover:opacity-100"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                    className="h-4 w-4"
                  >
                    <path d="M11 6 5 12l6 6" />
                    <path d="M5 12h14" />
                  </svg>
                </button>
              )}
              <h2 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">
                Download to
              </h2>
              <CloseButton onClick={() => setOpen(false)} />
            </header>

            {/* The floor the title stands on, in place of the border the block
                below used to draw across the whole panel. */}
            <div aria-hidden className="rule-head mx-5" />

            {/* qBittorrent's own words for why it did not take the release —
                its address, its refusal, its timeout. Not while browsing: the
                picker prints a failed save under its own button, and the same
                sentence twice reads as two things having gone wrong. */}
            {error && !browsing && (
              <div className="bg-red-500/[0.06] px-5 py-3">
                <Failure>{error}</Failure>
                <p className="mt-1.5 text-[11px] opacity-45">
                  Nothing was sent. Pick a destination to try again, or check
                  the client on the{" "}
                  <a href="/settings" className="underline underline-offset-2">
                    Settings page
                  </a>
                  .
                </p>
              </div>
            )}

            {browsing ? (
              <div className="pane-forward flex flex-col gap-3 px-5 py-4">
                {listing ? (
                  <FolderPicker
                    initialListing={listing}
                    saveLabel="Download here"
                    onSave={(path) => send(path)}
                  />
                ) : (
                  <div className="flex flex-col gap-2">
                    {Array.from({ length: 5 }, (_, i) => (
                      <div key={i} className="skeleton h-8 w-full" />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              /* Its own top edge only when the failure band is above it —
                 otherwise the title's rule is already the line here. */
              <div
                className={`flex flex-col divide-y divide-line ${
                  error ? "border-t border-line" : ""
                } ${visitedBrowse ? "pane-back" : ""}`}
              >
                {/* Each destination is a full row: what it is in words, where
                    it is in mono, and the one picked last says so. */}
                <Destination
                  icon={<DownArrow className="h-4 w-4" />}
                  label="qBittorrent's default"
                  detail="wherever the client is set to save"
                  remembered={lastPath === undefined}
                  disabled={pending}
                  index={0}
                  onPick={() => send(undefined)}
                />

                {(roots ?? []).map((root, i) => (
                  <Destination
                    key={root}
                    icon={<FolderIcon className="h-4 w-4" />}
                    label={basename(root)}
                    detail={root}
                    mono
                    remembered={root === lastPath}
                    disabled={pending}
                    index={i + 1}
                    onPick={() => send(root)}
                  />
                ))}

                {roots === null && (
                  <div className="flex flex-col gap-1.5 px-5 py-3">
                    <div className="skeleton h-9 w-full" />
                    <div className="skeleton h-9 w-full" />
                  </div>
                )}

                <Destination
                  icon={<FolderIcon className="h-4 w-4" />}
                  label="Somewhere else…"
                  detail="browse for any folder"
                  disabled={pending}
                  index={(roots?.length ?? 0) + 1}
                  onPick={beginBrowse}
                />
              </div>
            )}

          </>
        </Modal>
      )}
    </span>
  );
}
