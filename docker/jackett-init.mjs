/**
 * Hands Jackett the two things it would otherwise make you go and configure:
 * the API key the app already knows, and a starter set of indexers.
 *
 * Jackett generates a key on first start and writes it into ServerConfig.json,
 * which leaves the app with a credential it can only learn by being told —
 * somebody opens the dashboard, copies thirty-two characters and pastes them
 * into Settings. Jackett is equally happy to be handed a key instead: if the
 * config already names one, it keeps it. So this runs first, writes the key
 * from the environment into that file, and both sides of the stack come up
 * already agreeing.
 *
 * The indexers work the same way. A configured one is a plain JSON file in
 * Indexers/, and for a public tracker it holds nothing but the site address
 * and a couple of sort preferences — no login, nothing encrypted, nothing tied
 * to the machine that wrote it. The files in `jackett-indexers/` are Jackett's
 * own output, captured once and replayed here.
 *
 * Runs to completion before Jackett starts, and again on every `up`, so both
 * halves are written to be safe on an install that already exists: the key is
 * patched into the config rather than replacing it, and the indexers are only
 * ever seeded into an empty Indexers/ — see seedIndexers.
 */

import {
  chownSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const CONFIG_DIR = "/config/Jackett";
const CONFIG_FILE = path.join(CONFIG_DIR, "ServerConfig.json");
const INDEXER_DIR = path.join(CONFIG_DIR, "Indexers");

/** Mounted read-only by compose, from docker/jackett-indexers. */
const INDEXER_SEEDS = "/indexers";

/** What Jackett generates for itself: thirty-two of its own alphabet. */
const KEY_SHAPE = /^[a-z0-9]{32}$/i;

// PUID/PGID are LinuxServer's convention, and its startup refuses a config
// directory it does not own. Everything here is written as root and handed
// over as it goes.
const uid = Number(process.env.PUID ?? 1000);
const gid = Number(process.env.PGID ?? 1000);

const own = (target) => {
  try {
    chownSync(target, uid, gid);
  } catch {
    // A bind mount from macOS reports the host's ownership and refuses to have
    // it changed. The files are already the right user there, so the call was
    // never the thing that mattered — only the named volume needs it.
  }
};

/**
 * Writes the chosen key into Jackett's server config, leaving everything else
 * in the file exactly as it was.
 */
function seedApiKey() {
  const key = (process.env.JACKETT_API_KEY ?? "").trim();

  // No key chosen is a legitimate answer, and the one the stack falls back to:
  // Jackett generates its own and you paste it into Settings once, exactly as
  // you would outside a container. Nothing to do, and nothing to warn about.
  if (!key) {
    console.log(
      "jackett-init: no JACKETT_API_KEY set — Jackett will generate its own key, " +
        "and Settings → Jackett is where it goes.",
    );
    return;
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

  /**
   * Everything Jackett has already been told, or nothing on a first run.
   * Parsed rather than pattern-matched: this file holds the indexer setup and
   * the admin password, and a regex that got it wrong would take those with it.
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
    return;
  }

  const seeding = config.APIKey === undefined;

  writeFileSync(
    CONFIG_FILE,
    JSON.stringify(
      {
        // Defaults for a first run, both overridden by anything already there.
        // Jackett fills in the rest of the file itself on first start.
        Port: 9117,
        // "External" here is the Docker bridge the app reaches Jackett on, not
        // the internet — Jackett is inside gluetun's network either way.
        AllowExternal: true,
        ...config,
        APIKey: key,
      },
      null,
      2,
    ) + "\n",
  );

  own(CONFIG_FILE);

  console.log(
    seeding
      ? "jackett-init: seeded a fresh config with the key from the environment."
      : "jackett-init: replaced the existing key with the one from the environment.",
  );
}

/**
 * Copies the bundled indexer configs in, so a new install can search on the
 * first page load instead of after a trip to the dashboard.
 *
 * Only ever into an empty Indexers/. Once Jackett has one of its own, the set
 * is yours: removing a tracker you did not want should not be undone by the
 * next `up`, and that is a likelier thing to want than a starter set being
 * topped up behind you. Delete every indexer and the seeds do come back —
 * empty is indistinguishable from new, and that seemed the better failure.
 */
function seedIndexers() {
  const disabled = /^(0|false|no)$/i.test(
    process.env.JACKETT_SEED_INDEXERS ?? "",
  );
  if (disabled) {
    console.log("jackett-init: indexer seeding switched off.");
    return;
  }

  if (!existsSync(INDEXER_SEEDS)) return;

  const seeds = readdirSync(INDEXER_SEEDS).filter((f) => f.endsWith(".json"));
  if (seeds.length === 0) return;

  const existing = existsSync(INDEXER_DIR)
    ? readdirSync(INDEXER_DIR).filter((f) => f.endsWith(".json"))
    : [];

  if (existing.length > 0) {
    console.log(
      `jackett-init: ${existing.length} indexer(s) already configured — leaving them alone.`,
    );
    return;
  }

  mkdirSync(INDEXER_DIR, { recursive: true });
  own(INDEXER_DIR);

  for (const file of seeds) {
    const target = path.join(INDEXER_DIR, file);
    copyFileSync(path.join(INDEXER_SEEDS, file), target);
    own(target);
  }

  console.log(
    `jackett-init: seeded ${seeds.length} indexer(s) — ${seeds
      .map((f) => path.basename(f, ".json"))
      .join(", ")}.`,
  );
}

mkdirSync(CONFIG_DIR, { recursive: true });
own(CONFIG_DIR);

seedApiKey();
seedIndexers();
