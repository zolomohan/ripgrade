"use client";

import { useState, useTransition } from "react";

import { disconnectTmdb, saveTmdbToken } from "../actions";
import { ICONS, FIELD } from "../controls";
import { Spinner } from "../spinner";
import { stagger } from "../stagger";
import { SettingDialog } from "./dialog";
import { IconButton, Failure, Field, PRIMARY } from "./parts";

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
    <div className="flex flex-wrap items-center justify-end gap-3">
      {/* No word for the state: the dot beside this setting's name carries it
          now, and "Connected" on three rows in a column said the same nothing
          three times. See `status` on `SettingRow`. */}
      {configured && (
        <IconButton
          icon={ICONS.cross}
          label="Disconnect from TMDb"
          disabled={pending}
          onClick={() => startTransition(async () => disconnectTmdb())}
        />
      )}

      <button type="button" onClick={() => setOpen(true)} className={PRIMARY}>
        {configured ? "Replace" : "Connect"}
      </button>

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
            index={0}
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
            style={stagger(1)}
            /* The width of the thing it is the point of. `self-start` left the
               one action of a dialog hugging its own label in the corner, which
               is what a secondary choice looks like — and the download dialog's
               own primary press has spanned its panel since it was written. */
            className={`${PRIMARY} row-enter w-full`}
          >
            {pending && <Spinner />}
            {pending ? "Checking…" : configured ? "Replace token" : "Connect"}
          </button>
        </form>
      </SettingDialog>
    </div>
  );
}
