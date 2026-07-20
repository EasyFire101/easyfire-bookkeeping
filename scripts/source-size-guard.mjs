#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const defaultSourceFiles = {
  basenames: [
    "dockerfile",
    "containerfile",
    "makefile",
    "justfile",
    "rakefile",
    "gemfile",
  ],
  extensions: [
    ".astro",
    ".bash",
    ".bat",
    ".bicep",
    ".cjs",
    ".cmd",
    ".cs",
    ".csproj",
    ".css",
    ".dart",
    ".dockerfile",
    ".ex",
    ".exs",
    ".fsproj",
    ".go",
    ".gradle",
    ".gql",
    ".graphql",
    ".htm",
    ".html",
    ".ipynb",
    ".java",
    ".jl",
    ".js",
    ".json",
    ".jsonc",
    ".jsx",
    ".kt",
    ".kts",
    ".less",
    ".lua",
    ".md",
    ".mdx",
    ".mjs",
    ".php",
    ".proto",
    ".props",
    ".ps1",
    ".py",
    ".r",
    ".rb",
    ".rs",
    ".sass",
    ".scss",
    ".sh",
    ".sql",
    ".svelte",
    ".svg",
    ".swift",
    ".targets",
    ".tf",
    ".tfvars",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".vbproj",
    ".vue",
    ".xml",
    ".yaml",
    ".yml",
    ".zsh",
  ],
};

const skippedDirectories = new Set([
  ".git",
  ".worktrees",
  ".codex-worktrees",
  "node_modules",
  "dist",
  "build",
  "release",
  "coverage",
  "logs",
  ".cache",
  ".venv",
  "venv",
  "env",
  "__pycache__",
]);

const legacyChangedBase = "origin/main";
const blockingThresholdByProfile = {
  "personal-local": null,
  "private-unattended": "severe",
  "shared-packaged": "critical",
  "hosted-public": "critical",
};
const controlProfileRank = {
  "personal-local": 0,
  "private-unattended": 1,
  "shared-packaged": 2,
  "hosted-public": 3,
};
const severityRank = { warning: 1, critical: 2, severe: 3 };

function parseArgs(argv) {
  const options = {
    base: null,
    changed: false,
    policy: ".codex/source-size-policy.json",
    root: process.cwd(),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--changed") {
      options.changed = true;
    } else if (arg === "--base") {
      options.base = argv[++index] ?? options.base;
    } else if (arg === "--policy") {
      options.policy = argv[++index] ?? options.policy;
    } else if (arg === "--root") {
      options.root = argv[++index] ?? options.root;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node scripts/source-size-guard.mjs [--changed] [--base <ref>] [--policy <path>] [--root <path>]",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  options.root = path.resolve(options.root);
  options.policy = path.resolve(options.root, options.policy);
  options.base =
    options.base || acceptedSourceRef(options.root) || legacyChangedBase;
  return options;
}

function normalizePath(value) {
  return String(value).replace(/\\/g, "/").replace(/^\.\//, "");
}

function isUsableRemoteRef(value) {
  const candidate = String(value ?? "").trim();
  if (!candidate || candidate === "working-tree" || !candidate.includes("/")) {
    return false;
  }
  try {
    execFileSync("git", ["check-ref-format", `refs/remotes/${candidate}`], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function acceptedSourceRef(root) {
  const profilePath = path.join(root, "PROJECT_PROFILE.json");
  if (!fs.existsSync(profilePath)) {
    return "";
  }
  try {
    const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
    const candidate = profile?.sourceOfTruth?.code?.acceptedRef;
    return isUsableRemoteRef(candidate) ? String(candidate).trim() : "";
  } catch {
    return "";
  }
}

function validateOptionalProfileValue(profile, field, allowed) {
  if (profile[field] == null) return;
  if (!allowed.includes(profile[field])) {
    throw new Error(`Invalid PROJECT_PROFILE.json ${field}: ${profile[field]}`);
  }
}

function controlProfile(root) {
  const profilePath = path.join(root, "PROJECT_PROFILE.json");
  if (!fs.existsSync(profilePath)) return "personal-local";
  const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  validateOptionalProfileValue(profile, "projectMode", [
    "throwaway",
    "durable",
    "production",
  ]);
  validateOptionalProfileValue(profile, "runtimeMode", [
    "local",
    "packaged",
    "hosted",
    "hybrid",
    "not-applicable",
  ]);
  validateOptionalProfileValue(profile, "agentMode", [
    "single-agent",
    "multi-agent",
  ]);
  validateOptionalProfileValue(profile, "dataRisk", [
    "unknown",
    "none",
    "low",
    "moderate",
    "high",
    "sensitive",
    "local-user-data",
  ]);
  validateOptionalProfileValue(profile, "executionMode", [
    "interactive",
    "one-shot",
    "scheduled",
    "service",
    "not-applicable",
  ]);
  let minimum = "personal-local";
  if (
    profile.projectMode === "production" ||
    ["hosted", "hybrid"].includes(profile.runtimeMode)
  ) {
    minimum = "hosted-public";
  } else if (
    profile.runtimeMode === "packaged" ||
    profile.agentMode === "multi-agent"
  ) {
    minimum = "shared-packaged";
  } else if (["scheduled", "service"].includes(profile.executionMode)) {
    minimum = "private-unattended";
  }
  if (profile.controlProfile != null) {
    const explicit = String(profile.controlProfile).trim().toLowerCase();
    if (!(explicit in blockingThresholdByProfile)) {
      throw new Error(
        `Unknown PROJECT_PROFILE.json controlProfile: ${explicit}`,
      );
    }
    if (controlProfileRank[explicit] < controlProfileRank[minimum]) {
      throw new Error(
        `PROJECT_PROFILE.json controlProfile ${explicit} is weaker than required ${minimum}`,
      );
    }
    return explicit;
  }
  return minimum;
}

function normalizeToken(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function normalizeExtension(value) {
  const normalized = normalizeToken(value);
  if (!normalized) {
    return "";
  }
  return normalized.startsWith(".") ? normalized : `.${normalized}`;
}

function normalizePolicyList(values, normalize) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.map(normalize).filter(Boolean);
}

function readPolicy(policyPath) {
  const fallback = {
    defaults: { warning_lines: 800, critical_lines: 1500, severe_lines: 3000 },
    roles: [],
    sourceFiles: {
      basenames: [...defaultSourceFiles.basenames],
      extensions: [...defaultSourceFiles.extensions],
    },
  };
  if (!fs.existsSync(policyPath)) {
    return fallback;
  }
  const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
  const sourceFiles = policy.source_files ?? {};
  const extensions = normalizePolicyList(
    sourceFiles.extensions,
    normalizeExtension,
  );
  const basenames = normalizePolicyList(sourceFiles.basenames, normalizeToken);
  return {
    defaults: { ...fallback.defaults, ...(policy.defaults ?? {}) },
    roles: Array.isArray(policy.roles) ? policy.roles : [],
    sourceFiles: {
      basenames:
        basenames.length > 0 ? basenames : fallback.sourceFiles.basenames,
      extensions:
        extensions.length > 0 ? extensions : fallback.sourceFiles.extensions,
    },
  };
}

function roleMatches(role, relativePath, extension) {
  if (role.path_regex && new RegExp(role.path_regex).test(relativePath)) {
    return true;
  }
  if (Array.isArray(role.extensions)) {
    return role.extensions.some(
      (candidate) => candidate.toLowerCase() === extension,
    );
  }
  return false;
}

function roleFor(policy, relativePath, extension) {
  return (
    policy.roles.find((role) => roleMatches(role, relativePath, extension)) ?? {
      name: "source",
    }
  );
}

function thresholdsFor(policy, role) {
  const warning = Math.max(
    1,
    Number(role.warning_lines ?? policy.defaults.warning_lines),
  );
  const critical = Math.max(
    warning,
    Number(role.critical_lines ?? policy.defaults.critical_lines),
  );
  const severe = Math.max(
    critical,
    Number(role.severe_lines ?? policy.defaults.severe_lines),
  );
  return { warning, critical, severe };
}

function severityFor(lines, thresholds) {
  if (lines >= thresholds.severe) return "severe";
  if (lines >= thresholds.critical) return "critical";
  if (lines >= thresholds.warning) return "warning";
  return "ok";
}

function lineCount(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  if (!text) return 0;
  return text.split(/\r?\n/).length - (text.endsWith("\n") ? 1 : 0);
}

function walk(root, current = root, files = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) {
        walk(root, path.join(current, entry.name), files);
      }
      continue;
    }
    if (entry.isFile()) {
      files.push(path.join(current, entry.name));
    }
  }
  return files;
}

function gitResult(root, args) {
  try {
    const lines = execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return { lines, ok: true };
  } catch (error) {
    return { error, lines: [], ok: false };
  }
}

function gitLines(root, args) {
  return gitResult(root, args).lines;
}

function isGitWorktree(root) {
  const result = gitResult(root, ["rev-parse", "--is-inside-work-tree"]);
  return result.ok && result.lines[0] === "true";
}

function gitRefExists(root, ref) {
  if (!ref) {
    return false;
  }
  return gitResult(root, [
    "rev-parse",
    "--verify",
    "--quiet",
    `${ref}^{commit}`,
  ]).ok;
}

function changedFileSelection(root, base) {
  if (!isGitWorktree(root)) {
    return {
      fallbackReason:
        "git worktree is unavailable; scanned all supported files",
      files: walk(root),
      mode: "changed-fallback-all",
    };
  }
  if (!gitRefExists(root, base)) {
    return {
      fallbackReason: `base ref ${base} is unavailable; scanned all supported files`,
      files: walk(root),
      mode: "changed-fallback-all",
    };
  }

  const paths = new Set([
    ...gitLines(root, [
      "diff",
      "--name-only",
      "--diff-filter=ACMRTUXB",
      `${base}...HEAD`,
    ]),
    ...gitLines(root, ["diff", "--name-only", "--diff-filter=ACMRTUXB"]),
    ...gitLines(root, [
      "diff",
      "--cached",
      "--name-only",
      "--diff-filter=ACMRTUXB",
    ]),
    ...gitLines(root, ["ls-files", "--others", "--exclude-standard"]),
  ]);
  return {
    fallbackReason: "",
    files: [...paths]
      .map((item) => path.join(root, item))
      .filter(
        (filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile(),
      ),
    mode: "changed",
  };
}

function scanFiles(root, policy, files) {
  const candidates = [];
  let scanned = 0;
  const sourceExtensions = new Set(policy.sourceFiles.extensions);
  const sourceBasenames = new Set(policy.sourceFiles.basenames);
  for (const role of policy.roles) {
    if (Array.isArray(role.extensions)) {
      for (const extension of role.extensions) {
        const normalized = normalizeExtension(extension);
        if (normalized) {
          sourceExtensions.add(normalized);
        }
      }
    }
  }
  for (const filePath of files) {
    const relativePath = normalizePath(path.relative(root, filePath));
    const extension = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath).toLowerCase();
    if (!sourceExtensions.has(extension) && !sourceBasenames.has(fileName))
      continue;
    const role = roleFor(policy, relativePath, extension);
    if (role.scan === false) continue;
    scanned += 1;
    const lines = lineCount(filePath);
    const thresholds = thresholdsFor(policy, role);
    const severity = severityFor(lines, thresholds);
    if (severity !== "ok") {
      candidates.push({
        lines,
        path: relativePath,
        role: role.name ?? "source",
        severity,
      });
    }
  }
  candidates.sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path));
  return { candidates, scanned };
}

try {
  const options = parseArgs(process.argv.slice(2));
  const policy = readPolicy(options.policy);
  const profile = controlProfile(options.root);
  const blockingThreshold = blockingThresholdByProfile[profile];
  const selection = options.changed
    ? changedFileSelection(options.root, options.base)
    : { fallbackReason: "", files: walk(options.root), mode: "all" };
  const result = scanFiles(options.root, policy, selection.files);
  const blockingCandidates = blockingThreshold
    ? result.candidates.filter(
        (candidate) =>
          severityRank[candidate.severity] >= severityRank[blockingThreshold],
      )
    : [];
  const blockingPaths = new Set(
    blockingCandidates.map((candidate) => candidate.path),
  );
  const advisoryCandidates = result.candidates.filter(
    (candidate) => !blockingPaths.has(candidate.path),
  );
  console.log("Source size guard");
  console.log(`Root: ${options.root}`);
  console.log(
    `Policy: ${fs.existsSync(options.policy) ? options.policy : "built-in defaults"}`,
  );
  console.log(`Mode: ${selection.mode}`);
  console.log(`Control profile: ${profile}`);
  console.log(`Blocking threshold: ${blockingThreshold || "none"}`);
  if (options.changed) {
    console.log(`Changed-file base: ${options.base}`);
  }
  if (selection.fallbackReason) {
    console.log(`Changed-file fallback: ${selection.fallbackReason}`);
  }
  console.log(`Files scanned: ${result.scanned}`);
  console.log(`Split candidates: ${result.candidates.length}`);
  console.log(`Blocking candidates: ${blockingCandidates.length}`);
  console.log(`Advisory candidates: ${advisoryCandidates.length}`);
  for (const candidate of result.candidates.slice(0, 20)) {
    console.log(
      `- ${candidate.path} (${candidate.lines} lines, ${candidate.severity}, ${candidate.role})`,
    );
  }
  console.log(
    `SOURCE_SIZE_GUARD_STATUS=${blockingCandidates.length > 0 ? "blocked" : "complete"}`,
  );
  process.exitCode = blockingCandidates.length > 0 ? 2 : 0;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
