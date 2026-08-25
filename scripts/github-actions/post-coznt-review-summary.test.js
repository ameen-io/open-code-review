#!/usr/bin/env node

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 alibaba/open-code-review Contributors

"use strict";

const assert = require("assert");
const {
  normalizeLevel,
  renderSummary,
  runPostCozntReviewSummary,
} = require("./post-coznt-review-summary.js");

assert.strictEqual(normalizeLevel("critical"), "High");
assert.strictEqual(normalizeLevel("high"), "High");
assert.strictEqual(normalizeLevel("medium"), "Moderate");
assert.strictEqual(normalizeLevel("low"), "Low");

const result = {
  llm: { model: "gpt-test" },
  summary: { files_reviewed: 3 },
  comments: [
    {
      path: "src/app.ts",
      start_line: 4,
      end_line: 6,
      severity: "high",
      content: "A high-impact problem.",
      existing_code: "const oldValue = true;",
      suggestion_code: "const newValue = false;",
    },
    { path: "src/mod.ts", start_line: 9, severity: "medium", content: "A moderate problem." },
    { path: "README.md", start_line: 2, severity: "low", content: "A low-impact problem." },
  ],
};

const body = renderSummary({
  parsed: { succeeded: true, error: "", result },
  reviewedFiles: ["a", "b", "c"],
  fallbackModel: "fallback",
  runUrl: "https://example.test/run",
  title: "Coznt PR Review",
  marker: "<!-- coznt-pr-review -->",
});
assert.match(body, /## Coznt PR Review/);
assert.match(body, /\*\*Model:\*\* `gpt-test`/);
assert.match(body, /<summary><strong>High \(1\)<\/strong><\/summary>/);
assert.match(body, /<summary><strong>Moderate \(1\)<\/strong><\/summary>/);
assert.match(body, /<summary><strong>Low \(1\)<\/strong><\/summary>/);
assert.match(body, /\*\*Code\*\*[\s\S]*```typescript[\s\S]*const oldValue = true;/);
assert.match(body, /\*\*Suggested code\*\*[\s\S]*const newValue = false;/);

async function testPosting() {
  const created = [];
  const updated = [];
  const github = {
    paginate: async () => [],
    rest: {
      issues: {
        listComments: async () => ({ data: [] }),
        createComment: async (args) => created.push(args),
        updateComment: async (args) => updated.push(args),
      },
    },
  };
  const fs = {
    readFileSync(file) {
      if (file === "/result.json") return JSON.stringify(result);
      if (file === "/files.txt") return "a\nb\nc\n";
      throw new Error(`Unexpected file: ${file}`);
    },
  };
  await runPostCozntReviewSummary({
    github,
    context: { repo: { owner: "owner", repo: "repo" }, issue: { number: 7 }, payload: {} },
    core: { info() {} },
    fs,
    resultPath: "/result.json",
    reviewedFilesPath: "/files.txt",
  });
  assert.strictEqual(created.length, 1);
  assert.strictEqual(updated.length, 0);
  assert.match(created[0].body, /^<!-- coznt-pr-review -->/);
}

testPosting().then(() => {
  process.stdout.write("post-coznt-review-summary tests passed\n");
}).catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
