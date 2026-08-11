import type { Metadata, Viewport } from "next";
import {
  Inter,
  Instrument_Sans,
  JetBrains_Mono,
  Jim_Nightshade,
  Orbitron,
} from "next/font/google";
import "./globals.css";
import { getStripJob } from "@/lib/audio-strip";
import { getConvertJob } from "@/lib/convert";
import { getDoviJob } from "@/lib/dovi";
import { hasQb } from "@/lib/qbittorrent";
import { getScanState } from "@/lib/scanner";
import { getThumbJob } from "@/lib/thumbs";
import { getSweepJob } from "@/lib/upgrade-sweep";
import { CapabilitiesProvider } from "./capabilities";
import { JobsProvider } from "./jobs-provider";
import { ScanProvider } from "./scan-provider";
import { Glow } from "./glow";
import { RememberListing } from "./return-to";
import { SearchProvider } from "./search/dialog";
import { ServiceWorker } from "./service-worker";
import { Sidebar } from "./sidebar";
import { Splash } from "./splash";

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

// The colour the window's own chrome is painted — the title bar of the dock
// app, the tab strip in a browser. Given per scheme so it is the page's
// background either way and the seam between chrome and content disappears;
// the two values are `--background` from globals.css.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0d" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Seeded here so a reload mid-job shows progress immediately, before the
  // job stream has connected.
  const jobs = {
    scan: getScanState(),
    dovi: getDoviJob(),
    convert: getConvertJob(),
    strip: getStripJob(),
    sweep: getSweepJob(),
    thumbs: getThumbJob(),
  };
  return (
    <html
      lang="en"
      // Set on the document rather than passed down, because what it marks is
      // the load itself: every list rendered under the splash reads it, and
      // `SplashDone` clears it once the splash is gone. See globals.css.
      data-splash=""
      className={`${inter.variable} ${display.variable} ${mono.variable} ${logo.variable} ${score.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <Splash />
        <ServiceWorker />
        <RememberListing />
        <Glow />
        <CapabilitiesProvider qb={hasQb()}>
          <JobsProvider initial={jobs}>
            <ScanProvider>
              {/* Around both the rail and the page, because the rail's own
                  search button opens the window that hangs over the page. */}
              <SearchProvider>
                <Sidebar />
                {/* Clears the rail at the width the rail is standing there.
                    Below it the rail is a drawer, fixed and off the side of the
                    screen, taking up no room to be cleared — what the content
                    follows down there is the bar the drawer hides behind, which
                    is the one part of it in the flow of the page.

                    `overflow-x-clip` so a full-bleed strip can run to the edges
                    of this column without the page gaining a sideways
                    scrollbar. A shelf that escapes the reading column has to
                    measure itself against the viewport, and `100vw` counts the
                    scrollbar gutter this app holds open — a few pixels of
                    overshoot at each end, which clipping simply absorbs. `clip`
                    rather than `hidden`: hidden makes this a scroll container,
                    which would break any sticky heading inside it, and clip
                    does not. */}
                <div className="flex min-h-full flex-col overflow-x-clip md:pl-56">
                  {children}
                </div>
              </SearchProvider>
            </ScanProvider>
          </JobsProvider>
        </CapabilitiesProvider>
      </body>
    </html>
  );
}
