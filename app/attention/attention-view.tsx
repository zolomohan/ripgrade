"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { beginConvert, resolveIssue } from "@/app/actions";
import { ArtworkEditor } from "@/app/movie/[id]/artwork-editor";
import { groupIssues, type Issue, type Status } from "@/lib/derive";
import { artUrl, compareId, movieId } from "@/lib/routes";

/**
 * Everything outstanding, in one place, resolvable where it is listed.
 *
 * The library's version of this was a set of counters that put you into a
 * filtered list — fine for finding the work, useless for doing it. Here each
 * issue is its own row with its own button, because a film that raises four
 * problems is rarely four problems you feel the same way about: the fake-4K
 * flag matters, the missing English subtitle track probably does not.
 */
export type AttentionData = {
  issues: {
    path: string;
    title: string;
    year?: number;
    poster?: string;
    status: Status;
    issues: Issue[];
  }[];
  profile7: {
    path: string;
    title: string;
    year?: number;
    poster?: string;
    kind?: "mel" | "simple-fel" | "complex-fel" | "unknown";
    provisional: boolean;
    read?: "head" | "full";
  }[];
  duplicates: {
    key: string;
    title: string;
    year?: number;
    copies: {
      path: string;
      resolution: string;
      releaseType: string;
      score: number;
      sizeBytes: number;
    }[];
  }[];
  artwork: {
    path: string;
    title: string;
    year?: number;
    poster?: string;
    tmdbId?: number;
    missing: ("poster" | "fanart" | "logo")[];
  }[];
  matches: {
    path: string;
    title: string;
    year?: number;
    poster?: string;
    fileName: string;
    confidence: string;
  }[];
};

const KIND_WORDS = {
  poster: "poster",
  fanart: "backdrop",
  logo: "logo",
} as const;

const SEVERITY: Record<string, string> = {
  critical: "text-red-600 dark:text-red-400",
  warning: "text-amber-600 dark:text-amber-400",
  info: "opacity-60",
};

const size = (bytes: number) =>
  bytes >= 1e12
    ? `${(bytes / 1e12).toFixed(2)} TB`
    : `${(bytes / 1e9).toFixed(1)} GB`;

function Poster({ src }: { src?: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={artUrl(src)}
      alt=""
      loading="lazy"
      className="h-[72px] w-12 shrink-0 rounded-chip object-cover ring-1 ring-line"
    />
  ) : (
    <span className="h-[72px] w-12 shrink-0 rounded-chip bg-surface-strong" />
  );
}

function Title({
  path,
  title,
  year,
}: {
  path: string;
  title: string;
  year?: number;
}) {
  return (
    <Link
      href={`/movie/${movieId(path)}`}
      className="font-medium hover:underline hover:underline-offset-4"
    >
      {title}
      {year && <span className="ml-1.5 font-normal opacity-40">{year}</span>}
    </Link>
  );
}

/**
 * One category at a time.
 *
 * Everything outstanding on one page meant a scroll of several thousand pixels
 * with four unrelated kinds of work in it — and the four are not done in the
 * same sitting: clearing issues is a different job from picking artwork. The
 * bar keeps every count visible so nothing hides behind the choice.
 */
function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) {
    return (
      <p className="rounded-card border border-line bg-surface px-4 py-12 text-center text-sm opacity-45">
        Nothing under {title.toLowerCase()}.
      </p>
    );
  }
  return <section className="flex flex-col gap-2">{children}</section>;
}

type Category = "issues" | "profile7" | "duplicates" | "matches" | "artwork";

/** What each enhancement layer means for converting, in a few words. */
const EL_VERDICT: Record<string, { text: string; tone: string }> = {
  mel: {
    text: "MEL — safe to convert",
    tone: "text-emerald-600 dark:text-emerald-400",
  },
  "simple-fel": {
    text: "FEL, no brightness expansion — safe to convert",
    tone: "text-emerald-600 dark:text-emerald-400",
  },
  "complex-fel": {
    text: "Complex FEL — keep Profile 7",
    tone: "text-red-600 dark:text-red-400",
  },
  unknown: { text: "Enhancement layer unknown", tone: "opacity-50" },
};

export function AttentionView({ data }: { data: AttentionData }) {
  const categories: { key: Category; label: string; count: number }[] = [
    { key: "issues", label: "Open issues", count: data.issues.length },
    { key: "profile7", label: "Profile 7", count: data.profile7.length },
    { key: "duplicates", label: "Duplicates", count: data.duplicates.length },
    {
      key: "matches",
      label: "Matches to review",
      count: data.matches.length,
    },
    { key: "artwork", label: "Missing artwork", count: data.artwork.length },
  ];

  // Opens on the first category that has anything in it, so the page lands on
  // work rather than on an empty tab.
  const [tab, setTab] = useState<Category>(
    categories.find((c) => c.count > 0)?.key ?? "issues",
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [started, setStarted] = useState<string[]>([]);
  const [, startTransition] = useTransition();
  const router = useRouter();

  function run(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    startTransition(async () => {
      await action();
      setBusy(null);
      router.refresh();
    });
  }

  /**
   * Starts the conversion and leaves it running: it takes minutes, and this
   * page is a worklist rather than somewhere to stand and watch. Processes has
   * the progress bar.
   */
  function convert(path: string) {
    setBusy(path);
    setFailed((f) => ({ ...f, [path]: "" }));
    startTransition(async () => {
      const result = await beginConvert(path);
      setBusy(null);
      if (result.ok) {
        setStarted((s) => [...s, path]);
        router.refresh();
      } else {
        setFailed((f) => ({ ...f, [path]: result.error }));
      }
    });
  }

  const nothing =
    data.issues.length === 0 &&
    data.duplicates.length === 0 &&
    data.artwork.length === 0 &&
    data.matches.length === 0;

  if (nothing) {
    return (
      <div className="rounded-card border border-line bg-surface px-4 py-12 text-center">
        <p className="text-sm opacity-50">
          Nothing outstanding. Every issue is resolved, every film is matched
          and has artwork, and there are no duplicates.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-1.5">
        {categories.map((category) => (
          <button
            key={category.key}
            type="button"
            onClick={() => setTab(category.key)}
            aria-pressed={tab === category.key}
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
              tab === category.key
                ? "border-transparent bg-foreground text-background"
                : "border-line hover:bg-surface-strong"
            } ${category.count === 0 ? "opacity-45" : ""}`}
          >
            {category.label}
            <span
              className={`text-xs tabular-nums ${
                tab === category.key ? "opacity-70" : "opacity-45"
              }`}
            >
              {category.count}
            </span>
          </button>
        ))}
      </div>

      {tab === "issues" && (
      <Section title="Open issues" count={data.issues.length}>
        <div className="flex flex-col gap-4">
          {data.issues.map((film) => (
            <div
              key={film.path}
              className="flex gap-4 rounded-card border border-line bg-surface p-4"
            >
              <Poster src={film.poster} />

              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <Title path={film.path} title={film.title} year={film.year} />

                {/* One row per code, not per message: a film can raise the
                    same check more than once — three separate bitrate gaps
                    against one disc, say — and resolving is keyed by code, so
                    listing them separately would offer buttons that silently
                    clear each other. */}
                <ul className="divide-y divide-line">
                  {groupIssues(film.issues).map((group) => {
                    const key = `${film.path}:${group.code}`;
                    return (
                      <li
                        key={group.code}
                        className="flex items-start gap-3 py-3.5 first:pt-0 last:pb-0"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <span
                              className={`text-[10px] font-semibold uppercase ${SEVERITY[group.severity]}`}
                            >
                              {group.severity}
                            </span>
                            <code className="font-mono text-[10px] opacity-35">
                              {group.code}
                            </code>
                          </div>
                          {group.messages.map((message) => (
                            <p key={message} className="mt-0.5 text-sm">
                              {message}
                            </p>
                          ))}
                        </div>

                        {/* `self-center` against a row that may run to three
                            lines, so the button sits with the issue rather
                            than pinned to its first line. */}
                        <button
                          type="button"
                          disabled={busy === key}
                          onClick={() =>
                            run(key, () =>
                              resolveIssue(film.path, group.code, true),
                            )
                          }
                          aria-label={`Resolve ${group.code}`}
                          title="Mark as resolved"
                          className="grid h-8 w-8 shrink-0 place-items-center self-center rounded-full border border-line opacity-40 transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/[0.08] hover:text-emerald-700 hover:opacity-100 disabled:opacity-20 dark:hover:text-emerald-300"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-3.5 w-3.5"
                          >
                            <path d="m4 12.5 5 5 11-11" />
                          </svg>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </Section>

      )}

      {tab === "profile7" && (
      <Section title="Profile 7" count={data.profile7.length}>
        <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {data.profile7.map((film) => (
            <div key={film.path} className="flex items-center gap-4 px-4 py-3">
              <Poster src={film.poster} />
              <div className="min-w-0 flex-1">
                <Title path={film.path} title={film.title} year={film.year} />
                <p
                  className={`mt-0.5 text-xs ${EL_VERDICT[film.kind ?? "unknown"].tone}`}
                >
                  {film.kind
                    ? EL_VERDICT[film.kind].text
                    : "Stream not read yet"}
                </p>
                {film.provisional && (
                  <p className="mt-0.5 text-xs opacity-45">
                    Judged on a sample — needs a full pass before converting.
                  </p>
                )}
                {failed[film.path] && (
                  <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">
                    {failed[film.path]}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-[11px] opacity-35">
                  {film.read === "full"
                    ? "read in full"
                    : film.read === "head"
                      ? "sampled"
                      : "unread"}
                </span>

                {/* Only where the verdict allows it. A complex FEL and a
                    provisional one both have a reason not to, and the row
                    above says which. */}
                {(film.kind === "mel" ||
                  (film.kind === "simple-fel" && !film.provisional)) &&
                  (started.includes(film.path) ? (
                    <span className="text-xs text-emerald-600 dark:text-emerald-400">
                      Started
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => convert(film.path)}
                      disabled={busy === film.path}
                      className="rounded-control border border-line px-2.5 py-1 text-xs transition-colors hover:bg-surface-strong disabled:opacity-40"
                    >
                      {busy === film.path ? "Starting…" : "Convert"}
                    </button>
                  ))}

                <button
                  type="button"
                  onClick={() =>
                    run(`${film.path}:p7`, () =>
                      resolveIssue(film.path, "dv-profile-7", true),
                    )
                  }
                  disabled={busy === `${film.path}:p7`}
                  aria-label={`Resolve Profile 7 on ${film.title}`}
                  title="Mark as resolved"
                  className="grid h-8 w-8 place-items-center rounded-full border border-line opacity-40 transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/[0.08] hover:text-emerald-700 hover:opacity-100 disabled:opacity-20 dark:hover:text-emerald-300"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-3.5 w-3.5"
                  >
                    <path d="m4 12.5 5 5 11-11" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      </Section>
      )}

      {tab === "duplicates" && (
      <Section title="Duplicates" count={data.duplicates.length}>
        <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {data.duplicates.map((group) => (
            <div key={group.key} className="flex items-center gap-4 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {group.title}
                  {group.year && (
                    <span className="ml-1.5 font-normal opacity-40">
                      {group.year}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-xs opacity-50">
                  {group.copies
                    .map(
                      (c) =>
                        `${c.resolution} ${c.releaseType} · ${c.score}/100 · ${size(c.sizeBytes)}`,
                    )
                    .join("   vs   ")}
                </p>
              </div>
              <Link
                href={`/compare/${compareId(group.key)}`}
                className="shrink-0 rounded-control border border-line px-3 py-1.5 text-sm hover:bg-surface-strong"
              >
                Compare
              </Link>
            </div>
          ))}
        </div>
      </Section>

      )}

      {tab === "matches" && (
      <Section title="Matches to review" count={data.matches.length}>
        <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {data.matches.map((film) => (
            <div key={film.path} className="flex items-center gap-4 px-4 py-3">
              <Poster src={film.poster} />
              <div className="min-w-0 flex-1">
                <Title path={film.path} title={film.title} year={film.year} />
                <p className="mt-0.5 truncate font-mono text-xs opacity-40">
                  {film.fileName}
                </p>
              </div>
              <span className="shrink-0 rounded-chip bg-amber-500/[0.08] px-1.5 text-[11px] leading-[18px] font-medium text-amber-700 ring-1 ring-amber-500/30 ring-inset dark:text-amber-300">
                {film.confidence} confidence
              </span>
            </div>
          ))}
        </div>
      </Section>

      )}

      {tab === "artwork" && (
      <Section title="Missing artwork" count={data.artwork.length}>
        <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {data.artwork.map((film) => (
            <div key={film.path} className="flex items-center gap-4 px-4 py-3">
              <Poster src={film.poster} />
              <div className="min-w-0 flex-1">
                <Title path={film.path} title={film.title} year={film.year} />
                <p className="mt-0.5 text-xs opacity-50">
                  No {film.missing.map((k) => KIND_WORDS[k]).join(" or ")}
                </p>
              </div>

              {/* One button per missing kind, each opening the picker straight
                  onto it. The row already says which is absent, so making you
                  pick again from a menu would be asking twice. */}
              {film.tmdbId !== undefined && (
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  {film.missing.map((kind) => (
                    <ArtworkEditor
                      key={kind}
                      moviePath={film.path}
                      tmdbId={film.tmdbId!}
                      openAs={kind}
                      label={`Add ${KIND_WORDS[kind]}`}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>
      )}
    </div>
  );
}
