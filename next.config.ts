import type { NextConfig } from "next";

/**
 * Security headers.
 *
 * A beta user pointed out the session token is reachable from JavaScript, so any XSS hands over the
 * session. That is inherent to `@supabase/ssr`'s browser client: it writes its session cookie from
 * JS, so the cookie cannot be httpOnly without moving auth fully server-side. The honest mitigation
 * is to make XSS harder to land and cheaper to contain.
 *
 * A nonce-based Content-Security-Policy is the real fix and is deliberately NOT added here. Next's
 * inline bootstrap needs a per-request nonce through middleware, and shipping a strict policy
 * without exercising every page first is how you white-screen production. Tracked as follow-up.
 * Everything below cannot break rendering.
 */
const securityHeaders = [
  // Stop MIME sniffing turning a proxied file into executable script.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // No clickjacking of the studio or the record flow.
  { key: "X-Frame-Options", value: "DENY" },
  // Don't leak studio URLs (they carry brief/project ids) to third parties.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The teleprompter needs camera and mic, so allow self only and switch the rest off.
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
