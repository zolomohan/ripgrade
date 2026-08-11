"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useState } from "react";

import { SLIDE, useSlider } from "./controls";
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
 *
 * Two shapes, and only one of them is a rail. Wide, it is the column described
 * above, fixed down the left. Narrow, it is a drawer behind a button — the same
 * column, off the side of the screen until it is asked for.
 *
 * It used to be a bar instead: the whole rail laid out as a wrapping row across
 * the top. Nine links, a search, a scan button and a block that reports running
 * jobs do not fit across a phone, so they wrapped — three or four lines of
 * navigation above every page, taller than the content it was introducing, and
 * a scan starting would push the page down another line. A drawer is what a
 * list of this length wants when there is no room for it: one line of bar, and
 * the column arrives at full height when you go looking for it.
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
  // The work itself, while it runs and after it has. A clock face: what this
  // page is about is jobs against time — how far in, how long it took, when it
  // ended — and the rail below already spends the arrows.
  {
    href: "/jobs",
    label: "Jobs",
    icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3.5 2",
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
 * One orientation now, where it used to have two: the rail is a column at every
 * width, whether it is standing at the side of the page or has just slid in
 * from it.
 */
function Rule() {
  return (
    <span
      aria-hidden
      className="mx-3 my-2.5 h-px shrink-0 bg-[linear-gradient(to_right,var(--line-strong),transparent)]"
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
      className="glow flex items-center gap-2.5 rounded-full px-3 py-1.5 text-left text-sm opacity-60 transition-colors hover:opacity-100"
    >
      <NavIcon path="M17.6 17.6 21 21M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0" />
      Search
    </button>
  );
}

/**
 * The skull and the name, which now stand in two places: at the head of the
 * rail, and in the bar the rail hides behind on a narrow screen.
 *
 * A component rather than the copy it would otherwise be — the drawer covers
 * the bar when it is out, so the two are never on screen together and are read
 * as one thing appearing in one place. Two of them drifting apart would look
 * like the app changing its name as you open the menu.
 */
function Brand({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`flex items-center gap-2 ${className}`}>
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
  );
}

/**
 * The one control on the narrow bar, and the only thing standing between a
 * phone and the rail.
 *
 * Three lines and no word. This is the exception to the rule the rows below it
 * follow — every one of those carries its label because a column of nine marks
 * is a puzzle — and it is an exception on the same grounds: a hamburger is the
 * one icon on the web that does not need its label, and a bar that spent a
 * quarter of its width writing "Menu" would be a bar arguing with itself.
 *
 * At `h-10 w-10` rather than the size of the mark inside it: this is the only
 * thing on the bar you are aiming a thumb at.
 */
function MenuButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Menu"
      aria-expanded={open}
      aria-controls="rail"
      className="glow -mr-1.5 grid h-10 w-10 shrink-0 place-items-center rounded-full transition-colors hover:bg-surface"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden
        className="h-5 w-5"
      >
        <path d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    </button>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  /*
   * Which row is lit, as an address rather than a flag on each row — the
   * marker is one element for the whole rail now, and it has to be told which
   * of them it is standing on.
   *
   * An empty string where nothing matches. Every page in the app is under one
   * of these rows, so this is the state that should not arise; it arises the
   * moment one is added that is not, and a rail that keeps its marker on the
   * last row it recognised would be saying you are somewhere you are not.
   */
  const here =
    [...PAGES, ...ACQUIRING, ...TOOLS].find((page) =>
      isActive(page.href, pathname),
    )?.href ?? "";

  const [track, register, thumbStyle] = useSlider(here, "y");

  /*
   * Anything that moves you closes it.
   *
   * The rail's own rows do it on the way out — see the `onClick` on the nav
   * below — and this is for the navigations they do not cover: a link inside a
   * dialog opened from the rail, the back button, a redirect. Following a link
   * to the page you are already on is the one case the nav handles and this
   * does not, since the path never changes.
   *
   * Adjusted during render rather than in an effect, the same way `useClosing`
   * in app/modal.tsx does it: an effect would paint one frame of the new page
   * with the drawer still over it and then re-render to take it away, which is
   * the drawer flashing at the exact moment it is supposed to be leaving.
   */
  const [at, setAt] = useState(pathname);

  if (at !== pathname) {
    setAt(pathname);
    if (open) setOpen(false);
  }

  /*
   * Only while it is out, and all of it undone when it goes back in.
   *
   * Escape closes it, because a drawer is a thing standing over the page and
   * that is the gesture for leaving one, the same as every dialog here. The
   * page underneath stops scrolling for the same reason it does under a modal:
   * a flick aimed at the drawer that scrolls the library behind it leaves you
   * somewhere you never chose to be.
   *
   * And it closes itself if the window reaches the width that has a rail. A
   * phone turned on its side is suddenly a screen with the column already on
   * it, and the state left over from the drawer would otherwise sit there
   * holding the page unscrollable behind a menu that is no longer a menu.
   */
  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    // The `md:` this file is written against, as a number this file can ask
    // about. Tailwind's own breakpoint, and the two have to agree.
    const wide = window.matchMedia("(min-width: 48rem)");
    const onWide = () => {
      if (wide.matches) setOpen(false);
    };

    window.addEventListener("keydown", onKey);
    wide.addEventListener("change", onWide);

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onWide);
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      {/*
       * The narrow screen's whole header: who this is, and the way in. It is
       * the only part of the rail that is ever in the flow of the page, which
       * is what the content below it follows down — the drawer itself is fixed
       * and takes up no room, so there is nothing else holding the page clear.
       */}
      <header className="glass sticky top-0 z-30 flex items-center justify-between border-b border-line px-4 py-3 md:hidden">
        <Brand />
        <MenuButton open={open} onClick={() => setOpen((was) => !was)} />
      </header>

      {/*
       * The page, dimmed behind the drawer, and a target for the tap that says
       * "not this" — which on a touchscreen is the gesture, there being no
       * Escape to press.
       *
       * Always rendered and faded rather than mounted with the drawer, so it
       * has something to animate on the way out as well as in.
       * `pointer-events-none` while it is clear, or it would be an invisible
       * sheet over the whole app.
       */}
      <div
        aria-hidden
        onClick={() => setOpen(false)}
        className={`veil fixed inset-0 z-40 transition-opacity duration-200 motion-reduce:transition-none md:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/*
       * One element, two shapes: the rail down the side of a wide screen, and
       * the drawer that slides over a narrow one.
       *
       * `visibility` and not opacity or a conditional mount, because the thing
       * that has to go away when it is shut is not the picture of it — it is
       * the nine links, which a shut drawer would otherwise hand to anyone
       * tabbing through the page from a phone, one invisible row at a time. It
       * is also the one property that can be transitioned and still do that:
       * the flip to hidden waits for the slide out to finish, where `hidden`
       * would cut it off in the first frame.
       */}
      <aside
        id="rail"
        className={`glass fixed inset-y-0 left-0 z-50 flex w-64 flex-col gap-8 overflow-y-auto border-r border-line px-4 py-6 transition-[transform,visibility] duration-300 motion-reduce:transition-none md:visible md:z-30 md:w-56 md:translate-x-0 ${
          open ? "visible translate-x-0" : "invisible -translate-x-full"
        }`}
      >
        {/* px-3 rather than none, so the mark starts on the same vertical line
            as the labels below it rather than hanging left of them. */}
        <Brand className="mt-2 px-3" />

        {/* Every row in here is a way out of the drawer, so the drawer shuts on
            any of them rather than each one saying so for itself — the search
            included, which is not a navigation but does put a window over the
            page the drawer would otherwise be standing in front of. */}
        <nav
          ref={track}
          onClick={() => setOpen(false)}
          className="relative flex flex-1 flex-col gap-0.5"
        >
          {/*
           * The marker for the row you are on, and the one thing in the rail
           * that moves: it slides from the row you were on to the row you
           * chose, rather than going out at one and coming on at another. The
           * same object the switches on the shelves raise out of their track,
           * measured the same way and moving on the same clock — a column of
           * pages is that control at another size, so it should not be another
           * animation. See `useSlider` in app/controls.tsx.
           *
           * Ahead of the rows in the markup and under them in paint, because
           * `.glow` gives every row a stacking context of its own; nothing has
           * to be lifted above this to stay readable through it.
           *
           * It carries an edge, and the edge is what makes the movement worth
           * watching. As a bare wash it was 5% ink and the pointer's own light
           * on a row is about as much again — so the row you were about to
           * click already looked chosen, and the marker landing on it changed
           * nothing anyone could see. The two now differ in kind rather than in
           * degree: the light under the pointer is a gradient with no boundary
           * anywhere, and this is a shape.
           */}
          <span
            aria-hidden
            style={thumbStyle}
            className={`rail-here absolute inset-x-0 top-0 rounded-full bg-surface-strong ring-1 ring-line ${SLIDE}`}
          />

          <SearchTrigger />

          {[PAGES, ACQUIRING, TOOLS].map((group, g) => (
            <Fragment key={g}>
              <Rule />

              {group.map((page) => {
                const active = page.href === here;
                return (
                  <Link
                    key={page.href}
                    ref={register(page.href)}
                    href={page.href}
                    aria-current={active ? "page" : undefined}
                    /* Hover brings the label up to full strength and nothing
                       else. `.glow` already lights the row under the pointer,
                       and a wash laid on top of that light was a second answer
                       to the same question — one that happened to look like
                       the marker for the row you are on. Pointing at a row is
                       not being on it, and only one of the two is a state of
                       the app. */
                    className={`glow relative flex items-center gap-2.5 rounded-full px-3 py-1.5 text-sm transition-colors ${
                      active ? "font-medium" : "opacity-60 hover:opacity-100"
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
         * The foot of the rail: what is running, and the one verb that starts
         * it.
         *
         * The scan button was on the dashboard, beside the greeting, which made
         * the page that says what to do about the library also the only place
         * you could ask it to go and look — and the rail is where this app
         * keeps the things that are true from wherever you are standing. A scan
         * is one of those: started from a page and finished somewhere else,
         * already reporting itself here.
         *
         * Which is why the two are one group and not two things that happen to
         * be last. The aside sets its parts `gap-8` apart, and at that distance
         * the button read as unattached — the floor of the rail rather than the
         * control belonging to the block above it. `gap-3` is the distance
         * between a thing and its own progress.
         *
         * The button is last within it, because a control that jumps down
         * whenever a job starts is a control you have to look for.
         */}
        <div className="flex flex-col gap-3">
          {/* Renders nothing when nothing runs. `min-w-0` is what the
              truncation inside actually truncates against, and
              `overflow-hidden` is the backstop for anything that forgets to
              — a job with a long subtitle should not be able to widen the
              column it is reporting in. */}
          <div className="min-w-0 overflow-hidden empty:hidden">
            <SidebarProcesses />
          </div>

          {/* The rail's own width, at both of its widths: a button set short of
              the edges of a stack reads as loose in it. It was the size of its
              own word on a narrow screen, back when the rail there was a row —
              in a drawer it is in a column like everything else. */}
          <ScanButton className="w-full" />
        </div>
      </aside>
    </>
  );
}
