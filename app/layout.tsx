import type { Metadata } from "next";
import { Inter, Instrument_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { scanStatus } from "./actions";
import { ScanProvider } from "./scan-provider";

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

  return (
    <html
      lang="en"
      className={`${inter.variable} ${display.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ScanProvider initialState={scan}>{children}</ScanProvider>
      </body>
    </html>
  );
}
