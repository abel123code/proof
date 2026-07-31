import { describe, expect, it, beforeEach } from "vitest";
import {
  allowRepoList,
  withRepoListCache,
  __resetRepoListGuard,
  REPO_LIST_MAX_PER_WINDOW,
  REPO_LIST_WINDOW_MS,
  REPO_LIST_CACHE_TTL_MS,
} from "@/lib/repo-list-guard";

beforeEach(() => __resetRepoListGuard());

describe("withRepoListCache", () => {
  it("only hits GitHub once per handle inside the TTL", async () => {
    let calls = 0;
    const load = async () => {
      calls += 1;
      return ["repo"];
    };
    const t = 1_000_000;
    expect(await withRepoListCache("abhi", t, load)).toEqual(["repo"]);
    expect(await withRepoListCache("abhi", t + 1000, load)).toEqual(["repo"]);
    expect(await withRepoListCache("abhi", t + 30_000, load)).toEqual(["repo"]);
    // This is the actual quota protection: three lookups, one GitHub call.
    expect(calls).toBe(1);
  });

  it("refetches once the entry expires", async () => {
    let calls = 0;
    const load = async () => {
      calls += 1;
      return [calls];
    };
    const t = 2_000_000;
    await withRepoListCache("abhi", t, load);
    await withRepoListCache("abhi", t + REPO_LIST_CACHE_TTL_MS + 1, load);
    expect(calls).toBe(2);
  });

  it("keeps handles separate", async () => {
    const t = 3_000_000;
    await withRepoListCache("a", t, async () => ["a-repo"]);
    expect(await withRepoListCache("b", t, async () => ["b-repo"])).toEqual(["b-repo"]);
    expect(await withRepoListCache("a", t, async () => ["changed"])).toEqual(["a-repo"]);
  });
});

describe("allowRepoList", () => {
  it("permits normal use and blocks a runaway loop", () => {
    const t = 4_000_000;
    for (let i = 0; i < REPO_LIST_MAX_PER_WINDOW; i++) {
      expect(allowRepoList("user-a", t + i)).toBe(true);
    }
    // The failure mode this exists for: a client looping on the endpoint.
    expect(allowRepoList("user-a", t + REPO_LIST_MAX_PER_WINDOW)).toBe(false);
  });

  it("does not let one user's burst block anybody else", () => {
    const t = 5_000_000;
    for (let i = 0; i < REPO_LIST_MAX_PER_WINDOW + 5; i++) allowRepoList("noisy", t + i);
    expect(allowRepoList("noisy", t + 100)).toBe(false);
    expect(allowRepoList("quiet", t + 100)).toBe(true);
  });

  it("recovers once the window slides past", () => {
    const t = 6_000_000;
    for (let i = 0; i < REPO_LIST_MAX_PER_WINDOW; i++) allowRepoList("user-b", t + i);
    expect(allowRepoList("user-b", t + 100)).toBe(false);
    expect(allowRepoList("user-b", t + REPO_LIST_WINDOW_MS + 1000)).toBe(true);
  });
});
