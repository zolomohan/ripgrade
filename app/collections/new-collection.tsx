"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createCollection } from "@/app/actions";
import { BUTTON } from "@/app/controls";
import { rememberListing } from "@/app/return-to";
import { Spinner } from "@/app/spinner";
import { NameDialog } from "./name-dialog";

/**
 * Makes a set and opens it.
 *
 * Opening it is the point. A new collection is empty by definition, so the next
 * thing anybody wants is the page where films go into it — leaving you on a
 * list with one more empty line on it would be answering the question you asked
 * and none of the one you meant.
 */
export function NewCollection() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const router = useRouter();

  function create(name: string) {
    setError(null);
    startTransition(async () => {
      const result = await createCollection(name).catch((err: unknown) => ({
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      }));

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setOpen(false);
      // The list is where the new set's own back button has to return to, and
      // this leaves it by a button rather than by a link — which the delegated
      // listener in app/return-to.tsx cannot see.
      rememberListing();
      router.push(`/collections/custom/${result.id}`);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className={BUTTON.secondary}
      >
        {busy && !open ? (
          <Spinner />
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden
            className="h-3.5 w-3.5"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        )}
        New
      </button>

      <NameDialog
        open={open}
        title="New collection"
        confirmLabel={busy ? "Creating…" : "Create"}
        busy={busy}
        error={error}
        onSubmit={create}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
