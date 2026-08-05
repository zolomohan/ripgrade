import type { Metadata } from "next";
import {
  Inter,
  Instrument_Sans,
  JetBrains_Mono,
  Jim_Nightshade,
  Orbitron,
} from "next/font/google";
import "./globals.css";
import { getConvertJob } from "@/lib/convert";
import { getDoviJob } from "@/lib/dovi";
import { hasQb } from "@/lib/qbittorrent";
import { getScanState } from "@/lib/scanner";
import { getSweepJob } from "@/lib/upgrade-sweep";
import { CapabilitiesProvider } from "./capabilities";
import { JobsProvider } from "./jobs-provider";
import { ScanProvider } from "./scan-provider";
import { Glow } from "./glow";
import { RememberListing } from "./return-to";
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
    sweep: getSweepJob(),
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
        <RememberListing />
        <Glow />
        <CapabilitiesProvider qb={hasQb()}>
          <JobsProvider initial={jobs}>
            <ScanProvider>
              <Sidebar />
              {/* Clears the rail once it is fixed; above that it is a top bar
                  and the content simply follows it. */}
              <div className="flex min-h-full flex-col md:pl-56">{children}</div>
            </ScanProvider>
          </JobsProvider>
        </CapabilitiesProvider>
      </body>
    </html>
  );
}
