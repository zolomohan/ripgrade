"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  ViewTransition,
} from "react";

import {
  deleteCollection,
  removeFromCollection,
  renameCollection,
  uploadCollectionBackdrop,
} from "@/app/actions";
import { Art } from "@/app/art";
import { HERO_BOX_SHORT, HERO_ART, HERO_VEIL } from "@/app/hero-art";
import { CollectionView } from "@/app/collections/[id]/collection-view";
import { NameDialog } from "@/app/collections/name-dialog";
import { ConfirmModal } from "@/app/confirm";
import { BUTTON } from "@/app/controls";
import { EmptyState } from "@/app/empty-state";
import { BackButton } from "@/app/film/[id]/back-button";
import { HERO_BUTTON } from "@/app/film/[id]/hero-button";
import { ScoreRing } from "@/app/score-card";
import { scoreTheme } from "@/app/score-circle";
import { Spinner } from "@/app/spinner";
import type { CustomSet } from "@/lib/custom-collections";
import {
  collectionMetaName,
  collectionTitleName,
  customCollectionKey,
} from "@/lib/routes";
import { AddFilms } from "./add-films";

/**
 * The set's own actions, folded behind one ellipsis.
 *
 * Renaming and deleting are both rare and one of them is final, which is the
 * argument for a menu rather than two more buttons: a thing you press once a
 * month should not stand permanently beside the thing you press every visit,
 * and a delete you can hit without first reading the word is a delete waiting
 * to happen. Named in a list, both have to be read to be reached.
 *
 * Click-away and Escape both dismiss, as everywhere else here — the same pair
 * the dialogs answer, for the same reason: they are one gesture, "not this".
 *
 * A menu of its own rather than a shared one. There are three of these in the
 * app now — the artwork editor's, the transfers row's, this — and they differ
 * in enough of what a menu is (where it opens, what its trigger looks like,
 * whether an item can be dangerous) that the shared thing would be a component
 * with an option per caller. What they actually share is the panel, and that is
 * already shared: `glass-panel` and the classes beside it below.
 */
function SetMenu({
  onRename,
  onDelete,
}: {
  onRename: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  const items = [
    { label: "Rename", onSelect: onRename, danger: false },
    { label: "Delete", onSelect: onDelete, danger: true },
  ];

  return (
    <div ref={wrap} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Collection actions"
        aria-expanded={open}
        title="Collection actions"
        className={HERO_BUTTON}
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden
          className="h-4 w-4"
        >
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>

      {open && (
        <div className="row-enter absolute top-full right-0 z-30 mt-2 w-44 overflow-hidden glass-panel rounded-card border border-line py-1 shadow-2xl">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              /* The red arrives on hover, when you are reaching for it — the
                 rule `BUTTON.danger` keeps. The dialog behind it is where the
                 colour belongs standing. */
              className={`glow flex w-full items-center px-3 py-2 text-left text-sm transition-colors ${
                item.danger
                  ? "hover:bg-red-500/[0.08] hover:text-red-700 dark:hover:text-red-300"
                  : "hover:bg-surface-strong"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A set you made, drawn as a set.
 *
 * The hero, the heading over the foot of it, the ring, the two shelves: all of
 * it is what a TMDb collection's page already is, because the argument for
 * making your own sets falls apart the moment they look like a lesser kind of
 * page. What this adds is the four things a list you wrote can want and a list
 * you were given cannot — films in, films out, a different name, and a picture.
 *
 * The backdrop is the one of those that has nowhere else to come from. A TMDb
 * set arrives with artwork; yours has no publisher, so it is an upload, written
 * into a folder of the set's own and served by the same route that serves every
 * poster on the drive. See uploadCollectionBackdrop.
 */
export function CustomCollectionView({
  set,
  wishlisted,
}: {
  set: CustomSet;
  wishlisted: number[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const key = customCollectionKey(set.id);
  const missing = set.missing ?? [];
  const total = set.owned.length + missing.length;

  /**
   * The set's standing, which is the average of what you actually hold — the
   * films you do not have score nothing and would only drag it toward zero for
   * being absent, which is the other question this page already answers.
   */
  const average = set.owned.length
    ? Math.round(
        set.owned.reduce((sum, film) => sum + (film.owned?.score ?? 0), 0) /
          set.owned.length,
      )
    : 0;

  /**
   * One write, with whatever it says on the way out.
   *
   * A write that fails inside the action returns `{ ok: false }`; one that fails
   * before it ever runs — the request refused for its size, the server
   * restarting under you — rejects instead, and to the person waiting those are
   * one thing: it did not work, and here is why.
   */
  function write(
    work: () => Promise<{ ok: true } | { ok: false; error: string }>,
    done?: () => void,
  ) {
    setError(null);
    startTransition(async () => {
      const result = await work().catch((err: unknown) => ({
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      }));

      if (result.ok) {
        done?.();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function upload(chosen: File) {
    const form = new FormData();
    form.set("file", chosen);
    setUploading(true);
    write(
      () =>
        uploadCollectionBackdrop(set.id, form).finally(() =>
          setUploading(false),
        ),
      undefined,
    );
  }

  return (
    // The same shape a film and a show open with: artwork first, then the name
    // sitting over the foot of it.
    //
    // `min-h-dvh` so that a set with nothing in it yet has somewhere to put the
    // empty state: `EmptyState` centres itself in the height left over, and a
    // page sized to its contents leaves none.
    <main className="flex min-h-dvh flex-col pb-16">
      {/* Dropping an image on the hero is the same act as picking one with the
          button in its corner, and the hero is the thing the picture is going
          to become — so it is the target. */}
      <div
        className={HERO_BOX_SHORT}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const dropped = event.dataTransfer.files[0];
          if (dropped) upload(dropped);
        }}
      >
        {set.backdrop ? (
          <>
            <Art
              src={set.backdrop}
              version={set.backdropAt}
              size="original"
              className={HERO_ART}
            />
            <div className={HERO_VEIL} />
          </>
        ) : (
          <div className="absolute inset-0 bg-surface-strong" />
        )}

        {dragging && (
          <div className="pointer-events-none absolute inset-4 grid place-items-center rounded-card border-2 border-dashed border-line-strong bg-background/60 text-sm backdrop-blur">
            Drop an image to make it the backdrop
          </div>
        )}

        <BackButton label="Back to collections" />

        <input
          ref={picker}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            // Cleared so that picking the same file again counts as a change
            // again — which is what you do after one fails.
            event.target.value = "";
            if (chosen) upload(chosen);
          }}
        />
        <button
          type="button"
          onClick={() => picker.current?.click()}
          disabled={uploading}
          aria-label="Upload a backdrop"
          title={set.backdrop ? "Replace the backdrop" : "Upload a backdrop"}
          className={`absolute top-6 right-6 ${HERO_BUTTON}`}
        >
          {uploading ? (
            <Spinner className="h-4 w-4" />
          ) : (
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
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="m21 15-5-5L5 21" />
            </svg>
          )}
        </button>
      </div>

      {/* relative + z-10: the hero above is positioned, so without its own
          stacking position this content would paint underneath it.

          `flex-1` so it takes the height the hero did not, which is the space
          the empty state below centres itself in. With content in it nothing
          moves: a column of flex children still starts at the top. */}
      <div className="relative z-10 mx-auto -mt-24 flex w-full max-w-6xl flex-1 flex-col gap-12 px-6 sm:px-8">
        {/* One line: the name, what can be done to it, and how it scores, all
            centred on the ring's own middle.

            They were on three heights before — the title sitting on the ring's
            base, the buttons floating at its centre, and neither level with the
            other — which reads as three things that happened to land in the
            same row rather than one heading. */}
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div className="enter-rise min-w-0">
            <ViewTransition
              name={collectionTitleName(key)}
              share="title"
              default="none"
            >
              <h1 className="w-fit font-display text-3xl leading-tight font-semibold tracking-tight">
                {set.name}
              </h1>
            </ViewTransition>
            {/* The same words the row carried, so the line travels with the
                title rather than being replaced by a different sentence. */}
            <ViewTransition
              name={collectionMetaName(key)}
              share="title"
              default="none"
            >
              <p className="mt-2 w-fit text-sm leading-tight opacity-55">
                {total} {total === 1 ? "film" : "films"}
              </p>
            </ViewTransition>
          </div>

          <div className="flex items-center gap-4">
            {/*
             * Two marks where there were three words.
             *
             * Adding is the thing you came to this page to do, so it keeps a
             * button of its own — a plus, which is the one icon that needs no
             * label. What is left is a rename and a delete: neither is anything
             * you do often, and a delete standing out on the page beside the
             * action you *are* here for is a hazard rather than a convenience.
             * Both go behind the ellipsis, where they have to be read before
             * they can be pressed.
             */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAdding(true)}
                aria-label="Add films"
                title="Add films"
                className={HERO_BUTTON}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  aria-hidden
                  className="h-4 w-4"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>

              <SetMenu
                onRename={() => setRenaming(true)}
                onDelete={() => setDeleting(true)}
              />
            </div>

            {/* The same ring a film carries, at the head of the set: one number
                for the shelf, drawn the way every other score in the app is. */}
            {set.owned.length > 0 && (
              <ScoreRing
                score={average}
                ring={scoreTheme(average).stroke}
                caption="average"
              />
            )}
          </div>
        </div>

        {/* Not while the rename dialog is up: it says the same thing over the
            field the answer has to be corrected in, and a failure printed in
            two places reads as two failures. */}
        {error && !renaming && (
          <p className="-mt-8 text-sm wrap-anywhere text-red-700 dark:text-red-300">
            {error}
          </p>
        )}

        {total === 0 ? (
          <EmptyState
            icon={
              <>
                <rect x="3" y="7" width="13" height="14" rx="2" />
                <path d="M7 4h10a2 2 0 0 1 2 2v12" />
                <path d="M9.5 14h4M11.5 12v4" />
              </>
            }
            title="Nothing in here yet"
            action={
              <button
                type="button"
                onClick={() => setAdding(true)}
                className={BUTTON.primary}
              >
                Add films
              </button>
            }
          >
            Films come from the library or straight from TMDb — and one you do
            not own yet moves onto the shelf above by itself, the day you rip
            it.
          </EmptyState>
        ) : (
          <CollectionView
            set={set}
            wishlisted={wishlisted}
            onRemove={(filmKey) =>
              write(() => removeFromCollection(set.id, filmKey))
            }
          />
        )}
      </div>

      <AddFilms
        collectionId={set.id}
        open={adding}
        onClose={() => setAdding(false)}
      />

      <NameDialog
        open={renaming}
        title="Rename collection"
        confirmLabel={pending ? "Saving…" : "Save"}
        initial={set.name}
        busy={pending}
        error={renaming ? error : null}
        onSubmit={(name) =>
          write(
            () => renameCollection(set.id, name),
            () => setRenaming(false),
          )
        }
        onCancel={() => setRenaming(false)}
      />

      <ConfirmModal
        open={deleting}
        title="Delete this collection?"
        confirmLabel={pending ? "Deleting…" : "Delete"}
        tone="danger"
        busy={pending}
        onConfirm={() =>
          write(
            () => deleteCollection(set.id),
            () => {
              setDeleting(false);
              // The plain address, which is the half this set was on.
              router.replace("/collections");
            },
          )
        }
        onCancel={() => setDeleting(false)}
      >
        <strong>{set.name}</strong> and the {total}{" "}
        {total === 1 ? "film" : "films"} in it, along with the backdrop you gave
        it. Nothing on any drive is touched — a collection names films, it does
        not hold them.
      </ConfirmModal>
    </main>
  );
}
