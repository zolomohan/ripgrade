import Link from "next/link";

import {
  ASSUMED_BL_PEAK,
  AUDIO_POINTS,
  BPP,
  EL_BRIGHTNESS_MARGIN,
  ISSUE_CATALOGUE,
  RELEASE_POINTS,
  RPU_COVERAGE_TOLERANCE,
  STATUS_BANDS,
  VIDEO_CEILING_BONUS,
  VIDEO_POINTS,
  WEIGHTS,
} from "@/lib/derive";
import { HEAD_FRAMES } from "@/lib/dovi";

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
      <h2 className="font-display text-lg font-semibold">{title}</h2>
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
    <div className="overflow-x-auto rounded-control border border-line">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line text-xs uppercase tracking-wide opacity-60">
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
            <tr key={i} className="border-b border-line last:border-0">
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
        <h1 className="font-display text-2xl font-semibold">How it works</h1>
        <p className="text-sm opacity-70">
          Every number on this page is read directly from the scoring engine in{" "}
          <code className="font-mono text-xs">lib/derive.ts</code>, so it cannot
          drift out of date. Change a constant there and this page updates with
          it.
          <br />
          <br />
          This is the general rubric. For a specific film, open it from the
          library — each detail page itemises exactly where its points were
          earned and where they were lost.
        </p>
      </header>

      <Section
        title="The pipeline"
        lede="Six stages. Only the first four touch your drive."
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
              "Read Dolby Vision",
              `Demuxes the video stream of each Dolby Vision film and parses its RPU, which is the only place the enhancement layer type is recorded. Reads the first ${HEAD_FRAMES} frames, so it costs under a second per film however large the file is.`,
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
              <span className="shrink-0 font-mono text-xs opacity-40">
                {i + 1}
              </span>
              <span>
                <span className="font-medium">{name}</span>
                <span className="opacity-70"> — {text}</span>
              </span>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        title="Identification"
        lede="Films are matched against TMDb to establish what they are — never to judge how good they are."
      >
        <p className="text-sm opacity-70">
          Matching walks from strongest evidence to weakest and stops at the
          first hit: a TMDb id embedded in the container, then an embedded IMDb
          id, then title with an exact year, then title with a year within one,
          and finally title alone.
        </p>
        <p className="text-sm opacity-70">
          Only the first three count as <strong>high confidence</strong>.
          Everything below that is applied as a best guess and marked
          &ldquo;match?&rdquo; in the library, because a wrong match is worse
          than no match — it would manufacture a runtime discrepancy that means
          nothing. For that reason the runtime checks below only run on
          high-confidence matches.
        </p>
        <p className="text-sm opacity-70">
          <strong>TMDb never changes a score.</strong> It supplies the canonical
          title, year, runtime and collection, and it enables the runtime
          checks. Quality remains derived entirely from the file itself — TMDb
          knows nothing about how your copy was encoded, and it has no record of
          what discs exist, so it cannot tell you whether a better release is
          out there.
        </p>
      </Section>

      <Section
        title="Dolby Vision"
        lede="MediaInfo reads the profile out of the container's configuration record and stops there. Everything that decides what can be done with the file is inside the RPU, and the only way to see it is to demux the stream."
      >
        <p className="text-sm opacity-70">
          So every scan does. The video stream of each Dolby Vision film is piped
          through <code className="font-mono text-xs">dovi_tool</code>, which
          parses the first {HEAD_FRAMES} frames — enough to be past the studio
          logos and into the film itself. Nothing the size of the film is ever
          written to disk, and because the read stops at the head of the file it
          takes well under a second whether the film is 5 GB or 90 GB. What comes
          back is authored once and fixed for the whole stream: the profile, the
          enhancement layer type, the content mapping version, the L5 active
          area, and the static L6 fallback metadata.
        </p>
        <p className="text-sm opacity-70">
          The enhancement layer is the reason this stage exists. Profile 7 is a
          disc format that many players refuse, and flattening it to Profile 8.1
          means discarding that layer — so what the layer is <em>doing</em> is
          the whole question. There are three answers, and only the third is a
          reason not to convert.
        </p>
        <div className="flex flex-col gap-3">
          {[
            {
              name: "MEL — minimum enhancement layer",
              doing: "Nothing. The layer carries no picture data at all.",
              cost: "Nothing — the conversion is lossless.",
              verdict: "Convert",
              tone: "text-emerald-600 dark:text-emerald-400",
            },
            {
              name: "Simple FEL — no brightness expansion",
              doing:
                "Refining the picture, within the range the base layer already covers.",
              cost: "That refinement, and nothing structural.",
              verdict: "Convert",
              tone: "text-emerald-600 dark:text-emerald-400",
            },
            {
              name: "Complex FEL — brightness expansion",
              doing:
                "Reconstructing brightness the base layer does not hold. The classic case is a film mastered at 4000 nits whose HDR10 base was trimmed to 1000 — the missing highlights live in the enhancement layer.",
              cost:
                "Those highlights clip, and the tone mapping below them was authored for the two layers combined, so the result is wrong rather than merely poorer.",
              verdict: "Keep Profile 7",
              tone: "text-red-600 dark:text-red-400",
            },
          ].map((el) => (
            <div
              key={el.name}
              className="rounded-control border border-line px-4 py-3"
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium">{el.name}</p>
                <span className={`text-xs font-medium uppercase ${el.tone}`}>
                  {el.verdict}
                </span>
              </div>
              <p className="mt-1 text-sm">
                <span className="opacity-60">Doing: </span>
                <span className="opacity-70">{el.doing}</span>
              </p>
              <p className="mt-1 text-sm">
                <span className="opacity-60">Discarding it costs: </span>
                <span className="opacity-70">{el.cost}</span>
              </p>
            </div>
          ))}
        </div>
        <p className="text-sm opacity-70">
          Telling the last two apart is a brightness comparison. The Dolby Vision
          grade&rsquo;s measured peak — MaxCLL across the frames read — is set
          against the peak the base layer declares for itself. Clearing it by
          more than {EL_BRIGHTNESS_MARGIN} nits means the layer is adding
          brightness rather than refining it. Files that declare no MaxCLL are
          judged against {ASSUMED_BL_PEAK} nits, which is what a UHD disc base
          layer is trimmed to far more often than not. These are{" "}
          <a
            href="https://docs.doviconvert.com/"
            className="underline underline-offset-4 hover:opacity-100"
          >
            dovi_convert
          </a>
          &rsquo;s thresholds, so the two tools reach the same verdict on the
          same film.
        </p>
        <p className="text-sm opacity-70">
          A Profile 7 film&rsquo;s page states which it is in words rather than
          leaving you to interpret a three-letter field, and prints the exact{" "}
          <code className="font-mono text-xs">dovi_tool</code> command the
          conversion would take. It never runs it — rewriting a 90 GB file, and
          deciding where it lands, is not a call an audit tool should make for
          you.
        </p>
        <p className="text-sm opacity-70">
          Readings are cached against the file, and thrown away the moment its
          size or modification time changes, so a rescan costs nothing and a
          replaced file is never described by the old file&rsquo;s metadata.
        </p>
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-medium tracking-wide uppercase opacity-50">
            Reading every frame
          </h3>
          <p className="text-sm opacity-70">
            The scan reads a sample, and two things a sample cannot establish are
            offered on demand from each film&rsquo;s page. It takes minutes
            rather than milliseconds, because it reads the entire file.
          </p>
          <ul className="list-disc space-y-2 pl-5 text-sm opacity-70">
            <li>
              <span className="font-medium opacity-100">
                What the film actually peaks at.
              </span>{" "}
              The measured L1 light levels describe only the frames parsed, and
              the opening of a film is logos and titles rather than its brightest
              moment. Sampling Skyfall&rsquo;s first frames reports MaxCLL near
              200 nits; across the whole film it is over 700. Since that peak is
              what separates a simple FEL from a complex one, a sample can only
              settle the question one way: finding expansion proves it is there,
              while not finding it proves only that the opening was clean.
            </li>
            <li>
              <span className="font-medium opacity-100">
                Whether the metadata covers the whole film.
              </span>{" "}
              One RPU is expected per frame. Finding fewer than{" "}
              {(RPU_COVERAGE_TOLERANCE * 100).toFixed(1)}% of the frame count
              means the Dolby Vision layer stops partway, and a converted file
              would lose it partway too — which nothing short of a full read
              would reveal.
            </li>
          </ul>
        </div>
      </Section>

      <Section
        title="Bits per pixel per frame"
        lede="The single most useful number for judging an encode, and the one that makes different resolutions comparable."
      >
        <p className="rounded-control border border-line px-4 py-3 font-mono text-sm">
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
          rows={Object.entries(VIDEO_POINTS.resolution).map(([k, v]) => [
            k,
            `+${v}`,
          ])}
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
            [
              `Encode at bpp ≥ ${BPP.excellent}`,
              `+${VIDEO_POINTS.bppExcellent}`,
            ],
            [`Encode at bpp ≥ ${BPP.good}`, `+${VIDEO_POINTS.bppGood}`],
            [`Encode at bpp ≥ ${BPP.fair}`, `+${VIDEO_POINTS.bppFair}`],
          ]}
        />
        <p className="text-sm opacity-70">
          Resolution is judged on frame <em>width</em>, not height. A 2.40:1
          scope transfer is 3840×1600 — reading the height alone would misfile
          it as 1080p.
        </p>
      </Section>

      <Section
        title="Audio score"
        lede="Judged on the single best track in the file, not the average. A lossy commentary track alongside a TrueHD Atmos mix does not drag the score down."
      >
        <Table
          head={["Attribute", "Points"]}
          rows={[
            [
              "Lossless base (TrueHD, DTS-HD MA, PCM, FLAC)",
              AUDIO_POINTS.lossless,
            ],
            ["Lossy base (Dolby Digital, DD+, AAC, DTS)", AUDIO_POINTS.lossy],
            ["Object audio (Atmos or DTS:X)", `+${AUDIO_POINTS.objectAudio}`],
            ["8 channels or more", `+${AUDIO_POINTS.channels8}`],
            ["6 to 7 channels", `+${AUDIO_POINTS.channels6}`],
          ]}
        />
        <p className="text-sm opacity-70">
          &quot;Best&quot; is chosen by ranking lossless above object audio
          above channel count, so a 7.1 TrueHD Atmos track always wins over a
          5.1 Dolby Digital one.
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
          Release type is decided from the video stream itself, not the
          filename. A stream with no encoder library was copied rather than
          re-compressed — that is what makes it a remux. Filenames are used only
          to break ties, and lose: a file claiming REMUX over an x265 stream is
          classified as an encode.
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
        <p className="rounded-control border border-line px-4 py-3 font-mono text-sm">
          overall = min(
          <br />
          &nbsp;&nbsp;video × {WEIGHTS.video} + audio × {WEIGHTS.audio} +
          release × {WEIGHTS.release},
          <br />
          &nbsp;&nbsp;video + {VIDEO_CEILING_BONUS}
          <br />)
        </p>
        <p className="text-sm opacity-70">
          The cap is the important half. Without it, a 1080p SDR remux carrying
          TrueHD Atmos scores in the high seventies purely on perfect audio and
          a perfect container — outranking a genuinely better 4K HDR encode.
          Flawless sound cannot rescue a weak picture, so the overall score is
          never allowed to exceed the video score by more than{" "}
          {VIDEO_CEILING_BONUS} points.
        </p>
      </Section>

      <Section
        title="Status bands"
        lede="Applied to the overall score, highest first."
      >
        <Table
          head={["Score", "Status"]}
          rows={STATUS_BANDS.map((b, i) => {
            const upper = i === 0 ? 100 : STATUS_BANDS[i - 1].min - 1;
            return [`${b.min}–${upper}`, b.status];
          })}
        />
        <p className="text-sm opacity-70">
          Any <span className={SEVERITY_STYLE.critical}>critical</span> issue
          overrides the bands outright and forces{" "}
          <span className="font-medium">Must Upgrade</span>. A fake 4K upscale
          is a problem no matter how good its audio is.
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
              className="rounded-control border border-line px-4 py-3"
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
            Scores are absolute, judged against a fixed rubric rather than
            against the best disc ever pressed. A film may sit at the top of
            this scale and still have a superior release available.
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
              Whether the Dolby Vision grade is any good.
            </span>{" "}
            The RPU is parsed, so what the metadata declares is known precisely.
            Whether it was authored well — whether those trims suit the picture
            they sit on — would mean decoding and looking at frames, which
            nothing here does.
          </li>
        </ul>
      </Section>
    </main>
  );
}
