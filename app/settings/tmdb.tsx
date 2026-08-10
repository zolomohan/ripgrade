"use client";

import { useState, useTransition } from "react";

import { disconnectTmdb, saveTmdbToken } from "../actions";
import { FIELD } from "../controls";
import { Spinner } from "../spinner";
import { SettingDialog } from "./dialog";
import { Failure, Field, PRIMARY, QUIET, Status } from "./parts";

/**
 * Connecting TMDb.
 *
 * Write-only from here: the token is stored but no action hands it back, so a
 * connected install shows that it is connected and nothing else. This is the
 * only way to set it — the app does not read the environment for it. Saving
 * runs a live search first and puts back whatever worked before if it fails —
 * a field that accepts a typo silently would leave every title, poster and
 * collection quietly broken.
 *
 * The field lives in a dialog rather than under the state it changes. Typing a
 * token is something you do once and then never again, and while it sat in the
 * panel it was the tallest thing there — a password box under a line that
 * already said "Connected", asking to be read every time you opened Settings
 * looking for something else.
 */
export function Tmdb({ configured }: { configured: boolean }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** Leaving without saving forgets the half-pasted token and the last refusal. */
  function close() {
    setOpen(false);
    setToken("");
    setError(null);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveTmdbToken(token);
      // Only the dialog closes on success; the state behind it is the server's
      // to redraw, and it has already been told to.
      if (result.ok) {
        setToken("");
        setOpen(false);
      } else setError(result.error);
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Status
        on={configured}
        label={configured ? "Connected" : "Not connected"}
      />

      <div className="flex shrink-0 items-center gap-3">
        {configured && (
          <button
            type="button"
            onClick={() => startTransition(async () => disconnectTmdb())}
            disabled={pending}
            className={QUIET}
          >
            Disconnect
          </button>
        )}

        <button type="button" onClick={() => setOpen(true)} className={PRIMARY}>
          {configured ? "Replace token" : "Connect"}
        </button>
      </div>

      <SettingDialog
        open={open}
        onClose={close}
        busy={pending}
        title={configured ? "Replace the TMDb token" : "Connect TMDb"}
        lede="Nothing is stored until TMDb answers a search with it."
      >
        {/* A form, so Enter does what the button does — the whole dialog is one
            field, and reaching for the mouse to leave it is a step too many. */}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (token.trim()) save();
          }}
          className="flex flex-col gap-4"
        >
          <Field
            label="Read access token"
            hint="TMDb account settings, under API — the long one, not the v3 key."
          >
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="off"
              autoFocus
              spellCheck={false}
              className={`${FIELD.default} w-full`}
            />
          </Field>

          {error && <Failure>{error}</Failure>}

          <button
            type="submit"
            disabled={pending || !token.trim()}
            className={`${PRIMARY} self-start`}
          >
            {pending && <Spinner />}
            {pending ? "Checking…" : configured ? "Replace token" : "Connect"}
          </button>
        </form>
      </SettingDialog>
    </div>
  );
}
