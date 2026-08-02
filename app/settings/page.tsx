import { getLibraryRoot } from "../actions";
import { FolderSection } from "../folder-section";
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
  const root = await getLibraryRoot();
  const movies = getLibrary();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-8 sm:px-8">
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-semibold tracking-tight">
          Library folder
        </h2>
        <p className="text-sm opacity-60">
          Everything the app knows comes from scanning this folder. Changing it
          does not delete anything already scanned — the next scan simply reads
          somewhere else.
        </p>
        <FolderSection
          initialPath={root ?? DEFAULT_ROOT}
          hasRoot={Boolean(root)}
        />
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
            value={root ?? "No folder selected"}
            detail={root ? undefined : "pick one above to get started"}
          />
          <Row label="Films scanned" value={`${movies.length}`} />
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
