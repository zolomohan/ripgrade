import type { Metadata, Viewport } from "next";
import type { CSSProperties } from "react";
import { connection } from "next/server";
import {
  Inter,
  Instrument_Sans,
  JetBrains_Mono,
  Jim_Nightshade,
  Orbitron,
} from "next/font/google";
/*
 * Glacé's own sheet, ahead of ours so ours has the last word.
 *
 * It ships unlayered plain CSS — `.glace-glass` and the rest — and so does the
 * block at the foot of globals.css that tells those surfaces which colours and
 * which face this app uses. Two unlayered rules of equal weight are settled by
 * order, and this is the order.
 */
import "glaceui/styles.css";
import "./globals.css";
import { getStripJob } from "@/lib/audio-strip";
import { backdropAttribute } from "@/lib/backdrop";
import { themeAttribute } from "@/lib/theme";
import { getConvertJob } from "@/lib/convert";
import { getDoviJob } from "@/lib/dovi";
import { getDoviRun } from "@/lib/dovi-run";
import { hasQb } from "@/lib/qbittorrent";
import { getScanState } from "@/lib/scanner";
import { getThumbJob } from "@/lib/thumbs";
import { getSweepJob } from "@/lib/upgrade-sweep";
import { getBackdrop, getGlassTuning, getTheme } from "./actions";
import { CapabilitiesProvider } from "./capabilities";
import { GlassProvider } from "./glass";
import { JobsProvider } from "./jobs-provider";
import { ScanProvider } from "./scan-provider";
import { Glow } from "./glow";
import { PageGlass } from "./page-glass";
import { RememberListing } from "./return-to";
import { SearchProvider } from "./search/dialog";
import { ServiceWorker } from "./service-worker";
import { Sidebar } from "./sidebar";
import { Splash } from "./splash";
import { Toasts } from "./toast";

// Inter for the interface: it holds up at 11px, which this app leans on, and
// its tabular figures keep the score columns from jittering.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

// A slightly warmer geometric face for titles, so headings read as a different
// voice from the dense technical text rather than just a larger size of it.
const display = Instrument_Sans({
  variable: "--font-display-face",
  subsets: ["latin"],
  display: "swap",
});

// The wordmark only — a script face that belongs next to the skull and nowhere
// else in the interface. Jim Nightshade ships one weight, so nothing sets a
// heavier one: asking for bold here only gets the browser's synthetic smear.
const logo = Jim_Nightshade({
  variable: "--font-logo-face",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

// Scores, and only scores. Every number this app exists to produce is set in
// it, so a figure in Orbitron is a verdict and a figure in anything else is a
// measurement — the two stop having to be told apart by their surroundings.
const score = Orbitron({
  variable: "--font-score-face",
  subsets: ["latin"],
  display: "swap",
});

// Paths, codecs and encoder strings — JetBrains Mono disambiguates 0/O and 1/l,
// which matters when you are reading release names character by character.
const mono = JetBrains_Mono({
  variable: "--font-mono-face",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "RipGrade",
  description: "Audit the technical quality of a local film library",
  // Installed as an app, this is the name under the dock icon and in the menu
  // bar. `capable` is what tells Safari to open it in its own window rather
  // than hand the link back to a tab; the manifest says the same thing, and
  // both are read, so both say it.
  appleWebApp: {
    capable: true,
    title: "RipGrade",
    statusBarStyle: "black-translucent",
  },
};

/**
 * The colour the window's own chrome is painted — the title bar of the dock
 * app, the tab strip in a browser. The page's background either way, so the
 * seam between chrome and content disappears; the two values are `--background`
 * from globals.css.
 *
 * Generated rather than declared, because it is the one part of the theme that
 * cannot be answered in CSS. A media-keyed pair asks the machine, and the
 * machine is no longer who decides — an app pinned to light on a laptop set to
 * dark would have had a black title bar over a white page. Where the setting
 * has an opinion this states one colour; where it defers, the pair goes back
 * and the machine answers as before.
 */
export async function generateViewport(): Promise<Viewport> {
  const theme = await getTheme();

  if (theme === "light") return { themeColor: LIGHT };
  if (theme === "dark") return { themeColor: DARK };

  return {
    themeColor: [
      { media: "(prefers-color-scheme: light)", color: LIGHT },
      { media: "(prefers-color-scheme: dark)", color: DARK },
    ],
  };
}

const LIGHT = "#ffffff";
const DARK = "#0b0b0d";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  /*
   * Nothing below this line may be answered at build time.
   *
   * Every read here — the jobs, and `hasQb` under them — goes to SQLite
   * through a synchronous driver, and a synchronous read completes perfectly
   * happily while the page is being prerendered. So without this the answers
   * are whatever was true on the machine that ran `next build`, frozen into
   * the static shell: in the container that is a database that does not exist
   * yet, because /app/data is a volume mounted after the image is built.
   *
   * `qb` is the one that bites. Frozen false, it says qBittorrent is not
   * connected, and every download control in the app is a plain magnet link
   * rather than the handover to the queue — see `MagnetAction`. A request-time
   * render gets it right, so the app looks correct until something makes the
   * router re-read the shell, and then every button quietly changes meaning.
   *
   * `connection()` is where prerendering stops and the request begins, which
   * is the whole of the fix: these are facts about this install right now, and
   * there is no moment before the request at which they can honestly be read.
   */
  await connection();

  /*
   * How glass is drawn, read here because every pane in the app is drawn from
   * here down and none of them should be asking separately. Two things come
   * out of it: the props Glacé takes, handed to the client through
   * `GlassProvider`, and the one part of it that is a colour rather than a
   * filter, written onto <html> below as a custom property.
   */
  const glass = await getGlassTuning();

  /*
   * Which scheme the app is drawn in. It reaches the page as an attribute and
   * nothing else — every colour in globals.css is already written three ways
   * against it — so there is no palette to thread down and nothing to hydrate.
   *
   * Absent for `system`, which is the point of `themeAttribute` returning
   * undefined: the media query in globals.css is what answers then, and an
   * attribute saying "system" would be a third state for the CSS to have an
   * opinion about when there are only two ways to draw anything.
   */
  const theme = await getTheme();

  /*
   * And how far a page's artwork is allowed to spread, which travels the same
   * way and for the same reason: what the two full modes need is `overflow`,
   * `position` and a mask, all of them written against `[data-backdrop]` in
   * globals.css. The six pages that open on a picture are not told which mode
   * they are in and do not have to be.
   */
  const backdrop = await getBackdrop();

  // Seeded here so a reload mid-job shows progress immediately, before the
  // job stream has connected.
  const jobs = {
    scan: getScanState(),
    dovi: getDoviJob(),
    convert: getConvertJob(),
    strip: getStripJob(),
    sweep: getSweepJob(),
    thumbs: getThumbJob(),
    dvRun: getDoviRun(),
  };
  return (
    <html
      lang="en"
      // Set on the document rather than passed down, because what it marks is
      // the load itself: every list rendered under the splash reads it, and
      // `SplashDone` clears it once the splash is gone. See globals.css.
      data-splash=""
      data-theme={themeAttribute(theme)}
      /*
       * Absent for the band, which is what every rule in globals.css already
       * draws — see `backdropAttribute`. Present, it says the backdrop fills
       * the window and whether it stays there while the page moves over it.
       */
      data-backdrop={backdropAttribute(backdrop)}
      /*
       * The one part of the glass preference that is a colour and not a filter,
       * so it travels as CSS rather than as a prop: `--glass` in globals.css is
       * mixed from the page background at this percentage, and every Glacé
       * surface takes its fill from it. Set on the document because it is one
       * value for the whole app, and set here rather than in the provider so it
       * is already right in the first frame — a pane that arrives opaque and
       * clears once the client has mounted is a pane you watch load.
       */
      style={{ "--glass-opacity": `${glass.opacity}%` } as CSSProperties}
      /*
       * And the sheen, as an attribute rather than a property, because what
       * it switches is a `background` and a `display` rather than a value. Both
       * halves of it — the streak that sweeps on hover and the light sitting in
       * every pane's top left corner — are off together or on together, which
       * is how anyone looking at them reads them. See globals.css.
       */
      data-sheen={glass.sheen ? "on" : "off"}
      className={`${inter.variable} ${display.variable} ${mono.variable} ${logo.variable} ${score.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <Splash />
        <ServiceWorker />
        <RememberListing />
        <Glow />
        <GlassProvider tuning={glass}>
          <CapabilitiesProvider qb={hasQb()}>
            <JobsProvider initial={jobs}>
              <ScanProvider>
                {/* Around both the rail and the page, because the rail's own
                  search button opens the window that hangs over the page. */}
                {/* Inside the glass provider, because a toast is a pane like
                  the rest and is tuned by the same setting; outside the search
                  and the page, because what it reports is not about either. */}
                <Toasts theme={theme} />

                <SearchProvider>
                  {/* One column, exactly the height of the window, holding the
                    rail and the page both.

                    It is here so a page can simply say `flex-1` and be as tall
                    as the window — which every page with an empty state on it
                    needs to say, `EmptyState` being a block that fills what it
                    is given. They each claimed `min-h-dvh` instead, because
                    `min-h-full` on an auto-height body resolves to nothing for
                    a child to fill; and a page claiming the whole window from
                    *under* the narrow screen's header is a window and a bit —
                    every list page scrolled a header's worth on a phone with
                    nothing below the fold. Claimed once, above the header, and
                    the arithmetic comes out. */}
                  <div className="flex min-h-dvh flex-col">
                    <Sidebar />
                    {/* Clears the rail at the width the rail is standing there.
                      Below it the rail is a drawer, fixed and off the side of
                      the screen, taking up no room to be cleared — what the
                      content follows down there is the bar the drawer hides
                      behind, which is the one part of it in the flow of the
                      page.

                      `overflow-x-clip` so a full-bleed strip can run to the
                      edges of this column without the page gaining a sideways
                      scrollbar. A shelf that escapes the reading column has to
                      measure itself against the viewport, and `100vw` counts
                      the scrollbar gutter this app holds open — a few pixels of
                      overshoot at each end, which clipping simply absorbs.
                      `clip` rather than `hidden`: hidden makes this a scroll
                      container, which would break any sticky heading inside it,
                      and clip does not. */}
                    <div className="page-body flex flex-1 flex-col overflow-x-clip md:pl-56">
                      {children}

                      {/* After the page rather than before it, which is what
                        puts it over the backdrop and under the words: both sit
                        at `z-index: -1`, neither is in a stacking context of
                        its own, and at equal depth the later element wins.
                        Only where the backdrop fills the window — with the
                        picture in a band there is nothing behind the page for
                        a pane to be glass against. See ./page-glass.tsx. */}
                      {backdrop !== "band" && <PageGlass />}
                    </div>
                  </div>
                </SearchProvider>
              </ScanProvider>
            </JobsProvider>
          </CapabilitiesProvider>
        </GlassProvider>
      </body>
    </html>
  );
}
