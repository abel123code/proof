import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Proof — You build. We get you seen.",
};

// The pitch deck IS the landing page. It's a self-contained slide deck served from
// /public, mounted full-screen here. Its closing slide (and the "skip to demo" link)
// navigate the top window into the app at /connect.
export default function Landing() {
  return (
    <iframe
      src="/proof-deck.html"
      title="Proof pitch deck"
      className="fixed inset-0 h-full w-full border-0"
    />
  );
}
