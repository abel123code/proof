import type { Metadata } from "next";
import { LegalPage, Section } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Terms · Proof",
  description: "What you can expect from Proof, and what it expects from you.",
};

export default function TermsPage() {
  return (
    <LegalPage kicker="Terms" title="What to expect, both ways" updated="8 August 2026">
      <p>
        Short version: use it for your own work, do not upload things you have no right to, and
        know that it is early software run by one person. Everything below is detail on that.
      </p>

      <Section title="What you need">
        <p>
          A Google account to sign in. Access is capped while this is early, so signing up may put
          you on a waiting list rather than straight into the product. You need to be old enough to
          agree to this yourself.
        </p>
      </Section>

      <Section title="What you upload">
        <p>
          You keep everything you put in: your clips, your screenshots, your repository. You give
          permission to process them for the one purpose of making your video, which means storing
          them, sending them to the services listed in the{" "}
          <a href="/privacy">privacy page</a>, and reading them to write and review scenes.
        </p>
        <p>
          Only upload what is yours to upload. Do not film someone who has not agreed to be filmed,
          and do not attach screenshots containing other people&apos;s personal data or anything
          under an agreement that forbids it.
        </p>
      </Section>

      <Section title="What comes out">
        <p>
          The finished video is yours. Use it commercially, edit it, post it anywhere, no
          attribution required.
        </p>
        <p>
          <strong>Check it before you publish.</strong> Scenes are generated, and a generated scene
          can get something wrong. There are automatic checks that reject invented interface text
          and review every rendered scene, but they are not a guarantee. A scene may ship flagged
          with unresolved notes rather than being dropped, precisely so that you decide. You are
          responsible for what you post.
        </p>
      </Section>

      <Section title="Credits">
        <p>
          Each account starts with a fixed number of credits. Rendering a video is the expensive
          step and costs the most; analysis, research and drafting cost less. Credits are free, have
          no cash value, and cannot be transferred or refunded for money.
        </p>
        <p>
          If a render fails, its credits go back to your balance automatically. If that ever does
          not happen, email and it will be fixed by hand.
        </p>
      </Section>

      <Section title="Things not to do">
        <ul>
          <li>Upload someone else&apos;s footage, code or images as though they were yours.</li>
          <li>Make videos that impersonate a real person or company.</li>
          <li>Attack the service, scrape it, or work around the access cap and credit limits.</li>
          <li>Use it to produce anything illegal, or anything targeting a specific person.</li>
        </ul>
        <p>
          Accounts doing these things get removed, usually with an email first if there is any doubt.
        </p>
      </Section>

      <Section title="What this is not">
        <p>
          It is early software, provided as is, with no promise that it will be available, that a
          render will succeed, or that any particular video will be good. Renders take several
          minutes and occasionally fail. Keep your own copy of footage you care about rather than
          relying on this as storage.
        </p>
        <p>
          To the extent the law allows, liability is limited to what you paid, which is nothing.
          That is not a trick, it is what a free tool run by a student can honestly offer.
        </p>
      </Section>

      <Section title="Changes and endings">
        <p>
          You can stop using it whenever and ask for your account to be deleted by emailing{" "}
          <a href="mailto:abhishek.vulla@gmail.com">abhishek.vulla@gmail.com</a>. These terms may
          change as the product does; the date at the top says when they last did. If a change
          matters, signed-in users get told rather than quietly re-agreeing.
        </p>
      </Section>
    </LegalPage>
  );
}
