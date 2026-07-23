import type { Metadata, Viewport } from "next";
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
  metadataBase: new URL("https://tryproof.org"),
  title: {
    default: "proof — get your github projects seen",
    template: "%s · proof",
  },
  description:
    "you built the thing. proof gets it watched. point it at your github repo, read the script off a teleprompter, and it edits the video for you.",
  openGraph: {
    type: "website",
    url: "https://tryproof.org",
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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${display.variable} ${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <head>
        {/* Arm scroll-reveal hiding only when JS is present, before first paint —
            without JS the content stays visible instead of a blank section. */}
        <script
          dangerouslySetInnerHTML={{
            __html: "document.documentElement.classList.add('reveal-ready')",
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
