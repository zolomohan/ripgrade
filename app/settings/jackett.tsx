"use client";

import { useState, useTransition } from "react";

import { disconnectJackett, saveJackett } from "../actions";
import { FIELD } from "../controls";
import { Spinner } from "../spinner";
import { SettingDialog } from "./dialog";
import { Failure, Field, Note, PRIMARY, QUIET, Status } from "./parts";

/**
 * Connecting Jackett.
 *
 * The key is write-only from here: it is stored, but no action hands it back,
 * so a connected install shows the address and nothing else. Saving runs a live
 * check first and keeps the previous settings if it fails — a field that
 * accepts a typo silently is worse than one that refuses it.
 *
 * Address and key are asked for in a dialog. Shut, this setting is one line —
 * the address it reaches and whether it answers — which is what you came to
 * look at; the two fields that change it are a job of their own and now wait to
 * be asked for.
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
  const fallbackUrl = url ?? "http://localhost:9117";

  const [open, setOpen] = useState(false);
  const [draftUrl, setDraftUrl] = useState(fallbackUrl);
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * Leaving without saving puts the address back to the one in force. An edited
   * address left sitting in the box would be there the next time the dialog
   * opened, looking like the setting rather than an abandoned draft.
   */
  function close() {
    setOpen(false);
    setDraftUrl(fallbackUrl);
    setApiKey("");
    setError(null);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveJackett(draftUrl, apiKey);
      // The draft that saved is the setting now, so it can stay in the box; the
      // key is dropped, since nothing here ever shows it back.
      if (result.ok) {
        setApiKey("");
        setOpen(false);
      } else setError(result.error);
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
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Status
        on={configured}
        label={configured ? "Connected" : "Not connected"}
        detail={configured ? url : undefined}
      />

      <div className="flex shrink-0 items-center gap-3">
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

        <button type="button" onClick={() => setOpen(true)} className={PRIMARY}>
          {configured ? "Change" : "Connect"}
        </button>
      </div>

      <SettingDialog
        open={open}
        onClose={close}
        busy={pending}
        title={configured ? "Change the Jackett connection" : "Connect Jackett"}
        lede="Both are tried against Jackett before either is stored — what you have now stays put if the check fails."
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (draftUrl && apiKey) save();
          }}
          className="flex flex-col gap-4"
        >
          <Field label="Address">
            <input
              type="url"
              value={draftUrl}
              onChange={(event) => setDraftUrl(event.target.value)}
              placeholder="http://localhost:9117"
              className={`${FIELD.default} w-full`}
            />
          </Field>

          {/* The focus goes here rather than to the address: the address is
              filled in either way, and the key is the thing you arrived
              holding. */}
          <Field
            label="API key"
            hint="From the top right of Jackett’s own dashboard."
          >
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              autoComplete="off"
              autoFocus
              spellCheck={false}
              className={`${FIELD.default} w-full`}
            />
          </Field>

          {error && <Failure>{error}</Failure>}

          <button
            type="submit"
            disabled={pending || !draftUrl || !apiKey}
            className={`${PRIMARY} self-start`}
          >
            {pending && <Spinner />}
            {pending ? "Checking…" : configured ? "Test and save" : "Connect"}
          </button>
        </form>
      </SettingDialog>
    </div>
  );
}
