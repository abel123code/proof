import { Octokit } from "@octokit/rest";
import { optionalEnv } from "@/lib/env";

let cached: Octokit | null = null;

function getOctokit(): Octokit {
  if (cached) return cached;
  // Token is optional: public repos work unauthenticated (lower rate limit).
  cached = new Octokit({ auth: optionalEnv("GITHUB_TOKEN") });
  return cached;
}

/** Extract a bare GitHub username from a handle, profile URL, or "@name". */
export function parseUsername(input: string): string {
  const cleaned = input.trim().replace(/^@/, "");
  const fromUrl = cleaned.match(/github\.com\/([^/?#]+)/i);
  const name = (fromUrl ? fromUrl[1] : cleaned).trim();
  if (!/^[A-Za-z0-9-]{1,39}$/.test(name)) {
    throw new Error(`Could not parse a GitHub username from: ${input}`);
  }
  return name;
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
  /**
   * False when the repo has no README. The README is the main thing Proof reads, so a repo without
 * one yields a thin script, callers warn the user instead of silently under-delivering.
   */
  hasReadme: boolean;
  /** Top-level + shallow file paths to convey structure (truncated). */
  fileTree: string[];
}

/**
 * True when an Octokit error means "you are not allowed to see this" rather than "this is missing".
 *
 * GitHub answers **404, not 403**, for private resources the caller cannot see. A naive `catch {}`
 * therefore turns an auth failure into "(no README found)" and the pipeline cheerfully scripts a
 * video about an empty repo. Anything auth-shaped must be re-thrown.
 */
export function isAccessError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  return status === 401 || status === 403 || status === 404;
}

/**
 * Pull repo-level context: metadata, languages, README, and a shallow file tree.
 *
 * NOTE: this reads the README, language stats and file *paths* only, never source file contents.
 * The privacy claim shown to users in the connect UI depends on that staying true.
 *
 * `client` injects an installation-scoped Octokit for private repos; omitted, it uses the shared
 * server token, which can only see public repos.
 */
export async function fetchRepoSnapshot(repoUrl: string, client?: Octokit): Promise<RepoSnapshot> {
  const { owner, repo } = parseRepoUrl(repoUrl);
  const gh = client ?? getOctokit();

  // THIS is the call that fails when the repo is private or otherwise invisible, so the access
 // check belongs here, not on the README below. GitHub answers 404 (not 403) in that case, and
  // the raw error ("Not Found") gives the user nothing to act on.
  let meta;
  try {
    ({ data: meta } = await gh.repos.get({ owner, repo }));
  } catch (err) {
    if (isAccessError(err)) {
      throw new Error(
        `Cannot read ${owner}/${repo}. If it is private, connect it to Proof from the repo picker so GitHub can grant access.`,
      );
    }
    throw err;
  }

  const { data: langs } = await gh.repos.listLanguages({ owner, repo });

  let hasReadme = true;
  let readme = "";
  try {
    const { data } = await gh.repos.getReadme({ owner, repo });
    readme = Buffer.from(data.content, "base64").toString("utf8");
  } catch {
    hasReadme = false;
    // Access is already proven by repos.get above, so a failure here (including the 404 GitHub
    // returns for a repo with no README at all) genuinely means "no README". Degrade quietly.
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
    hasReadme,
    description: meta.description,
    languages: Object.keys(langs),
    readme: cappedReadme,
    fileTree,
  };
}

/** A public repo shown in the repo picker (lightweight - no README fetch). */
export interface PublicRepo {
  name: string;
  fullName: string;
  url: string;
  description: string | null;
  language: string | null;
  stars: number;
  pushedAt: string | null;
}

/**
 * List a user's public, owned (non-fork) repos, newest pushes first. Uses the
 * server Octokit (GITHUB_TOKEN), so no user token / extra OAuth scope is needed.
 */
export async function listUserRepos(input: string): Promise<PublicRepo[]> {
  const username = parseUsername(input);
  const gh = getOctokit();
  const { data: repos } = await gh.repos.listForUser({
    username,
    sort: "pushed",
    direction: "desc",
    per_page: 60,
    type: "owner",
  });
  return repos
    .filter((r) => !r.fork)
    .map((r) => ({
      name: r.name,
      fullName: r.full_name,
      url: r.html_url,
      description: r.description,
      language: r.language ?? null,
      stars: r.stargazers_count ?? 0,
      pushedAt: r.pushed_at ?? null,
    }));
}

/** One repo in an account-level snapshot (the builder's portfolio). */
export interface RepoSummary {
  name: string;
  url: string;
  description: string | null;
  language: string | null;
  stars: number;
  pushedAt: string | null;
  /** README excerpt for the most active repos only (kept small). */
  readme?: string;
}

/** Account-level builder snapshot: profile + most-active public repos. */
export interface UserSnapshot {
  username: string;
  name: string | null;
  bio: string | null;
  /** Most-active, non-fork public repos (newest pushes first). */
  repos: RepoSummary[];
}

/**
 * Pull an account-level snapshot for a GitHub user: their profile plus their
 * most recently active public repos (with READMEs for the top few). This is the
 * raw material for a "builder profile" - what this person actually ships.
 */
export async function fetchUserSnapshot(input: string): Promise<UserSnapshot> {
  const username = parseUsername(input);
  const gh = getOctokit();

  const { data: user } = await gh.users.getByUsername({ username });

  const { data: repos } = await gh.repos.listForUser({
    username,
    sort: "pushed",
    direction: "desc",
    per_page: 30,
    type: "owner",
  });

  // Keep real, substantive work: drop forks and empty repos, newest pushes first.
  const active = repos
    .filter((r) => !r.fork)
    .slice(0, 6);

  const summaries: RepoSummary[] = await Promise.all(
    active.map(async (r, i) => {
      let readme: string | undefined;
      // Only pull READMEs for the top ~3 to keep prompts (and rate limit) sane.
      if (i < 3) {
        try {
          const { data } = await gh.repos.getReadme({ owner: username, repo: r.name });
          const text = Buffer.from(data.content, "base64").toString("utf8");
          readme = text.length > 4_000 ? text.slice(0, 4_000) + "\n...(truncated)" : text;
        } catch {
          readme = undefined;
        }
      }
      return {
        name: r.name,
        url: r.html_url,
        description: r.description,
        language: r.language ?? null,
        stars: r.stargazers_count ?? 0,
        pushedAt: r.pushed_at ?? null,
        readme,
      };
    }),
  );

  return {
    username,
    name: user.name ?? null,
    bio: user.bio ?? null,
    repos: summaries,
  };
}
