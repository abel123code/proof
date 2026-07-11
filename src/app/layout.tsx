import type { Metadata } from "next";
import { Fraunces, Hanken_Grotesk, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// Editorial Creator Studio type system: high-contrast display serif,
// clean grotesk body, and a mono for technical detailing.
const display = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  axes: ["opsz", "SOFT", "WONK"],
});

const sans = Hanken_Grotesk({
  variable: "--font-sans",
  subsets: ["latin"],
});

const mono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Absolute base so the auto-generated OG/twitter image URLs resolve when shared.
  metadataBase: new URL("https://proof-build2026.vercel.app"),
  title: {
    default: "proof — get your github projects seen",
    template: "%s · proof",
  },
  description:
    "you built the thing. proof gets it watched. point it at your github repo, read the script off a teleprompter, and it edits the video for you.",
  openGraph: {
    type: "website",
    url: "https://proof-build2026.vercel.app",
    siteName: "proof",
    title: "proof — get your github projects seen",
    description:
      "devs ship projects nobody sees. proof turns your repo into a short people actually watch — research-backed script, teleprompter, auto-edited.",
  },
  twitter: {
    card: "summary_large_image",
    title: "proof — get your github projects seen",
    description:
      "point it at your github repo. proof writes the script, you read the teleprompter, it edits the video.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
