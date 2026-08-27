#!/usr/bin/env node

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 alibaba/open-code-review Contributors

"use strict";

const assert = require("assert");
const {
  MAX_CONTEXT_CHARACTERS,
  cleanWarning,
  validateBundle,
  fetchCozntReviewContext,
} = require("./fetch-coznt-review-context.js");

const manifest = {
  plan: { id: "plan-1", kind: "spec", title: "SSO", version: 2 },
  artifacts: [{
    artifactId: "123e4567-e89b-12d3-a456-426614174000",
    file: "requirements.md",
    hashPrefix: "0123456789ab",
    sourceState: "current",
  }],
};

assert.strictEqual(cleanWarning("line\n::warning:: injected"), "line : :warning: : injected");
assert.strictEqual(validateBundle({ version: 1, status: "ready", warnings: [], manifest, markdown: "x".repeat(MAX_CONTEXT_CHARACTERS) }).status, "ready");
assert.throws(
  () => validateBundle({ version: 1, status: "ready", warnings: [], manifest, markdown: "x".repeat(MAX_CONTEXT_CHARACTERS + 1) }),
  /exceeds/,
);
assert.strictEqual(validateBundle({ version: 1, status: "ready", warnings: [], manifest, markdown: "😀" }).markdown, "😀");

async function testFetch() {
  const writes = new Map();
  const outputs = new Map();
  const warnings = [];
  const bundle = {
    version: 1,
    status: "partial",
    contextHash: "a".repeat(64),
    warnings: ["requirements.md changed"],
    manifest: {
      ...manifest,
      plan: { ...manifest.plan, excerpt: "MUST NOT LEAK" },
      artifacts: [{ ...manifest.artifacts[0], excerpt: "MUST NOT LEAK" }],
    },
    markdown: "PRIVATE EXCERPT",
  };
  await fetchCozntReviewContext({
    fetchImpl: async (_url, options) => {
      assert.strictEqual(options.headers["x-coznt-api-key"], "secret-key");
      return { ok: true, json: async () => bundle };
    },
    fs: { writeFileSync: (path, body) => writes.set(path, body) },
    core: {
      setOutput: (key, value) => outputs.set(key, value),
      warning: (value) => warnings.push(value),
    },
    baseUrl: "https://coznt.example",
    apiKey: "secret-key",
    repository: "acme/app",
    pullNumber: "42",
    headSha: "a".repeat(40),
    backgroundPath: "/tmp/background.md",
    manifestPath: "/tmp/manifest.json",
  });

  assert.strictEqual(writes.get("/tmp/background.md"), "PRIVATE EXCERPT");
  assert.ok(!writes.get("/tmp/manifest.json").includes("PRIVATE EXCERPT"));
  assert.ok(!writes.get("/tmp/manifest.json").includes("MUST NOT LEAK"));
  assert.ok(!writes.get("/tmp/manifest.json").includes("secret-key"));
  assert.strictEqual(outputs.get("available"), "true");
  assert.deepStrictEqual(warnings, ["requirements.md changed"]);
}

async function testUnavailable() {
  const writes = new Map();
  const outputs = new Map();
  await fetchCozntReviewContext({
    fetchImpl: async () => ({ ok: true, json: async () => ({ version: 1, status: "unavailable", warnings: [], manifest }) }),
    fs: { writeFileSync: (path, body) => writes.set(path, body) },
    core: { setOutput: (key, value) => outputs.set(key, value), warning() {} },
    baseUrl: "https://coznt.example",
    apiKey: "secret-key",
    repository: "acme/app",
    pullNumber: "42",
    headSha: "a".repeat(40),
    backgroundPath: "/tmp/background.md",
    manifestPath: "/tmp/manifest.json",
  });
  assert.strictEqual(outputs.get("available"), "false");
  assert.strictEqual(writes.has("/tmp/background.md"), false);
  assert.strictEqual(writes.has("/tmp/manifest.json"), true);
}

Promise.all([testFetch(), testUnavailable()]).then(() => {
  process.stdout.write("fetch-coznt-review-context tests passed\n");
}).catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
