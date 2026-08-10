# Indexer Connectivity — Diagnosis & Fix

**Status:** complete and verified against the live setup on 2026-08-07. Two of
four indexers restored; two follow-ups listed at the end remain open.

---

## The problem

Two symptoms, reported separately, which turned out to have three unrelated
causes:

1. The queue page showed *"Search keeps failing — is Jackett reachable?"* and the
   message would not clear, even while searching a film by hand worked.
2. Some films had no download, "namely from TorrentDownload".

Nothing about either symptom pointed at its actual cause. The first described a
proxy that was running; the second described an indexer returning results that
could not be used, on top of an indexer returning nothing at all.

---

## Cause 1 — a failed sweep has no way out

The message was not a live check. It was a dead job's state, read from
`globalThis`:

```json
{ "status": "error", "total": 17, "done": 2,
  "startedAt": 1786119050977, "finishedAt": 1786119051013,
  "error": "Search keeps failing — is Jackett reachable? (…fetch failed)" }
```

That sweep lived **36 milliseconds** — three instant connection refusals in a
row, tripping `ABORT_AFTER_FAILURES` in `lib/upgrade-sweep.ts`. The abort exists
for a good reason (a dead Jackett would otherwise cost an hour of attempts), but
it leaves `status: "error"` frozen with nothing able to overwrite it.

`startSweep()` had exactly two callers — the end of a scan (`lib/scanner.ts`) and
adding a wishlist item (`app/actions.ts`) — and `app/actions.ts` said so
outright: *"There is no start here."* So the page could describe a failure for
hours after it stopped being true.

Manual searches kept working throughout because they call `searchIndexers`
directly and never touch sweep state. The two paths cannot agree or disagree —
they do not talk.

**Fixed by** `retryUpgradeSweep()` in `app/actions.ts` and a *Try again* control
beside the error in `app/upgrades/upgrades-view.tsx`. Scoped to the error state
only: a sweep is still not something you start, and this is a retry on a thing
that failed. A fresh sweep spreads over `IDLE`, which carries no `error` key, so
starting one clears the message by construction.

---

## Cause 2 — the ISP forges DNS answers

Three of four indexers returned nothing, failing with an OpenSSL error
(`error:0A0003E8:SSL routines::reason(1000)`) before any query was sent.

### Evidence

Asking two resolvers the same question:

| Host | ISP resolver | Cloudflare DoH (truth) |
| --- | --- | --- |
| `www.torrentdownload.info` | **49.205.171.201** | 172.67.142.65 |
| `1337x.to` | **49.205.171.201** | 172.67.188.67 |
| `thepiratebay.org` | **49.205.171.201** | 162.159.137.6 |
| `www.limetorrents.lol` | real Cloudflare IPv6 | ✓ matches |
| `apibay.org` | real Cloudflare IPv6 | ✓ matches |

Three unrelated sites resolving to one identical address is a sinkhole. The TLS
handshake then fails because that host serves a block page under a certificate
for some other domain — so the client correctly refuses to talk to it. The error
reads as "encryption failed" rather than "you were lied to", which is what made
this hard to see.

The two indexers that worked were simply not on the block list. That
inconsistency was the first clue: a genuine fault breaks everything, a block
breaks a list.

### Changing resolver does not help

```
via 1.1.1.1 → 123.176.40.67
via 8.8.8.8 → 123.176.40.67
via 9.9.9.9 → 123.176.40.67
```

Three competing providers returning one identical forged address means the
answer never came from any of them. Port 53 is intercepted regardless of who the
query is addressed to — plain DNS is unencrypted, so it can be read in transit
and answered in the resolver's place.

### Nothing else is blocked

Supplying the real addresses by hand, with correct SNI, from inside the
container:

| Host | Result |
| --- | --- |
| `www.torrentdownload.info` | 200 |
| `1337x.to` | 403 (Cloudflare challenge — separate issue) |
| `www.limetorrents.lol` | 301 |
| `thepiratebay.org` | 302 |

No SNI filtering, no DPI. The block is **purely DNS**, which is why a VPN was
the wrong tool: it would have fixed lookups as a side effect of tunnelling all
traffic, at the cost of a subscription, throughput, and — the reason it was
rejected — signing the machine out of everything else.

### The fix

`~/jackett-vpn/` holds a two-container compose stack:

- **`jackett-dns`** — CoreDNS, forwarding every lookup over TLS (DoT, port 853)
  to Cloudflare. Config in `~/jackett-vpn/Corefile`.
- **`jackett`** — unchanged image and bind mount, with `dns: [172.28.0.53]`
  pointing at the resolver.

Both sit on a private network `172.28.0.0/16`; the resolver's address ends in
`.53` as a mnemonic for the DNS port.

The load-bearing line is `tls_servername cloudflare-dns.com`. Encryption alone
would only make the query unreadable — an interceptor could still answer on port
853. Naming the certificate that must be presented makes the connection
*unforgeable*: it either returns the true address or fails loudly. It cannot be
talked into returning a sinkhole quietly.

**Scope:** per-container, so the host is untouched. Verified simultaneously:

| `1337x.to` resolves to | |
| --- | --- |
| Host (macOS) | `49.205.171.201` — still sinkholed |
| `jackett` container | `104.21.40.193` — real |

### Two dead ends worth recording

- **cloudflared `proxy-dns`** — removed in cloudflared 2026.2.0. The container
  crash-loops with `dns-proxy feature is no longer supported`.
- **dnscrypt-proxy** — connects fine, but the default config listens on loopback
  only, so nothing else on the network can reach it. Would need a mounted TOML.

CoreDNS was chosen for being a nine-line config with an official image.

---

## Cause 3 — some indexers publish no magnet

Independent of the block. Once TorrentDownload returned results, they still had
no download, because its Torznab items carry **neither `magneturl` nor
`infohash`** — only Jackett's own `<link>`:

```xml
<title>Inception 2010 1080p AV1 10Bit DKong</title>
<guid>https://www.torrentdownload.info/520F5BB299060C2CD62192E602F1C2157E9D277F/Inception-2010</guid>
<link>http://localhost:9117/dl/torrentdownload/?jackett_apikey=…&amp;path=…</link>
```

That link embeds the API key, and `lib/jackett.ts` deliberately never carries it
into a result — results are rendered in the browser and the key would go with
them. Correct decision; the consequence is a row with nothing to fetch it by.

The info hash is in the `guid`, because that is how those sites address a
torrent. `lib/torznab.ts` now reads it back when the feed omits it:

```ts
const HASH_IN_URL = /(?:^|[^0-9a-f])([0-9a-f]{40})(?:[^0-9a-f]|$)/i;
```

Bounded on both sides so a 64-character v2 hash cannot have 40 characters taken
from its middle — that would build a magnet which looks valid and resolves to
nothing, worse than no button at all.

**LimeTorrents cannot be fixed this way.** Its `guid` holds only a page id
(`…-torrent-18534512.html`), so there is no hash anywhere in the feed.

---

## Results

Measured on the live aggregate feed, `t=movie&cat=2000&q=Inception`:

| Indexer | Items before | Items after | With a usable download |
| --- | --- | --- | --- |
| TorrentDownload | 0 | 35 | **35 / 35** |
| LimeTorrents | 0 | 26 | 0 |
| The Pirate Bay | 98 | 98 | 98 / 98 |
| 1337x | 0 | 0 | — |
| **Aggregate** | **98** | **159** | **133 / 159** |

Tests: **156 pass** (was 153; three added for the hash-from-URL path).

---

## Files changed

| Path | Change |
| --- | --- |
| `lib/torznab.ts` | Recover info hash from the details URL when the feed omits it |
| `test/torznab.test.ts` | Three tests: recovery, v2-hash rejection, attribute precedence |
| `app/actions.ts` | `retryUpgradeSweep()` |
| `app/upgrades/upgrades-view.tsx` | *Try again* beside a failed sweep |
| `~/jackett-vpn/docker-compose.yml` | CoreDNS + Jackett stack (outside the repo) |
| `~/jackett-vpn/Corefile` | DoT forwarding with certificate pinning |

The Jackett container was recreated. Its config directory
(`~/.config/Jackett`) is a bind mount and was reused, so the API key and every
configured indexer survived unchanged — the app's stored URL and key still work
without edits.

---

## Outstanding

- **LimeTorrents downloads.** 26 results with no magnet and no hash in the feed.
  The fix is resolving Jackett's `link` server-side, where the API key is safe,
  and returning only the magnet. New server action plus UI wiring, and it
  touches the boundary `lib/jackett.ts` deliberately drew — worth a decision
  before building.
- **1337x.** Now fails with `Challenge detected` rather than an SSL error, which
  means DNS is fixed and Cloudflare's anti-bot is the next layer. FlareSolverr
  is the standard answer and drops into the same compose file.
- **Stale `upgrade_checks`.** 19 rows were written while three indexers were
  down, and sit inside the sweep's 24-hour freshness window, so they are skipped
  rather than re-searched. Clearing the table would force a full re-sweep.
- **`npm test` is broken, pre-existing.** The script is
  `node --test data/_test/test/`, and Node 24 resolves the trailing directory as
  a module rather than globbing it. Running the files explicitly passes all 156.

---

## Reproducing the diagnosis

```bash
# Is a given indexer answering at all?
KEY=$(sqlite3 data/medlib.db "select value from settings where key='jackettApiKey';")
curl -s "http://localhost:9117/api/v2.0/indexers/<name>/results/torznab/api?apikey=$KEY&t=search&q=Inception" \
  | grep -c "<item>"

# Is DNS being forged? Compare the container against the truth.
docker exec jackett getent ahostsv4 1337x.to
curl -s -H 'accept: application/dns-json' "https://1.1.1.1/dns-query?name=1337x.to&type=A"

# Is anything other than DNS blocked? Supply the address by hand.
docker exec jackett curl -s -o /dev/null -w "%{http_code}\n" \
  --resolve "1337x.to:443:172.67.188.67" "https://1337x.to/"
```
