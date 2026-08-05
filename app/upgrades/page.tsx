import { hasJackett } from "@/lib/jackett";
import {
  checkedCount,
  getUpgradeQueue,
  sweepCandidates,
} from "@/lib/upgrade-sweep";
import { UpgradesView } from "./upgrades-view";

export const metadata = { title: "Upgrades — RipGrade" };

// Reads the database on every request, like the library itself.
export const dynamic = "force-dynamic";

export default async function UpgradesPage() {
  return (
    // min-h-dvh rather than flex-1: the layout's own column has no definite
    // height for a flex child to fill, so the viewport is claimed directly —
    // which is what lets an empty state centre itself in it.
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 px-6 py-8 sm:px-8">
      <UpgradesView
        queue={getUpgradeQueue()}
        candidates={sweepCandidates().length}
        checked={checkedCount()}
        jackettReady={hasJackett()}
      />
    </main>
  );
}
