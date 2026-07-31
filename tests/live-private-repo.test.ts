/**
 * LIVE proof against the real GitHub API. Not part of CI — run explicitly:
 *   GH_TEST_TOKEN=$(gh auth token) npx vitest run tests/live-private-repo.test.ts
 *
 * Proves the exact path a GitHub App installation takes: fetchRepoSnapshot given a scoped,
 * authenticated Octokit can read a PRIVATE repo, and the unauthenticated server client cannot.
 */
import { describe, expect, it } from "vitest";
import { Octokit } from "@octokit/rest";
import { fetchRepoSnapshot } from "@/lib/github";

const TOKEN = process.env.GH_TEST_TOKEN;
const PRIVATE_REPO = process.env.GH_TEST_PRIVATE_REPO;

const LIVE = Boolean(TOKEN && PRIVATE_REPO);

// Skipped unless explicitly run with credentials, so CI never hits the network.
describe.skipIf(!LIVE)("live: private repo access", () => {
  it("reads a REAL private repo through a scoped client", async () => {
    const scoped = new Octokit({ auth: TOKEN });
    const snap = await fetchRepoSnapshot(`https://github.com/${PRIVATE_REPO}`, scoped);

    console.log("\n--- SNAPSHOT FROM A REAL PRIVATE REPO ---");
    console.log("name      :", snap.name);
    console.log("languages :", snap.languages.join(", ") || "(none)");
    console.log("readme    :", snap.readme.slice(0, 120).replace(/\s+/g, " "), "...");
    console.log("readmeLen :", snap.readme.length);
    console.log("fileTree  :", snap.fileTree.length, "paths e.g.", snap.fileTree.slice(0, 5));

    expect(snap.name).toBeTruthy();
    expect(snap.fileTree.length).toBeGreaterThan(0);
  }, 60_000);

  it("CANNOT read the same private repo without the scoped client (gating is real)", async () => {
    // The default server Octokit has no user token in this process, so GitHub hides the repo.
    await expect(
      fetchRepoSnapshot(`https://github.com/${PRIVATE_REPO}`),
    ).rejects.toThrow(/connect it to Proof/);
  }, 60_000);

  it("never pulls source file CONTENTS — only paths (the privacy claim)", async () => {
    const scoped = new Octokit({ auth: TOKEN });
    const snap = await fetchRepoSnapshot(`https://github.com/${PRIVATE_REPO}`, scoped);
    // fileTree entries are paths; none should contain code-ish payload (newlines/braces).
    const looksLikeCode = snap.fileTree.filter((p) => /[\n{};]/.test(p));
    expect(looksLikeCode).toEqual([]);
  }, 60_000);
});
