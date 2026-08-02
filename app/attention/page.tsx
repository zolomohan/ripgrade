import { openIssues } from "@/lib/derive";
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
      .filter((m) => !m.poster || !m.fanart)
      .map((m) => ({
        path: m.path,
        title: m.title,
        year: m.year,
        poster: m.poster,
        missing: [!m.poster && "poster", !m.fanart && "backdrop"].filter(
          Boolean,
        ) as string[],
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
