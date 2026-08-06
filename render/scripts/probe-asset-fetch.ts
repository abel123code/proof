/**
 * Downloads real assets through the worker's own pipeline, end to end.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co npx tsx scripts/probe-asset-fetch.ts [url...]
 *
 * The unit tests around `fetchAssetBytesWithDeps` inject a fake `request`, so they never execute
 * `pinnedHttpsRequest` or its DNS shim. That is exactly where a Node 22 incompatibility hid long
 * enough to break every premium asset download in production while the suite stayed green. This
 * probe exercises the real socket path, so a regression there shows up as a failed download rather
 * than as scenes quietly falling back to generic overlays.
 *
 * No credentials needed: the brand-assets bucket is public.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  allowedAssetHosts,
  assertDecodedRasterImage,
  fetchAssetBytes,
  MAX_ASSET_BYTES,
} from "../src/premium/asset-source.ts";

// `allowedAssetHosts()` reads process.env, so load render/.env when the var is not already set.
if (!process.env.SUPABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL) {
  try {
    const text = readFileSync(join(import.meta.dirname, "..", ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*(SUPABASE_URL|NEXT_PUBLIC_SUPABASE_URL)\s*=\s*(.+?)\s*$/);
      if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // fall through to the explicit error below
  }
}

const hosts = allowedAssetHosts();
if (!hosts.length) {
  console.error("set SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL first");
  process.exit(1);
}

const base = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
const DEFAULTS = ["1.jpg", "2.jpg", "3.png", "4.png", "deadlines-excel.jpg"].map(
  (n) => `${base}/storage/v1/object/public/brand-assets/e2e-assets-demo/${n}`,
);

const targets = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULTS;

console.log(`allowed hosts : ${hosts.join(", ")}`);
console.log(`size cap      : ${(MAX_ASSET_BYTES / 1e6).toFixed(1)} MB\n`);

let ok = 0;
for (const url of targets) {
  const name = url.split("/").pop() ?? url;
  try {
    const bytes = await fetchAssetBytes(url);
    await assertDecodedRasterImage(bytes);
    console.log(`  ok      ${name.padEnd(24)} ${(bytes.length / 1e6).toFixed(2)} MB`);
    ok += 1;
  } catch (err) {
    console.log(`  FAILED  ${name.padEnd(24)} ${err instanceof Error ? err.message : String(err)}`);
  }
}

// The guards matter as much as the download; a probe that only proves fetching would happily
// pass with the allowlist removed.
console.log("\nguards (each must refuse)");
const host = new URL(base).hostname;
for (const [label, bad] of [
  ["foreign host", "https://evil.example.com/a.png"],
  ["not https", `http://${host}/a.png`],
  ["link-local", "https://169.254.169.254/a.png"],
] as const) {
  try {
    await fetchAssetBytes(bad);
    console.log(`  NOT REFUSED  ${label}`);
    process.exitCode = 1;
  } catch (err) {
    console.log(`  refused      ${label.padEnd(14)} ${err instanceof Error ? err.message : ""}`);
  }
}

console.log(`\n${ok}/${targets.length} downloaded and decoded`);
if (ok !== targets.length) process.exitCode = 1;
