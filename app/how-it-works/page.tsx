import Link from "next/link";

import {
  AUDIO_POINTS,
  BPP,
  ISSUE_CATALOGUE,
  RELEASE_POINTS,
  STATUS_BANDS,
  VIDEO_CEILING_BONUS,
  VIDEO_POINTS,
  WEIGHTS,
} from "@/lib/derive";

export const metadata = { title: "How it works — RipGrade" };

const SEVERITY_STYLE: Record<string, string> = {
  critical: "text-red-600 dark:text-red-400",
  warning: "text-amber-600 dark:text-amber-400",
  info: "opacity-60",
};

function Section({
  title,
  lede,
  children,
}: {
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {lede && <p className="text-sm opacity-70">{lede}</p>}
      {children}
    </section>
  );
}

function Table({
  head,
  rows,
}: {
  head: string[];
  rows: (string | number)[][];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-black/15 dark:border-white/15">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-black/10 text-xs uppercase tracking-wide opacity-60 dark:border-white/10">
          <tr>
            {head.map((h, i) => (
              <th
                key={h}
                className={`px-3 py-2 font-medium ${i > 0 ? "text-right" : ""}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-black/5 last:border-0 dark:border-white/5">
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={`px-3 py-2 ${j > 0 ? "text-right tabular-nums" : ""} ${
                    j === 0 ? "" : "opacity-80"
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function HowItWorks() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 p-8">
      <header className="flex flex-col gap-2">
        <Link href="/" className="text-sm opacity-60 hover:opacity-100">
          ← Back to library
        </Link>
        <h1 className="text-2xl font-semibold">How it works</h1>
        <p className="text-sm opacity-70">
          Every number on this page is read directly from the scoring engine in{" "}
          <code className="font-mono text-xs">lib/derive.ts</code>, so it cannot drift
          out of date. Change a constant there and this page updates with it.
          <br />
          <br />
          This is the general rubric. For a specific film, open it from the
          library — each detail page itemises exactly where its points were
          earned and where they were lost.
        </p>
      </header>

      <Section
        title="The pipeline"
        lede="Five stages. Only the first three touch your drive."
      >
        <ol className="flex flex-col gap-2 text-sm">
          {[
            [
              "Scan",
              "Walks the library folder recursively, keeping known video extensions and skipping hidden files, macOS ._ AppleDouble stubs, samples, trailers and drive bookkeeping folders.",
            ],
            [
              "Probe",
              "Runs MediaInfo on each new file and stores the raw JSON. A file is re-probed only if its size or modification time changed, so repeat scans cost almost nothing.",
            ],
            [
              "Index artwork",
              "Reads each folder once for a poster and fanart image, accepting either .jpg or .jpeg. These are streamed from the drive on demand rather than copied into the app.",
            ],
            [
              "Derive",
              "Turns that stored JSON into a verdict — parsing, classification, scoring and issue detection. Pure functions, no disk access, so the whole library re-derives in milliseconds.",
            ],
            [
              "Present",
              "The derived rows are loaded into the page and filtered in the browser.",
            ],
          ].map(([name, text], i) => (
            <li key={name} className="flex gap-3">
              <span className="shrink-0 font-mono text-xs opacity-40">{i + 1}</span>
              <span>
                <span className="font-medium">{name}</span>
                <span className="opacity-70"> — {text}</span>
              </span>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        title="Bits per pixel per frame"
        lede="The single most useful number for judging an encode, and the one that makes different resolutions comparable."
      >
        <p className="rounded-lg border border-black/15 px-4 py-3 font-mono text-sm dark:border-white/15">
          bpp = video bitrate ÷ (width × height × frame rate)
        </p>
        <p className="text-sm opacity-70">
          Raw bitrate is misleading: 15 Mbps is generous at 1080p and starved at
          2160p. Dividing by the number of pixels encoded per second normalises
          that away, so one scale works everywhere.
        </p>
        <Table
          head={["Band", "Threshold", "Meaning"]}
          rows={[
            ["Excellent", `≥ ${BPP.excellent}`, "Near-transparent"],
            ["Good", `≥ ${BPP.good}`, "Very hard to fault"],
            ["Fair", `≥ ${BPP.fair}`, "Watchable, some loss"],
            ["Poor", `< ${BPP.fair}`, "Banding and motion smear"],
          ]}
        />
        <p className="text-sm opacity-70">
          Remuxes are exempt: they carry the disc bitrate by definition, so bpp
          only discriminates between encodes.
        </p>
      </Section>

      <Section
        title="Video score"
        lede="Points accumulate, then clamp to 100. Resolution sets the floor; HDR and encode quality decide the rest."
      >
        <Table
          head={["Resolution", "Points"]}
          rows={Object.entries(VIDEO_POINTS.resolution).map(([k, v]) => [k, `+${v}`])}
        />
        <Table
          head={["HDR format", "Points"]}
          rows={Object.entries(VIDEO_POINTS.hdr).map(([k, v]) => [k, `+${v}`])}
        />
        <Table
          head={["Bonus", "Points"]}
          rows={[
            ["10-bit depth or higher", `+${VIDEO_POINTS.tenBit}`],
            ["Release is a REMUX", `+${VIDEO_POINTS.remux}`],
            [`Encode at bpp ≥ ${BPP.excellent}`, `+${VIDEO_POINTS.bppExcellent}`],
            [`Encode at bpp ≥ ${BPP.good}`, `+${VIDEO_POINTS.bppGood}`],
            [`Encode at bpp ≥ ${BPP.fair}`, `+${VIDEO_POINTS.bppFair}`],
          ]}
        />
        <p className="text-sm opacity-70">
          Resolution is judged on frame <em>width</em>, not height. A 2.40:1 scope
          transfer is 3840×1600 — reading the height alone would misfile it as
          1080p.
        </p>
      </Section>

      <Section
        title="Audio score"
        lede="Judged on the single best track in the file, not the average. A lossy commentary track alongside a TrueHD Atmos mix does not drag the score down."
      >
        <Table
          head={["Attribute", "Points"]}
          rows={[
            ["Lossless base (TrueHD, DTS-HD MA, PCM, FLAC)", AUDIO_POINTS.lossless],
            ["Lossy base (Dolby Digital, DD+, AAC, DTS)", AUDIO_POINTS.lossy],
            ["Object audio (Atmos or DTS:X)", `+${AUDIO_POINTS.objectAudio}`],
            ["8 channels or more", `+${AUDIO_POINTS.channels8}`],
            ["6 to 7 channels", `+${AUDIO_POINTS.channels6}`],
          ]}
        />
        <p className="text-sm opacity-70">
          &quot;Best&quot; is chosen by ranking lossless above object audio above
          channel count, so a 7.1 TrueHD Atmos track always wins over a 5.1
          Dolby Digital one.
        </p>
      </Section>

      <Section
        title="Release score"
        lede="How much generational loss sits between the disc master and your file."
      >
        <Table
          head={["Release type", "Score"]}
          rows={[
            ["REMUX — untouched disc stream", RELEASE_POINTS.REMUX],
            ["WEB-DL — provider's compressed master", RELEASE_POINTS.WEBDL],
            [`Encode, bpp ≥ ${BPP.excellent}`, RELEASE_POINTS.encodeExcellent],
            [`Encode, bpp ≥ ${BPP.good}`, RELEASE_POINTS.encodeGood],
            [`Encode, bpp ≥ ${BPP.fair}`, RELEASE_POINTS.encodeFair],
            [`Encode, bpp < ${BPP.fair}`, RELEASE_POINTS.encodePoor],
            ["Encode, bitrate unknown", RELEASE_POINTS.encodeNoBpp],
            ["Unrecognised encoder", RELEASE_POINTS.UNKNOWN],
          ]}
        />
        <p className="text-sm opacity-70">
          Release type is decided from the video stream itself, not the filename.
          A stream with no encoder library was copied rather than re-compressed —
          that is what makes it a remux. Filenames are used only to break ties,
          and lose: a file claiming REMUX over an x265 stream is classified as an
          encode.
        </p>
        <p className="text-sm opacity-70">
          One subtlety worth knowing: studios cut UHD discs on professional
          encoders like ATEME, and a remux inherits that string from the master.
          So a professional encoder alone cannot separate a disc remux from a
          streaming pull — the disc tag in the filename is what distinguishes
          them.
        </p>
      </Section>

      <Section
        title="Overall score"
        lede="A weighted blend, with one deliberate constraint."
      >
        <p className="rounded-lg border border-black/15 px-4 py-3 font-mono text-sm dark:border-white/15">
          overall = min(
          <br />
          &nbsp;&nbsp;video × {WEIGHTS.video} + audio × {WEIGHTS.audio} + release ×{" "}
          {WEIGHTS.release},
          <br />
          &nbsp;&nbsp;video + {VIDEO_CEILING_BONUS}
          <br />)
        </p>
        <p className="text-sm opacity-70">
          The cap is the important half. Without it, a 1080p SDR remux carrying
          TrueHD Atmos scores in the high seventies purely on perfect audio and a
          perfect container — outranking a genuinely better 4K HDR encode.
          Flawless sound cannot rescue a weak picture, so the overall score is
          never allowed to exceed the video score by more than{" "}
          {VIDEO_CEILING_BONUS} points.
        </p>
      </Section>

      <Section title="Status bands" lede="Applied to the overall score, highest first.">
        <Table
          head={["Score", "Status", "Upgrade priority"]}
          rows={STATUS_BANDS.map((b, i) => {
            const upper = i === 0 ? 100 : STATUS_BANDS[i - 1].min - 1;
            return [`${b.min}–${upper}`, b.status, b.priority];
          })}
        />
        <p className="text-sm opacity-70">
          Any <span className={SEVERITY_STYLE.critical}>critical</span> issue
          overrides the bands outright and forces{" "}
          <span className="font-medium">Must Upgrade</span> at Critical priority.
          A fake 4K upscale is a problem no matter how good its audio is.
        </p>
      </Section>

      <Section
        title="Issue checks"
        lede="Detected from the file's own metadata. Critical issues force an upgrade verdict; warnings and info do not affect the score directly."
      >
        <div className="flex flex-col gap-3">
          {Object.entries(ISSUE_CATALOGUE).map(([code, meta]) => (
            <div
              key={code}
              className="rounded-lg border border-black/15 px-4 py-3 dark:border-white/15"
            >
              <div className="flex items-baseline justify-between gap-3">
                <code className="font-mono text-sm">{code}</code>
                <span
                  className={`text-xs font-medium uppercase ${SEVERITY_STYLE[meta.severity]}`}
                >
                  {meta.severity}
                </span>
              </div>
              <p className="mt-1 text-sm">
                <span className="opacity-60">Triggers when: </span>
                {meta.trigger}
              </p>
              <p className="mt-1 text-sm opacity-70">{meta.why}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="What this cannot tell you">
        <ul className="list-disc space-y-2 pl-5 text-sm opacity-70">
          <li>
            <span className="font-medium opacity-100">
              Whether a better release exists.
            </span>{" "}
            Scores are absolute, judged against a fixed rubric rather than against
            the best disc ever pressed. A film may sit at the top of this scale
            and still have a superior release available.
          </li>
          <li>
            <span className="font-medium opacity-100">
              Whether the title is correct.
            </span>{" "}
            Identification comes from the filename, the folder name and the
            container title. A misnamed file is audited as whatever it claims to
            be.
          </li>
          <li>
            <span className="font-medium opacity-100">
              How the encode actually looks.
            </span>{" "}
            Everything here is read from metadata. No frames are decoded, so
            grain retention, banding and detail loss are inferred from bitrate
            density rather than measured.
          </li>
          <li>
            <span className="font-medium opacity-100">
              Whether the Dolby Vision layer is valid.
            </span>{" "}
            The profile and fallback flag are read from the header. Verifying the
            RPU metadata itself would mean demuxing the whole video stream.
          </li>
        </ul>
      </Section>
    </main>
  );
}
