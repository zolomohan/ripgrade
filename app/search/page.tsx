import { hasJackett } from "@/lib/jackett";
import { SearchView } from "./search-view";

export const metadata = { title: "Search — RipGrade" };

// Nothing is read from the database here, but the Jackett settings are, and
// they can change while the app is running.
export const dynamic = "force-dynamic";

export default function SearchPage() {
  return (
    <div className="flex flex-col">
      {/* min-h-dvh so the empty state below the field has a height to centre
          itself in; see the upgrades page. */}
      <main className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-6 px-6 py-8 sm:px-8">
        <SearchView configured={hasJackett()} />
      </main>
    </div>
  );
}
