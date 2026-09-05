import {
  getAudioLanguages,
  getSubtitleLanguages,
  getConvertTempDir,
  getDataLocation,
  getKeepEnhancementLayer,
  getBackdrop,
  getGlassPosters,
  getTheme,
  getGlassTuning,
  getListLayout,
  getJackettStatus,
  getLibraryFolders,
  getQbStatus,
  getQueueRules,
  getThumbCache,
  getTmdbStatus,
} from "../actions";
import { AudioLanguages } from "./audio-languages";
import { DataFolder } from "./data-folder";
import { SubtitleLanguages } from "./subtitle-languages";
import { EnhancementLayer } from "./el-backup";
import { GlassTuning } from "./glass-tuning";
import { ThemeChoice } from "./theme-choice";
import { BackdropChoice } from "./backdrop-choice";
import { ListLayout } from "./list-layout";
import { FolderSection } from "../folder-section";
import { ScanButton } from "../scan-button";
import { Jackett } from "./jackett";
import { Qbittorrent } from "./qbittorrent";
import { QueueThreshold } from "./queue-threshold";
import { TempFolder } from "./temp-folder";
import { Thumbs } from "./thumbs";
import { Panel } from "../panel";
import { SectionHeading } from "../section-heading";
import { Row } from "./parts";
import { Tmdb } from "./tmdb";
import { DEFAULT_ROOT } from "@/lib/browse";
import { glassSummary } from "@/lib/glass";
import { size } from "@/app/format";

export const metadata = { title: "Settings — RipGrade" };

export const dynamic = "force-dynamic";

/**
 * One setting: what it is, what it is set to, and the controls themselves.
 *
 * The film page's panel, unchanged — so a setting parts from the next one the
 * way every section in this app parts from the next: a hairline between them,
 * fading at both ends, and no rule under any heading. The two treatments were
 * on screen at once for a while and the difference was the only thing either
 * of them said.
 *
 * Shut, the line beside the name is what the setting is set to, which is the
 * whole of what you need when you are looking for a different one; open, it is
 * the controls and nothing else.
 *
 * It used to open onto a paragraph saying why you would touch it, and every one
 * of the eleven settings here had one. Eleven paragraphs is a page you read
 * past rather than a page you use, and none of them were news after the first
 * time: the argument for a setting is worth making once and worth having to
 * hand forever, which is a tooltip and not a body. It is on the title now —
 * see `Explained` in app/controls.tsx.
 */
function Setting({
  title,
  summary,
  hint,
  children,
}: {
  title: string;
  /** What it is set to now — the line the shut row shows. */
  summary: string;
  /** Why you would touch it, on the title rather than under it — see `Panel`. */
  hint: string;
  children: React.ReactNode;
}) {
  return (
    // A step down from the group heading it sits under — see `as` on Panel.
    <Panel title={title} as="h3" hint={hint} summary={summary}>
      <div className="flex flex-col gap-5">{children}</div>
    </Panel>
  );
}

/** The cache's size, said the way the setting itself says it. */

export default async function SettingsPage() {
  const roots = await getLibraryFolders();
  const tempDir = await getConvertTempDir();
  const keepingEl = await getKeepEnhancementLayer();
  const jackett = await getJackettStatus();
  const qb = await getQbStatus();
  const tmdb = await getTmdbStatus();
  const thumbs = await getThumbCache();
  const dataLocation = await getDataLocation();
  const queue = await getQueueRules();
  const audio = await getAudioLanguages();
  const subtitles = await getSubtitleLanguages();
  const layout = await getListLayout();
  const theme = await getTheme();
  const glass = await getGlassTuning();
  const glassPosters = await getGlassPosters();
  const backdrop = await getBackdrop();

  /** What the shut row says: the languages kept, in the order they were shown. */
  const audioSummary = [
    ...audio.available
      .filter((language) => audio.preference.languages.includes(language.key))
      .map((language) => language.name),
    ...(audio.preference.original ? ["Original"] : []),
  ];

  // The same line for the text tracks, with the two flags that have no audio
  // counterpart appended — they change what is proposed as much as a language
  // does, and a shut row that named only languages would be half the answer.
  const subtitleSummary = [
    ...subtitles.available
      .filter((language) =>
        subtitles.preference.languages.includes(language.key),
      )
      .map((language) => language.name),
    ...(subtitles.preference.original ? ["Original"] : []),
    ...(subtitles.preference.forced ? ["Forced"] : []),
    ...(subtitles.preference.sdh ? ["SDH"] : []),
  ];

  /*
   * In the order you meet them: where the films are, what is done to them, and
   * then how new ones are found and fetched — with how any of it is drawn last,
   * being the only group here about the app rather than about the library.
   *
   * One column, parted by the heading every other long page in this app is
   * parted by. It was three tabs, and then a menu, and both were the same
   * mistake made twice: a control invented for this page to answer a question
   * — "where is the qBittorrent setting" — that scrolling already answers
   * everywhere else. The downloads log has "Downloading" and "History", the
   * jobs page names each queue, the wishlist parts what it found from what it
   * did not; none of them make you choose a section before you can see one.
   * A switcher also hid three quarters of the page from find-in-page, which is
   * how somebody who knows the name of the thing they want actually looks.
   *
   * The panels stay shut. That is the other half of the length problem and the
   * half worth keeping: fourteen names with what each is set to beside them is
   * a page you can read down, and the controls are one press away rather than
   * one press and a guess about which tab they were filed under.
   */
  return (
    <main className="reading-column mx-auto flex flex-col gap-10 px-6 py-8 sm:px-8">
      <Group label="Library">
        <Library />
      </Group>

      {/* Named for the page that runs the work these govern: a conversion's
          scratch disk, what it keeps of the original, and which audio is worth
          the space. Every one is answered on the Jobs page, one film at a
          time. */}
      <Group label="Jobs">
        <Jobs />
      </Group>

      {/* The app's own word for what all three are about, and a noun like the
          two before it — "Fetching" named the act rather than the subject.
          Not "Queue": that is one of the two lists these feed, and the
          wishlist is the other. */}
      <Group label="Downloads">
        <Downloads />
      </Group>

      {/* Last, and the only group about the app rather than about the library.
          A preference rather than a configuration: nothing in here changes
          what the app does, only what you see it as. */}
      <Group label="Themes">
        <Themes />
      </Group>
    </main>
  );

  /**
   * A group of settings under the app's own section heading.
   *
   * `SectionHeading` rather than anything of this page's own — it is what the
   * downloads log, the jobs page and the wishlist part their sections with,
   * and a settings page that drew its own would be the fourth opinion about a
   * thing the app has one opinion about.
   *
   * The gap under the heading is smaller than the gap between groups, so a
   * heading reads as belonging to what follows it rather than floating between
   * two blocks. The panels inside rule themselves apart — see `.ruled`.
   */
  function Group({
    label,
    children,
  }: {
    label: string;
    children: React.ReactNode;
  }) {
    return (
      <section className="flex flex-col gap-1">
        <SectionHeading label={label} />
        <div>{children}</div>
      </section>
    );
  }

  /*
   * The four groups' panels, as functions closed over what the page has
   * already awaited. Written inline rather than as components of their own:
   * they take no arguments and are used once each, and lifting them out would
   * mean threading a dozen values through four prop lists to say nothing new.
   */

  /** What the app knows about, and what it knows about it. */
  function Library() {
    return (
      <>
        <Setting
          title="Library folders"
          summary={
            roots.length
              ? `${roots.length} folder${roots.length === 1 ? "" : "s"}`
              : "None chosen"
          }
          hint="Everything the app knows comes from scanning these. Add as many as the library is spread across — one scan walks all of them, and one runs every time the app starts."
        >
          <FolderSection roots={roots} defaultPath={DEFAULT_ROOT} />

          {/* Only once there is something to walk: a scan of no folders is an
              error message dressed as a button. */}
          {roots.length > 0 && (
            <Row
              title="Scan now"
              hint="For when you have just moved a file and would rather not restart. Progress shows in the rail, wherever you go next."
            >
              <ScanButton />
            </Row>
          )}
        </Setting>

        <Setting
          title="TMDb"
          summary={tmdb.configured ? "Connected" : "Not connected"}
          hint="TMDb supplies every title, poster, backdrop and collection in the app. Without it a scan still reads your files, but they stay filenames."
        >
          <Tmdb configured={tmdb.configured} />
        </Setting>

        <Setting
          title="Thumbnail cache"
          summary={
            thumbs.files
              ? `${thumbs.files.toLocaleString("en-GB")} · ${size(thumbs.bytes)}`
              : "Empty"
          }
          hint="Downscaled copies of your artwork, kept on this machine so shelves load fast and still show with the drive unplugged. It fills itself as you browse; rebuild before taking the drive away, clear to reclaim the space."
        >
          <Thumbs files={thumbs.files} bytes={thumbs.bytes} />
        </Setting>

        <Setting
          title="Data folder"
          summary={dataLocation.path}
          hint="The database, the thumbnail cache and the artwork for sets of your own — everything the app makes for itself, and none of your films. Worth moving out of the project if you run from source: `next dev` watches the project folder and cannot be told not to, so a scan's write-ahead log becomes thousands of change events for the dev server to handle. The store is copied, not moved, and read from its new home after a restart."
        >
          <DataFolder location={dataLocation} />
        </Setting>
      </>
    );
  }

  /** What the app does to those files, and what it leaves behind. */
  function Jobs() {
    return (
      <>
        <Setting
          title="Conversion scratch space"
          summary={tempDir ?? "Beside the film"}
          hint="A conversion reads and writes at once, which is slow when both land on the same spinning drive. Point the working file at an SSD and the job runs at the speed of the faster disk; the film still lands beside the original."
        >
          <TempFolder current={tempDir} defaultPath={DEFAULT_ROOT} />
        </Setting>

        <Setting
          title="Going back to Profile 7"
          summary={keepingEl ? "Enhancement layer kept" : "Nothing kept"}
          hint="A conversion discards the enhancement layer, and the way back is the whole original it leaves beside the film — the first thing anyone deletes once the converted file plays. So the layer is packed into a small archive of its own first: a tenth to a quarter of the film, and enough to rebuild the Profile 7 version from the converted one years later. Turning it off saves a pass over the film before every conversion, and makes the conversion final once that original has gone."
        >
          <EnhancementLayer keeping={keepingEl} />
        </Setting>

        <Setting
          title="Audio languages"
          summary={
            audioSummary.length ? audioSummary.join(" · ") : "Nothing preferred"
          }
          hint="Which languages are worth the space they take. On a remux the audio is routinely half the file, and a disc carries every language it was pressed with — so everything you do not keep is what the Jobs page's Strip Tracks tab offers to remove, one film at a time, original kept beside it."
        >
          <AudioLanguages
            preference={audio.preference}
            available={audio.available}
          />
        </Setting>

        <Setting
          title="Subtitle languages"
          summary={
            subtitleSummary.length
              ? subtitleSummary.join(" · ")
              : "Nothing preferred"
          }
          hint="Which text tracks are worth keeping in the menu. A disc carries a set for every market it was pressed for, and they ride out of the file in the same remux the audio does — so what you do not keep here is offered for removal on the same row, at no extra pass over the film."
        >
          <SubtitleLanguages
            preference={subtitles.preference}
            available={subtitles.available}
          />
        </Setting>
      </>
    );
  }

  /** How the app draws what it holds: the shape its lists take, and what its
   *  chrome is made of. */
  function Themes() {
    return (
      <>
        {/* First, because it is the one setting here that changes every page at
            once — the rest arrange what is drawn, and this decides what colour
            any of it is. */}
        <Setting
          title="Theme"
          summary={
            theme === "system"
              ? "Following the machine"
              : theme === "light"
                ? "Light"
                : "Dark"
          }
          hint="Light or dark, or whatever the machine is set to. The app has had both palettes since the beginning and the machine was the only thing allowed to choose between them — which is the right default and a poor rule, since a laptop following the sun does not know this app is looked at in a dark room, or that a shelf of artwork reads better on white."
        >
          <ThemeChoice theme={theme} />
        </Setting>

        {/* Second, and next to the scheme rather than next to Glass, because
            what it changes is the same kind of thing: how much of the window a
            page is allowed to be, before anything is drawn on it. It does put
            a film behind the rail, and the rail is what the Glass setting is
            about — but that is what the choice produces rather than what it
            asks. */}
        <Setting
          title="Backdrop"
          summary={
            backdrop === "band"
              ? "A band at the top"
              : backdrop === "fixed"
                ? "The whole window, fixed"
                : "The whole window, scrolling"
          }
          hint="Six pages open on a frame of the film, and a band is the cautious way to show one: a strip at the head of the column, starting where the rail stops. Given the whole window it runs behind the rail instead, which is the first time anything in this app has put a picture behind the glass — the page is then read off a pane over it. Fixed keeps the frame still and moves the page across it; scrolling lets it leave with the page."
        >
          <BackdropChoice backdrop={backdrop} />
        </Setting>

        <Setting
          title="Layout"
          summary={layout === "grid" ? "Posters" : "Rows"}
          hint="How the lists that can be read either way are drawn — the downloads log, the jobs page, and the releases found for your wishlist. Posters are for recognising a film and rows are for reading the figures on it; a shelf of artwork is the app's own default. This was a button on each of those pages, which made it three answers to one question."
        >
          <ListLayout layout={layout} />
        </Setting>

        <Setting
          title="Glass"
          summary={glassSummary(glass)}
          hint="Every surface standing in front of the page rather than in it is a pane of glass — the rail down the side, the bar at the top of a phone. Real glass, not a blur behind a rectangle: the rim bends what passes under it and splits it a little into colour. The seven properties of that material, set once for all of it, shown over a shelf of your own posters. Carry the pane across the shelf to find an edge worth watching, drag its corner to see the same numbers at another size, and double-click it to put it back."
        >
          <GlassTuning tuning={glass} posters={glassPosters} />
        </Setting>
      </>
    );
  }

  /** Where more files come from: what finds them, what fetches them, and how
   *  good a find has to be before you hear about it. */
  function Downloads() {
    return (
      <>
        {/* The two services next to each other, which the one column never let
            them be — the queue threshold sat between them because it arrived
            later. They are the two halves of one arrangement: Jackett is asked,
            qBittorrent is handed the answer. */}
        <Setting
          title="Jackett"
          summary={
            jackett.configured ? (jackett.url ?? "Connected") : "Not connected"
          }
          hint="Jackett holds your indexer logins and exposes them as one feed, so the app talks to it and never to a tracker. Nothing is downloaded here — results are names, sizes and links."
        >
          <Jackett
            configured={jackett.configured}
            url={jackett.url}
            env={jackett.env}
            overriding={jackett.overriding}
          />
        </Setting>

        <Setting
          title="qBittorrent"
          summary={qb.configured ? (qb.url ?? "Connected") : "Not connected"}
          hint="Connect qBittorrent and every download button hands the release to it directly, with progress shown on the Downloads page. Without it, magnets open in whatever the system has registered."
        >
          <Qbittorrent
            configured={qb.configured}
            url={qb.url}
            managed={qb.managed}
            stopSeeding={qb.stopSeeding}
          />
        </Setting>

        <Setting
          title="Queue threshold"
          summary={`${
            queue.threshold === 0 ? "Off" : `${queue.threshold} of 100`
          }${queue.discOnly ? " · disc-scored only" : ""}`}
          hint="The sweep stores the best release it can find for every film, however slight. This is how good that has to be before the queue bothers you with it — nothing is thrown away, so lowering it brings the rest back."
        >
          <QueueThreshold
            threshold={queue.threshold}
            discOnly={queue.discOnly}
          />
        </Setting>
      </>
    );
  }
}
