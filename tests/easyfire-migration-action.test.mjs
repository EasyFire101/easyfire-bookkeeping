import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const controllerPath = resolve(root, "deploy/windows/migration-action.ps1");

const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex").toUpperCase();

function runController(parameters) {
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    controllerPath,
  ];
  for (const [name, value] of Object.entries(parameters)) {
    args.push(`-${name}`);
    if (value !== true) args.push(String(value));
  }
  return spawnSync("powershell.exe", args, { encoding: "utf8" });
}

function createFixture() {
  const fixture = mkdtempSync(resolve(tmpdir(), "easyfire-migration-"));
  const authorityRoot = resolve(fixture, "authority");
  const releaseDirectory = resolve(fixture, "release-E4210A54464D");
  const targetReleaseDirectory = resolve(fixture, "release-d418213b4c9a");
  mkdirSync(authorityRoot, { recursive: true });
  mkdirSync(releaseDirectory, { recursive: true });
  mkdirSync(targetReleaseDirectory, { recursive: true });

  const composeFile = resolve(releaseDirectory, "docker-compose.prod.yml");
  const envFile = resolve(releaseDirectory, ".env.production");
  const backupFile = resolve(authorityRoot, "legacy-full.sql.gz");
  const targetComposeFile = resolve(
    targetReleaseDirectory,
    "docker-compose.prod.yml",
  );
  const targetEnvFile = resolve(targetReleaseDirectory, ".env.production");
  const backupTaskXmlPath = resolve(authorityRoot, "task-backup.xml");
  const startupTaskXmlPath = resolve(authorityRoot, "task-startup.xml");
  writeFileSync(composeFile, "services:\n  mysql:\n    image: legacy\n", "utf8");
  writeFileSync(
    envFile,
    "SYSTEM_DB_NAME=legacy_system\nTENANT_DB_NAME_PERFIX=legacy_tenant_\n",
    "utf8",
  );
  writeFileSync(backupFile, "synthetic compressed backup fixture", "utf8");
  writeFileSync(targetComposeFile, "services:\n  mysql:\n    image: target\n", "utf8");
  writeFileSync(targetEnvFile, "SYSTEM_DB_NAME=legacy_system\n", "utf8");
  writeFileSync(backupTaskXmlPath, "<Task id='backup' />", "utf8");
  writeFileSync(startupTaskXmlPath, "<Task id='startup' />", "utf8");

  const migrationId = randomUUID();
  const backupOperationId = randomUUID();
  const metadataFile = `${backupFile}.metadata.json`;
  const metadata = {
    SchemaVersion: 1,
    MigrationId: migrationId,
    InvocationRole: "MigrationSource",
    BackupOperationId: backupOperationId,
    BackupMode: "full",
    AuthorityRoot: authorityRoot,
    ComposeProject: "easyfire-bookkeeping-prod",
    ComposeFile: composeFile,
    ComposeFileSha256: sha256(readFileSync(composeFile)),
    EnvFile: envFile,
    EnvFileSha256: sha256(readFileSync(envFile)),
    MysqlContainerId: "a".repeat(64),
    MysqlContainerName: "easyfire-mysql",
    MysqlImageReference: "easyfire-20260713-e4210a54464d",
    MysqlImageId: `sha256:${"b".repeat(64)}`,
    MysqlVolumeName: "easyfire-bookkeeping-prod_mysql-data",
    MysqlVolumeComposeKey: "mysql-data",
    MysqlVolumeDestination: "/var/lib/mysql",
    BackupFile: backupFile,
    BackupSha256: sha256(readFileSync(backupFile)),
  };
  writeFileSync(metadataFile, JSON.stringify(metadata, null, 2), "utf8");

  const common = {
    MigrationId: migrationId,
    AuthorityRoot: authorityRoot,
    SourceReleaseId: "E4210A54464D",
    SourceReleaseDirectory: releaseDirectory,
    SourceComposeFile: composeFile,
    SourceComposeSha256: metadata.ComposeFileSha256,
    SourceEnvFile: envFile,
    SourceEnvSha256: metadata.EnvFileSha256,
    SourceProjectName: metadata.ComposeProject,
    SourceMysqlContainerId: metadata.MysqlContainerId,
    SourceMysqlContainerName: metadata.MysqlContainerName,
    SourceMysqlImageReference: metadata.MysqlImageReference,
    SourceMysqlImageId: metadata.MysqlImageId,
    SourceMysqlVolumeName: metadata.MysqlVolumeName,
    SourceMysqlVolumeComposeKey: metadata.MysqlVolumeComposeKey,
    SourceMysqlVolumeDestination: metadata.MysqlVolumeDestination,
    SourceRedisVolumeName: "easyfire-bookkeeping-prod_redis-data",
    TargetReleaseId: "d418213b4c9a",
    TargetReleaseDirectory: targetReleaseDirectory,
    TargetComposeFile: targetComposeFile,
    TargetComposeSha256: sha256(readFileSync(targetComposeFile)),
    TargetEnvFile: targetEnvFile,
    TargetEnvSha256: sha256(readFileSync(targetEnvFile)),
    TargetServerImageReference: "easyfire/server:d418213b4c9a",
    TargetServerImageId: `sha256:${"c".repeat(64)}`,
    TargetWebappImageReference: "easyfire/webapp:d418213b4c9a",
    TargetWebappImageId: `sha256:${"d".repeat(64)}`,
    TargetWorkerImageReference: "easyfire/worker:d418213b4c9a",
    TargetWorkerImageId: `sha256:${"e".repeat(64)}`,
    TargetMysqlImageReference: "easyfire/mariadb:d418213b4c9a",
    TargetMysqlImageId: `sha256:${"f".repeat(64)}`,
    TargetRedisImageReference: "easyfire/redis:d418213b4c9a",
    TargetRedisImageId: `sha256:${"9".repeat(64)}`,
    BackupTaskXmlPath: backupTaskXmlPath,
    BackupTaskXmlSha256: sha256(readFileSync(backupTaskXmlPath)),
    StartupTaskXmlPath: startupTaskXmlPath,
    StartupTaskXmlSha256: sha256(readFileSync(startupTaskXmlPath)),
    BackupMetadataFile: metadataFile,
    BackupMetadataSha256: sha256(readFileSync(metadataFile)),
  };

  return { fixture, authorityRoot, metadata, metadataFile, common };
}

function parseLastJson(stdout) {
  const lines = stdout.trim().split(/\r?\n/);
  return JSON.parse(lines.at(-1));
}

test("plan binds the legacy source and emits only derived candidate write targets", () => {
  const item = createFixture();
  try {
    const result = runController({ Mode: "Plan", ...item.common });
    assert.equal(result.status, 0, result.stderr);
    const proof = parseLastJson(result.stdout);
    assert.equal(proof.State, "Planned");
    assert.equal(proof.MigrationId, item.common.MigrationId);
    assert.match(
      proof.Candidate.ProjectName,
      /^easyfire-bookkeeping-mig-[0-9a-f]{32}$/,
    );
    assert.match(
      proof.Candidate.MysqlVolumeName,
      /^easyfire_mig_mysql_[0-9a-f]{32}$/,
    );
    assert.match(
      proof.Candidate.RedisVolumeName,
      /^easyfire_mig_redis_[0-9a-f]{32}$/,
    );
    assert.equal(
      proof.Source.MysqlVolumeName,
      item.common.SourceMysqlVolumeName,
    );
    assert.equal(proof.Source.Preservation, "ReadOnlyPreserve");
    assert.equal(proof.Target.ReleaseId, item.common.TargetReleaseId);
    assert.equal(proof.Target.Images.length, 5);

    const operations = proof.Operations;
    assert.ok(operations.length >= 10);
    const serialized = JSON.stringify(operations);
    assert.doesNotMatch(serialized, /RemoveSource|DeleteSource|RenameSource/);
    assert.doesNotMatch(serialized, /docker\s+(volume\s+rm|rm)|Remove-Item/i);
    const importOperation = operations.find(
      (operation) => operation.Kind === "ImportMigrationBackup",
    );
    assert.equal(
      importOperation.WriteTarget,
      proof.Candidate.MysqlVolumeName,
    );
    assert.notEqual(
      importOperation.WriteTarget,
      item.common.SourceMysqlVolumeName,
    );

    const taskOperations = operations.filter((operation) =>
      ["RepairScheduledTask", "RetireScheduledTask"].includes(operation.Kind),
    );
    assert.deepEqual(
      taskOperations.map((operation) => operation.TaskName),
      [
        "easyfire-bookkeeping-prod-backup",
        "easyfire-bookkeeping-prod-startup",
      ],
    );
    assert.ok(
      taskOperations.every(
        (operation) =>
          operation.Execution === "ExternalIdentityBoundOnly" &&
          operation.RequiresExactXmlBackup === true &&
          operation.XmlBackupSha256,
      ),
    );
  } finally {
    rmSync(item.fixture, { recursive: true, force: true });
  }
});

test("WhatIf returns the exact plan without publishing a journal", () => {
  const item = createFixture();
  try {
    const result = runController({
      Mode: "Plan",
      ...item.common,
      WhatIf: true,
    });
    assert.equal(result.status, 0, result.stderr);
    const proof = parseLastJson(result.stdout);
    assert.equal(proof.State, "Planned");
    assert.equal(proof.PreserveOriginals, true);
    assert.equal(
      readFileSync(item.metadata.BackupFile, "utf8"),
      "synthetic compressed backup fixture",
    );
    const journalPath = resolve(
      item.authorityRoot,
      "migrations",
      item.common.MigrationId,
      "migration.journal.json",
    );
    assert.equal(
      spawnSync("powershell.exe", [
        "-NoProfile",
        "-Command",
        `if (Test-Path -LiteralPath '${journalPath.replaceAll("'", "''")}') { exit 1 }`,
      ]).status,
      0,
    );
  } finally {
    rmSync(item.fixture, { recursive: true, force: true });
  }
});

test("plan rejects noncanonical ids and any changed backup, compose, env, or metadata authority", () => {
  for (const mutation of [
    (item) => ({ MigrationId: item.common.MigrationId.toUpperCase() }),
    (item) => {
      writeFileSync(item.metadata.BackupFile, "tampered", "utf8");
      return {};
    },
    (item) => {
      writeFileSync(item.common.SourceComposeFile, "tampered", "utf8");
      return {};
    },
    (item) => {
      writeFileSync(item.common.SourceEnvFile, "tampered", "utf8");
      return {};
    },
    (item) => {
      writeFileSync(item.common.TargetComposeFile, "tampered", "utf8");
      return {};
    },
    (item) => {
      writeFileSync(item.common.BackupTaskXmlPath, "tampered", "utf8");
      return {};
    },
    (item) => {
      const metadata = JSON.parse(readFileSync(item.metadataFile, "utf8"));
      metadata.MysqlVolumeName = "wrong-volume";
      writeFileSync(item.metadataFile, JSON.stringify(metadata), "utf8");
      return {
        BackupMetadataSha256: sha256(readFileSync(item.metadataFile)),
      };
    },
  ]) {
    const item = createFixture();
    try {
      const overrides = mutation(item);
      const result = runController({
        Mode: "Plan",
        ...item.common,
        ...overrides,
      });
      assert.notEqual(result.status, 0, result.stdout);
    } finally {
      rmSync(item.fixture, { recursive: true, force: true });
    }
  }
});

test("rehearse and cutover fail closed until every exact proof gate passes", () => {
  const item = createFixture();
  try {
    const planned = runController({ Mode: "Plan", ...item.common });
    assert.equal(planned.status, 0, planned.stderr);
    const plan = parseLastJson(planned.stdout);
    const evidenceFile = resolve(item.authorityRoot, "rehearsal-evidence.json");
    const evidence = {
      SchemaVersion: 1,
      MigrationId: item.common.MigrationId,
      BackupRestore: {
        Passed: true,
        BackupSha256: item.metadata.BackupSha256,
        BackupMetadataSha256: item.common.BackupMetadataSha256,
      },
      CandidateHealth: {
        Passed: true,
        ProjectName: plan.Candidate.ProjectName,
        MysqlVolumeName: plan.Candidate.MysqlVolumeName,
        RedisVolumeName: plan.Candidate.RedisVolumeName,
      },
      NativeAuthentication: { Passed: true, Result: "Passed" },
      MigrationProof: {
        Passed: true,
        ImportedOnlyIntoCandidate: true,
        SourceVolumeUnchanged: true,
      },
      RollbackRehearsal: {
        Passed: true,
        CandidateStopped: true,
        SourceProjectRestarted: true,
        SourceVolumeUnchanged: true,
      },
    };
    writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2), "utf8");

    const denied = runController({
      Mode: "Rehearse",
      ...item.common,
      EvidenceFile: evidenceFile,
      EvidenceSha256: sha256(readFileSync(evidenceFile)),
      NativeAuthProbeResult: "Failed",
    });
    assert.notEqual(denied.status, 0);

    evidence.RollbackRehearsal.SourceProjectRestarted = false;
    writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2), "utf8");
    const incomplete = runController({
      Mode: "Rehearse",
      ...item.common,
      EvidenceFile: evidenceFile,
      EvidenceSha256: sha256(readFileSync(evidenceFile)),
      NativeAuthProbeResult: "Passed",
    });
    assert.notEqual(incomplete.status, 0);

    evidence.RollbackRehearsal.SourceProjectRestarted = true;
    writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2), "utf8");
    const rehearsed = runController({
      Mode: "Rehearse",
      ...item.common,
      EvidenceFile: evidenceFile,
      EvidenceSha256: sha256(readFileSync(evidenceFile)),
      NativeAuthProbeResult: "Passed",
    });
    assert.equal(rehearsed.status, 0, rehearsed.stderr);
    assert.equal(
      parseLastJson(rehearsed.stdout).State,
      "RehearsalEvidenceRecorded",
    );

    const wrongEvidence = { ...evidence, MigrationId: randomUUID() };
    writeFileSync(evidenceFile, JSON.stringify(wrongEvidence, null, 2), "utf8");
    const cutoverDenied = runController({
      Mode: "Cutover",
      ...item.common,
      EvidenceFile: evidenceFile,
      EvidenceSha256: sha256(readFileSync(evidenceFile)),
      NativeAuthProbeResult: "Passed",
    });
    assert.notEqual(cutoverDenied.status, 0);

    writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2), "utf8");
    const cutover = runController({
      Mode: "Cutover",
      ...item.common,
      EvidenceFile: evidenceFile,
      EvidenceSha256: sha256(readFileSync(evidenceFile)),
      NativeAuthProbeResult: "Passed",
    });
    assert.notEqual(cutover.status, 0, cutover.stdout);
    assert.match(
      `${cutover.stdout}\n${cutover.stderr}`,
      /LIVE_EXECUTOR_PROOF_REQUIRED/,
    );
  } finally {
    rmSync(item.fixture, { recursive: true, force: true });
  }
});

test("rollback authorizes only candidate stop plus the exact source restart", () => {
  const item = createFixture();
  try {
    const planResult = runController({ Mode: "Plan", ...item.common });
    assert.equal(planResult.status, 0, planResult.stderr);
    const plan = parseLastJson(planResult.stdout);
    const result = runController({ Mode: "Rollback", ...item.common });
    assert.equal(result.status, 0, result.stderr);
    const rollback = parseLastJson(result.stdout);
    assert.equal(rollback.State, "RollbackAuthorized");
    assert.deepEqual(
      rollback.AuthorizedOperations.map((operation) => operation.Kind),
      [
        "StopCandidate",
        "RestartExactSourceProject",
        "RestoreScheduledTask",
        "RestoreScheduledTask",
      ],
    );
    assert.equal(
      rollback.AuthorizedOperations[0].ProjectName,
      plan.Candidate.ProjectName,
    );
    assert.equal(
      rollback.AuthorizedOperations[1].ProjectName,
      item.common.SourceProjectName,
    );
    assert.equal(
      rollback.AuthorizedOperations[1].MysqlVolumeName,
      item.common.SourceMysqlVolumeName,
    );
    assert.deepEqual(
      rollback.AuthorizedOperations.slice(2).map((operation) => [
        operation.TaskName,
        operation.XmlBackupPath,
        operation.XmlBackupSha256,
      ]),
      [
        [
          "easyfire-bookkeeping-prod-backup",
          item.common.BackupTaskXmlPath,
          item.common.BackupTaskXmlSha256,
        ],
        [
          "easyfire-bookkeeping-prod-startup",
          item.common.StartupTaskXmlPath,
          item.common.StartupTaskXmlSha256,
        ],
      ],
    );
  } finally {
    rmSync(item.fixture, { recursive: true, force: true });
  }
});

test("plan rejects a reparse point anywhere in a bound path chain", (t) => {
  const item = createFixture();
  try {
    const junction = resolve(item.fixture, "target-release-link");
    const create = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `New-Item -ItemType Junction -Path '${junction.replaceAll("'", "''")}' -Target '${item.common.TargetReleaseDirectory.replaceAll("'", "''")}' -ErrorAction Stop | Out-Null`,
      ],
      { encoding: "utf8" },
    );
    if (create.status !== 0) {
      t.skip(`junction creation unavailable: ${create.stderr}`);
      return;
    }
    const result = runController({
      Mode: "Plan",
      ...item.common,
      TargetReleaseDirectory: junction,
      TargetComposeFile: resolve(junction, "docker-compose.prod.yml"),
      TargetEnvFile: resolve(junction, ".env.production"),
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /reparse point/i);
  } finally {
    rmSync(item.fixture, { recursive: true, force: true });
  }
});

test("rehearsal transition recovers when its immutable snapshot won the crash window", () => {
  const item = createFixture();
  try {
    const planResult = runController({ Mode: "Plan", ...item.common });
    assert.equal(planResult.status, 0, planResult.stderr);
    const plan = parseLastJson(planResult.stdout);
    const evidenceFile = resolve(item.authorityRoot, "rehearsal-evidence.json");
    const evidence = {
      SchemaVersion: 1,
      MigrationId: item.common.MigrationId,
      BackupRestore: {
        Passed: true,
        BackupSha256: item.metadata.BackupSha256,
        BackupMetadataSha256: item.common.BackupMetadataSha256,
      },
      CandidateHealth: {
        Passed: true,
        ProjectName: plan.Candidate.ProjectName,
        MysqlVolumeName: plan.Candidate.MysqlVolumeName,
        RedisVolumeName: plan.Candidate.RedisVolumeName,
      },
      NativeAuthentication: { Passed: true, Result: "Passed" },
      MigrationProof: {
        Passed: true,
        ImportedOnlyIntoCandidate: true,
        SourceVolumeUnchanged: true,
      },
      RollbackRehearsal: {
        Passed: true,
        CandidateStopped: true,
        SourceProjectRestarted: true,
        SourceVolumeUnchanged: true,
      },
    };
    writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2), "utf8");
    const evidenceHash = sha256(readFileSync(evidenceFile));
    const journal = JSON.parse(readFileSync(plan.JournalPath, "utf8"));
    const at = new Date().toISOString();
    journal.State = "RehearsalEvidenceRecorded";
    journal.Evidence = {
      Path: evidenceFile,
      Sha256: evidenceHash,
      NativeAuthProbeResult: "Passed",
      EvidenceKind: "CallerPlanningReceipt",
      VerifiedAtUtc: at,
    };
    journal.UpdatedAtUtc = at;
    journal.Transitions.push({
      Sequence: 2,
      From: "Planned",
      To: "RehearsalEvidenceRecorded",
      AtUtc: at,
      EvidenceSha256: evidenceHash,
    });
    const snapshot = resolve(
      dirname(plan.JournalPath),
      "transition-0002-RehearsalEvidenceRecorded.json",
    );
    writeFileSync(snapshot, JSON.stringify(journal, null, 2), "utf8");

    const recovered = runController({
      Mode: "Rehearse",
      ...item.common,
      EvidenceFile: evidenceFile,
      EvidenceSha256: evidenceHash,
      NativeAuthProbeResult: "Passed",
    });
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(parseLastJson(recovered.stdout).State, "RehearsalEvidenceRecorded");
    assert.equal(
      JSON.parse(readFileSync(plan.JournalPath, "utf8")).State,
      "RehearsalEvidenceRecorded",
    );
  } finally {
    rmSync(item.fixture, { recursive: true, force: true });
  }
});
