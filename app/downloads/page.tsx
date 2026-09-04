import { getDownloadLog } from "@/lib/qbittorrent";
import { readLayout } from "@/lib/layout";
import { DownloadsView } from "./downloads-view";

export const metadata = { title: "Downloads — RipGrade" };

// Reads the database and qBittorrent on every request, like the library itself.
export const dynamic = "force-dynamic";

export default async function DownloadsPage() {
  /*
   * The whole log, whichever list sent it — this app's own record of every
   * magnet ever handed over, joined to what qBittorrent says about each one
   * now. Read on the server for the first paint only; the view polls itself
   * from there, quickly while anything is moving and slowly while anything is
   * merely in the client.
   */
  const transfers = await getDownloadLog();

  // Posters or rows, answered once under Settings → Themes rather than by a
  // control on this page — see `readLayout`.
  const layout = readLayout();

  return (
    // `flex-1`: the layout's column is the window's height, and this fills it —
    // which is what lets an empty state centre itself in the page.
    <main className="mx-auto flex page-column flex-1 flex-col gap-8 px-6 py-8 sm:px-8">
      <DownloadsView initial={transfers} layout={layout} />
    </main>
  );
}
