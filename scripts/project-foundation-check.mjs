import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFoundationVersion = "1.7.0";
const scriptPath = fileURLToPath(import.meta.url);
const rootPath = path.resolve(path.dirname(scriptPath), "..");
const errors = [];
const warnings = [];
let checks = 0;

const requiredFiles = [
  "README.md",
  "AGENTS.md",
  "PROJECT_PROFILE.json",
  "PROJECT_LOG.md",
  "HANDOFF.md",
  "FEATURE_READINESS.md",
  ".gitignore",
  ".env.example",
  ".editorconfig",
  ".gitattributes",
  ".codex/source-size-policy.json",
  "scripts/source-size-guard.mjs",
  "scripts/project-foundation-check.mjs",
];

function portable(value) {
  return String(value).replace(/\\/g, "/");
}

function read(relativePath) {
  return fs.readFileSync(path.join(rootPath, relativePath), "utf8");
}

function get(value, dottedPath) {
  return dottedPath.split(".").reduce((current, segment) => {
    if (current && typeof current === "object" && segment in current) {
      return current[segment];
    }
    return undefined;
  }, value);
}

for (const relativePath of requiredFiles) {
  if (!fs.existsSync(path.join(rootPath, relativePath))) {
    errors.push(`missing-file:${relativePath}`);
  }
}
checks += 1;

let profile;
try {
  profile = JSON.parse(read("PROJECT_PROFILE.json"));
} catch (error) {
  errors.push(
    `invalid-profile-json:${error instanceof Error ? error.message : String(error)}`,
  );
}

if (profile) {
  if (profile.foundationVersion !== currentFoundationVersion) {
    errors.push(
      `foundation-version:${profile.foundationVersion || "missing"} expected:${currentFoundationVersion}`,
    );
  }
  for (const field of [
    "projectName",
    "purpose",
    "projectMode",
    "runtimeMode",
    "executionMode",
    "controlProfile",
    "readinessLevel",
    "dataRisk",
    "deploymentContext.audience",
    "deploymentContext.networkExposure",
    "deploymentContext.trustedComputeBoundary",
    "deploymentContext.availabilityTarget",
    "deploymentContext.assuranceTarget",
    "sourceOfTruth.code.status",
    "sourceOfTruth.code.acceptedRef",
    "sourceOfTruth.code.recoveryPath",
    "sourceControlPolicy.localCommit",
    "sourceControlPolicy.createRemote",
    "sourceControlPolicy.push",
    "sourceControlPolicy.merge",
    "guardrails.sourceSizePolicy.changedCommand",
    "guardrails.contractRegistry",
    "operatingModel.validation.defaultCommand",
    "securityAndPrivacy.securityRequirements",
    "reproducibility.runtimeVersion",
  ]) {
    const value = get(profile, field);
    if (value === undefined || value === null || String(value).trim() === "") {
      errors.push(`missing-profile-field:${field}`);
    }
  }
  for (const field of [
    "deploymentContext.audience",
    "deploymentContext.networkExposure",
    "deploymentContext.trustedComputeBoundary",
    "deploymentContext.availabilityTarget",
    "deploymentContext.assuranceTarget",
    "operatingModel.validation.defaultCommand",
    "sourceOfTruth.runningRuntime",
    "sourceOfTruth.driftCheck",
    "sourceOfTruth.code.recoveryPath",
    "securityAndPrivacy.securityRequirements",
    "reproducibility.runtimeVersion",
  ]) {
    if (/\bTODO\b/i.test(String(get(profile, field) || ""))) {
      warnings.push(`decision-pending:${field}`);
    }
  }
  const profileRanks = {
    "personal-local": 0,
    "private-unattended": 1,
    "shared-packaged": 2,
    "hosted-public": 3,
  };
  if (!["throwaway", "durable", "production"].includes(profile.projectMode)) {
    errors.push(`invalid-project-mode:${profile.projectMode}`);
  }
  if (
    !["local", "packaged", "hosted", "hybrid", "not-applicable"].includes(
      profile.runtimeMode,
    )
  ) {
    errors.push(`invalid-runtime-mode:${profile.runtimeMode}`);
  }
  if (!["single-agent", "multi-agent"].includes(profile.agentMode)) {
    errors.push(`invalid-agent-mode:${profile.agentMode}`);
  }
  if (
    ![
      "unknown",
      "none",
      "low",
      "moderate",
      "high",
      "sensitive",
      "local-user-data",
    ].includes(profile.dataRisk)
  ) {
    errors.push(`invalid-data-risk:${profile.dataRisk}`);
  }
  let minimumProfile = "personal-local";
  if (
    profile.projectMode === "production" ||
    ["hosted", "hybrid"].includes(profile.runtimeMode)
  ) {
    minimumProfile = "hosted-public";
  } else if (
    profile.runtimeMode === "packaged" ||
    profile.agentMode === "multi-agent"
  ) {
    minimumProfile = "shared-packaged";
  } else if (["scheduled", "service"].includes(profile.executionMode)) {
    minimumProfile = "private-unattended";
  }
  if (!(profile.controlProfile in profileRanks)) {
    errors.push(`invalid-control-profile:${profile.controlProfile}`);
  } else if (
    profileRanks[profile.controlProfile] < profileRanks[minimumProfile]
  ) {
    errors.push(
      `control-profile-weaker-than-context:${profile.controlProfile} expected-at-least:${minimumProfile}`,
    );
  }
  if (
    ![
      "interactive",
      "one-shot",
      "scheduled",
      "service",
      "not-applicable",
    ].includes(profile.executionMode)
  ) {
    errors.push(`invalid-execution-mode:${profile.executionMode}`);
  }
  if (!["compact", "full"].includes(profile.readinessLevel)) {
    errors.push(`invalid-readiness-level:${profile.readinessLevel}`);
  } else if (
    profile.readinessLevel === "compact" &&
    (minimumProfile !== "personal-local" ||
      ["moderate", "high", "sensitive", "local-user-data"].includes(
        profile.dataRisk,
      ))
  ) {
    errors.push(`readiness-level-weaker-than-context:compact expected:full`);
  }
}
checks += 1;

for (const relativePath of requiredFiles.filter((item) =>
  /\.(?:md|json|mjs)$/.test(item),
)) {
  if (!fs.existsSync(path.join(rootPath, relativePath))) {
    continue;
  }
  if (/\{\{[A-Z0-9_]+\}\}/.test(read(relativePath))) {
    errors.push(`unresolved-template-token:${relativePath}`);
  }
}
checks += 1;

for (const relativePath of [
  "scripts/source-size-guard.mjs",
  "scripts/project-foundation-check.mjs",
]) {
  if (!fs.existsSync(path.join(rootPath, relativePath))) {
    continue;
  }
  const result = spawnSync(
    process.execPath,
    ["--check", path.join(rootPath, relativePath)],
    {
      cwd: rootPath,
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0) {
    errors.push(`script-parse:${relativePath}`);
  }
}
checks += 1;

if (profile?.agentMode === "multi-agent") {
  for (const relativePath of [
    "MULTI_AGENT.md",
    "scripts/agent-status.mjs",
    "scripts/start-agent-worktree.mjs",
    "logs/wip-claims/.gitkeep",
  ]) {
    if (!fs.existsSync(path.join(rootPath, relativePath))) {
      errors.push(`missing-multi-agent-file:${relativePath}`);
    }
  }
  const ignoreText = read(".gitignore");
  for (const line of [
    "!logs/",
    "logs/*",
    "!logs/wip-claims/",
    "logs/wip-claims/*",
    "!logs/wip-claims/.gitkeep",
  ]) {
    if (!ignoreText.split(/\r?\n/).includes(line)) {
      errors.push(`missing-ignore-rule:${line}`);
    }
  }
  try {
    const insideGit =
      execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
        cwd: rootPath,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() === "true";
    if (insideGit) {
      const ignored = spawnSync(
        "git",
        ["check-ignore", "-q", "--", "logs/wip-claims/.gitkeep"],
        {
          cwd: rootPath,
          windowsHide: true,
        },
      );
      if (ignored.status === 0) {
        errors.push("claim-directory-gitkeep-is-ignored");
      }
    }
  } catch {
    warnings.push("git-not-initialized");
  }
  checks += 1;
}

console.log(
  `PROJECT_FOUNDATION_CHECK_STATUS=${errors.length === 0 ? "complete" : "blocked"}`,
);
console.log(`PROJECT_FOUNDATION_CHECK_ROOT=${portable(rootPath)}`);
console.log(
  `PROJECT_FOUNDATION_CHECK_CURRENT_VERSION=${currentFoundationVersion}`,
);
console.log(
  `PROJECT_FOUNDATION_CHECK_VERSION=${profile?.foundationVersion || "unknown"}`,
);
console.log(`PROJECT_FOUNDATION_CHECKS=${checks}`);
console.log(`PROJECT_FOUNDATION_WARNINGS=${warnings.length}`);
console.log(`PROJECT_FOUNDATION_ERRORS=${errors.length}`);
for (const warning of warnings) {
  console.log(`PROJECT_FOUNDATION_WARNING=${warning}`);
}
for (const error of errors) {
  console.log(`PROJECT_FOUNDATION_ERROR=${error}`);
}

if (errors.length > 0) {
  process.exitCode = 2;
}
