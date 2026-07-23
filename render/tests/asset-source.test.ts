import { test } from "node:test";
import assert from "node:assert/strict";

import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import {
  allowedAssetHosts,
  assertDecodedRasterImage,
  fetchAssetBytesWithDeps,
  isPrivateAddress,
  nodeResponseToWebResponse,
  parseMaxAssetBytes,
  readCapped,
  validateAssetSource,
  type AssetFetchDeps,
} from "../src/premium/asset-source.js";

/** A minimal IncomingMessage stand-in for the response converter. */
function fakeIncoming(statusCode: number, chunks: Buffer[] = []): IncomingMessage {
  return Object.assign(Readable.from(chunks), { statusCode, headers: {} }) as unknown as IncomingMessage;
}

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

test("fetchAssetBytesWithDeps cancels response bodies for every pre-stream rejection", async () => {
  const responseInits: ResponseInit[] = [
    { status: 500, headers: { "content-type": "image/png" } }, // bad status
    { status: 200, headers: { "content-type": "text/plain" } }, // non-image
    { status: 200, headers: { "content-type": "image/png", "content-length": "15000001" } }, // too large
  ];
  for (const responseInit of responseInits) {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() {
        cancelled = true;
      },
    });
    const deps: AssetFetchDeps = {
      lookup: async () => ["93.184.216.34"], // public
      request: async () => new Response(body, responseInit),
    };
    await assert.rejects(() => fetchAssetBytesWithDeps("https://cdn.example.com/a.png", ["cdn.example.com"], deps));
    assert.equal(cancelled, true, `body was not cancelled for status ${responseInit.status}`);
  }
});

test("fetchAssetBytesWithDeps pins to the validated address and blocks a private DNS resolution (rebinding)", async () => {
  // A host that resolves to a private/metadata address is rejected BEFORE any socket is opened.
  let requested = false;
  const rebind: AssetFetchDeps = {
    lookup: async () => ["169.254.169.254"],
    request: async () => {
      requested = true;
      return new Response(new Uint8Array());
    },
  };
  await assert.rejects(
    () => fetchAssetBytesWithDeps("https://cdn.example.com/a.png", ["cdn.example.com"], rebind),
    /private address/,
  );
  assert.equal(requested, false, "must not open a socket to a host that resolves private");

  // A public resolution pins the socket to exactly that address (closing the fetch() re-resolve window).
  let pinnedTo = "";
  const pinned: AssetFetchDeps = {
    lookup: async () => ["93.184.216.34"],
    request: async (_url, addr) => {
      pinnedTo = addr;
      return new Response(new Uint8Array(), { status: 500 });
    },
  };
  await assert.rejects(() => fetchAssetBytesWithDeps("https://cdn.example.com/a.png", ["cdn.example.com"], pinned));
  assert.equal(pinnedTo, "93.184.216.34", "the socket is pinned to the validated address");
});

test("isPrivateAddress catches ranges a naive regex misses", () => {
  assert.equal(isPrivateAddress("100.64.0.1"), true, "CGNAT 100.64/10");
  assert.equal(isPrivateAddress("198.18.0.1"), true, "benchmarking 198.18/15");
  assert.equal(isPrivateAddress("2002:c0a8:0101::1"), true, "6to4");
  assert.equal(isPrivateAddress("64:ff9b::7f00:1"), true, "NAT64 of 127.0.0.1");
  assert.equal(isPrivateAddress("::ffff:169.254.169.254"), true, "IPv4-mapped metadata");
  assert.equal(isPrivateAddress("not-an-ip"), true, "non-IP literal is unsafe");
  assert.equal(isPrivateAddress("93.184.216.34"), false, "a real public host still passes");
});

test("nodeResponseToWebResponse gives null-body statuses a null body (no worker crash)", () => {
  // `new Response(body, {status: 204})` throws — the source of the DoS codex flagged. These must
  // convert to a null-body Response instead of throwing inside the async request callback.
  for (const status of [204, 205, 304]) {
    const resp = nodeResponseToWebResponse(fakeIncoming(status, [Buffer.from([1])]));
    assert.equal(resp.status, status);
    assert.equal(resp.body, null, `status ${status} must have a null body`);
  }
  // a normal 200 keeps its streamed body
  const ok = nodeResponseToWebResponse(fakeIncoming(200, [Buffer.from([1, 2, 3])]));
  assert.equal(ok.status, 200);
  assert.ok(ok.body, "200 keeps its body");
});

test("assertDecodedRasterImage rejects SVG, spoofed types, and garbage bytes", async () => {
  await assert.rejects(
    () => assertDecodedRasterImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"), "image/png"),
    /decoded raster/,
    "an SVG declared as png must be rejected after decode",
  );
  await assert.rejects(
    () => assertDecodedRasterImage(Buffer.from("x"), "image/svg+xml"),
    /not an accepted raster type/,
    "a non-raster declared type is rejected before decode",
  );
  await assert.rejects(() => assertDecodedRasterImage(Buffer.from("not an image at all")), /decoded raster/);
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
