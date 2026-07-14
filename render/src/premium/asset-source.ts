import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Guards for the premium assets folder (`RenderBrief.assets.images`).
 *
 * These URLs are user-controlled (the app will let people attach screenshots/logos), and the
 * render worker fetches them server-side, so an unguarded fetch is a classic SSRF + local-file
 * read: `http://169.254.169.254/...` reaches cloud metadata, and a bare path like `/app/.env`
 * would be copied into the scene dir, embedded in the authored HTML, and composited into a
 * video the caller downloads — leaking OPENAI_API_KEY / SUPABASE_SERVICE_ROLE_KEY.
 *
 * Policy: https only, host must be on an allowlist, the host must not resolve to a private or
 * link-local address, no redirects, must be an image, and bounded in size.
 */

const DEFAULT_MAX_ASSET_BYTES = 15_000_000;

/**
 * Parse the size cap defensively. `Number("15MB")` is NaN, and every `x > NaN` is false — so a
 * fat-fingered env value would silently DISABLE the limit rather than tighten it. Fail back to
 * the default on anything non-finite or non-positive.
 */
export function parseMaxAssetBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PREMIUM_MAX_ASSET_BYTES;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_ASSET_BYTES;
}

export const MAX_ASSET_BYTES = parseMaxAssetBytes();

/**
 * Read a response body with a hard byte ceiling, aborting mid-stream.
 *
 * Buffering first (`res.arrayBuffer()`) and checking the size after is useless as a defence: a
 * hostile host can chunked-stream gigabytes with no content-length and OOM the worker before the
 * check is ever reached. So cap as we read and cancel the stream the moment we cross the line.
 */
export async function readCapped(body: ReadableStream<Uint8Array>, max: number): Promise<Buffer> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new Error(`asset too large (exceeds ${max} bytes)`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * Hosts assets may be fetched from. Defaults to the Supabase project host (where the app
 * uploads user assets). Override/extend with PREMIUM_ASSET_HOSTS="a.com,b.com".
 */
export function allowedAssetHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  const explicit = (env.PREMIUM_ASSET_HOSTS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (explicit.length) return explicit;
  try {
    return [new URL(env.SUPABASE_URL || "").hostname.toLowerCase()];
  } catch {
    return [];
  }
}

/** Private / loopback / link-local / metadata ranges an asset host must never resolve to. */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^::ffff:/, ""); // unwrap IPv4-mapped IPv6
  if (v === "::1" || v.startsWith("127.") || v.startsWith("0.")) return true;
  if (v.startsWith("10.") || v.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(v)) return true;
  if (v.startsWith("169.254.")) return true; // link-local, incl. 169.254.169.254 metadata
  if (/^f[cd][0-9a-f]{2}:/.test(v)) return true; // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]:/.test(v)) return true; // fe80::/10 link-local
  return false;
}

/**
 * Validate an asset source WITHOUT touching the network (pure, so it's unit-testable).
 * Throws on anything that isn't an https URL on an allowlisted host.
 */
export function validateAssetSource(src: string, hosts: string[]): URL {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    // A bare path ("/app/.env", "../secrets") or "file://" lands here — never allowed.
    throw new Error(`asset must be an absolute https URL: ${String(src).slice(0, 80)}`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`asset must use https (got "${url.protocol}")`);
  }
  if (!hosts.length) {
    throw new Error("no allowed asset hosts configured (set PREMIUM_ASSET_HOSTS or SUPABASE_URL)");
  }
  if (!hosts.includes(url.hostname.toLowerCase())) {
    throw new Error(`asset host not allowed: ${url.hostname}`);
  }
  return url;
}

/** DNS-resolve the (already allowlisted) host and reject private/link-local addresses. */
export async function assertPublicHost(hostname: string): Promise<void> {
  const addrs = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true }).catch(() => {
        throw new Error(`asset host did not resolve: ${hostname}`);
      });
  for (const { address } of addrs) {
    if (isPrivateAddress(address)) {
      throw new Error(`asset host resolves to a private address: ${hostname} -> ${address}`);
    }
  }
}

/** Fetch a validated asset into memory. Rejects redirects, non-images, and oversized bodies. */
export async function fetchAssetBytes(src: string): Promise<Buffer> {
  const url = validateAssetSource(src, allowedAssetHosts());
  await assertPublicHost(url.hostname);

  // redirect:"error" — a 302 could bounce an allowlisted host to an internal one.
  const res = await fetch(url, { redirect: "error" });
  if (!res.ok) throw new Error(`download failed (${res.status})`);

  const type = res.headers.get("content-type") || "";
  if (!/^image\//i.test(type)) throw new Error(`asset is not an image (content-type: "${type}")`);

  // A declared content-length lets us bail before reading a byte — but it's optional and can
  // lie, so it's only a fast path. readCapped() is what actually enforces the ceiling.
  const declared = Number(res.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > MAX_ASSET_BYTES) {
    throw new Error(`asset too large (${declared} > ${MAX_ASSET_BYTES} bytes)`);
  }
  if (!res.body) throw new Error("asset response had no body");
  return readCapped(res.body, MAX_ASSET_BYTES);
}
