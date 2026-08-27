// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 alibaba/open-code-review Contributors

"use strict";

const MAX_CONTEXT_CHARACTERS = 32768;
const MAX_CONTEXT_BYTES = 1 << 20;
const STATES = new Set(["current", "changed", "missing", "offset_mismatch"]);

function cleanWarning(value) {
  return String(value ?? "")
    .replace(/[\r\n\x00-\x1f\x7f]/g, " ")
    .replace(/::/g, ": :")
    .trim()
    .slice(0, 500);
}

function validateManifest(value) {
  const plan = value?.plan;
  const artifacts = value?.artifacts;
  if (!plan || typeof plan.id !== "string" || typeof plan.kind !== "string"
    || typeof plan.title !== "string" || !Number.isInteger(plan.version)
    || !Array.isArray(artifacts)) {
    throw new Error("Coznt returned an invalid context manifest");
  }
  const cleanArtifacts = artifacts.map((artifact) => {
    if (!artifact || typeof artifact.artifactId !== "string" || typeof artifact.file !== "string"
      || !/^[a-f0-9]{12}$/.test(artifact.hashPrefix) || !STATES.has(artifact.sourceState)) {
      throw new Error("Coznt returned an invalid artifact manifest entry");
    }
    return {
      artifactId: artifact.artifactId,
      file: artifact.file,
      hashPrefix: artifact.hashPrefix,
      sourceState: artifact.sourceState,
    };
  });
  return {
    plan: { id: plan.id, kind: plan.kind, title: plan.title, version: plan.version },
    artifacts: cleanArtifacts,
  };
}

function validateBundle(value) {
  if (!value || value.version !== 1 || !["ready", "partial", "unavailable"].includes(value.status)
    || !Array.isArray(value.warnings)) {
    throw new Error("Coznt returned an unsupported review context bundle");
  }
  const manifest = validateManifest(value.manifest);
  const warnings = value.warnings.map(cleanWarning).filter(Boolean);
  if (value.status === "ready" || value.status === "partial") {
    if (typeof value.markdown !== "string" || !value.markdown.trim()) {
      throw new Error("Coznt returned available context without Markdown");
    }
    if (Array.from(value.markdown).length > MAX_CONTEXT_CHARACTERS
      || Buffer.byteLength(value.markdown, "utf8") > MAX_CONTEXT_BYTES) {
      throw new Error("Coznt review context exceeds the OCR input limits");
    }
  }
  return {
    version: 1,
    status: value.status,
    contextHash: typeof value.contextHash === "string" && /^[a-f0-9]{64}$/.test(value.contextHash)
      ? value.contextHash
      : undefined,
    markdown: value.markdown,
    warnings,
    manifest,
  };
}

async function fetchCozntReviewContext({ fetchImpl, fs, core, baseUrl, apiKey, repository, pullNumber, headSha, backgroundPath, manifestPath }) {
  if (!baseUrl || !apiKey || !repository || !pullNumber || !headSha) {
    throw new Error("Coznt context inputs are incomplete");
  }
  const url = new URL("/api/v1/ocr/review-context", baseUrl);
  url.searchParams.set("repository", repository);
  url.searchParams.set("pullNumber", String(pullNumber));
  url.searchParams.set("headSha", headSha);

  const response = await fetchImpl(url, {
    headers: { accept: "application/json", "x-coznt-api-key": apiKey },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Coznt context API returned HTTP ${response.status}`);
  const bundle = validateBundle(await response.json());
  const publicManifest = {
    version: bundle.version,
    status: bundle.status,
    contextHash: bundle.contextHash,
    warnings: bundle.warnings,
    manifest: bundle.manifest,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(publicManifest, null, 2)}\n`, { mode: 0o600 });

  const available = bundle.status !== "unavailable";
  if (available) fs.writeFileSync(backgroundPath, bundle.markdown, { mode: 0o600 });
  core.setOutput("available", String(available));
  core.setOutput("status", bundle.status);
  core.setOutput("background_path", available ? backgroundPath : "");
  core.setOutput("manifest_path", manifestPath);
  bundle.warnings.forEach((warning) => core.warning(warning));
  return bundle;
}

module.exports = {
  MAX_CONTEXT_CHARACTERS,
  cleanWarning,
  validateBundle,
  fetchCozntReviewContext,
};
