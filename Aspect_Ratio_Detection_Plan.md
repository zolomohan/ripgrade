# Aspect Ratio & IMAX Detection — Plan

**Status:** not started. Investigation complete, findings verified against the real library on 2026-08-02.

---

## The problem

RipGrade cannot currently tell a scope film from one containing IMAX sequences,
and cannot verify a filename that claims `IMAX`.

**Metadata cannot answer this.** Every 4K film in the library reports the same
geometry regardless of its actual picture shape:

| Film | Encoded size | Container DAR |
| --- | --- | --- |
| Dunkirk | 3840×2160 | 1.778 |
| Tenet | 3840×2160 | 1.778 |
| Oppenheimer | 3840×2160 | 1.778 |
| The Dark Knight | 3840×2160 | 1.778 |
| Interstellar | 3840×2160 | 1.778 |

The letterbox bars are baked into the pixels, so MediaInfo, ffprobe and TMDb are
all blind to the real ratio. Answering this requires decoding frames.

---

## Verified findings

Method: `ffmpeg -ss <t> -i <file> -frames:v 8 -vf cropdetect=limit=64:round=2:reset=0 -an -sn -f null -`

| Film | Samples | Result |
| --- | --- | --- |
| Dune (2021) | t=3000s | `crop=3840:1604:0:278` → constant **2.39:1** scope |
| Blade Runner 2049 | t=1200s, 4800s | `crop=3840:1600:0:280` → constant **2.40:1** scope |
| **The Dark Knight** | 9 samples, t=300…7800s | **1.78:1 at t=300s**, `3840:1600–1602` (2.40:1) at all eight later samples |

The Dark Knight result is the proof of concept: the opening bank heist is one of
the IMAX-photographed sequences, and it measures full-frame while the rest of the
film measures 2.40. **Variable aspect ratio across the runtime is the signature
of IMAX sequences**, and it is reliably measurable.

### The critical gotcha — do not lose this

`cropdetect`'s default is `limit=24`. **On 10-bit HDR content this always
reports full frame**, because limited-range black is code **64**, not 0. The bars
never fall below the threshold, so nothing is detected.

The first investigation pass reported *every* film — including known scope
titles — as 1.78 full-frame. Setting `limit=64` fixed it immediately: Dune went
from "no bars detected" to `3840:1604:0:278`.

A naive implementation using the default threshold will silently classify the
entire HDR library as open-matte and appear to work correctly.

---

## Design

### Schema

New table, so it applies with no migration and no rescan:

```sql
CREATE TABLE IF NOT EXISTS aspect (
  path         TEXT PRIMARY KEY,
  analysed_at  INTEGER NOT NULL,
  samples      TEXT NOT NULL,   -- JSON: [{ t, width, height, ratio }]
  ratios       TEXT NOT NULL,   -- JSON: [{ ratio, label, share }] sorted by share
  variable     INTEGER NOT NULL,
  error        TEXT
);
```

Joined into `LibraryItem` at read time, the same way `artwork` and `triage` are —
never baked into the derived payload, so re-deriving cannot discard it.

### Modules

- `lib/aspect.ts` — spawns ffmpeg, parses `crop=W:H:X:Y`, classifies, persists.
- Server actions `analyseAspect(path)` / `aspectStatus(path)`.
- Detail page: an **Analyse aspect ratio** button beside Reveal / Play, results
  rendered as a small timeline of sampled ratios.

### Sampling strategy

- Skip the first and last 5% of runtime (logos, credits).
- 12 samples evenly spaced across the remainder.
- 8 frames per sample; take the last reported `crop=` value per sample, since
  cropdetect converges over successive frames.
- Round detected heights to the nearest 2px before comparing — measured values
  drift between 1600 and 1604 for the same nominal ratio.
- Treat ratios within ±0.03 as the same ratio.

### Classification

| Measured ratio | Label |
| --- | --- |
| ≥ 2.30 | Scope (2.39 / 2.40) |
| 2.00 – 2.30 | Wide (2.20, 70mm) |
| 1.85 – 2.00 | Flat / IMAX Digital (1.90) |
| 1.70 – 1.85 | 16:9 / IMAX full-height |
| ≤ 1.50 | IMAX 70mm (1.43) |

**Variable** when two or more distinct ratios each hold ≥ 5% of samples.

### New issue codes

Add to `ISSUE_CATALOGUE` in `lib/derive.ts`:

- `imax-claimed-not-found` — filename says IMAX but every sample measures the
  same ratio. Three files currently carry `IMAX` in the name (Tenet,
  Oppenheimer, Interstellar) with nothing verifying it.
- `open-matte` — constant ~1.78 on a film shot for scope; may be an open-matte
  fan edit rather than the theatrical framing.

Severity `info` for both — these are framing facts, not defects.

---

## Cost

Each sample is a seek plus a short decode: roughly **2–5 seconds** over USB.
Twelve samples per film is **30–60 seconds**.

Far too slow for the scan pass. This must be **on-demand per film**, cached in
the `aspect` table and computed once. A "re-analyse" action can force a refresh.

---

## Risks and open questions

- **Dark scenes read as bars.** A near-black frame can crop to nothing. Discard
  samples whose detected height is implausibly small (< 40% of frame) and
  re-sample elsewhere.
- **Dolby Vision.** The base layer is what ffmpeg decodes; the RPU does not
  affect geometry, so this should be safe — but worth confirming on a P7 file.
- **Threshold portability.** `limit=64` is right for 10-bit limited range. An
  8-bit SDR file needs the old 24. Pick the limit from `BitDepth` and
  `colour_range` rather than hardcoding.
- **Sample count vs accuracy.** Twelve samples will find long IMAX sequences but
  can miss a single short one. Accept this and label the result as sampled, not
  exhaustive.

---

## Phasing

1. `lib/aspect.ts` + table + one hardcoded film, verify against the Dark Knight
   numbers recorded above.
2. Server action, detail-page button, cached results, sampled-ratio timeline.
3. Classification labels and the two new issue codes.
4. Optional: an `Aspect` facet in the library filters (Scope / Flat / IMAX /
   Variable) once enough films have been analysed to be useful.
