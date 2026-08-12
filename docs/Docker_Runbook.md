# Docker runbook

**Status:** working, brought up end to end against Docker Desktop 28.5.1 on Apple Silicon,
2026-08-12. The resolver returns real addresses inside the Jackett container while the host still
gets the ISP's sinkhole; a search across a 41-indexer install returned 683 results through the app,
and a wiped install re-seeded itself and returned 188. Replaces the standalone stack that used to
live at `~/jackett-vpn/`.

Running RipGrade as a container, with the five command-line tools already inside it, Jackett
beside it, and a resolver in front of Jackett. Everything the app shells out to is baked into the
image, so there is nothing to `brew install` and nothing to keep in step.

**There is no VPN here, deliberately.** The trackers are blocked by name, not by address, so the
stack runs CoreDNS forwarding over TLS instead — the diagnosis is in
[Indexer_Connectivity_Fix.md](Indexer_Connectivity_Fix.md), and the short version is under
[the resolver](#the-resolver). Nothing in `.env` needs a subscription.

The macOS caveat is at the [bottom](#the-honest-caveat), and it is worth reading before you
commit to this over a native install.

---

## Contents

| | |
|---|---|
| **[First run](#first-run)** | Four commands, once |
| **[Where things are](#where-things-are)** | Ports, and why not 3000 |
| **[Everyday](#everyday)** | The five commands you will actually use |
| **[The resolver](#the-resolver)** | Why CoreDNS and not a VPN |
| **[What is already configured](#what-is-already-configured)** | The key, the indexers, and how to change them |
| **[After a code change](#after-a-code-change)** | Rebuild cost, and what stays cached |
| **[Your data](#your-data)** | What survives, and the one command that does not |
| **[Developing alongside it](#developing-alongside-it)** | `next dev` and the container, at once |
| **[Troubleshooting](#troubleshooting)** | In the order things actually fail |
| **[What does not work in a container](#what-does-not-work-in-a-container)** | One casualty |

---

## First run

```bash
cp .env.docker.example .env
openssl rand -hex 16              # → JACKETT_API_KEY in .env
code .env                         # + JACKETT_CONFIG, if you have a Jackett already
```

Mount the library drive, **then**:

```bash
docker compose up -d --build
```

Drive first. Docker Desktop establishes the share when the container starts and does not reliably
propagate one plugged in later.

> [!IMPORTANT]
> Generate your own `JACKETT_API_KEY` rather than keeping the one the example ships with. That
> file is committed, which makes its key published rather than secret.

### Carrying an existing library across

The container has its own database, separate from `data/` on the host. To keep the scan you
already have — and the TMDb token in it — rather than starting from nothing:

```bash
docker compose cp data/medlib.db ripgrade:/app/data/medlib.db
docker compose restart ripgrade
```

The paths inside it are absolute and begin `/Volumes/`, which is exactly where the drive is bound
inside the container, so every one of them still resolves.

Otherwise: **Settings → Library folders** to add the drive, **Settings → TMDb** for the token.

---

## Where things are

| | | |
|---|---|---|
| **App** | <http://localhost:6969> | `RIPGRADE_PORT` in `.env` moves it |
| **Jackett** | <http://localhost:9117> | Its own port, on the network it shares with the app |

Not 3000, because that belongs to `next dev`. Running the container and the dev server at the same
time should not be a choice you have to make. Inside the container it is still 3000; only the host
side moved.

### What is running

| | |
|---|---|
| **dns** | CoreDNS at a fixed `172.28.0.53`, forwarding every lookup over TLS to Cloudflare. |
| **jackett-init** | Runs once, before Jackett, then exits. `Exited (0)` in `ps` is success. |
| **jackett** | The indexer proxy, given `dns: [172.28.0.53]` so it never consults the resolver the ISP hands out. |
| **ripgrade** | The app, the five tools, and the drive. On the default resolver: TMDb and Blu-ray.com are not names anybody is blocking. |

---

## Everyday

```bash
docker compose up -d --build ripgrade          # after a code change — ~34s
docker compose up -d                           # after an .env change — no rebuild
docker compose pull && docker compose up -d    # update Jackett and CoreDNS
docker compose logs -f ripgrade                # scan progress
docker compose down                            # stop. Data safe.
```

---

## The resolver

Three of four indexers used to return nothing, and the cause was not the trackers being
unreachable — it was the names. Asked for `torrentdownload.info`, `1337x.to` or `thepiratebay.org`,
the ISP's resolver answers `49.205.171.201` for all three: one sinkhole standing in for every
blocked name, serving a block page under a certificate for some other domain, so TLS fails.

Aiming at `1.1.1.1` does not help — port 53 is intercepted whatever you point it at, and `8.8.8.8`
and `9.9.9.9` hand back the same forged answer. What survives is an encrypted query, which cannot
be read and so cannot be answered for.

So `docker/Corefile` forwards every lookup over TLS to Cloudflare, and Jackett is given
`dns: [172.28.0.53]`. The load-bearing line is:

```
tls_servername cloudflare-dns.com
```

Encryption alone would only make the query unreadable — an interceptor could still answer on port
853. Naming the certificate that must be presented makes the connection *unforgeable*: it either
returns the true address or fails loudly.

**A VPN would also have worked**, and was rejected: it costs a subscription and a slower path for
traffic that was never the problem, and it signs the machine out of everything else. The block is
at the name, so the fix is at the name. Full diagnosis in
[Indexer_Connectivity_Fix.md](Indexer_Connectivity_Fix.md).

**Scope is one container.** The host keeps its own resolver, and `1337x.to` still resolves to the
sinkhole there. That was the point of doing it this way.

---

## What is already configured

Two things that would otherwise mean a trip to Jackett's dashboard before the app could search
anything. Both are done by [`docker/jackett-init.mjs`](../docker/jackett-init.mjs), which runs to
completion before Jackett starts.

### Where the config lives

`JACKETT_CONFIG` in `.env` points at Jackett's config directory on the host. Point it at an
install you already have and its indexers come across untouched; leave it unset and the stack
uses `docker/jackett-config/` and starts empty.

### The API key

Jackett normally invents one on first start and you go and copy it out. Here you choose it, in
`.env`, and it is written into Jackett's `ServerConfig.json` before Jackett has ever run — Jackett
only generates a key when it does not already have one. The same value reaches the app, so
**Settings → Jackett** reads *Set by the environment* on the first page load.

Changing it later is safe: the config is parsed and patched, not rewritten, so the indexers and
the admin password survive. Leave `JACKETT_API_KEY` blank and you get the old behaviour — Jackett
generates its own and you paste it into Settings.

### Three public indexers

The Pirate Bay, TorrentDownload and LimeTorrents, from
[`docker/jackett-indexers/`](../docker/jackett-indexers/). These are Jackett's own output,
captured once and replayed — a public tracker's config is a site address and a sort preference,
with no login, nothing encrypted and nothing tied to the machine that wrote it.

Seeded **only into a fresh Jackett**. Once it has indexers of its own the set is yours: dropping
one you did not want should not be undone by the next `up`. The trade-off is that deleting all of
them looks like a new install, and the seeds come back.

> [!IMPORTANT]
> Seeding is a **boot-time** mechanism, and Jackett reads `Indexers/` once at startup. If you
> delete indexers from the dashboard and then run `docker compose up -d`, `jackett-init` writes the
> files again but Compose has no reason to recreate Jackett — so the files are on disk and Jackett
> still reports none. It looks like the seeding failed when it did not.
>
> ```bash
> docker compose restart jackett     # or `down` then `up -d`
> ```
>
> This cannot bite on a genuinely fresh install, where `service_completed_successfully` already
> orders the two correctly.

- `JACKETT_SEED_INDEXERS=0` — start empty and choose your own.
- **Private trackers stay manual**, and should. Their configs carry logins, passkeys and cookies,
  which is not something to keep in a repo. Add those at <http://localhost:9117>.

---

## After a code change

```bash
docker compose up -d --build ripgrade
```

Rebuilds the image and recreates only that container. Jackett and the resolver keep running.

**Measured at 34 seconds.** The Dockerfile copies `package.json` before the source, so a code
change invalidates only the tail of the build:

| Stays cached | Re-runs |
|---|---|
| `npm ci` — the native modules, and the slow part | `COPY . .` |
| apt: mediainfo, ffmpeg, mkvtoolnix | `next build`, ~12s |
| dovi_tool and dovi_convert downloads | `npm prune` |
| the `node_modules` copy into the runner | the `.next` copy |

Touch `package.json` and `npm ci` invalidates too. That case is a couple of minutes, and it is the
only slow one.

### What does not need a rebuild

- **`.env`** — ports, the Jackett config path, the key. `docker compose up -d` recreates with the new values.
- **`docker/jackett-init.mjs`**, **`docker/jackett-indexers/`** and **`docker/Corefile`** —
  bind-mounted read-only, not baked into any image. The next `up` runs the new version.

---

## Your data

| | |
|---|---|
| `ripgrade-data` (volume) | `medlib.db` and the thumbnail cache |
| `$JACKETT_CONFIG` (bind mount) | The API key and every indexer — a directory on the host, so it is yours |

Rebuilding replaces the container, not either of them. A rebuild costs you nothing — no rescan, no
reconfiguration.

> [!WARNING]
> `docker compose down -v` deletes the `ripgrade-data` volume. It cannot touch `$JACKETT_CONFIG`,
> which is a plain directory outside Docker's control. Plain `down` deletes nothing.

To take a copy of the database out:

```bash
docker compose cp ripgrade:/app/data/medlib.db ./medlib-backup.db
```

---

## Developing alongside it

34 seconds is fine occasionally and miserable as an edit-refresh loop. That is what the port split
is for:

```bash
npm run dev                              # localhost:3000 — iterate here
docker compose up -d --build ripgrade    # localhost:6969 — update the keeper
```

Both at once. They use **separate databases** — the dev server reads `data/medlib.db` on the host,
the container reads its volume — so a scan in one does not appear in the other. That is usually
what you want; when it is not, `docker compose cp` moves the file either way.

---

## Troubleshooting

In roughly the order things fail.

**An indexer returns nothing.** Almost always DNS, and the resolver is the first thing to check.
It should answer with a real address, not `49.205.171.201` — that one is the ISP's sinkhole:

```bash
docker compose exec jackett getent hosts thepiratebay.org
docker compose logs dns
```

Note the scope: this fixes lookups *inside the Jackett container only*. The same name on the host
will still resolve to the sinkhole, and that is intended.

**The app cannot see the drive.** It was mounted after the container started.

```bash
docker compose restart ripgrade
docker compose exec ripgrade ls /Volumes    # what it can actually see
```

**Jackett looks unconfigured, or has lost its indexers.** Check `JACKETT_CONFIG` in `.env` is
pointing where you think — an unset one sends the stack to an empty `docker/jackett-config/`
rather than to the install you already have.

```bash
docker compose logs jackett-init
```

It says what it did: seeded a key, replaced a key, seeded *n* indexers, or left an existing install
alone. `Exited (0)` is the correct state for that container.

**The image will not build.** Check nothing is mid-edit — the build copies the working tree as it
finds it, and a half-saved file fails `next build` the same way it would locally.

---

## What does not work in a container

**Reveal in Finder.** There is no Finder. The button is not drawn rather than drawn and always
failing — [`lib/system.ts`](../lib/system.ts) decides on `process.platform`, and
[`app/film/[id]/detail.tsx`](../app/film/%5Bid%5D/detail.tsx) hides it.

Everything else works unchanged. Convert, audio strip and cleanup all write through the bind
mount, and the files land on the host owned by you, not by root.

---

## The honest caveat

On macOS every byte the app reads crosses Docker Desktop's file sharing. MediaInfo reads headers
and barely notices. A `dovi_convert` run is a 90 GB remux through that same mount, and it will be
meaningfully slower than running the app natively — worth keeping the Homebrew install around for
conversion days.

On Linux, where the drive is simply mounted, none of this applies.
