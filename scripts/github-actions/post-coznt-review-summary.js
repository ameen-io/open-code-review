// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 alibaba/open-code-review Contributors

"use strict";

const SUMMARY_MARKER = "<!-- coznt-pr-review -->";
const LEVELS = ["High", "Moderate", "Low"];

function normalizeLevel(severity) {
  switch (String(severity || "").trim().toLowerCase()) {
    case "critical":
    case "high":
      return "High";
    case "medium":
    case "moderate":
      return "Moderate";
    default:
      return "Low";
  }
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/<!--/g, "&lt;!--")
    .replace(/-->/g, "--&gt;")
    .trim();
}

function validMarker(value) {
  const marker = String(value || "").trim();
  if (!/^<!-- [A-Za-z0-9][A-Za-z0-9:_-]* -->$/.test(marker)) {
    throw new Error("marker must be an HTML comment containing only letters, numbers, colons, underscores, or hyphens");
  }
  return marker;
}

function inlineCode(value) {
  return `\`${cleanText(value).replace(/\r?\n/g, " ").replace(/`/g, "'")}\``;
}

function languageForPath(filePath) {
  const name = String(filePath || "").toLowerCase();
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  const languages = {
    c: "c",
    cc: "cpp",
    cpp: "cpp",
    cs: "csharp",
    css: "css",
    go: "go",
    html: "html",
    java: "java",
    js: "javascript",
    json: "json",
    jsx: "jsx",
    kt: "kotlin",
    kts: "kotlin",
    md: "markdown",
    php: "php",
    py: "python",
    rb: "ruby",
    rs: "rust",
    sh: "bash",
    sql: "sql",
    swift: "swift",
    ts: "typescript",
    tsx: "tsx",
    vue: "vue",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
  };
  return languages[extension] || "text";
}

function fencedCode(value, language) {
  const content = String(value ?? "").trim();
  let fence = "```";
  while (content.includes(fence)) fence += "`";
  return `${fence}${language}\n${content}\n${fence}`;
}

function findingLine(finding) {
  const start = finding.start_line ?? finding.startLine;
  const end = finding.end_line ?? finding.endLine ?? finding.line;
  if (start && end && start !== end) return `${start}-${end}`;
  return String(end || start || finding.position || "n/a");
}

function renderFinding(finding, index) {
  const filePath = finding.path ?? finding.file ?? finding.filename ?? "unknown file";
  const content = cleanText(
    finding.content
      ?? finding.body
      ?? finding.text
      ?? finding.message
      ?? finding.description
      ?? "No summary returned.",
  );
  const lines = [
    `#### ${index}. ${inlineCode(filePath)}:${inlineCode(findingLine(finding))}`,
    "",
    "**Summary**",
    "",
    content,
  ];

  if (String(finding.existing_code ?? "").trim()) {
    lines.push(
      "",
      "**Code**",
      "",
      fencedCode(finding.existing_code, languageForPath(filePath)),
    );
  }
  if (String(finding.suggestion_code ?? "").trim()) {
    lines.push(
      "",
      "**Suggested code**",
      "",
      fencedCode(finding.suggestion_code, languageForPath(filePath)),
    );
  }

  return lines.join("\n");
}

function renderLevel(level, findings) {
  const lines = [
    "<details>",
    `<summary><strong>${level} (${findings.length})</strong></summary>`,
    "",
  ];
  if (findings.length === 0) {
    lines.push("No findings.");
  } else {
    findings.forEach((finding, index) => {
      if (index > 0) lines.push("", "---", "");
      lines.push(renderFinding(finding, index + 1));
    });
  }
  lines.push("", "</details>");
  return lines.join("\n");
}

function parseResult(fs, resultPath, reviewStatus, reviewError) {
  if (reviewStatus !== "success") {
    return { succeeded: false, error: cleanText(reviewError || "Reviewer did not complete."), result: null };
  }
  try {
    return { succeeded: true, error: "", result: JSON.parse(fs.readFileSync(resultPath, "utf8")) };
  } catch (error) {
    return { succeeded: false, error: `Could not parse OCR output: ${cleanText(error.message)}`, result: null };
  }
}

function readReviewedFiles(fs, reviewedFilesPath) {
  if (!reviewedFilesPath) return [];
  try {
    return fs.readFileSync(reviewedFilesPath, "utf8").split(/\r?\n/).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function readContextManifest(fs, contextManifestPath) {
  if (!contextManifestPath) return null;
  try {
    const value = JSON.parse(fs.readFileSync(contextManifestPath, "utf8"));
    if (!value?.manifest?.plan || !Array.isArray(value.manifest.artifacts)) return null;
    return value;
  } catch (_) {
    return null;
  }
}

function renderContextManifest(value) {
  if (!value) return "";
  const plan = value.manifest.plan;
  const artifacts = value.manifest.artifacts;
  const lines = [
    "### Review context",
    "",
    `- **Plan:** ${inlineCode(plan.id)} - ${cleanText(plan.title).replace(/\r?\n/g, " ")}`,
    `- **Context status:** ${inlineCode(value.status || "unknown")}`,
  ];
  if (artifacts.length) {
    lines.push("- **Artifacts:** " + artifacts.map((artifact) =>
      `${inlineCode(artifact.file)} (${inlineCode(artifact.hashPrefix)}, ${inlineCode(artifact.sourceState)})`
    ).join(", "));
  }
  const warnings = Array.isArray(value.warnings) ? value.warnings.map(cleanText).filter(Boolean) : [];
  if (warnings.length) lines.push("- **Warnings:** " + warnings.join(" "));
  return lines.join("\n");
}

function renderSummary({ parsed, reviewedFiles, contextManifest, fallbackModel, runUrl, title = "Coznt PR Review", marker = SUMMARY_MARKER }) {
  const result = parsed.result || {};
  const findings = Array.isArray(result.comments) ? result.comments : [];
  const groups = Object.fromEntries(LEVELS.map((level) => [level, []]));
  findings.forEach((finding) => groups[normalizeLevel(finding.severity)].push(finding));

  const model = result.llm?.model || fallbackModel || "Not configured";
  const filesReviewed = result.summary?.files_reviewed ?? reviewedFiles.length;
  const lines = [
    validMarker(marker),
    `## ${cleanText(title || "Coznt PR Review").replace(/\r?\n/g, " ")}`,
    "",
    `- **Review status:** ${parsed.succeeded ? "Succeeded" : "Failed"}`,
    `- **Model:** ${inlineCode(model)}`,
    `- **Files reviewed:** ${parsed.succeeded ? filesReviewed : "Unknown"}`,
    `- **Finding count:** ${parsed.succeeded ? findings.length : "Unknown"}`,
  ];

  if (!parsed.succeeded) {
    lines.push("", `**Error:** ${parsed.error}`);
  } else {
    LEVELS.forEach((level) => lines.push("", renderLevel(level, groups[level])));
  }
  const renderedContext = renderContextManifest(contextManifest);
  if (renderedContext) lines.push("", renderedContext);
  if (runUrl) lines.push("", `[Workflow run](${runUrl})`);
  return lines.join("\n");
}

async function runPostCozntReviewSummary({
  github,
  context,
  core,
  fs,
  title = "Coznt PR Review",
  marker = SUMMARY_MARKER,
  resultPath,
  reviewedFilesPath = "",
  contextManifestPath = "",
  reviewStatus = "success",
  reviewError = "",
  fallbackModel = "",
}) {
  const parsed = parseResult(fs, resultPath, reviewStatus, reviewError);
  const reviewedFiles = readReviewedFiles(fs, reviewedFilesPath);
  const contextManifest = readContextManifest(fs, contextManifestPath);
  const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : "";
  const stickyMarker = validMarker(marker);
  const body = renderSummary({ parsed, reviewedFiles, contextManifest, fallbackModel, runUrl, title, marker: stickyMarker });
  const prNumber = context.issue?.number ?? context.payload?.pull_request?.number;

  const comments = await github.paginate(github.rest.issues.listComments, {
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: prNumber,
    per_page: 100,
  });
  const existing = comments.find((comment) => comment.user?.type === "Bot"
    && String(comment.body || "").startsWith(stickyMarker));

  if (existing) {
    await github.rest.issues.updateComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      comment_id: existing.id,
      body,
    });
    core?.info?.(`Updated Coznt PR review comment ${existing.id}.`);
    return;
  }
  await github.rest.issues.createComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: prNumber,
    body,
  });
  core?.info?.("Created Coznt PR review comment.");
}

module.exports = {
  SUMMARY_MARKER,
  LEVELS,
  normalizeLevel,
  validMarker,
  languageForPath,
  fencedCode,
  findingLine,
  renderFinding,
  renderLevel,
  readContextManifest,
  renderContextManifest,
  renderSummary,
  runPostCozntReviewSummary,
};
