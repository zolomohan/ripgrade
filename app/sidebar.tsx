"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ScanButton } from "./scan-button";

/**
 * Identity, navigation and the one global action, in a column that survives
 * navigation.
 *
 * Every page used to carry its own header repeating the app name and links back
 * to the others, which meant three headers to keep in step and a "back to
 * library" link on pages that were never below the library. One rail replaces
 * all of it.
 */
const PAGES = [
  { href: "/", label: "Library" },
  { href: "/wishlist", label: "Wishlist" },
  { href: "/how-it-works", label: "How it works" },
];

/** A film or a comparison is somewhere inside the library, not a place of its own. */
const isActive = (href: string, pathname: string) =>
  href === "/"
    ? pathname === "/" ||
      pathname.startsWith("/movie") ||
      pathname.startsWith("/compare")
    : pathname.startsWith(href);

export function Sidebar({ hasRoot }: { hasRoot: boolean }) {
  const pathname = usePathname();

  return (
    // One element, two shapes: a rail on a wide screen, a bar across the top
    // when there is no room for one.
    <aside className="sticky top-0 z-30 flex items-center gap-4 border-b border-line bg-background/85 px-4 py-3 backdrop-blur md:fixed md:inset-y-0 md:left-0 md:w-56 md:flex-col md:items-stretch md:gap-8 md:border-r md:border-b-0 md:px-4 md:py-6">
      {/* px-3 rather than none, so the wordmark starts on the same vertical
          line as the labels below it rather than hanging left of them. */}
      <Link
        href="/"
        className="font-logo px-3 mt-2 text-2xl leading-none font-semibold lowercase"
      >
        ripgrade
      </Link>

      <nav className="flex flex-1 items-center gap-1 md:flex-col md:items-stretch md:gap-0.5">
        {PAGES.map((page) => {
          const active = isActive(page.href, pathname);
          return (
            <Link
              key={page.href}
              href={page.href}
              aria-current={active ? "page" : undefined}
              className={`rounded-control px-3 py-1.5 text-sm transition-colors ${
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

      {/* Scanning belongs to the library rather than to any page, so it sits
          with the navigation and works from all of them. */}
      {hasRoot && (
        <div className="shrink-0 md:mt-auto md:w-full">
          <ScanButton />
        </div>
      )}
    </aside>
  );
}
