import { getConvertJob } from "@/lib/convert";
import { getDoviJob } from "@/lib/dovi";
import { getScanState } from "@/lib/scanner";
import { ProcessesView } from "./processes-view";

export const metadata = { title: "Processes — RipGrade" };

// Seeded from the server so a job already running is on screen immediately,
// rather than after the first poll.
export const dynamic = "force-dynamic";

export default async function ProcessesPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8 sm:px-8">
      <ProcessesView
        initial={{
          scan: getScanState(),
          dovi: getDoviJob(),
          convert: getConvertJob(),
        }}
      />
    </main>
  );
}
