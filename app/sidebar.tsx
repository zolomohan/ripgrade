"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";

import { SidebarProcesses } from "./sidebar-processes";

/**
 * Identity and navigation, in a column that survives navigation.
 *
 * Every page used to carry its own header repeating the app name and links back
 * to the others, which meant three headers to keep in step and a "back to
 * library" link on pages that were never below the library. One rail replaces
 * all of it.
 *
 * Three groups, ruled apart: what you have, what you are getting, and the two
 * pages about the app itself.
 */

/**
 * What you have: the collection as it stands — the films, how they are
 * grouped, what is missing from it, and what it all adds up to.
 *
 * These were one undifferentiated list with everything below, which made
 * "Stats" and "Downloads" look like the same kind of place.
 */
const PAGES = [
  { href: "/", label: "Library" },
  { href: "/collections", label: "Collections" },
  { href: "/wishlist", label: "Wishlist" },
  { href: "/stats", label: "Stats" },
];

/** And what you are getting: finding it, queueing it, watching it land. */
const ACQUIRING = [
  { href: "/search", label: "Search" },
  // Everything there is to go and fetch, ranked: better copies of what you
  // have, and the wants something has turned up for.
  { href: "/upgrades", label: "Queue" },
  { href: "/downloads", label: "Downloads" },
];

/**
 * The two that are about the app rather than about the library.
 *
 * Last, below a rule of their own: they are reached rarely, and what separates
 * them from everything above is not what they are about but how often you want
 * them. They were icons at the foot of the rail — legible enough once you knew
 * which was which, and a guess until then.
 */
const TOOLS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/settings", label: "Settings" },
];

/**
 * A film, an episode or a show is somewhere inside the library, not a place
 * of its own. A comparison is the queue's page: its rows are the one thing
 * that opens it, and the question it answers is the queue's question.
 */
const isActive = (href: string, pathname: string) =>
  href === "/"
    ? pathname === "/" ||
      pathname.startsWith("/film") ||
      pathname.startsWith("/episode") ||
      pathname.startsWith("/show")
    : href === "/upgrades"
      ? pathname.startsWith("/upgrades") || pathname.startsWith("/compare")
      : pathname.startsWith(href);

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
        <span aria-hidden className="brand-mark mark-skull h-7 w-[1.35rem] shrink-0" />
        {/* No weight class: the face has one weight, and asking for bold would
            only get a synthetic one. */}
        <span className="brand-word font-logo text-3xl leading-none lowercase">
          ripgrade
        </span>
      </Link>

      <nav className="flex flex-1 items-center gap-1 md:flex-col md:items-stretch md:gap-0.5">
        {[PAGES, ACQUIRING, TOOLS].map((group, g) => (
          <Fragment key={g}>
            {/* Weighted where the labels begin and trailing off away from
                them — `.rule-head`'s hairline rather than the one that fades
                at both ends, because this rule belongs to the group under it
                the way that one belongs to its heading. It turns with the
                rail: upright between two runs of links across the top of a
                narrow screen, laid flat between two stacks in the column. */}
            {g > 0 && (
              <span
                aria-hidden
                className="mx-2 h-4 w-px shrink-0 bg-[linear-gradient(to_bottom,var(--line-strong),transparent)] md:mx-3 md:my-2.5 md:h-px md:w-auto md:bg-[linear-gradient(to_right,var(--line-strong),transparent)]"
              />
            )}

            {group.map((page) => {
              const active = isActive(page.href, pathname);
              return (
                <Link
                  key={page.href}
                  href={page.href}
                  aria-current={active ? "page" : undefined}
                  className={`glow rounded-control px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? "bg-surface-strong font-medium"
                      : "opacity-60 hover:bg-surface hover:opacity-100"
                  }`}
                >
                  {page.label}
                </Link>
              );
            })}
          </Fragment>
        ))}
      </nav>

      {/* Wraps onto its own line across the top of a narrow screen, and holds
          the foot of the rail in its column form. Renders nothing when nothing
          runs.

          `w-full` at every width, never auto: the aside stays flex-wrap in
          its column form, and a wrapping column sizes each line to its widest
          item's own content — an auto-width job with a long subtitle would
          take the whole rail with it. A definite width is what the truncation
          inside actually truncates against; overflow-hidden is the backstop
          for anything that forgets to. */}
      <div className="order-last w-full min-w-0 overflow-hidden empty:hidden md:order-none md:mt-auto">
        <SidebarProcesses />
      </div>

    </aside>
  );
}
