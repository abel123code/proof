import { describe, expect, it, beforeAll } from "vitest";
import { decideInstallCallback } from "@/lib/github-app";

beforeAll(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
});

const base = {
  installationId: 123,
  stateUserId: null as string | null,
  sessionUserId: "user-a",
  profileHandle: "abhishekvulla" as string | null,
  installationOwner: "AbhishekVulla" as string | null,
};

describe("decideInstallCallback", () => {
  it("rejects a missing or nonsense installation id", () => {
    for (const id of [0, -1, NaN]) {
      expect(decideInstallCallback({ ...base, installationId: id }).ok).toBe(false);
      expect(decideInstallCallback({ ...base, installationId: id })).toMatchObject({
        reason: "missing_installation",
      });
    }
  });

  describe("path A: started from our button (signed state present)", () => {
    it("accepts when the state names the signed-in user", () => {
      expect(decideInstallCallback({ ...base, stateUserId: "user-a" })).toEqual({ ok: true });
    });

    it("rejects when the state names somebody else", () => {
      // A crafted link must not bind an attacker's installation to the victim's account.
      expect(decideInstallCallback({ ...base, stateUserId: "attacker" })).toMatchObject({
        ok: false,
        reason: "state_invalid",
      });
    });

    it("trusts the state without needing a handle or an owner lookup", () => {
      expect(
        decideInstallCallback({
          ...base,
          stateUserId: "user-a",
          profileHandle: null,
          installationOwner: null,
        }),
      ).toEqual({ ok: true });
    });
  });

  describe("path B: installed straight from github.com (no state)", () => {
    it("accepts when the installation belongs to the user's saved handle", () => {
      expect(decideInstallCallback(base)).toEqual({ ok: true });
    });

    it("is case insensitive and tolerates whitespace", () => {
      expect(
        decideInstallCallback({
          ...base,
          profileHandle: "  AbhishekVulla  ",
          installationOwner: "abhishekvulla",
        }),
      ).toEqual({ ok: true });
    });

    it("rejects when the installation belongs to a DIFFERENT account", () => {
      // The core protection on the stateless path.
      expect(
        decideInstallCallback({ ...base, installationOwner: "someone-else" }),
      ).toMatchObject({ ok: false, reason: "owner_mismatch" });
    });

    it("rejects when the owner could not be resolved at all", () => {
      expect(decideInstallCallback({ ...base, installationOwner: null })).toMatchObject({
        ok: false,
        reason: "owner_mismatch",
      });
    });

    it("asks the user to save a handle first when the profile has none", () => {
      expect(decideInstallCallback({ ...base, profileHandle: null })).toMatchObject({
        ok: false,
        reason: "set_handle_first",
      });
      expect(decideInstallCallback({ ...base, profileHandle: "   " })).toMatchObject({
        ok: false,
        reason: "set_handle_first",
      });
    });
  });
});
