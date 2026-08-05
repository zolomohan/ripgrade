# Future plans

Where this app could go, and what each direction actually costs. Written as a
decision record rather than a roadmap: nothing here is scheduled, and the point
is that the next person to pick one of these up does not have to rediscover the
trade-offs.

Nothing in here has been built. Everything in the "what exists today" table has.

---

## The goal

**RipGrade should be self-contained except for TMDb.** Someone should be able to
install one thing and have a working library: no Homebrew, no CLI tools to
install, no Jackett to configure, no qBittorrent to point at.

The only things the user supplies are the ones that are genuinely theirs:

- **A TMDb API key** — accepted, and already stored in app settings rather than
  the environment.
- **Private tracker credentials**, if they use private trackers. This is an
  account, not a package: no amount of bundling can invent someone's login.
  Public indexers need nothing.

Bundle size is explicitly **not** a constraint.

---

## What exists today

Every external thing the app reaches for, as of writing:

| Dependency | Used for | Where |
| --- | --- | --- |
| **MediaInfo** | Every probe — codecs, HDR format, DV profile, Atmos, encoder settings | `lib/media.ts` |
| **ffmpeg** | Piping the HEVC stream for RPU extraction (`-c copy`, no encoding) | `lib/dovi.ts` |
| **dovi_tool** | RPU extraction, `info -s` summaries | `lib/dovi.ts` |
| **dovi_convert** | The whole P7 → P8.1 conversion | `lib/convert.ts` |
| **Jackett** | Every release search, via its aggregate Torznab feed | `lib/jackett.ts` |
| **qBittorrent** | Handing magnets over, tracking downloads | `lib/qbittorrent.ts` |
| `open -R` | Reveal in Finder (macOS only) | `lib/system.ts` |
| better-sqlite3, sharp | Storage, thumbnails | native Node modules |
| TMDb, Blu-ray.com | Metadata, disc specs | plain HTTP |

Two things worth knowing about that list:

- **`dovi_convert` is a GPL-3 Python script** with a hard-coded Homebrew Python
  shebang. So the app already has a hidden dependency on a specific Python
  install that nothing in the UI mentions.
- **The app already speaks Torznab itself** (`lib/torznab.ts`). Jackett is not
  providing intelligence — it is a fan-out and a parser. This matters a lot
  below.

---

## 1. Bundling the media tools

Straightforward. Ship the binaries, resolve their paths from one place instead
of `PATH`.

- **MediaInfo** — BSD-2-Clause, ~12 MB with libmediainfo. Keep it. The note in
  `lib/media.ts` is right that ffprobe does not report
  `Format_Commercial_IfAny`, so dropping it costs Atmos detection.
- **dovi_tool** — MIT, ~6 MB. No complications.
- **ffmpeg** — the app only demuxes and stream-copies, so an **LGPL build with
  no encoders** is enough: no x264/x265, no GPL obligations, and a build limited
  to hevc/matroska/mp4 lands nearer 10–15 MB than 80.

### Replace `dovi_convert` rather than bundling it

It is GPL-3 and drags in a Python runtime, and what it does is a pipeline whose
halves the app already drives: extract the RPU, convert it to 8.1, inject it,
remux. `lib/convert.ts` explains that driving ffmpeg and dovi_tool directly was
deliberately avoided; that decision is worth revisiting, because it is what
removes Python from the picture entirely.

**Budget real verification time.** This is the only step in the whole app that
rewrites the user's files.

---

## 2. The indexer: Prowlarr, bundled and hidden

Jackett's value is not the protocol — it is roughly 600 Cardigann indexer
definitions, YAML scraping recipes for sites that change their HTML often.

**Decision: bundle Prowlarr rather than Jackett.** Not for size — because it
updates its own indexer definitions, so a tracker redesign never means shipping
a new build of RipGrade. It exposes Torznab, so `lib/torznab.ts` does not change
at all; only the auto-config half in `lib/jackett.ts` does.

Started on a random loopback port with a generated key, config seeded over its
own API, never shown to the user.

Options considered, for the record:

| Approach | Coverage | Maintenance |
| --- | --- | --- |
| Bundle Jackett | full | we own definition rot |
| **Bundle Prowlarr** | full | upstream owns it |
| Direct first-party adapters per indexer | only what we write | we own each adapter |
| Port the Cardigann engine to TypeScript | full | we own the engine |
| Hybrid: adapters by default, optional Prowlarr | ours, or full if attached | proportional |

The last two only made sense when bundle size mattered. It does not, so they are
out.

**Private trackers still need credentials.** The nice version of that is to take
the step into RipGrade's own settings and proxy it to the hidden Prowlarr, so a
tracker is added in our UI and the user never learns a second app is running.

---

## 3. The torrent engine: pick for streaming

Replace qBittorrent with a bundled engine. `lib/qbittorrent.ts` is already the
right shape — login, add magnet, poll, pause, remove — so this is a re-target,
not a rewrite.

**Choose rqbit** (Rust, Apache-2.0, ~15 MB, HTTP API). Not because of size, but
because of what it enables:

| Engine | Sequential | Streaming endpoint |
| --- | --- | --- |
| **rqbit** | yes | **yes** — HTTP with Range, per file |
| WebTorrent | yes | yes, but weak on large swarms and large files |
| qBittorrent | yes (+ first/last piece first) | no — we would read a partial file off disk ourselves |
| transmission-daemon | yes | no |

transmission is the more battle-tested engine and would be the pick if streaming
were off the table. It is not — see below — so rqbit wins on the strength of one
feature we would otherwise have to build.

---

## 4. Streaming from a torrent

Possible, and cheap **if** the engine above is rqbit. The hard part is not the
transport, it is playback.

### Why playback is the problem here

This library is mostly MKV, HEVC, TrueHD/Atmos, some Dolby Vision P7:

- **MKV** — not playable in Chrome or Safari.
- **HEVC** — Safari yes; Chrome only with hardware decode, and only in
  MP4/fMP4.
- **TrueHD / Atmos / DTS-HD** — no browser support. Must be transcoded.
- **Dolby Vision P7 dual-layer** — nothing in a browser touches it.

### Tier A — hand off to a native player (recommended)

The engine serves `http://127.0.0.1:port/…`; the app launches **mpv, IINA or
VLC** against it. Everything plays, no transcoding, no CPU, no quality loss. mpv
takes IPC commands, so play/pause/seek and position can still be driven from and
reflected in our UI.

Effort: small.

### Tier B — play it in the app

ffmpeg remuxing on the fly to fMP4, usually HLS-segmented so seeking works: copy
the video where it is HEVC/H.264, **transcode the audio every time** (Atmos →
EAC3 or an AAC downmix), extract or burn in subtitles, restart the pipeline at a
new offset on every seek, and re-prioritise torrent pieces so those bytes exist.

Effort: significant, and permanently lossy in exactly the dimensions this app
exists to measure. An app whose thesis is *is this the best possible copy* would
be serving a 5.1 downmix of a TrueHD Atmos track.

### Needed either way

- Sequential mode with first/last piece priority.
- **A readiness heuristic.** Enough contiguous bytes from the head, plus a rate
  that beats the bitrate. The library already knows the bitrate, so the app can
  say "this will not stream" before anyone presses play.
- A Range-capable route proxying the engine, so the player sees one origin.
- Cleanup rules: a torrent fetched to watch once is not one fetched to keep.
- Subtitles — free in Tier A, a small project in Tier B.

### Suggested order

Build the boring half first: **play a file already in the library**. That is a
player handoff with no torrent involved — an afternoon — and it puts the
launcher, the IPC and the UI affordance in place. Streaming then becomes
"point the same launcher at rqbit's URL instead of a path".

---

## 5. The shell: Electron, and why not native

The app is a Next.js server with Node-only dependencies (`better-sqlite3`,
`sharp`), so **Electron** is the fit: the main process boots the Next standalone
server on a loopback port, opens a window, and spawns the sidecars.
`shell.showItemInFolder` replaces `open -R` on all three platforms for free.

Tauri's advantage is replacing Node with Rust — but we would bundle Node as a
sidecar anyway and gain an IPC layer for nothing.

### The trap: this UI is Chromium-flavoured

Any plan that swaps Chromium for the **system** WebView (Tauri, or a native
shell hosting WKWebView) has to reckon with what the interface is built on:

- `::details-content` and `interpolate-size: allow-keywords` — the entire panel
  open/close animation.
- `overflow-clip-margin` — the episode rows bleeding past their panel.
- `@property --count` — the counting score.
- View Transitions — the poster morph and the splash handover.

At least the first two are Chrome-only or very recent elsewhere; in WKWebView
the accordions would snap open instead of animating. **Verify against the target
WebView version before believing any of this** — but plan for it. Shipping
Chromium is what makes the UI work as built.

### What going fully native would actually buy

- **Playback** — embed mpv or use AVPlayer: MKV, HEVC, TrueHD, DV, no
  transcoding. Tier B stops being a compromise.
- **Dock progress, notifications, sleep assertions** — a conversion runs for
  tens of minutes on a 60 GB file; it should hold the machine awake and say when
  it is done.
- **Native file panels** — `NSOpenPanel` deletes `app/folder-picker.tsx`.
- **Startup and memory** — ~50 MB and instant, versus a few hundred megabytes
  and a second or two.
- **No Chromium to patch.**

### What it would cost

Not the UI. **`lib/derive.ts` (61 KB), `lib/release-title.ts` (16 KB) and
`lib/bluray.ts` (20 KB)** — the scoring rubric, the release-name parser and the
scraper. That is the actual product, hand-tuned, with no test oracle beyond "the
numbers look right", and porting it is where weeks disappear and silent
regressions enter the one thing users trust. SwiftUI is also macOS-only, so
Windows means doing the UI twice.

### The honest position

**Most of what a native app would buy, Electron already exposes**: dock
progress, native notifications, `NSOpenPanel`, power-save blockers, Finder
integration, tray. The two it cannot match are memory/startup and an embedded
native player — and the player has a middle path: **Electron shell, mpv in its
own window, driven over IPC.**

If a true native app is ever wanted, the sane order is: keep the Node engine,
put a native shell in front of it, and port the UI last. **Never port the
rubric.**

---

## 6. Phasing

Rough, for one person working with focus.

| Phase | Work | Estimate |
| --- | --- | --- |
| 1 | Central tool-path resolution; bundle MediaInfo, ffmpeg, dovi_tool | 2 days |
| 2 | Replace `dovi_convert` with an in-app ffmpeg + dovi_tool pipeline | 3–5 days |
| 3 | Electron shell, Next standalone, native module rebuilds | 3–5 days |
| 4 | Bundle rqbit; re-point the download adapter | 3–5 days |
| 5 | Bundle Prowlarr; auto-config; tracker credentials in our own settings | 1–2 weeks |
| 6 | Signing, notarisation, auto-update | 3–5 days, then ongoing |
| 7 | Player handoff, then streaming | 2–4 days |

**≈ 4–6 weeks**, plus costs that do not exist today: an Apple Developer account
and notarisation, a Windows signing certificate or a SmartScreen warning on
every release, and three platform builds to keep green.

Start with phase 2. It is the only one that touches the user's files, and it
removes a dependency that is already there and already undeclared.

---

## 7. Where the difficulty really lives

Not in any of the above individually — in **lifecycle**. Sidecars that start,
stop with the app, survive a crash, pick free ports, and leave no orphans. A
first run that seeds config once and is idempotent afterwards. An update path
for the bundled binaries, since their security patches become our
responsibility. That is where this project would actually spend its time.

Also worth stating plainly: a signed app that bundles an indexer aggregator and
a torrent client is fine for direct distribution and notarisation, and is not
App Store material.

---

## 8. Small things worth doing now

Neither of these waits on any decision above.

- **Record which indexer a release came from.** `IndexerResult.indexer` arrives
  on every result and is dropped at download time; the `downloads` table has no
  column for it. It is one column, and it turns "which indexers matter to us"
  from a guess into a fact.
- **The docs shrink when this lands.** `app/how-it-works/page.tsx` and the
  Settings screens currently explain how to install and configure these tools.
  Most of that text disappears when the answer becomes "it is already running".
