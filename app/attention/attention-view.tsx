"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { acknowledge, resolveIssue } from "@/app/actions";
import type { Issue, Status } from "@/lib/derive";
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
    missing: string[];
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

/** Collapses repeats of the same check into the one thing you can act on. */
function byCode(issues: Issue[]) {
  const groups = new Map<
    string,
    { code: string; severity: string; messages: string[] }
  >();

  for (const issue of issues) {
    const group = groups.get(issue.code) ?? {
      code: issue.code,
      severity: issue.severity,
      messages: [],
    };
    group.messages.push(issue.message);
    groups.set(issue.code, group);
  }

  return [...groups.values()];
}

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

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-[11px] font-medium tracking-widest uppercase opacity-45">
          {title}
        </h2>
        <span className="text-xs opacity-40">{count}</span>
      </div>
      {children}
    </section>
  );
}

export function AttentionView({ data }: { data: AttentionData }) {
  const [busy, setBusy] = useState<string | null>(null);
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
    <div className="flex flex-col gap-8">
      <Section title="Open issues" count={data.issues.length}>
        <div className="flex flex-col gap-3">
          {data.issues.map((film) => (
            <div
              key={film.path}
              className="flex gap-4 rounded-card border border-line bg-surface p-4"
            >
              <Poster src={film.poster} />

              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Title
                    path={film.path}
                    title={film.title}
                    year={film.year}
                  />
                  <button
                    type="button"
                    disabled={busy === film.path}
                    onClick={() =>
                      run(film.path, () => acknowledge(film.path, true))
                    }
                    className="text-xs opacity-45 hover:opacity-100 disabled:opacity-25"
                  >
                    Accept the film as-is
                  </button>
                </div>

                {/* One row per code, not per message: a film can raise the
                    same check more than once — three separate bitrate gaps
                    against one disc, say — and resolving is keyed by code, so
                    listing them separately would offer buttons that silently
                    clear each other. */}
                <ul className="divide-y divide-line">
                  {byCode(film.issues).map((group) => {
                    const key = `${film.path}:${group.code}`;
                    return (
                      <li
                        key={group.code}
                        className="flex items-start gap-3 py-2 first:pt-0 last:pb-0"
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

                        <button
                          type="button"
                          disabled={busy === key}
                          onClick={() =>
                            run(key, () =>
                              resolveIssue(film.path, group.code, true),
                            )
                          }
                          className="shrink-0 rounded-control border border-line px-2.5 py-1 text-xs hover:bg-surface-strong disabled:opacity-40"
                        >
                          Resolve
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

      <Section title="Missing artwork" count={data.artwork.length}>
        <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {data.artwork.map((film) => (
            <div key={film.path} className="flex items-center gap-4 px-4 py-3">
              <Poster src={film.poster} />
              <div className="min-w-0 flex-1">
                <Title path={film.path} title={film.title} year={film.year} />
                <p className="mt-0.5 text-xs opacity-50">
                  No {film.missing.join(" or ")}
                </p>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
