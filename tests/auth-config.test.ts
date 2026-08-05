import { describe, expect, it } from "vitest";
import { resolveAuthConfig } from "@/lib/auth-config";

const URL_ONLY = { url: "https://x.supabase.co", anonKey: undefined };
const BOTH = { url: "https://x.supabase.co", anonKey: "anon-key" };
const NEITHER = { url: undefined, anonKey: undefined };

describe("resolveAuthConfig", () => {
  it("enforces auth when both values are present", () => {
    expect(resolveAuthConfig(BOTH, "production")).toEqual({ mode: "enforce" });
    expect(resolveAuthConfig(BOTH, "development")).toEqual({ mode: "enforce" });
  });

  it("allows the dev identity only outside production when nothing is set", () => {
    expect(resolveAuthConfig(NEITHER, "development")).toEqual({ mode: "dev-open" });
    expect(resolveAuthConfig(NEITHER, "test")).toEqual({ mode: "dev-open" });
  });

  it("refuses to open up in production even with nothing set", () => {
    expect(resolveAuthConfig(NEITHER, "production")).toEqual({
      mode: "misconfigured",
      missing: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"],
    });
  });

  it("treats a half-configured environment as misconfigured, never as dev", () => {
    expect(resolveAuthConfig(URL_ONLY, "production")).toEqual({
      mode: "misconfigured",
      missing: ["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
    });
    expect(resolveAuthConfig(URL_ONLY, "development")).toEqual({
      mode: "misconfigured",
      missing: ["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
    });
  });

  it("treats an empty string as absent, not as configured", () => {
    expect(resolveAuthConfig({ url: "https://x.supabase.co", anonKey: "" }, "production")).toEqual({
      mode: "misconfigured",
      missing: ["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
    });
  });
});
