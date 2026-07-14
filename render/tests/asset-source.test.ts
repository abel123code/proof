import { test } from "node:test";
import assert from "node:assert/strict";

import {
  allowedAssetHosts,
  isPrivateAddress,
  validateAssetSource,
} from "../src/premium/asset-source.js";

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

test("allowedAssetHosts falls back to the Supabase host, and PREMIUM_ASSET_HOSTS overrides", () => {
  assert.deepEqual(
    allowedAssetHosts({ SUPABASE_URL: "https://abc123.supabase.co" } as NodeJS.ProcessEnv),
    ["abc123.supabase.co"],
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
