import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

/**
 * Proves the route proxy shares the same three-state auth posture as the API
 * gates in src/lib/auth.ts, rather than keeping its own independent fail-open
 * check on the two env vars. A half-configured deploy (one var present, one
 * missing) must not serve the studio shell to an unauthenticated caller.
 */

const ORIGINAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ORIGINAL_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function setEnv(url: string | undefined, anon: string | undefined, nodeEnv: string | undefined) {
  if (url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = url;

  if (anon === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anon;

  if (nodeEnv === undefined) delete (process.env as { NODE_ENV?: string }).NODE_ENV;
  else (process.env as { NODE_ENV?: string }).NODE_ENV = nodeEnv;
}

afterEach(() => {
  setEnv(ORIGINAL_URL, ORIGINAL_ANON, ORIGINAL_NODE_ENV);
});

describe("proxy (misconfigured auth)", () => {
  beforeEach(() => {
    // One var present, one missing, and a NODE_ENV that must never unlock dev-open.
    setEnv("https://x.supabase.co", undefined, "production");
  });

  it("does not pass a non-public route through untouched", async () => {
    const request = new NextRequest("http://localhost/connect");
    const response = await proxy(request);
    // A silent pass-through would come back as a plain NextResponse.next() with no
    // redirect Location header. That is the exact bug being closed here.
    expect(response.headers.get("location")).toBeTruthy();
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
  });

  it("still renders public routes", async () => {
    const request = new NextRequest("http://localhost/login");
    const response = await proxy(request);
    expect(response.headers.get("location")).toBeFalsy();
  });

  it("lets /api/* through so the route handler can answer with a 503", async () => {
    // Redirecting a fetch() to /login is worse than useless: fetch follows it,
    // the caller gets the login HTML with status 200, and res.json() throws a
    // parse error instead of surfacing the handler's "sign-in unavailable" 503.
    const request = new NextRequest("http://localhost/api/render");
    const response = await proxy(request);
    expect(response.headers.get("location")).toBeFalsy();
  });
});
