import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolveWorkerSecurityConfiguration,
  workerRequestAuthorized,
} from "../src/server-auth.js";

test("no RENDER_TOKEN fails closed unless the explicit local-dev escape hatch is set", () => {
  // Production misconfig: no token, no escape hatch -> refuse to boot.
  assert.throws(() => resolveWorkerSecurityConfiguration({} as NodeJS.ProcessEnv), /RENDER_TOKEN is required/);

  // Escape hatch but a public bind is still refused.
  assert.throws(
    () =>
      resolveWorkerSecurityConfiguration({
        ALLOW_INSECURE_LOCAL_RENDER: "true",
        RENDER_HOST: "0.0.0.0",
      } as NodeJS.ProcessEnv),
    /loopback/,
  );

  // Escape hatch bound to loopback -> unauthenticated local dev (worker + /out open on loopback).
  const local = resolveWorkerSecurityConfiguration({
    ALLOW_INSECURE_LOCAL_RENDER: "true",
  } as NodeJS.ProcessEnv);
  assert.equal(local.allowUnauthenticated, true);
  assert.equal(local.host, "127.0.0.1");
});

test("a configured RENDER_TOKEN is the production posture: token required, public bind", () => {
  const prod = resolveWorkerSecurityConfiguration({ RENDER_TOKEN: "s3cret" } as NodeJS.ProcessEnv);
  assert.equal(prod.renderToken, "s3cret");
  assert.equal(prod.allowUnauthenticated, false);
  assert.equal(prod.host, "0.0.0.0");
});

test("workerRequestAuthorized is constant-time-exact and fails closed without a token", () => {
  // With a token, only the exact token passes.
  assert.equal(workerRequestAuthorized("s3cret", "s3cret"), true);
  assert.equal(workerRequestAuthorized("wrong", "s3cret"), false);
  assert.equal(workerRequestAuthorized("s3cre", "s3cret"), false); // length mismatch
  assert.equal(workerRequestAuthorized(undefined, "s3cret"), false);
  assert.equal(workerRequestAuthorized(123, "s3cret"), false);

  // Without a configured token, authorization follows the explicit allowUnauthenticated flag only.
  assert.equal(workerRequestAuthorized("anything", undefined), false);
  assert.equal(workerRequestAuthorized("anything", undefined, true), true);
});
