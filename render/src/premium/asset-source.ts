import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import sharp from "sharp";

/**
 * Guards for the premium assets folder (`RenderBrief.assets.images`).
 *
 * These URLs are user-controlled (the app will let people attach screenshots/logos), and the
 * render worker fetches them server-side, so an unguarded fetch is a classic SSRF + local-file
 * read: `http://169.254.169.254/...` reaches cloud metadata, and a bare path like `/app/.env`
 * would be copied into the scene dir, embedded in the authored HTML, and composited into a
 * video the caller downloads — leaking OPENAI_API_KEY / SUPABASE_SERVICE_ROLE_KEY.
 *
 * Policy: https only, host on an allowlist, the host must not resolve to a private/link-local
 * address, no redirects, decoded-and-proven raster image, bounded in size. Crucially the socket
 * is PINNED to the address we validated: a plain `fetch()` re-resolves DNS, so an attacker's host
 * can answer the check with a public IP and the fetch with an internal one (DNS rebinding). We
 * resolve once and connect to that exact address.
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
const MAX_ASSET_PIXELS = 40_000_000;
const RASTER_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * Every non-globally-routable IPv4/IPv6 range an asset host must never resolve to. Uses the kernel
 * `BlockList` rather than string prefixes so it also covers ranges a regex misses — CGNAT
 * (100.64/10), benchmarking (198.18/15), 6to4 (2002::/16), NAT64 (64:ff9b::/96) and IPv6 forms.
 */
const NON_GLOBAL = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as Array<[string, number]>) {
  NON_GLOBAL.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64],
  ["2001::", 32], ["2001:2::", 48], ["2001:10::", 28], ["2001:20::", 28],
  ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fec0::", 10],
  ["fe80::", 10], ["ff00::", 8],
] as Array<[string, number]>) {
  NON_GLOBAL.addSubnet(network, prefix, "ipv6");
}

/**
 * Decode every asset; a content-type header and a `.png` extension do not prove the bytes are safe
 * raster content. Rejects SVG (script-bearing), polyglots, and content-type spoofing by actually
 * decoding to raw pixels with sharp.
 */
export async function assertDecodedRasterImage(bytes: Buffer, declaredType?: string): Promise<void> {
  const normalizedType = declaredType?.split(";", 1)[0].trim().toLowerCase();
  if (normalizedType && !RASTER_MIME_TYPES.has(normalizedType)) {
    throw new Error(`asset is not an accepted raster type (${normalizedType})`);
  }
  try {
    const image = sharp(bytes, { limitInputPixels: MAX_ASSET_PIXELS, failOn: "error" });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || !["png", "jpeg", "webp"].includes(metadata.format ?? "")) {
      throw new Error("decoded raster is not a PNG, JPEG, or WebP image");
    }
    await image.clone().raw().toBuffer();
  } catch (error) {
    if (error instanceof Error && /decoded raster/.test(error.message)) throw error;
    throw new Error("decoded raster validation failed");
  }
}

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
    return [
      new URL(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "").hostname.toLowerCase(),
    ];
  } catch {
    return [];
  }
}

/** Private / loopback / link-local / metadata ranges an asset host must never resolve to. */
export function isPrivateAddress(ip: string): boolean {
  const value = ip.toLowerCase();
  const family = isIP(value);
  if (family === 4) return NON_GLOBAL.check(value, "ipv4");
  if (family === 6) {
    // Unwrap IPv4-in-IPv6 (::ffff:1.2.3.4 and the hex form ::ffff:0102:0304) so a mapped
    // private v4 can't slip through the v6 check.
    const embeddedV4 = value.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
    if (embeddedV4) return isPrivateAddress(embeddedV4);
    const hexMapped = value.match(/^::(?:ffff(?::0)?:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMapped) {
      const high = Number.parseInt(hexMapped[1], 16);
      const low = Number.parseInt(hexMapped[2], 16);
      return isPrivateAddress(`${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`);
    }
    return NON_GLOBAL.check(value, "ipv6");
  }
  return true; // not a valid IP literal — treat as unsafe
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
    throw new Error(
      "no allowed asset hosts configured (set PREMIUM_ASSET_HOSTS, SUPABASE_URL, or NEXT_PUBLIC_SUPABASE_URL)",
    );
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

/** Injectable DNS + request so the pinning can be unit-tested without real sockets. */
export interface AssetFetchDeps {
  lookup: (hostname: string) => Promise<string[]>;
  request: (url: URL, pinnedAddress: string) => Promise<Response>;
}

/**
 * HTTPS request PINNED to a pre-validated address: `lookup` is overridden to always hand the socket
 * the address we already checked, closing the DNS-rebinding window that `fetch()` leaves open.
 * `servername`/`host` keep TLS + routing correct for the original hostname. `https.request` does not
 * follow redirects, so a 302 to an internal host simply returns a non-2xx and is rejected below.
 */
async function pinnedHttpsRequest(url: URL, pinnedAddress: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        servername: url.hostname,
        headers: { host: url.host },
        lookup: (_hostname, _options, callback) => callback(null, pinnedAddress, isIP(pinnedAddress)),
      },
      (response) => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
        }
        resolve(
          new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, {
            status: response.statusCode ?? 500,
            headers,
          }),
        );
      },
    );
    request.once("error", reject);
    request.end();
  });
}

const DEFAULT_FETCH_DEPS: AssetFetchDeps = {
  lookup: async (hostname) =>
    isIP(hostname) ? [hostname] : (await lookup(hostname, { all: true })).map(({ address }) => address),
  request: pinnedHttpsRequest,
};

/** Fetch a validated asset into memory. Rejects redirects, non-images, and oversized bodies. */
export async function fetchAssetBytes(src: string): Promise<Buffer> {
  return fetchAssetBytesWithDeps(src, allowedAssetHosts(), DEFAULT_FETCH_DEPS);
}

export async function fetchAssetBytesWithDeps(
  src: string,
  hosts: string[],
  deps: AssetFetchDeps,
): Promise<Buffer> {
  const url = validateAssetSource(src, hosts);
  // Resolve ONCE, reject private addresses, then pin the socket to the first survivor.
  const addresses = await deps.lookup(url.hostname).catch(() => {
    throw new Error(`asset host did not resolve: ${url.hostname}`);
  });
  if (!addresses.length) throw new Error(`asset host did not resolve: ${url.hostname}`);
  for (const address of addresses) {
    if (isPrivateAddress(address)) {
      throw new Error(`asset host resolves to a private address: ${url.hostname} -> ${address}`);
    }
  }

  const res = await deps.request(url, addresses[0]);
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`download failed (${res.status})`);
  }

  const type = res.headers.get("content-type") || "";
  if (!RASTER_MIME_TYPES.has(type.split(";", 1)[0].trim().toLowerCase())) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`asset is not an image (content-type: "${type}")`);
  }

  // A declared content-length lets us bail before reading a byte — but it's optional and can
  // lie, so it's only a fast path. readCapped() is what actually enforces the ceiling.
  const declared = Number(res.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > MAX_ASSET_BYTES) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`asset too large (${declared} > ${MAX_ASSET_BYTES} bytes)`);
  }
  if (!res.body) throw new Error("asset response had no body");
  const bytes = await readCapped(res.body, MAX_ASSET_BYTES);
  // Prove the bytes are a real raster image (not SVG/polyglot/spoofed) before they touch Chromium.
  await assertDecodedRasterImage(bytes, type);
  return bytes;
}
