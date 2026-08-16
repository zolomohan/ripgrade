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
    // `flex-1` for the empty states' sake, the way the dashboard's main does
    // it: `EmptyState` fills the height it is handed and centres in it, and a
    // main sized to its contents hands it none — so "no collections yet" sat
    // tucked under the tabs rather than in the middle of the page it speaks for.
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-6 py-8 sm:px-8">
      <CollectionsView sets={sets} custom={getCustomSets(movies)} />
    </main>
  );
}
