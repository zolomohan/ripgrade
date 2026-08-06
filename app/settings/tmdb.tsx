"use client";

import { useState, useTransition } from "react";

import { disconnectTmdb, saveTmdbToken } from "../actions";
import { Failure, Field, FIELD, Note, PRIMARY, QUIET, Status } from "./parts";

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
 * The field is always here rather than behind a Connect button: the panel this
 * sits in is already the disclosure, and a second one inside it would be two
 * things to open before you can type.
 */
export function Tmdb({ configured }: { configured: boolean }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveTmdbToken(token);
      if (result.ok) setToken("");
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Status
          on={configured}
          label={configured ? "Connected" : "Not connected"}
        />

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
      </div>

      <Field
        label="Read access token"
        hint="TMDb account settings, under API — the long one, not the v3 key."
      >
        <input
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          className={FIELD}
        />
      </Field>

      {error && <Failure>{error}</Failure>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending || !token.trim()}
          className={PRIMARY}
        >
          {pending ? "Checking…" : configured ? "Replace token" : "Connect"}
        </button>
        <Note>Saved only if TMDb answers.</Note>
      </div>
    </div>
  );
}
