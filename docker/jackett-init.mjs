/**
 * Gives Jackett the API key we already know, before it has a chance to invent
 * one of its own.
 *
 * Jackett generates a key on first start and writes it into ServerConfig.json,
 * which leaves the app with a credential it can only learn by being told —
 * somebody opens the dashboard, copies thirty-two characters and pastes them
 * into Settings. Jackett is equally happy to be handed a key instead: if the
 * config already names one, it keeps it. So this runs first, writes the key
 * from the environment into that file, and both sides of the stack come up
 * already agreeing.
 *
 * Runs to completion before Jackett starts, and again on every `up` — the
 * config is patched rather than replaced, so an existing install keeps its
 * indexers, its password and everything else it has learned.
 */

import {
  chownSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const CONFIG_DIR = "/config/Jackett";
const CONFIG_FILE = path.join(CONFIG_DIR, "ServerConfig.json");

/** What Jackett generates for itself: thirty-two of its own alphabet. */
const KEY_SHAPE = /^[a-z0-9]{32}$/i;

const key = (process.env.JACKETT_API_KEY ?? "").trim();

// No key chosen is a legitimate answer, and the one the stack falls back to:
// Jackett generates its own and you paste it into Settings once, exactly as
// you would outside a container. Nothing to do here, and nothing to warn about.
if (!key) {
  console.log(
    "jackett-init: no JACKETT_API_KEY set — Jackett will generate its own key, " +
      "and Settings → Jackett is where it goes.",
  );
  process.exit(0);
}

// A malformed key would be accepted here and rejected by every search later,
// which is a long way from the cause. Fail while the reason is still visible.
if (!KEY_SHAPE.test(key)) {
  console.error(
    `jackett-init: JACKETT_API_KEY is ${key.length} characters; Jackett's own keys are ` +
      "32 letters and digits. Generate one with: openssl rand -hex 16",
  );
  process.exit(1);
}

// PUID/PGID are LinuxServer's convention, and its startup refuses a config
// directory it does not own. Written as root, handed over here.
const uid = Number(process.env.PUID ?? 1000);
const gid = Number(process.env.PGID ?? 1000);

mkdirSync(CONFIG_DIR, { recursive: true });

/**
 * Everything Jackett has already been told, or nothing on a first run. Parsed
 * rather than pattern-matched: this file holds the indexer setup and the admin
 * password, and a regex that got it wrong would take those with it.
 */
let config = {};
if (existsSync(CONFIG_FILE)) {
  try {
    config = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  } catch (err) {
    console.error(
      `jackett-init: ${CONFIG_FILE} is not readable JSON, and overwriting it would ` +
        `take your indexers with it. Fix or delete it first. (${err.message})`,
    );
    process.exit(1);
  }
}

if (config.APIKey === key) {
  console.log("jackett-init: key already in place.");
  process.exit(0);
}

const seeding = config.APIKey === undefined;

writeFileSync(
  CONFIG_FILE,
  JSON.stringify(
    {
      // Defaults for a first run, both overridden by anything already there.
      // Jackett fills in the rest of the file itself on first start.
      Port: 9117,
      // Off, and the tunnel is why: Jackett shares gluetun's network, so
      // "external" here means the Docker bridge that the app reaches it on.
      AllowExternal: true,
      ...config,
      APIKey: key,
    },
    null,
    2,
  ) + "\n",
);

chownSync(CONFIG_DIR, uid, gid);
chownSync(CONFIG_FILE, uid, gid);

console.log(
  seeding
    ? "jackett-init: seeded a fresh config with the key from the environment."
    : "jackett-init: replaced the existing key with the one from the environment.",
);
