"use client";

import { useState, useTransition } from "react";

import { disconnectJackett, saveJackett } from "../actions";
import { Failure, Field, FIELD, Note, PRIMARY, QUIET, Status } from "./parts";

/**
 * Connecting Jackett.
 *
 * The key is write-only from here: it is stored, but no action hands it back,
 * so a connected install shows the address and nothing else. Saving runs a live
 * check first and keeps the previous settings if it fails — a field that
 * accepts a typo silently is worse than one that refuses it.
 */
export function Jackett({
  configured,
  url,
  managed,
}: {
  configured: boolean;
  url?: string;
  managed: boolean;
}) {
  const [draftUrl, setDraftUrl] = useState(url ?? "http://localhost:9117");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveJackett(draftUrl, apiKey);
      if (result.ok) setApiKey("");
      else setError(result.error);
    });
  }

  // Set outside the app, so there is nothing here to change — only the fact of
  // it, said in the same shape as a connection you made yourself.
  if (managed) {
    return (
      <div className="flex flex-col gap-3">
        <Status on label="Set by the environment" detail={url} />
        <Note>
          JACKETT_URL and JACKETT_API_KEY are set, so this cannot be changed
          here.
        </Note>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Status
          on={configured}
          label={configured ? "Connected" : "Not connected"}
          detail={configured ? url : undefined}
        />

        {configured && (
          <button
            type="button"
            onClick={() => startTransition(async () => disconnectJackett())}
            disabled={pending}
            className={QUIET}
          >
            Disconnect
          </button>
        )}
      </div>

      <Field label="Address">
        <input
          type="url"
          value={draftUrl}
          onChange={(event) => setDraftUrl(event.target.value)}
          placeholder="http://localhost:9117"
          className={FIELD}
        />
      </Field>

      <Field
        label="API key"
        hint="From the top right of Jackett’s own dashboard."
      >
        <input
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
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
          disabled={pending || !draftUrl || !apiKey}
          className={PRIMARY}
        >
          {pending ? "Checking…" : configured ? "Test and save" : "Connect"}
        </button>
        <Note>Saved only if Jackett answers.</Note>
      </div>
    </div>
  );
}
