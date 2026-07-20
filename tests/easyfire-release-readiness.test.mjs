import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("sanitized accounting evidence contains one clean document", () => {
  const evidence = read("docs/easyfire/ACCOUNTING_SMOKE.md");
  const headings = evidence.match(
    /^# EasyFire Bookkeeping -- Synthetic Accounting Reconciliation \(Sanitized\)$/gm,
  );

  assert.equal(
    headings?.length ?? 0,
    1,
    "expected one accounting evidence document",
  );
  assert.match(evidence, /document-only reconciliation proof/i);
  assert.match(
    evidence,
    /did not create or validate application or database records/i,
  );

  for (const forbidden of [
    "end▁of▁thinking",
    "DSML",
    "tool_calls",
    "parameter name=",
    "let me re-derive",
    "need to re-do",
    "Now let me write this document",
  ]) {
    assert.doesNotMatch(evidence, new RegExp(forbidden, "i"));
  }
});

test("network users receive an EasyFire AGPL source path", () => {
  const readme = read("README.md");
  const legal = read("packages/webapp/src/constants/legal.ts");
  const footer = read("packages/webapp/src/constants/footerLinks.tsx");
  const auth = read(
    "packages/webapp/src/containers/Authentication/AuthCopyright.tsx",
  );
  const sidebar = read(
    "packages/webapp/src/containers/Dashboard/Sidebar/Sidebar.tsx",
  );
  const paymentPortal = read(
    "packages/webapp/src/containers/PaymentPortal/PaymentPage.tsx",
  );
  const compliance = read("docs/easyfire/AGPL_COMPLIANCE.md");
  const sourceUrl = "https://github.com/EasyFire101/easyfire-bookkeeping";

  assert.match(readme, /^## EasyFire Bookkeeping fork$/m);
  assert.match(readme, new RegExp(sourceUrl.replaceAll("/", "\\/")));
  assert.match(legal, /EASYFIRE_SOURCE_URL/);
  assert.match(legal, new RegExp(sourceUrl.replaceAll("/", "\\/")));
  assert.match(footer, /title: 'Source Code \(AGPLv3\)'/);
  assert.match(footer, /EASYFIRE_SOURCE_URL/);
  for (const renderedSurface of [auth, sidebar, paymentPortal]) {
    assert.match(renderedSurface, /EASYFIRE_SOURCE_URL/);
    assert.match(renderedSurface, /Source code \(AGPL-3\.0\)/);
    assert.match(renderedSurface, /target="_blank"/);
    assert.match(renderedSurface, /rel="noopener noreferrer"/);
  }
  assert.match(compliance, new RegExp(sourceUrl.replaceAll("/", "\\/")));
  assert.match(compliance, /hosted at bookkeeping\.easyfire\.fyi/i);
  assert.doesNotMatch(compliance, /internal local development use only/i);
});

test("current-state documents no longer claim the superseded recovery state", () => {
  const deployment = read("docs/easyfire/DEPLOYMENT_DESIGN.md");
  const runbook = read("docs/easyfire/PRODUCTION_RUNBOOK.md");
  const historicalHandoff = read("AGENT_FOUNDRY_EASYFIRE_HANDOFF.md");

  assert.match(deployment, /superseded historical proposal/i);
  assert.match(deployment, /PRODUCTION_RUNBOOK\.md/);
  assert.doesNotMatch(runbook, /Production Packet Gate\s*--\s*BLOCKED/i);
  assert.doesNotMatch(runbook, /easyfire-bookkeeping\/af-bk-full-01/);
  assert.match(historicalHandoff, /historical/i);
  assert.match(historicalHandoff, /HANDOFF\.md/);
});

test("project ownership and reproducibility metadata are fully specified", () => {
  const agents = read("AGENTS.md");
  const profile = read("PROJECT_PROFILE.json");
  const projectLog = read("PROJECT_LOG.md");
  const handoff = read("HANDOFF.md");
  const currentState = read("docs/easyfire/CURRENT_STATE.md");
  const runbook = read("docs/easyfire/PRODUCTION_RUNBOOK.md");

  assert.doesNotMatch(agents, /TODO:|<command/);
  assert.doesNotMatch(profile, /TODO:/);
  assert.match(profile, /"projectName": "EasyFire Bookkeeping"/);
  assert.match(profile, /"acceptedRef": "easyfire-forgejo\/main"/);

  for (const publicationFile of [
    agents,
    profile,
    projectLog,
    handoff,
    currentState,
    runbook,
  ]) {
    assert.doesNotMatch(publicationFile, /C:\\Users\\jmc34/i);
    assert.doesNotMatch(publicationFile, /100\.84\.66\.30/);
  }
});

test("generated and credential-bearing production paths stay out of Git", () => {
  const ignoreLines = new Set(
    read(".gitignore")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );

  for (const expected of [
    ".env.*",
    "!.env.example",
    "!.env.production.example",
    "credentials/",
    "deploy/**/credentials/",
    "deploy/**/journals/",
    "deploy/**/backups/",
    "production-journals/",
    "restore-scratch/",
    "mysql-*.sql",
    "*.sql.gz",
    "*.sqlite",
    "*.sqlite-*",
    "*.pem",
    "*.key",
    "*.p12",
    "*.pfx",
    ".envrc",
    ".npmrc",
    ".codex-recovery-backups/",
    "deploy/cloudflare/config.yml",
  ]) {
    assert.ok(ignoreLines.has(expected), `missing ignore rule: ${expected}`);
  }
});

test("inherited GitHub workflows require an explicit manual dispatch", () => {
  for (const path of [
    ".github/workflows/build-deploy-container.yml",
    ".github/workflows/build-deploy-develop-container.yaml",
    ".github/workflows/e2e.yml",
    ".github/workflows/format-check.yml",
    ".github/workflows/generate-openapi.yml",
    ".github/workflows/typecheck.yml",
  ]) {
    const workflow = read(path);

    assert.match(workflow, /^on:\r?\n  workflow_dispatch:\s*$/m, path);
    assert.doesNotMatch(
      workflow,
      /^  (?:push|pull_request|release|schedule):/m,
      path,
    );
  }
});

test("published examples contain only unmistakable secret and identity placeholders", () => {
  const examples = [read(".env.example"), read("packages/server/.env.example")];
  const accessTemplate = read(
    "deploy/cloudflare/access-application.template.json",
  );

  for (const example of examples) {
    assert.doesNotMatch(example, /b0JDZW56RnV6aEthb0RGPXVEcUI/);
    assert.match(example, /JWT_SECRET=REPLACE_WITH_RANDOM_64_CHARACTER_SECRET/);
    assert.match(
      example,
      /APP_JWT_SECRET=REPLACE_WITH_RANDOM_64_CHARACTER_SECRET/,
    );
  }
  assert.match(accessTemplate, /"REPLACE_WITH_OWNER_EMAIL"/);
  assert.doesNotMatch(accessTemplate, /PLACEHOLDER_ADMIN_EMAIL@easyfire\.fyi/);
});
