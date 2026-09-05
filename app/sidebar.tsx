"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useState } from "react";

import { SLIDE, useSlider } from "./controls";
import { Glass, GlassButton } from "./glass";
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
 *
 * Both shapes are Glacé surfaces, and the menu button on the narrow one with
 * them — `Glass` and `GlassButton` from the `glaceui` package. The rail was
 * `.glass`, a
 * class of this app's own that was the page background held short of opaque
 * over `backdrop-filter: blur()`. That is frosting and nothing else: the shelf
 * passing behind the rail went soft, and the rail's edge stayed a hairline
 * ruled on top of it. Glacé builds a displacement map at the element's real
 * size and bends the backdrop through the rim, so the posters going by are
 * pulled sideways as they pass under the edge, with a specular highlight down
 * it and a fringe of colour where the bend is steepest — a pane with thickness
 * rather than a pane with blur behind it. It is the one thing this rail was
 * always pretending to be and could not do at any blur radius.
 *
 * The pane and nothing on it. The search and the marker for the row you are on
 * were both drawn in it too for a while, and both are back to what they were:
 * glass here is the surface the rail is, and what stands on a surface is not
 * made of it. See `SearchTrigger` and the marker in the nav below.
 *
 * What it is not is a second design system. Every colour, border and shadow
 * those surfaces draw resolves to a token this app already had; see the Glacé
 * block at the foot of globals.css, which also explains why the rules that
 * position these panes live there rather than in the class lists below.
 *
 * Nor does anything here decide what glass looks like. The bend, the rim, the
 * fringe, the frosting, the saturation and the opacity were all written on
 * these three panes once, a prop at a time, which made the rail the place the
 * app's glass was defined by accident — the bar had its own numbers, and the
 * fourth pane anybody added would have had a third set. They are a setting
 * now, under Themes, and they arrive through app/glass.tsx. What is still
 * written below is geometry: `radius`, because a pane fixed to the edge of the
 * window has no corner to round and a pill has nothing but corners.
 */

/**
 * What you have: the collection as it stands — the films, how they are
 * grouped, what is missing from it, and what it all adds up to.
 *
 * These were one undifferentiated list with everything below, which made
 * "Stats" and "Jobs" look like the same kind of place.
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
  /*
   * What is actually coming down the wire, whichever list sent it.
   *
   * Queue stood above this for a long time — the better copies the sweep had
   * found, as a page of releases. It has gone, and not because it was wrong:
   * everything on it was about a film already on your shelf, which is where it
   * is drawn now. See the "Upgrades found" section in app/library-view.tsx.
   *
   * That leaves one entry where there were two, and it is the one that was
   * always a place rather than a list — a fetch is a thing happening, and this
   * is where you go to watch it happen. See app/downloads/downloads-view.tsx.
   */
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
 * A film, an episode or a show is somewhere inside the library, not a place of
 * its own — and so is a comparison, now. It belonged to the queue while the
 * queue existed, because the queue's rows were the one thing that opened it;
 * what opens it now is a card on the shelf, and the two copies it weighs
 * against each other are both library files.
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
        pathname.startsWith("/show") ||
        pathname.startsWith("/compare")
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
 *
 * A row, like the nine under it, and deliberately not a pane.
 *
 * It was a Glacé pill for a while, on the argument that the one thing in the
 * rail that is a button should be the one thing drawn as one. The argument is
 * sound and the result was not: a raised, lit, sheening object at the head of
 * a column of quiet links is the loudest thing in the app, and what it is
 * loudest about is a control you already reach with ⌘F. It also broke the one
 * alignment that matters here — nine marks in a column with their words at a
 * common left edge, and a tenth sitting on a slab of its own.
 *
 * Glass in this rail is the rail. The things standing on it are text.
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
 * thing on the bar you are aiming a thumb at. Glacé's button sizes are set by
 * padding around a label, and this one has no label, so `.rail-menu` takes the
 * padding away and the square is what is left.
 */
function MenuButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <GlassButton
      size="sm"
      onClick={onClick}
      aria-label="Menu"
      aria-expanded={open}
      aria-controls="rail"
      /*
       * `no-sheen` because a button cannot say it as a prop: Glacé writes the
       * streak into every one of them and offers no way back. See globals.css.
       *
       * And always, rather than following the setting the panes follow. The
       * rail is the one surface here you are not looking at — it is what you
       * cross on the way to something else — and a highlight that sweeps every
       * time the pointer passes is a thing at the corner of your eye asking to
       * be looked at, several times a minute, about nothing. A sheen is for a
       * surface you have arrived at.
       */
      className="rail-menu no-sheen -mr-1.5 h-10 w-10 shrink-0"
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
    </GlassButton>
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
      <Glass
        as="header"
        /* Never, whatever Settings says — see `MenuButton` below for the
           argument, which is the same one. */
        sheen={false}
        /* Square, and flush: it is the width of the window and its top edge is
           the top of the window, so there is no corner for a radius to round.
           Glacé defaults to 16, which on a full-bleed bar puts two notches of
           page in the top corners. */
        radius={0}
        className="rail-bar top-0 z-30 flex items-center justify-between px-4 py-3 md:hidden"
      >
        <Brand />
        <MenuButton open={open} onClick={() => setOpen((was) => !was)} />
      </Glass>

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
      <Glass
        as="aside"
        id="rail"
        sheen={false}
        radius={0}
        className={`rail-pane inset-y-0 left-0 z-50 flex w-64 flex-col transition-[transform,visibility] duration-300 motion-reduce:transition-none md:visible md:z-30 md:w-56 md:translate-x-0 ${
          open ? "visible translate-x-0" : "invisible -translate-x-full"
        }`}
      >
        {/*
         * The column scrolls, the pane does not.
         *
         * They were one element, and Glacé's specular rim is a child laid over
         * the whole of it — so a rail with more links than height scrolled its
         * own edge highlight up out of the pane. The rim belongs to the glass
         * and the links belong to the column, and this is the line between
         * them.
         */}
        <div className="flex flex-1 flex-col gap-8 overflow-y-auto px-4 py-6">
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
             *
             * A ring and a wash, and not a pane of glass. It was one for a
             * while — glass over the rail, on the reasoning that the shelf
             * arrives at this pill already refracted once and could be bent
             * again. What that missed is that a marker is not a surface: it is
             * the app saying which row you are on, and a second lens sliding
             * over the first turned the one moving thing in the rail into the
             * busiest. This is a shape, and a shape is what the argument above
             * asked for.
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
                      /*
                       * The whole page, fetched before it is asked for.
                       *
                       * `auto` — the default — prefetches a dynamic route only
                       * as far as its nearest loading boundary, and every page
                       * here is dynamic with no boundary anywhere, so it was
                       * fetching about two hundred bytes of nothing and the
                       * real page was fetched on the click. That is the wait
                       * you feel in the rail.
                       *
                       * The obvious fix is a `loading.tsx`, and it is the wrong
                       * one here. A loading boundary answers a click by
                       * replacing the page with a skeleton — and this app's
                       * navigations are meant to be one poster moving from a
                       * tile to the page it opens. A skeleton has no poster in
                       * it, so there is nothing for the browser to pair the old
                       * one with, and the morph degrades to a cross-fade. The
                       * illusion is the point; a spinner in its place is a
                       * worse page that happens to feel faster.
                       *
                       * `true` prefetches the whole route instead, boundary or
                       * no boundary, and moves it into the client cache's
                       * `static` bucket — five minutes rather than the zero
                       * seconds a dynamic route gets. So the page is already
                       * in hand when you press, the real poster is there to
                       * morph into, and nothing has to stand in for it.
                       */
                      prefetch
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
           * The foot of the rail: what is running.
           *
           * A Scan button stood under this for a while, on the argument that the
           * rail is where the app keeps what is true from wherever you are
           * standing, and a scan is one of those. What it was not was something
           * you press from wherever you are standing: the shelf has its own now,
           * beside the shelf it refreshes, and Settings keeps the one for the odd
           * time you have moved a file by hand. A verb parked in the furniture of
           * every page, three inches from a shelf with the same word on it, was
           * the third place to press for a thing there is now one place to press
           * for.
           *
           * What is left is the report, which was always the part that had to be
           * here. Renders nothing when nothing runs. `min-w-0` is what the
           * truncation inside actually truncates against, and `overflow-hidden`
           * is the backstop for anything that forgets to — a job with a long
           * subtitle should not be able to widen the column it is reporting in.
           */}
          <div className="min-w-0 overflow-hidden empty:hidden">
            <SidebarProcesses />
          </div>
        </div>
      </Glass>
    </>
  );
}
