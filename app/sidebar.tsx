"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { SidebarProcesses } from "./sidebar-processes";

/**
 * Identity and navigation, in a column that survives navigation.
 *
 * Every page used to carry its own header repeating the app name and links back
 * to the others, which meant three headers to keep in step and a "back to
 * library" link on pages that were never below the library. One rail replaces
 * all of it.
 */
const PAGES = [
  { href: "/", label: "Library" },
  { href: "/collections", label: "Collections" },
  { href: "/stats", label: "Stats" },
  { href: "/wishlist", label: "Wishlist" },
  { href: "/search", label: "Search" },
];

/**
 * The two that are about the app rather than about the library.
 *
 * Held apart at the foot of the rail and reduced to their icons: they are
 * reached rarely, and a list where every entry looks equally likely says
 * nothing about which of them you actually want.
 */
const TOOLS = [
  {
    href: "/how-it-works",
    label: "How it works",
    // A question mark in a circle: this is the page that answers "why that
    // score", which is the only question the app cannot answer in place.
    path: "M12 17h.01M9.2 9a3 3 0 1 1 4 2.8c-.8.3-1.2 1-1.2 1.9",
    circle: true,
  },
  {
    href: "/settings",
    label: "Settings",
    path: "M10.3 4.3a1 1 0 0 1 1-.8h1.4a1 1 0 0 1 1 .8l.2 1.3 1.4.8 1.2-.5a1 1 0 0 1 1.2.4l.7 1.2a1 1 0 0 1-.2 1.3l-1 .9v1.6l1 .9a1 1 0 0 1 .2 1.3l-.7 1.2a1 1 0 0 1-1.2.4l-1.2-.5-1.4.8-.2 1.3a1 1 0 0 1-1 .8h-1.4a1 1 0 0 1-1-.8l-.2-1.3-1.4-.8-1.2.5a1 1 0 0 1-1.2-.4l-.7-1.2a1 1 0 0 1 .2-1.3l1-.9v-1.6l-1-.9a1 1 0 0 1-.2-1.3l.7-1.2a1 1 0 0 1 1.2-.4l1.2.5 1.4-.8z",
    circle: false,
  },
];

/**
 * A film, an episode, a show or a comparison is somewhere inside the library,
 * not a place of its own.
 */
const isActive = (href: string, pathname: string) =>
  href === "/"
    ? pathname === "/" ||
      pathname.startsWith("/film") ||
      pathname.startsWith("/episode") ||
      pathname.startsWith("/show") ||
      pathname.startsWith("/compare")
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
        {PAGES.map((page) => {
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
      </nav>

      {/* Wraps onto its own line across the top of a narrow screen, and sits
          above the two icons in the rail. Renders nothing when nothing runs. */}
      <div className="order-last w-full min-w-0 empty:hidden md:order-none md:mt-auto md:w-auto">
        <SidebarProcesses />
      </div>

      {/* `mt-auto` only once the rail is a column — across the top they simply
          end the row, which is the same place: last, and out of the way. */}
      <div className="flex shrink-0 items-center gap-1.5 md:px-2">
        {TOOLS.map((tool) => {
          const active = pathname.startsWith(tool.href);
          return (
            <Link
              key={tool.href}
              href={tool.href}
              aria-label={tool.label}
              aria-current={active ? "page" : undefined}
              title={tool.label}
              className={`grid h-9 w-9 place-items-center rounded-full border transition-colors ${
                active
                  ? "border-line-strong bg-surface-strong"
                  : "border-line opacity-50 hover:bg-surface hover:opacity-100"
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
                className="h-4 w-4"
              >
                {tool.circle && <circle cx="12" cy="12" r="9" />}
                {!tool.circle && <circle cx="12" cy="12" r="2.6" />}
                <path d={tool.path} />
              </svg>
            </Link>
          );
        })}
      </div>
    </aside>
  );
}
