import type { Metadata } from "next";
import {
  Afacad,
  Inter,
  Instrument_Sans,
  JetBrains_Mono,
} from "next/font/google";
import "./globals.css";
import { getLibraryFolders, scanStatus } from "./actions";
import { ScanProvider } from "./scan-provider";
import { Sidebar } from "./sidebar";

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

// The wordmark only. One weight, because the logo is the only thing set in it
// and a second would just be an invitation to use this face elsewhere.
const logo = Afacad({
  variable: "--font-logo-face",
  weight: "600",
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
  description: "Audit the technical quality of a local movie library",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Seeded here so a reload mid-scan shows progress immediately.
  const scan = await scanStatus();
  // Only for whether the rail offers a scan; the picker itself lives on the
  // library page, which is where you go when there is nothing to scan yet.
  const roots = await getLibraryFolders();

  return (
    <html
      lang="en"
      className={`${inter.variable} ${display.variable} ${mono.variable} ${logo.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <ScanProvider initialState={scan}>
          <Sidebar hasRoot={roots.length > 0} />
          {/* Clears the rail once it is fixed; above that it is a top bar and
              the content simply follows it. */}
          <div className="flex min-h-full flex-col md:pl-56">{children}</div>
        </ScanProvider>
      </body>
    </html>
  );
}
