import {
  getAudioLanguages,
  getSubtitleLanguages,
  getConvertTempDir,
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
import { LibraryFolders } from "./library-folders";
import { SubtitleLanguages } from "./subtitle-languages";
import { EnhancementLayer } from "./el-backup";
import { GlassPanel } from "./glass-panel";
import { ThemeChoice } from "./theme-choice";
import { BackdropChoice } from "./backdrop-choice";
import { ListLayout } from "./list-layout";
import { Jackett } from "./jackett";
import { Qbittorrent } from "./qbittorrent";
import { QueueDiscOnly, QueueThreshold } from "./queue-threshold";
import { TempFolder } from "./temp-folder";
import { Thumbs } from "./thumbs";
import { SettingsTabs } from "./settings-tabs";
import { SettingRow } from "./parts";
import { Tmdb } from "./tmdb";
import { DEFAULT_ROOT } from "@/lib/browse";
import { glassSummary } from "@/lib/glass";

export const metadata = { title: "Settings — RipGrade" };

export const dynamic = "force-dynamic";

/**
 * One setting on the page: its name and a line about it, and its control.
 *
 * A thin wrapper over `SettingRow` so the page reads as a list of settings
 * rather than a list of layout. It was a `Panel` — a drawer with the name on
 * the front and the value beside it — which put every control one press away
 * and made a page of fourteen a page you had to open to read. See `SettingRow`
 * in ./parts.tsx for why that was the wrong container.
 */
function Setting({
  title,
  blurb,
  hint,
  children,
}: {
  title: string;
  /** The line under the name, always on. One sentence. */
  blurb: string;
  /** The argument for it, on the name — see `Explained` in app/controls.tsx. */
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <SettingRow title={title} blurb={blurb} hint={hint}>
      {children}
    </SettingRow>
  );
}

export default async function SettingsPage() {
  const roots = await getLibraryFolders();
  const tempDir = await getConvertTempDir();
  const keepingEl = await getKeepEnhancementLayer();
  const jackett = await getJackettStatus();
  const qb = await getQbStatus();
  const tmdb = await getTmdbStatus();
  const thumbs = await getThumbCache();
  const queue = await getQueueRules();
  const audio = await getAudioLanguages();
  const subtitles = await getSubtitleLanguages();
  const layout = await getListLayout();
  const theme = await getTheme();
  const glass = await getGlassTuning();
  const glassPosters = await getGlassPosters();
  const backdrop = await getBackdrop();



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
    <main className="reading-column mx-auto flex flex-col px-6 py-8 sm:px-8">
      <SettingsTabs
        groups={[
          {
            key: "library",
            label: "Library",
            blurb: "Where the films are, and what the app knows about them.",
            settings: <Library />,
          },
          {
            key: "jobs",
            // Named for the page that runs the work these govern: a
            // conversion's scratch disk, what it keeps of the original, and
            // which audio is worth the space. Every one is answered on the
            // Jobs page, one film at a time.
            label: "Jobs",
            blurb: "What the app does to a file, and what it keeps of it.",
            settings: <Jobs />,
          },
          {
            key: "downloads",
            // The app's own word for what all three are about, and a noun like
            // the two beside it. Not "Queue": that is one of the two lists
            // these feed, and the wishlist is the other.
            label: "Downloads",
            blurb: "Where new films are found, and what fetches them.",
            settings: <Downloads />,
          },
          {
            key: "themes",
            // The only group about the app rather than about the library: a
            // preference rather than a configuration. Nothing in here changes
            // what the app does, only what you see it as.
            label: "Themes",
            blurb: "How the app is drawn. None of it changes what it does.",
            settings: <Themes />,
          },
        ]}
      />
    </main>
  );

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
          blurb="The folders a scan walks. Everything the app knows comes from these."
          hint="Everything the app knows comes from scanning these. Add as many as the library is spread across — one scan walks all of them, and one runs every time the app starts."
        >
          <LibraryFolders roots={roots} defaultPath={DEFAULT_ROOT} />
        </Setting>

        <Setting
          title="TMDb"
          blurb="Supplies every title, poster and backdrop. Without it, films stay filenames."
          hint="TMDb supplies every title, poster, backdrop and collection in the app. Without it a scan still reads your files, but they stay filenames."
        >
          <Tmdb configured={tmdb.configured} />
        </Setting>

        <Setting
          title="Thumbnail cache"
          blurb="Downscaled artwork kept on this machine, so shelves draw without the drive."
          hint="Downscaled copies of your artwork, kept on this machine so shelves load fast and still show with the drive unplugged. It fills itself as you browse; rebuild before taking the drive away, clear to reclaim the space."
        >
          <Thumbs files={thumbs.files} bytes={thumbs.bytes} />
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
          blurb="Where a conversion writes while it works. An SSD here makes the job faster."
          hint="A conversion reads and writes at once, which is slow when both land on the same spinning drive. Point the working file at an SSD and the job runs at the speed of the faster disk; the film still lands beside the original."
        >
          <TempFolder current={tempDir} defaultPath={DEFAULT_ROOT} />
        </Setting>

        <Setting
          title="Going back to Profile 7"
          blurb="Whether the enhancement layer is kept, so a conversion can be undone."
          hint="A conversion discards the enhancement layer, and the way back is the whole original it leaves beside the film — the first thing anyone deletes once the converted file plays. So the layer is packed into a small archive of its own first: a tenth to a quarter of the film, and enough to rebuild the Profile 7 version from the converted one years later. Turning it off saves a pass over the film before every conversion, and makes the conversion final once that original has gone."
        >
          <EnhancementLayer keeping={keepingEl} />
        </Setting>

        <Setting
          title="Audio languages"
          blurb="Which languages are worth the space they take."
          hint="Which languages are worth the space they take. On a remux the audio is routinely half the file, and a disc carries every language it was pressed with — so everything you do not keep is what the Jobs page's Strip Tracks tab offers to remove, one film at a time, original kept beside it."
        >
          <AudioLanguages
            preference={audio.preference}
            available={audio.available}
          />
        </Setting>

        <Setting
          title="Subtitle languages"
          blurb="Which text tracks are worth keeping in the menu."
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
          blurb="Light or dark, or whatever this machine is set to."
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
          blurb="How much of the window a page's artwork is allowed to take."
          hint="Six pages open on a frame of the film, and a band is the cautious way to show one: a strip at the head of the column, starting where the rail stops. Given the whole window it runs behind the rail instead, which is the first time anything in this app has put a picture behind the glass — the page is then read off a pane over it. Fixed keeps the frame still and moves the page across it; scrolling lets it leave with the page."
        >
          <BackdropChoice backdrop={backdrop} />
        </Setting>

        <Setting
          title="Layout"
          blurb="Whether the lists that can be read either way are posters or rows."
          hint="How the lists that can be read either way are drawn — the downloads log, the jobs page, and the releases found for your wishlist. Posters are for recognising a film and rows are for reading the figures on it; a shelf of artwork is the app's own default. This was a button on each of those pages, which made it three answers to one question."
        >
          <ListLayout layout={layout} />
        </Setting>

        <Setting
          title="Glass"
          blurb="How the panes in front of the page refract, blur and catch the light."
          hint="Every surface standing in front of the page rather than in it is a pane of glass — the rail down the side, the bar at the top of a phone. Real glass, not a blur behind a rectangle: the rim bends what passes under it and splits it a little into colour. The seven properties of that material, set once for all of it, shown over a shelf of your own posters. Carry the pane across the shelf to find an edge worth watching, drag its corner to see the same numbers at another size, and double-click it to put it back."
        >
          <GlassPanel
            tuning={glass}
            posters={glassPosters}
            summary={glassSummary(glass)}
          />
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
          blurb="The indexer proxy every search goes through."
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
          blurb="The client a magnet is handed to, with progress on the Downloads page."
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
          blurb="The score at which a film is worth finding a better copy of."
          hint="The sweep stores the best release it can find for every film, however slight. This is how good that has to be before the queue bothers you with it — nothing is thrown away, so lowering it brings the rest back."
        >
          <QueueThreshold threshold={queue.threshold} />
        </Setting>

        <Setting
          title="Only films scored against a disc"
          blurb="Whether a film with nothing to be measured against can reach the queue."
          hint="A film with no disc release found is scored on the rubric alone, so its number answers a different question than the rest of the list. Asked of the disc you have linked today, not of the disc the last sweep happened to know about — link one and the film returns. A release that already scores 100 stays either way: nothing can beat it, so there is nothing a disc would settle."
        >
          <QueueDiscOnly discOnly={queue.discOnly} />
        </Setting>
      </>
    );
  }
}
