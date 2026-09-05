"use client";

import { useState, useTransition } from "react";

import { disconnectQb, saveQb, setQbStopSeeding } from "../actions";
import { ICONS, FIELD } from "../controls";
import { Spinner } from "../spinner";
import { stagger } from "../stagger";
import { SettingDialog } from "./dialog";
import {
  Failure,
  Field,
  IconButton,
  PRIMARY,
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
 *
 * The three fields are asked for in a dialog, as TMDb's and Jackett's are.
 * Inline they were the tallest thing on the page and the only part of it you
 * would never touch twice, standing between the line that says whether the
 * WebUI answers and the one choice a live connection actually carries.
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
  const fallbackUrl = url ?? "http://localhost:8080";

  const [open, setOpen] = useState(false);
  const [draftUrl, setDraftUrl] = useState(fallbackUrl);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** Leaving without saving puts the address back and forgets the credentials. */
  function close() {
    setOpen(false);
    setDraftUrl(fallbackUrl);
    setUsername("");
    setPassword("");
    setError(null);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveQb(draftUrl, username, password);
      // The address that saved is the setting now, so it stays; the login is
      // dropped, since nothing here ever shows it back.
      if (result.ok) {
        setUsername("");
        setPassword("");
        setOpen(false);
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
        {/* Connected, and nothing else — the address and the variable that
            set it were two facts about a service whose row answers one
            question. There is no button here because there is nothing this
            page could change. */}
        <div className="flex justify-end">
          <Status on label="Connected" />
        </div>
        {seeding}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Status
          on={configured}
          label={configured ? "Connected" : "Not connected"}
        />

        {configured && (
          <IconButton
            icon={ICONS.cross}
            label="Disconnect"
            disabled={pending}
            onClick={() => startTransition(async () => disconnectQb())}
          />
        )}

        <button type="button" onClick={() => setOpen(true)} className={PRIMARY}>
          {configured ? "Change" : "Connect"}
        </button>
      </div>

      {seeding}

      <SettingDialog
        open={open}
        onClose={close}
        busy={pending}
        title={
          configured
            ? "Change the qBittorrent connection"
            : "Connect qBittorrent"
        }
        lede="Nothing is stored until the WebUI answers — what you have now stays put if the check fails."
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (draftUrl) save();
          }}
          className="flex flex-col gap-4"
        >
          {/* The focus starts here because it is the only field that has to be
              filled in: on a localhost install that waives its login, the
              address is the whole of the connection. */}
          <Field label="Address of the WebUI" index={0}>
            <input
              type="url"
              value={draftUrl}
              onChange={(event) => setDraftUrl(event.target.value)}
              placeholder="http://localhost:8080"
              autoFocus
              className={`${FIELD.default} w-full`}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Username"
              hint="Leave empty if localhost needs no login."
              index={1}
            >
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                className={`${FIELD.default} w-full`}
              />
            </Field>

            <Field label="Password" index={2}>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                className={`${FIELD.default} w-full`}
              />
            </Field>
          </div>

          {error && <Failure>{error}</Failure>}

          <button
            type="submit"
            disabled={pending || !draftUrl}
            style={stagger(3)}
            /* The width of the thing it is the point of. `self-start` left the
               one action of a dialog hugging its own label in the corner, which
               is what a secondary choice looks like — and the download dialog's
               own primary press has spanned its panel since it was written. */
            className={`${PRIMARY} row-enter w-full`}
          >
            {pending && <Spinner />}
            {pending ? "Checking…" : configured ? "Test and save" : "Connect"}
          </button>
        </form>
      </SettingDialog>
    </div>
  );
}
