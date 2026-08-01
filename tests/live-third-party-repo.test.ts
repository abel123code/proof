/**
 * LIVE proof that Proof can read a repo owned by SOMEBODY ELSE. Not part of CI.
 *   GH_LIVE=1 npx vitest run tests/live-third-party-repo.test.ts
 */
import { describe, expect, it } from "vitest";
import { listUserRepos, fetchRepoSnapshot } from "@/lib/github";

const LIVE = process.env.GH_LIVE === "1";

describe.skipIf(!LIVE)("live: third-party public repos", () => {
  it("lists a stranger's public repos", async () => {
    const repos = await listUserRepos("vercel");
    console.log(`\n--- listUserRepos("vercel") -> ${repos.length} repos ---`);
    console.log(repos.slice(0, 5).map((r) => r.fullName).join(", "));
    expect(repos.length).toBeGreaterThan(0);
    expect(repos[0].fullName.toLowerCase().startsWith("vercel/")).toBe(true);
  }, 60_000);

  it("reads a stranger's repo well enough to script a video", async () => {
    const snap = await fetchRepoSnapshot("https://github.com/vercel/swr");
    console.log("\n--- SNAPSHOT OF A REPO WE DO NOT OWN ---");
    console.log("name      :", snap.name);
    console.log("languages :", snap.languages.join(", "));
    console.log("hasReadme :", snap.hasReadme);
    console.log("readmeLen :", snap.readme.length);
    console.log("filePaths :", snap.fileTree.length);
    expect(snap.name).toBe("swr");
    expect(snap.hasReadme).toBe(true);
    expect(snap.readme.length).toBeGreaterThan(200);
    expect(snap.fileTree.length).toBeGreaterThan(0);
  }, 60_000);

  it("still refuses a repo that does not exist or is invisible", async () => {
    await expect(
      fetchRepoSnapshot("https://github.com/vercel/definitely-not-a-real-repo-xyz"),
    ).rejects.toThrow(/connect it to Proof/);
  }, 60_000);
});
