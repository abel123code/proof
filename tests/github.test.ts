import { describe, expect, it } from "vitest";
import { parseRepoUrl, parseUsername } from "@/lib/github";

describe("parseUsername", () => {
  it("strips a leading @", () => {
    expect(parseUsername("@octocat")).toBe("octocat");
  });

  it("extracts from a profile URL", () => {
    expect(parseUsername("https://github.com/octocat")).toBe("octocat");
  });

  it("accepts a bare handle", () => {
    expect(parseUsername("octocat")).toBe("octocat");
  });

  it("throws on an invalid handle", () => {
    expect(() => parseUsername("not a name")).toThrow();
    expect(() => parseUsername("")).toThrow();
  });
});

describe("parseRepoUrl", () => {
  it("parses a full https URL", () => {
    expect(parseRepoUrl("https://github.com/owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("strips a trailing .git", () => {
    expect(parseRepoUrl("https://github.com/owner/repo.git")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("parses the shorthand owner/repo form", () => {
    expect(parseRepoUrl("owner/repo")).toEqual({ owner: "owner", repo: "repo" });
  });

  it("parses an SSH-style remote", () => {
    expect(parseRepoUrl("git@github.com:owner/repo.git")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("ignores trailing path segments", () => {
    expect(parseRepoUrl("https://github.com/owner/repo/tree/main")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("throws when it cannot find a repo", () => {
    expect(() => parseRepoUrl("just-some-text")).toThrow();
  });
});
