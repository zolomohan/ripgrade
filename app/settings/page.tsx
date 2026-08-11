import {
  getAudioLanguages,
  getConvertTempDir,
  getKeepEnhancementLayer,
  getJackettStatus,
  getLibraryFolders,
  getQbStatus,
  getQueueRules,
  getThumbCache,
  getTmdbStatus,
} from "../actions";
import { AudioLanguages } from "./audio-languages";
import { EnhancementLayer } from "./el-backup";
import { FolderSection } from "../folder-section";
import { ScanButton } from "../scan-button";
import { Jackett } from "./jackett";
import { Qbittorrent } from "./qbittorrent";
import { QueueThreshold } from "./queue-threshold";
import { TempFolder } from "./temp-folder";
import { Thumbs } from "./thumbs";
import { Panel } from "../panel";
import { Row } from "./parts";
import { Tmdb } from "./tmdb";
import { DEFAULT_ROOT } from "@/lib/browse";

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
 * whole of what you need when you are looking for a different one; open, it
 * says why you would touch it and then lets you.
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
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <Panel title={title} summary={summary}>
      <div className="flex flex-col gap-5">
        <p className="max-w-prose text-sm opacity-55">{hint}</p>
        {children}
      </div>
    </Panel>
  );
}

/** The cache's size, said the way the setting itself says it. */
const size = (bytes: number) =>
  bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(1)} GB`
    : bytes >= 1e6
      ? `${(bytes / 1e6).toFixed(1)} MB`
      : `${Math.ceil(bytes / 1e3)} KB`;

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

  /** What the shut row says: the languages kept, in the order they were shown. */
  const audioSummary = [
    ...audio.available
      .filter((language) => audio.preference.languages.includes(language.key))
      .map((language) => language.name),
    ...(audio.preference.original ? ["Original"] : []),
  ];

  /*
   * In the order you meet them: where the films are, what they are called and
   * what they look like, and then how new ones are found and fetched.
   */
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col px-6 py-8 sm:px-8">
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
        title="Jackett"
        summary={
          jackett.configured ? (jackett.url ?? "Connected") : "Not connected"
        }
        hint="Jackett holds your indexer logins and exposes them as one feed, so the app talks to it and never to a tracker. Nothing is downloaded here — results are names, sizes and links."
      >
        <Jackett
          configured={jackett.configured}
          url={jackett.url}
          managed={jackett.managed}
        />
      </Setting>

      <Setting
        title="Audio languages"
        summary={
          audioSummary.length ? audioSummary.join(" · ") : "Nothing preferred"
        }
        hint="Which languages are worth the space they take. On a remux the audio is routinely half the file, and a disc carries every language it was pressed with — so everything you do not keep is what the Jobs page's Audio tracks tab offers to remove, one film at a time, original kept beside it."
      >
        <AudioLanguages
          preference={audio.preference}
          available={audio.available}
        />
      </Setting>

      <Setting
        title="Queue threshold"
        summary={`${
          queue.threshold === 0 ? "Off" : `${queue.threshold} of 100`
        }${queue.discOnly ? " · disc-scored only" : ""}`}
        hint="The sweep stores the best release it can find for every film, however slight. This is how good that has to be before the queue bothers you with it — nothing is thrown away, so lowering it brings the rest back."
      >
        <QueueThreshold threshold={queue.threshold} discOnly={queue.discOnly} />
      </Setting>

      <Setting
        title="qBittorrent"
        summary={qb.configured ? (qb.url ?? "Connected") : "Not connected"}
        hint="Connect qBittorrent and every download button hands the release to it directly, with progress shown on the Upgrades page. Without it, magnets open in whatever the system has registered."
      >
        <Qbittorrent
          configured={qb.configured}
          url={qb.url}
          managed={qb.managed}
          stopSeeding={qb.stopSeeding}
        />
      </Setting>
    </main>
  );
}
