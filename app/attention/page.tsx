import { classifyEnhancementLayer, openIssues } from "@/lib/derive";
import { duplicateGroups, getLibrary, groupKeyOf } from "@/lib/library";
import { AttentionView, type AttentionData } from "./attention-view";

export const metadata = { title: "Needs attention — RipGrade" };

export const dynamic = "force-dynamic";

export default async function AttentionPage() {
  const movies = getLibrary();

  const data: AttentionData = {
    issues: movies
      .map((m) => ({
        path: m.path,
        title: m.title,
        year: m.year,
        poster: m.poster,
        status: m.status,
        issues: openIssues(m),
      }))
      .filter((m) => m.issues.length > 0)
      // Worst first: a critical issue is a different order of problem from a
      // warning, and a film carrying several needs looking at before one.
      .sort(
        (a, b) =>
          b.issues.filter((i) => i.severity === "critical").length -
            a.issues.filter((i) => i.severity === "critical").length ||
          b.issues.length - a.issues.length,
      ),

    // A lens on the issues above rather than a separate pile: the same films
    // are in "Open issues", but converting a library is its own sitting, and
    // what decides each one is the enhancement layer rather than the message.
    profile7: movies
      .filter((m) =>
        openIssues(m).some((i) => i.code === "dv-profile-7"),
      )
      .map((m) => {
        const el = classifyEnhancementLayer(m.dovi, m.hdr10);
        return {
          path: m.path,
          title: m.title,
          year: m.year,
          poster: m.poster,
          kind: el?.kind,
          provisional: el?.provisional ?? false,
          read: m.dovi?.depth,
        };
      })
      // Convertible first: those are the ones with something to do.
      .sort(
        (a, b) =>
          Number(b.kind === "mel") - Number(a.kind === "mel") ||
          Number(a.kind === "complex-fel") - Number(b.kind === "complex-fel"),
      ),

    duplicates: duplicateGroups(movies).map((group) => ({
      key: groupKeyOf(group[0]),
      title: group[0].title,
      year: group[0].year,
      copies: group.map((m) => ({
        path: m.path,
        resolution: m.resolution,
        releaseType: m.releaseType,
        score: m.scores.overall,
        sizeBytes: m.sizeBytes,
      })),
    })),

    artwork: movies
      .filter((m) => !m.poster || !m.fanart || !m.logo)
      .map((m) => ({
        path: m.path,
        title: m.title,
        year: m.year,
        poster: m.poster,
        tmdbId: m.tmdb?.id,
        // Kept as the kinds themselves rather than as words, so the buttons
        // below can open the picker on the one that is missing.
        missing: [
          !m.poster && ("poster" as const),
          !m.fanart && ("fanart" as const),
          !m.logo && ("logo" as const),
        ].filter(Boolean) as ("poster" | "fanart" | "logo")[],
      })),

    matches: movies
      .filter((m) => m.tmdb && m.tmdb.confidence !== "high")
      .map((m) => ({
        path: m.path,
        title: m.title,
        year: m.year,
        poster: m.poster,
        fileName: m.fileName,
        confidence: m.tmdb!.confidence,
      })),
  };

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8 sm:px-8">
      <AttentionView data={data} />
    </main>
  );
}
