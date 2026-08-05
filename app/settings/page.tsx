import {
  getConvertTempDir,
  getJackettStatus,
  getLibraryFolders,
  getThumbCache,
  getTmdbStatus,
} from "../actions";
import { FolderSection } from "../folder-section";
import { Jackett } from "./jackett";
import { TempFolder } from "./temp-folder";
import { Thumbs } from "./thumbs";
import { Tmdb } from "./tmdb";
import { DEFAULT_ROOT } from "@/lib/browse";

export const metadata = { title: "Settings — RipGrade" };

export const dynamic = "force-dynamic";

/**
 * One setting: what it is, why you would touch it, and the control itself.
 *
 * The prose was as long as the section it introduced, which made a page of four
 * settings read as an essay. What survives is the sentence that changes what
 * you would do; the rest was describing the app to someone already using it.
 */
function Setting({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="font-display text-lg font-semibold tracking-tight">
          {title}
        </h2>
        <p className="mt-0.5 text-sm opacity-55">{hint}</p>
      </div>
      {children}
    </section>
  );
}

export default async function SettingsPage() {
  const roots = await getLibraryFolders();
  const tempDir = await getConvertTempDir();
  const jackett = await getJackettStatus();
  const tmdb = await getTmdbStatus();
  const thumbs = await getThumbCache();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 py-8 sm:px-8">
      <Setting
        title="Library folders"
        hint="Everything the app knows comes from scanning these. Add as many as the library is spread across — one scan walks all of them."
      >
        <FolderSection roots={roots} defaultPath={DEFAULT_ROOT} />
      </Setting>

      <Setting
        title="Conversion scratch space"
        hint="A conversion reads and writes at once, which is slow when both land on the same spinning drive. Point the working file at an SSD and the job runs at the speed of the faster disk; the film still lands beside the original."
      >
        <TempFolder current={tempDir} defaultPath={DEFAULT_ROOT} />
      </Setting>

      <Setting
        title="Titles and artwork"
        hint="TMDb supplies every title, poster, backdrop and collection in the app. Without it a scan still reads your files, but they stay filenames."
      >
        <Tmdb configured={tmdb.configured} />
      </Setting>

      <Setting
        title="Thumbnail cache"
        hint="Downscaled copies of your artwork, kept on this machine so shelves load fast and still show with the drive unplugged. It fills itself as you browse; rebuild before taking the drive away, clear to reclaim the space."
      >
        <Thumbs files={thumbs.files} bytes={thumbs.bytes} />
      </Setting>

      <Setting
        title="Release search"
        hint="Jackett holds your indexer logins and exposes them as one feed, so the app talks to it and never to a tracker. Nothing is downloaded here — results are names, sizes and links."
      >
        <Jackett
          configured={jackett.configured}
          url={jackett.url}
          managed={jackett.managed}
        />
      </Setting>
    </main>
  );
}
