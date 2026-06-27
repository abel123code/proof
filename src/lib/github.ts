import { Octokit } from "@octokit/rest";
import { optionalEnv } from "@/lib/env";

let cached: Octokit | null = null;

function getOctokit(): Octokit {
  if (cached) return cached;
  // Token is optional: public repos work unauthenticated (lower rate limit).
  cached = new Octokit({ auth: optionalEnv("GITHUB_TOKEN") });
  return cached;
}

/** Parse "https://github.com/owner/repo(.git)" or "owner/repo" into parts. */
export function parseRepoUrl(input: string): { owner: string; repo: string } {
  const cleaned = input.trim().replace(/\.git$/, "");
  const match =
    cleaned.match(/github\.com[/:]([^/]+)\/([^/]+)/i) ??
    cleaned.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!match) throw new Error(`Could not parse a GitHub repo from: ${input}`);
  return { owner: match[1], repo: match[2] };
}

export interface RepoSnapshot {
  name: string;
  description: string | null;
  languages: string[];
  readme: string;
  /** Top-level + shallow file paths to convey structure (truncated). */
  fileTree: string[];
}

/** Pull repo-level context: metadata, languages, README, and a shallow file tree. */
export async function fetchRepoSnapshot(repoUrl: string): Promise<RepoSnapshot> {
  const { owner, repo } = parseRepoUrl(repoUrl);
  const gh = getOctokit();

  const { data: meta } = await gh.repos.get({ owner, repo });

  const { data: langs } = await gh.repos.listLanguages({ owner, repo });

  let readme = "";
  try {
    const { data } = await gh.repos.getReadme({ owner, repo });
    readme = Buffer.from(data.content, "base64").toString("utf8");
  } catch {
    readme = "(no README found)";
  }

  let fileTree: string[] = [];
  try {
    const { data: tree } = await gh.git.getTree({
      owner,
      repo,
      tree_sha: meta.default_branch,
      recursive: "true",
    });
    fileTree = tree.tree
      .map((t) => t.path ?? "")
      .filter(Boolean)
      // keep it shallow-ish and bounded so prompts stay small
      .filter((p) => p.split("/").length <= 3)
      .slice(0, 200);
  } catch {
    fileTree = [];
  }

  // README can be huge; cap it to keep token usage sane.
  const cappedReadme = readme.length > 12_000 ? readme.slice(0, 12_000) + "\n...(truncated)" : readme;

  return {
    name: meta.name,
    description: meta.description,
    languages: Object.keys(langs),
    readme: cappedReadme,
    fileTree,
  };
}
