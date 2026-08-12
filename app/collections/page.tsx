import { getCollectionSets } from "@/lib/collections";
import { getCustomSets } from "@/lib/custom-collections";
import { getMovies } from "@/lib/library";
import { CollectionsView } from "./collections-view";

export const metadata = { title: "Collections — RipGrade" };

export const dynamic = "force-dynamic";

export default async function CollectionsPage() {
  // Read once and handed to both: a set of your own is joined to the library by
  // the same films the TMDb sets are grouped from.
  const movies = getMovies();

  // Held films only for the TMDb half, which costs nothing but a read of the
  // library. What a set is missing is TMDb's answer, and it is asked for on the
  // set's own page — where you have said which set you actually care about.
  //
  // The sets you made need no such thrift: their missing half is rows you wrote
  // rather than a request to anybody.
  const sets = await getCollectionSets(movies, false);

  return (
    // `min-h-dvh` for the empty states' sake, the way the dashboard's main
    // does it: `EmptyState` centres itself in whatever height is spare, and a
    // main sized to its contents has none — so "no collections yet" sat tucked
    // under the tabs rather than in the middle of the page it is speaking for.
    <main className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-6 px-6 py-8 sm:px-8">
      <CollectionsView sets={sets} custom={getCustomSets(movies)} />
    </main>
  );
}
