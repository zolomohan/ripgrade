"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";

import { ScanButton } from "./scan-button";
import { useSearchDialog } from "./search/dialog";
import { SidebarProcesses } from "./sidebar-processes";

/**
 * Identity and navigation, in a column that survives navigation.
 *
 * Every page used to carry its own header repeating the app name and links back
 * to the others, which meant three headers to keep in step and a "back to
 * library" link on pages that were never below the library. One rail replaces
 * all of it.
 *
 * A way to search and three groups of pages, ruled apart: what you have, what
 * you are getting, and the two pages about the app itself. Only the search is
 * not a place — it opens over the one you are on. See app/search/dialog.tsx.
 *
 * Every row carries a mark as well as its word. Not to replace the word: a
 * column of nine labels at one size and one weight is a list you read from the
 * top every time, and a shape beside each one is what you actually aim at once
 * you know where things are. The words stay for the once you do not.
 */

/**
 * What you have: the collection as it stands — the films, how they are
 * grouped, what is missing from it, and what it all adds up to.
 *
 * These were one undifferentiated list with everything below, which made
 * "Stats" and "Downloads" look like the same kind of place.
 */
const PAGES = [
  // First, and the page the app opens on: everything below is an arrangement
  // of the library, and this is the one that says what to do about it. A dial,
  // which is what the page is: a reading taken of the whole library.
  {
    href: "/",
    label: "Dashboard",
    icon: "M4.6 18a9 9 0 1 1 14.8 0M12 13.5 16 9",
  },
  // The poster shelf, four tiles of it — the same mark the search wears for
  // the same place.
  {
    href: "/library",
    label: "Library",
    icon: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  },
  // Films stacked into sets, seen edge on.
  {
    href: "/collections",
    label: "Collections",
    icon: "M12 3 3 7.5l9 4.5 9-4.5zM3 12.5 12 17l9-4.5M3 17 12 21.5 21 17",
  },
  // The heart the search puts on a tile, which is how anything gets here.
  {
    href: "/wishlist",
    label: "Wishlist",
    icon: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 1 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8z",
  },
  { href: "/stats", label: "Stats", icon: "M5 20v-8M12 20V4M19 20v-5" },
];

/**
 * And what you are getting: queueing it, watching it land.
 *
 * Finding it is not here any more. It was a page you navigated to in order to
 * type into a field, which is the one thing ⌘F does from wherever you already
 * are — the indexers are one of the places that window asks now.
 */
const ACQUIRING = [
  // Everything there is to go and fetch, ranked: better copies of what you
  // have, and the wants something has turned up for. An arrow up off the
  // shelf, because every row here is something rising above what you hold.
  {
    href: "/upgrades",
    label: "Queue",
    icon: "M12 15V4m0 0L8 8m4-4 4 4M4 20h16",
  },
  // And the same arrow the other way, landing.
  {
    href: "/downloads",
    label: "Downloads",
    icon: "M12 4v11m0 0 4-4m-4 4-4-4M4 20h16",
  },
];

/**
 * The two that are about the app rather than about the library.
 *
 * Last, below a rule of their own: they are reached rarely, and what separates
 * them from everything above is not what they are about but how often you want
 * them. They were bare icons at the foot of the rail once — legible enough
 * once you knew which was which, and a guess until then, which is the argument
 * for a mark standing next to its word rather than in place of it.
 */
const TOOLS = [
  {
    href: "/how-it-works",
    label: "How it works",
    icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M9.6 9.5a2.5 2.5 0 1 1 3.3 2.4c-.5.2-.9.7-.9 1.3v.3M12 16.5h.01",
  },
  // Sliders rather than a cog: what is behind this page is a set of things set
  // to a value, not a machine to be got inside.
  {
    href: "/settings",
    label: "Settings",
    icon: "M4 8h8M16 8h4M4 16h4M12 16h8M14 6v4M10 14v4",
  },
];

/**
 * A film, an episode or a show is somewhere inside the library, not a place
 * of its own. A comparison is the queue's page: its rows are the one thing
 * that opens it, and the question it answers is the queue's question.
 *
 * The dashboard is the exception that has to be written out: it is the only
 * href that is a prefix of every other one, so the fallback below would light
 * it up on every page in the app. It is exactly itself and parents nothing.
 */
const isActive = (href: string, pathname: string) =>
  href === "/"
    ? pathname === "/"
    : href === "/library"
      ? pathname.startsWith("/library") ||
        pathname.startsWith("/film") ||
        pathname.startsWith("/episode") ||
        pathname.startsWith("/show")
      : href === "/upgrades"
        ? pathname.startsWith("/upgrades") || pathname.startsWith("/compare")
        : pathname.startsWith(href);

/**
 * Between two groups of links: weighted where the labels begin and trailing off
 * away from them — `.rule-head`'s hairline rather than the one that fades at
 * both ends, because this rule belongs to the group under it the way that one
 * belongs to its heading.
 *
 * It turns with the rail: upright between two runs of links across the top of a
 * narrow screen, laid flat between two stacks in the column.
 */
function Rule() {
  return (
    <span
      aria-hidden
      className="mx-2 h-4 w-px shrink-0 bg-[linear-gradient(to_bottom,var(--line-strong),transparent)] md:mx-3 md:my-2.5 md:h-px md:w-auto md:bg-[linear-gradient(to_right,var(--line-strong),transparent)]"
    />
  );
}

/**
 * The mark on a row of the rail. Drawn at the app's usual stroke on a 24×24
 * grid, at the size a word of this rail is tall — a mark that outweighs its
 * label is a mark being asked to do the label's job.
 */
function NavIcon({ path }: { path: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="h-3.5 w-3.5 shrink-0"
    >
      <path d={path} />
    </svg>
  );
}

/**
 * Search, at the head of the rail and ruled off from everything under it.
 *
 * It is not one of the places the library is arranged into — it is the way to
 * any of them — and it is no longer a page at all: the button opens the window
 * over whatever you are looking at. It stays in the rail because the key that
 * opens it is invisible, and this is the visible half of the same gesture.
 */
function SearchTrigger() {
  const open = useSearchDialog();

  return (
    <button
      type="button"
      onClick={open}
      title="Search (⌘F)"
      className="glow flex items-center gap-2.5 rounded-full px-3 py-1.5 text-left text-sm opacity-60 transition-colors hover:bg-surface hover:opacity-100"
    >
      <NavIcon path="M17.6 17.6 21 21M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0" />
      Search
    </button>
  );
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    // One element, two shapes: a rail on a wide screen, a bar across the top
    // when there is no room for one.
    <aside className="sticky top-0 z-30 flex flex-wrap items-center gap-4 border-b border-line bg-background/85 px-4 py-3 backdrop-blur md:fixed md:inset-y-0 md:left-0 md:w-56 md:flex-col md:items-stretch md:gap-8 md:border-r md:border-b-0 md:px-4 md:py-6">
      {/* px-3 rather than none, so the mark starts on the same vertical line as
          the labels below it rather than hanging left of them. */}
      <Link href="/" className="mt-2 flex items-center gap-2 px-3">
        {/* Decorative: the wordmark next to it already names the app. */}
        <span
          aria-hidden
          className="brand-mark mark-skull h-7 w-[1.35rem] shrink-0"
        />
        {/* No weight class: the face has one weight, and asking for bold would
            only get a synthetic one. */}
        <span className="brand-word font-logo text-3xl leading-none lowercase">
          ripgrade
        </span>
      </Link>

      <nav className="flex flex-1 items-center gap-1 md:flex-col md:items-stretch md:gap-0.5">
        <SearchTrigger />

        {[PAGES, ACQUIRING, TOOLS].map((group, g) => (
          <Fragment key={g}>
            <Rule />

            {group.map((page) => {
              const active = isActive(page.href, pathname);
              return (
                <Link
                  key={page.href}
                  href={page.href}
                  aria-current={active ? "page" : undefined}
                  className={`glow flex items-center gap-2.5 rounded-full px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? "bg-surface-strong font-medium"
                      : "opacity-60 hover:bg-surface hover:opacity-100"
                  }`}
                >
                  <NavIcon path={page.icon} />
                  {page.label}
                </Link>
              );
            })}
          </Fragment>
        ))}
      </nav>

      {/*
       * The foot of the rail: what is running, and the one verb that starts it.
       *
       * The scan button was on the dashboard, beside the greeting, which made
       * the page that says what to do about the library also the only place you
       * could ask it to go and look — and the rail is where this app keeps the
       * things that are true from wherever you are standing. A scan is one of
       * those: started from a page and finished somewhere else, already
       * reporting itself here.
       *
       * Which is why the two are one group and not two things that happen to be
       * last. The aside sets its parts `md:gap-8` apart, and at that distance
       * the button read as unattached — the floor of the rail rather than the
       * control belonging to the block above it. `gap-3` is the distance
       * between a thing and its own progress.
       *
       * `display: contents` below `md:`, so the group exists only in the column.
       * Across the top of a narrow screen the rail is a wrapping row, where the
       * job block takes a line of its own and the button rides at the end of the
       * first — two placements that a box around both would have to undo.
       *
       * The button is last within it, because a control that jumps down whenever
       * a job starts is a control you have to look for.
       */}
      <div className="contents md:flex md:flex-col md:gap-3">
        {/* Renders nothing when nothing runs.

            `w-full` at every width, never auto: the aside stays flex-wrap in
            its column form, and a wrapping column sizes each line to its widest
            item's own content — an auto-width job with a long subtitle would
            take the whole rail with it. A definite width is what the truncation
            inside actually truncates against; overflow-hidden is the backstop
            for anything that forgets to. */}
        <div className="order-last w-full min-w-0 overflow-hidden empty:hidden md:order-none">
          <SidebarProcesses />
        </div>

        {/* `md:w-full` and not before: in the column it is the rail's width,
            since a button set short of the edges of a stack reads as loose in
            it. In the top bar a full-width button would be a second bar under
            the first, so it stays the size of its own word. */}
        <ScanButton className="md:w-full" />
      </div>
    </aside>
  );
}
