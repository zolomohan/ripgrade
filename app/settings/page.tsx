import {
  getConvertTempDir,
  getJackettStatus,
  getLibraryFolders,
  unidentifiedArtwork,
} from "../actions";
import { IdentifyArtwork } from "./identify-artwork";
import { FolderSection } from "../folder-section";
import { Jackett } from "./jackett";
import { TempFolder } from "./temp-folder";
import { DEFAULT_ROOT } from "@/lib/browse";
import { getLibrary } from "@/lib/library";
import { hasCredentials } from "@/lib/tmdb";

export const metadata = { title: "Settings — RipGrade" };

export const dynamic = "force-dynamic";

function Row({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="grid grid-cols-[10rem_1fr] items-baseline gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="text-sm opacity-55">{label}</dt>
      <dd className="min-w-0 text-sm">
        {value}
        {detail && <span className="ml-2 opacity-45">{detail}</span>}
      </dd>
    </div>
  );
}

export default async function SettingsPage() {
  const roots = await getLibraryFolders();
  const tempDir = await getConvertTempDir();
  const jackett = await getJackettStatus();
  const movies = getLibrary();
  const unidentified = await unidentifiedArtwork();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-8 sm:px-8">
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-semibold tracking-tight">
          Library folders
        </h2>
        <p className="text-sm opacity-60">
          Everything the app knows comes from scanning these. Add as many as the
          library is spread across; a scan walks all of them and the films land
          in one library.
        </p>
        <FolderSection roots={roots} defaultPath={DEFAULT_ROOT} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-semibold tracking-tight">
          Conversion scratch space
        </h2>
        <p className="text-sm opacity-60">
          A Profile 7 conversion reads the film and writes the converted video
          at the same time. On one spinning drive those compete for the same
          head; pointing the working file at an SSD splits them and the job runs
          at the speed of the faster disk. The converted film still lands beside
          the original.
        </p>
        <TempFolder current={tempDir} defaultPath={DEFAULT_ROOT} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-semibold tracking-tight">
          Release search
        </h2>
        <p className="text-sm opacity-60">
          Jackett holds your indexer logins and exposes them as one feed, so the
          app talks to it and never to a tracker. With it connected, a film can
          be searched for a better release than the one on the drive — every
          result scored on the same rubric as the library, from its name alone.
          Nothing is ever downloaded here: results are names, sizes and links.
        </p>
        <Jackett
          configured={jackett.configured}
          url={jackett.url}
          managed={jackett.managed}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-semibold tracking-tight">
          Artwork sources
        </h2>
        <p className="text-sm opacity-60">
          Posters, backdrops and logos are read from the drive, which means they
          vanish with it. Anything downloaded here records where it came from
          and is refetched from TMDb when the file cannot be read; this works
          the same out for artwork that was already on the drive, by matching
          each file against the images TMDb holds for that title. It only needs
          running once.
        </p>
        <IdentifyArtwork pending={unidentified} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-semibold tracking-tight">
          What is set up
        </h2>
        {/* Read-only: these are environment and disk facts, not preferences,
            and saying so is more useful than offering a field that cannot
            change them. */}
        <dl className="divide-y divide-line rounded-card border border-line bg-surface px-4 py-3">
          <Row
            label="Scanning"
            value={
              roots.length === 0
                ? "No folder selected"
                : roots.length === 1
                  ? roots[0]
                  : `${roots.length} folders`
            }
            detail={
              roots.length === 0 ? "pick one above to get started" : undefined
            }
          />
          <Row label="Films scanned" value={`${movies.length}`} />
          <Row
            label="Convert scratch"
            value={tempDir ?? "Beside the film"}
            detail={
              tempDir ? undefined : "set one above if the library is on a HDD"
            }
          />
          <Row
            label="Release search"
            value={jackett.configured ? "Jackett connected" : "Not connected"}
            detail={
              jackett.configured
                ? "search a film for a better release"
                : "connect it above to search indexers"
            }
          />
          <Row
            label="TMDb"
            value={hasCredentials() ? "Connected" : "No API key"}
            detail={
              hasCredentials()
                ? "titles, artwork and collections"
                : "set TMDB_READ_TOKEN and restart"
            }
          />
        </dl>
      </section>
    </main>
  );
}
