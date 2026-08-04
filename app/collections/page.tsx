import { getCollectionSets } from "@/lib/collections";
import { getMovies } from "@/lib/library";
import { CollectionsView } from "./collections-view";

export const metadata = { title: "Collections — RipGrade" };

export const dynamic = "force-dynamic";

export default async function CollectionsPage() {
  // Held films only, which costs nothing but a read of the library. What a set
  // is missing is TMDb's answer, and it is asked for on the set's own page —
  // where you have said which set you actually care about.
  const sets = await getCollectionSets(getMovies(), false);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8 sm:px-8">
      <CollectionsView sets={sets} />
    </main>
  );
}
