import { getDownloadLog, hasQb } from "@/lib/qbittorrent";
import { DownloadsView } from "./downloads-view";

export const metadata = { title: "Downloads — RipGrade" };

// Reads qBittorrent and the log on every request, like the library itself.
export const dynamic = "force-dynamic";

export default async function DownloadsPage() {
  return (
    // min-h-dvh so an empty state can centre itself; see the upgrades page.
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 px-6 py-8 sm:px-8">
      <DownloadsView initial={await getDownloadLog()} configured={hasQb()} />
    </main>
  );
}
