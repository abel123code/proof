import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { resolveAuthConfig } from "@/lib/auth-config";

// Refreshes the Supabase session on every request and gates the studio routes.
// If nothing is configured (local / pre-OAuth), auth is a no-op. If only ONE of
// the two vars is present, that's a broken deploy, not a developer laptop: fail
// closed rather than serving the studio shell with no session check.

const PUBLIC_PREFIXES = ["/", "/login", "/pending", "/auth"];

export function isPublic(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some((p) => p !== "/" && pathname.startsWith(p));
}

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authConfig = resolveAuthConfig({ url, anonKey: anon }, process.env.NODE_ENV);

  // Auth disabled (developer laptop): pass everything through untouched.
  if (authConfig.mode === "dev-open") return NextResponse.next({ request });

  // Half-configured deploy: fail closed. Public routes still render so the
  // landing page and /login itself stay reachable; everything else redirects to
  // /login instead of silently serving the studio shell with no session check.
  //
  // Skip the redirect for /api/* : those routes self-gate via requireApprovedUser
  // / requireAdmin, which now returns a 503 for this same misconfigured state, and
  // redirecting a fetch() to /login is worse than useless — fetch follows it, the
  // caller gets the login HTML back with status 200, and res.json() throws a parse
  // error instead of surfacing the handler's "sign-in unavailable" response.
  if (authConfig.mode === "misconfigured") {
    const { pathname } = request.nextUrl;
    if (isPublic(pathname) || pathname.startsWith("/api")) {
      return NextResponse.next({ request });
    }
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/login";
    redirect.searchParams.set("next", pathname);
    return NextResponse.redirect(redirect);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url!, anon!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Not signed in -> login.
  if (!user && !isPublic(pathname)) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/login";
    redirect.searchParams.set("next", pathname);
    return NextResponse.redirect(redirect);
  }

  // Signed in but not yet approved (no profile row) -> waitlist. Without this a
  // pending user has a valid session and could open /connect directly. The
  // "own profile" RLS policy lets the user read only their own row here.
  //
  // Skip this DB lookup for /api/* : those routes self-gate via
  // requireApprovedUser, and redirecting a fetch() to /pending is useless. This
  // removes one Supabase round-trip from every API call.
  if (user && !isPublic(pathname) && !pathname.startsWith("/api")) {
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    // Fail open on a lookup error (API routes still enforce approval); only
    // redirect when we definitively know there's no profile.
    if (!profileErr && !profile) {
      const redirect = request.nextUrl.clone();
      redirect.pathname = "/pending";
      redirect.search = "";
      redirect.searchParams.set("status", "pending");
      return NextResponse.redirect(redirect);
    }
  }

  return response;
}

export const config = {
  matcher: [
    // Run on everything except static assets and the Next internals.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|mp4|ico)$).*)",
  ],
};
