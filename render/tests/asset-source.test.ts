import { test } from "node:test";
import assert from "node:assert/strict";

import {
  allowedAssetHosts,
  isPrivateAddress,
  parseMaxAssetBytes,
  readCapped,
  validateAssetSource,
} from "../src/premium/asset-source.js";

/** A body that streams `chunks` of `size` bytes — like a host ignoring content-length. */
function streamOf(chunkSize: number, chunks: number): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (sent++ >= chunks) return c.close();
      c.enqueue(new Uint8Array(chunkSize));
    },
  });
}

const HOSTS = ["cdn.example.com"];

test("validateAssetSource rejects bare filesystem paths (local-file read)", () => {
  // The old code copied any non-http string straight in -> /app/.env into the video.
  // Note "C:\..." actually parses as a URL with protocol "c:", so it's caught by the
  // https check rather than the parse check — either way it must be rejected.
  for (const bad of ["/app/.env", "/etc/passwd", "../../secrets.txt", "C:\\Windows\\win.ini"]) {
    assert.throws(
      () => validateAssetSource(bad, HOSTS),
      /absolute https URL|must use https/,
      `should have been rejected: ${bad}`,
    );
  }
});

test("validateAssetSource rejects file:// and non-https schemes", () => {
  assert.throws(() => validateAssetSource("file:///app/.env", HOSTS), /https/);
  assert.throws(() => validateAssetSource("http://cdn.example.com/a.png", HOSTS), /https/);
  assert.throws(() => validateAssetSource("ftp://cdn.example.com/a.png", HOSTS), /https/);
});

test("validateAssetSource rejects hosts that aren't allowlisted (SSRF)", () => {
  assert.throws(
    () => validateAssetSource("https://169.254.169.254/latest/meta-data/", HOSTS),
    /host not allowed/,
  );
  assert.throws(() => validateAssetSource("https://internal.svc/secret", HOSTS), /host not allowed/);
  assert.throws(() => validateAssetSource("https://evil.example.com/a.png", HOSTS), /host not allowed/);
});

test("validateAssetSource fails closed when no hosts are configured", () => {
  assert.throws(() => validateAssetSource("https://cdn.example.com/a.png", []), /no allowed asset hosts/);
});

test("validateAssetSource accepts an allowlisted https asset", () => {
  const url = validateAssetSource("https://cdn.example.com/logo.png?v=2", HOSTS);
  assert.equal(url.hostname, "cdn.example.com");
});

test("isPrivateAddress catches loopback, private, link-local and metadata ranges", () => {
  for (const ip of [
    "127.0.0.1",
    "::1",
    "10.0.0.5",
    "192.168.1.10",
    "172.16.0.1",
    "172.31.255.255",
    "169.254.169.254", // cloud metadata
    "0.0.0.0",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1", // IPv4-mapped loopback
  ]) {
    assert.equal(isPrivateAddress(ip), true, `should be private: ${ip}`);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700::1111"]) {
    assert.equal(isPrivateAddress(ip), false, `should be public: ${ip}`);
  }
});

test("parseMaxAssetBytes never returns NaN (a bad env value must not disable the cap)", () => {
  // Number("15MB") is NaN, and `bytes > NaN` is false -> the limit would silently switch off.
  assert.equal(parseMaxAssetBytes({ PREMIUM_MAX_ASSET_BYTES: "15MB" } as NodeJS.ProcessEnv), 15_000_000);
  assert.equal(parseMaxAssetBytes({ PREMIUM_MAX_ASSET_BYTES: "" } as NodeJS.ProcessEnv), 15_000_000);
  assert.equal(parseMaxAssetBytes({ PREMIUM_MAX_ASSET_BYTES: "0" } as NodeJS.ProcessEnv), 15_000_000);
  assert.equal(parseMaxAssetBytes({ PREMIUM_MAX_ASSET_BYTES: "-5" } as NodeJS.ProcessEnv), 15_000_000);
  assert.equal(parseMaxAssetBytes({} as NodeJS.ProcessEnv), 15_000_000);
  assert.equal(parseMaxAssetBytes({ PREMIUM_MAX_ASSET_BYTES: "500" } as NodeJS.ProcessEnv), 500);
});

test("readCapped returns bodies under the cap", async () => {
  const buf = await readCapped(streamOf(100, 5), 1000); // 500 bytes
  assert.equal(buf.byteLength, 500);
});

test("readCapped aborts a body that streams past the cap (memory-exhaustion DoS)", async () => {
  // A hostile host that ignores content-length and just keeps sending.
  await assert.rejects(() => readCapped(streamOf(1000, 1000), 5000), /asset too large/);
});

test("allowedAssetHosts falls back to the Supabase host, and PREMIUM_ASSET_HOSTS overrides", () => {
  assert.deepEqual(
    allowedAssetHosts({ SUPABASE_URL: "https://abc123.supabase.co" } as NodeJS.ProcessEnv),
    ["abc123.supabase.co"],
  );
  assert.deepEqual(
    allowedAssetHosts({
      NEXT_PUBLIC_SUPABASE_URL: "https://public-ref.supabase.co",
    } as NodeJS.ProcessEnv),
    ["public-ref.supabase.co"],
  );
  assert.deepEqual(
    allowedAssetHosts({
      SUPABASE_URL: "https://abc123.supabase.co",
      PREMIUM_ASSET_HOSTS: "cdn.example.com, images.example.org",
    } as NodeJS.ProcessEnv),
    ["cdn.example.com", "images.example.org"],
  );
  assert.deepEqual(allowedAssetHosts({} as NodeJS.ProcessEnv), []);
});
