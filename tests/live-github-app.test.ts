/**
 * FULL end-to-end proof against a REAL GitHub App installation. Not part of CI.
 *
 * Exercises Proof's own code path exactly as production would:
 *   app private key -> app JWT -> installation token -> read a PRIVATE repo
 *
 * Run: GH_APP_CREDS=<path to creds json> npx vitest run tests/live-github-app.test.ts
 */
import { describe, expect, it, beforeAll } from "vitest";
import fs from "node:fs";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";

const CREDS_PATH = process.env.GH_APP_CREDS;
const LIVE = Boolean(CREDS_PATH && fs.existsSync(CREDS_PATH ?? ""));

let installationId: number;
let appId: string;
let pem: string;

beforeAll(async () => {
  if (!LIVE) return;
  const creds = JSON.parse(fs.readFileSync(CREDS_PATH!, "utf8"));
  appId = String(creds.id);
  pem = creds.pem;

  // Configure the module exactly as production env vars would.
  process.env.GITHUB_APP_ID = appId;
  process.env.GITHUB_APP_PRIVATE_KEY = pem;
  process.env.GITHUB_APP_SLUG = creds.slug;

  // Find the installation the user just created (app-level JWT auth).
  const appOctokit = new Octokit({ authStrategy: createAppAuth, auth: { appId, privateKey: pem } });
  const { data } = await appOctokit.apps.listInstallations();
  installationId = data[0]?.id;
  console.log(`\n--- REAL INSTALLATION ---\ninstallations: ${data.length}, id: ${installationId}, account: ${data[0]?.account?.login}`);
});

describe.skipIf(!LIVE)("live: real GitHub App installation", () => {
  it("githubAppConfigured() flips to true once the env vars exist", async () => {
    const { githubAppConfigured } = await import("@/lib/github-app");
    expect(githubAppConfigured()).toBe(true);
  });

  it("mints a REAL installation token and lists ONLY the granted private repos", async () => {
    const { listInstallationRepos } = await import("@/lib/github-app");
    const repos = await listInstallationRepos(installationId);
    console.log("granted private repos:", repos.map((r) => r.fullName));
    // Scoping is the whole privacy claim: we must see what was ticked, and nothing else.
    expect(repos.length).toBeGreaterThan(0);
    for (const r of repos) expect(r.isPrivate).toBe(true);
  }, 60_000);

  it("reads a PRIVATE repo end to end through the installation token", async () => {
    const { installationOctokit, listInstallationRepos } = await import("@/lib/github-app");
    const { fetchRepoSnapshot } = await import("@/lib/github");

    const repos = await listInstallationRepos(installationId);
    const target = repos[0];
    const client = installationOctokit(installationId);
    const snap = await fetchRepoSnapshot(`https://github.com/${target.fullName}`, client);

    console.log("\n--- PRIVATE REPO READ VIA INSTALLATION TOKEN ---");
    console.log("repo      :", target.fullName);
    console.log("languages :", snap.languages.join(", "));
    console.log("hasReadme :", snap.hasReadme);
    console.log("readmeLen :", snap.readme.length);
    console.log("filePaths :", snap.fileTree.length);

    expect(snap.name).toBeTruthy();
    expect(snap.fileTree.length).toBeGreaterThan(0);
  }, 60_000);

  it("installationCanAccess() gates a repo that was NOT granted", async () => {
    const { installationCanAccess } = await import("@/lib/github-app");
    const granted = await installationCanAccess(installationId, "AbhishekVulla", "LearnLoop");
    const notGranted = await installationCanAccess(installationId, "torvalds", "linux");
    console.log(`gate check -> granted repo: ${granted}, ungranted repo: ${notGranted}`);
    expect(notGranted).toBe(false);
  }, 60_000);
});
