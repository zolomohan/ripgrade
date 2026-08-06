"use client";

import { useState, useTransition } from "react";

import { disconnectQb, saveQb, setQbStopSeeding } from "../actions";
import {
  Failure,
  Field,
  FIELD,
  Note,
  PRIMARY,
  QUIET,
  Row,
  Status,
  Toggle,
} from "./parts";

/**
 * Connecting qBittorrent.
 *
 * The password is write-only from here, exactly as Jackett's key is: stored,
 * never handed back. The username and password stay optional because
 * qBittorrent installs commonly bypass authentication on localhost — the
 * address alone is a working setup there, and the live check on save is what
 * finds out whether more is needed.
 */
export function Qbittorrent({
  configured,
  url,
  managed,
  stopSeeding,
}: {
  configured: boolean;
  url?: string;
  managed: boolean;
  stopSeeding: boolean;
}) {
  const [draftUrl, setDraftUrl] = useState(url ?? "http://localhost:8080");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveQb(draftUrl, username, password);
      if (result.ok) {
        setUsername("");
        setPassword("");
      } else setError(result.error);
    });
  }

  /** What to do once a download lands — the one choice a connection carries. */
  const seeding = configured && (
    <Row
      title="Stop seeding once a download finishes"
      hint="Off if your trackers count ratio — a stopped torrent earns none."
    >
      <Toggle
        on={stopSeeding}
        label="Stop seeding once a download finishes"
        disabled={pending}
        onChange={() =>
          startTransition(async () => setQbStopSeeding(!stopSeeding))
        }
      />
    </Row>
  );

  if (managed) {
    return (
      <div className="flex flex-col gap-4">
        <Status on label="Set by the environment" detail={url} />
        <Note>QBITTORRENT_URL is set, so this cannot be changed here.</Note>
        {seeding}
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
            onClick={() => startTransition(async () => disconnectQb())}
            disabled={pending}
            className={QUIET}
          >
            Disconnect
          </button>
        )}
      </div>

      <Field label="Address of the WebUI">
        <input
          type="url"
          value={draftUrl}
          onChange={(event) => setDraftUrl(event.target.value)}
          placeholder="http://localhost:8080"
          className={FIELD}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Username"
          hint="Leave empty if localhost needs no login."
        >
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            className={FIELD}
          />
        </Field>

        <Field label="Password">
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            className={FIELD}
          />
        </Field>
      </div>

      {error && <Failure>{error}</Failure>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending || !draftUrl}
          className={PRIMARY}
        >
          {pending ? "Checking…" : configured ? "Test and save" : "Connect"}
        </button>
        <Note>Saved only if qBittorrent answers.</Note>
      </div>

      {seeding}
    </div>
  );
}
