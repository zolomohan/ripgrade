import { hasJackett } from "@/lib/jackett";
import { SearchView } from "./search-view";

export const metadata = { title: "Search — RipGrade" };

// Nothing is read from the database here, but the Jackett settings are, and
// they can change while the app is running.
export const dynamic = "force-dynamic";

export default function SearchPage() {
  return (
    <div className="flex flex-col">
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8 sm:px-8">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Search
          </h1>
          <p className="mt-1 text-sm opacity-55">
            Every indexer Jackett knows, asked whatever you like — not only what
            is already in the library.
          </p>
        </div>

        <SearchView configured={hasJackett()} />
      </main>
    </div>
  );
}
