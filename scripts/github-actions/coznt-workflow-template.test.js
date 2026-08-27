#!/usr/bin/env node

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 alibaba/open-code-review Contributors

"use strict";

const assert = require("assert");
const fs = require("fs");

const workflow = fs.readFileSync("examples/github_actions/coznt-artifact-aware-review.yml", "utf8");

assert.match(workflow, /pull_request_target:/);
assert.match(workflow, /if: github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
assert.match(workflow, /git fetch --no-tags origin/);
assert.doesNotMatch(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
assert.match(workflow, /coznt_api_key: \$\{\{ secrets\.COZNT_API_KEY \}\}/);
assert.match(workflow, /\$GITHUB_WORKSPACE:\/repo:ro/);
assert.match(workflow, /\$BACKGROUND_PATH:\/run\/coznt\/background\.md:ro/);
assert.match(workflow, /--background-file \/run\/coznt\/background\.md/);
assert.match(workflow, /ghcr\.io\/ameen-io\/ocr-reviewer:v1\.10\.0/);
assert.match(workflow, /git config --global --add safe\.directory \/repo/);
assert.match(workflow, /Coznt review context unavailable; running diff-only/);
assert.match(workflow, /name: Delete temporary review context\s+if: always\(\)/);
assert.doesNotMatch(workflow, /echo[^\n]*(COZNT_API_KEY|coznt_api_key)/);

process.stdout.write("coznt workflow template tests passed\n");
