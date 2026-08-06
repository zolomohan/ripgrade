import { SearchView } from "./search-view";

export const metadata = { title: "Search — RipGrade" };

// Nothing is read here at render time — every answer arrives from an action —
// but the actions behind it read the database and the settings, so there is
// nothing worth prerendering either.
export const dynamic = "force-dynamic";

export default function SearchPage() {
  return (
    // The library page's own column and padding: this is a shelf of films like
    // any other, arrived at by typing rather than by scanning a drive.
    // `min-h-dvh` so the empty state has a height to centre itself in.
    <main className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-8 px-6 py-8 sm:px-8">
      <SearchView />
    </main>
  );
}
