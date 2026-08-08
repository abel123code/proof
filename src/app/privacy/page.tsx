import type { Metadata } from "next";
import { LegalPage, Section } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy — Proof",
  description: "What Proof stores, who it sends things to, and how to get it deleted.",
};

export default function PrivacyPage() {
  return (
    <LegalPage kicker="Privacy" title="What we store, and who sees it" updated="8 August 2026">
      <p>
        Proof takes your code and your face and makes short videos out of them. That means it
        handles things you would reasonably want to know about. This page says exactly what, in
        plain terms, without the usual padding.
      </p>

      <Section title="What we store">
        <ul>
          <li>
            <strong>Your account.</strong> Email address and name from the Google account you sign
            in with, plus your GitHub username once you connect it.
          </li>
          <li>
            <strong>Repository context, not your source code.</strong> We read a repository&apos;s
            README, its language statistics, and the list of file paths. We do not read the contents
            of your source files. For private repositories this runs through a GitHub App you
            install on the specific repos you pick, requesting only metadata and contents read
            access.
          </li>
          <li>
            <strong>The clips you record.</strong> Video you film in the browser, stored so the
            renderer can cut it. Your voice is transcribed to place captions and time the edit.
          </li>
          <li>
            <strong>Screenshots and logos you upload.</strong> Kept with the brief they belong to,
            and read once by a vision model so the editor knows what each one shows.
          </li>
          <li>
            <strong>The finished video</strong>, plus the brief and the per-scene review notes
            behind it.
          </li>
        </ul>
      </Section>

      <Section title="Who else it goes to">
        <p>
          We are one person and a handful of services. Nothing is sold, and nothing is shared with
          anyone beyond the companies that run the product:
        </p>
        <ul>
          <li>
            <strong>OpenAI</strong> — writes the brief and the scenes, transcribes your voice, and
            reviews rendered frames. Your clips, transcript and uploaded images pass through it.
          </li>
          <li>
            <strong>Supabase</strong> — the database and file storage.
          </li>
          <li>
            <strong>Railway</strong> — runs the rendering service.
          </li>
          <li>
            <strong>Vercel</strong> — hosts the website.
          </li>
          <li>
            <strong>Google and GitHub</strong> — sign-in and repository access.
          </li>
        </ul>
      </Section>

      <Section title="Two things worth knowing">
        <p>
          <strong>Uploaded images sit at public URLs.</strong> Screenshots you attach are stored at
          long, random, unguessable addresses, but anyone holding one of those links can open the
          file without signing in. Deleting an image from a brief deletes the file itself, so the
          link stops working. Do not upload a screenshot containing something you would not want
          seen if the link leaked.
        </p>
        <p>
          <strong>Your finished video is not private by default.</strong> It is stored the same way,
          so treat its link as shareable. That is the point of the product, but it should not be a
          surprise.
        </p>
      </Section>

      <Section title="Getting rid of it">
        <p>
          You can delete a video from the studio, and removing an image from a brief removes the
          stored file too. For everything else, email{" "}
          <a href="mailto:abhishek.vulla@gmail.com">abhishek.vulla@gmail.com</a> and ask for your
          account and its data to be deleted. There is no form and no waiting period. It is a person
          reading the message.
        </p>
        <p>
          You can also disconnect the GitHub App at any time from your GitHub settings, which cuts
          off repository access immediately.
        </p>
      </Section>

      <Section title="How long things are kept">
        <p>
          Recordings, uploads and finished videos stay until you delete them or ask for the account
          to be removed. Recordings attached to a finished brief may be cleared automatically when
          you re-render it, to keep storage from growing without bound.
        </p>
      </Section>

      <Section title="Who this is">
        <p>
          Proof is built and run by Abhishek Vulla, a student at the Singapore University of
          Technology and Design. It is early software with a small number of users. If something
          here matters to you and is not covered, ask and you will get a straight answer.
        </p>
      </Section>
    </LegalPage>
  );
}
