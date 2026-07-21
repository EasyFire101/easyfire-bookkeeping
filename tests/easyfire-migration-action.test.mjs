import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
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

function runController(parameters, controllerOverride) {
  const exactController =
    controllerOverride ??
    resolve(
      parameters.TargetReleaseDirectory,
      "deploy/windows/migration-action.ps1",
    );
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    exactController,
  ];
  for (const [name, value] of Object.entries(parameters)) {
    args.push(`-${name}`);
    if (value !== true) args.push(String(value));
  }
  return spawnSync("powershell.exe", args, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

function parseLastJson(stdout) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return JSON.parse(lines.at(-1));
}

function createFixture({ targetUnderAuthority = true } = {}) {
  const fixture = mkdtempSync(resolve(tmpdir(), "easyfire-migration-action-"));
  const authorityRoot = resolve(fixture, "authority");
  const sourceRelease = resolve(fixture, "source", "E4210A54464D");
  const targetRelease = targetUnderAuthority
    ? resolve(authorityRoot, "releases", "e7ca15f2ee2b")
    : resolve(fixture, "target", "e7ca15f2ee2b");
  mkdirSync(authorityRoot, { recursive: true });
  mkdirSync(sourceRelease, { recursive: true });
  mkdirSync(targetRelease, { recursive: true });

  const controllerBundle = [
    "deploy/windows/migration-action.ps1",
    "deploy/windows/migration-state.psm1",
    "deploy/windows/migration-runtime.psm1",
    "deploy/windows/migration-windows.psm1",
    "deploy/windows/migration-scheduled-backup.ps1",
    "deploy/windows/production-io.psm1",
    "deploy/windows/production-state.psm1",
    "scripts/production/backup.ps1",
    "scripts/production/restore-verify.ps1",
    "scripts/production/backup-integrity.psm1",
  ];
  for (const relativePath of controllerBundle) {
    const destination = resolve(targetRelease, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(resolve(root, relativePath), destination);
  }

  const sourceCompose = resolve(sourceRelease, "docker-compose.prod.yml");
  const sourceEnv = resolve(sourceRelease, ".env");
  const targetCompose = resolve(targetRelease, "docker-compose.prod.yml");
  const targetEnv = resolve(targetRelease, ".env");
  const backup = resolve(authorityRoot, "initial.sql.gz");
  const metadata = `${backup}.metadata.json`;
  const sidecar = `${backup}.sha256`;
  const backupTask = resolve(authorityRoot, "backup-task.xml");
  const startupTask = resolve(authorityRoot, "startup-task.xml");
  const cloudflareCredential = resolve(authorityRoot, "cloudflare.json");
  const sourceInventory = resolve(authorityRoot, "source-inventory.json");

  writeFileSync(sourceCompose, "services:\n  mysql:\n    image: old\n", "utf8");
  writeFileSync(
    sourceEnv,
    "SYSTEM_DB_NAME=easyfire_system\nTENANT_DB_NAME_PERFIX=easyfire_tenant_\n",
    "utf8",
  );
  writeFileSync(
    targetCompose,
    "services:\n  mysql:\n    image: new\n  database_migration:\n    image: migration\n",
    "utf8",
  );
  writeFileSync(
    targetEnv,
    [
      "IMAGE_TAG=migration-test",
      "MARIADB_IMAGE_TAG=migration-db-test",
      "SYSTEM_DB_NAME=easyfire_system",
      "TENANT_DB_NAME_PERFIX=easyfire_tenant_",
      "DB_USER=easyfire",
      "DB_PASSWORD=secret-test-only",
      "DB_ROOT_PASSWORD=root-secret-test-only",
    ].join("\n") + "\n",
    "utf8",
  );
  writeFileSync(backup, "synthetic-gzip-authority", "utf8");
  writeFileSync(sidecar, `${sha256(readFileSync(backup))}  initial.sql.gz\n`, "ascii");
  writeFileSync(backupTask, "<Task id='backup' />", "utf8");
  writeFileSync(startupTask, "<Task id='startup' />", "utf8");
  writeFileSync(cloudflareCredential, '{"testOnly":true}\n', "utf8");

  const migrationId = randomUUID();
  const backupOperationId = randomUUID();
  const metadataValue = {
    SchemaVersion: 1,
    MigrationId: migrationId,
    InvocationRole: "MigrationSource",
    BackupOperationId: backupOperationId,
    BackupMode: "full",
    AuthorityRoot: authorityRoot,
    ComposeProject: "easyfire-bookkeeping-prod",
    ComposeFile: sourceCompose,
    ComposeFileSha256: sha256(readFileSync(sourceCompose)),
    EnvFile: sourceEnv,
    EnvFileSha256: sha256(readFileSync(sourceEnv)),
    MysqlContainerId: "a".repeat(64),
    MysqlContainerName: "easyfire-mysql",
    MysqlImageReference: "easyfire-bookkeeping/mariadb:old",
    MysqlImageId: `sha256:${"b".repeat(64)}`,
    MysqlVolumeName: "easyfire_prod_mysql",
    MysqlVolumeComposeKey: "mysql",
    MysqlVolumeDestination: "/var/lib/mysql",
    BackupFile: backup,
    BackupSha256: sha256(readFileSync(backup)),
  };
  writeFileSync(metadata, JSON.stringify(metadataValue, null, 2), "utf8");

  const services = [
    "mysql",
    "redis",
    "database_migration",
    "server",
    "webapp",
    "envoy",
    "gotenberg",
  ];
  const inventoryValue = {
    ProjectName: "easyfire-bookkeeping-prod",
    MysqlVolumeName: "easyfire_prod_mysql",
    RedisVolumeName: "easyfire_prod_redis",
    Containers: services.map((Service, index) => ({
      Service,
      ContainerId:
        Service === "mysql"
          ? metadataValue.MysqlContainerId
          : (index + 1).toString(16).repeat(64),
      ContainerName:
        Service === "mysql"
          ? metadataValue.MysqlContainerName
          : `easyfire-${Service.replaceAll("_", "-")}`,
      ProjectName: "easyfire-bookkeeping-prod",
      ImageReference:
        Service === "mysql"
          ? metadataValue.MysqlImageReference
          : `easyfire/${Service}:old`,
      ImageId:
        Service === "mysql"
          ? metadataValue.MysqlImageId
          : `sha256:${(index + 8).toString(16).repeat(64)}`,
      State: Service === "database_migration" ? "exited" : "running",
      Health: Service === "database_migration" ? "none" : "healthy",
      RestartPolicy: Service === "database_migration" ? "no" : "unless-stopped",
      PortBindings: [],
      VolumeNames:
        Service === "mysql"
          ? ["easyfire_prod_mysql"]
          : Service === "redis"
            ? ["easyfire_prod_redis"]
            : [],
      Mounts: [],
    })),
    Networks: [],
    Volumes: [],
    ForeignVolumeConsumers: [],
  };
  writeFileSync(sourceInventory, JSON.stringify(inventoryValue, null, 2), "utf8");

  const common = {
    MigrationId: migrationId,
    AuthorityRoot: authorityRoot,
    ProductionRoot: fixture,
    SourceReleaseId: "E4210A54464D",
    SourceReleaseDirectory: sourceRelease,
    SourceComposeFile: sourceCompose,
    SourceComposeSha256: sha256(readFileSync(sourceCompose)),
    SourceEnvFile: sourceEnv,
    SourceEnvSha256: sha256(readFileSync(sourceEnv)),
    SourceProjectName: "easyfire-bookkeeping-prod",
    SourceMysqlContainerId: metadataValue.MysqlContainerId,
    SourceMysqlContainerName: metadataValue.MysqlContainerName,
    SourceMysqlImageReference: metadataValue.MysqlImageReference,
    SourceMysqlImageId: metadataValue.MysqlImageId,
    SourceMysqlVolumeName: metadataValue.MysqlVolumeName,
    SourceMysqlVolumeComposeKey: metadataValue.MysqlVolumeComposeKey,
    SourceMysqlVolumeDestination: metadataValue.MysqlVolumeDestination,
    SourceRedisVolumeName: "easyfire_prod_redis",
    SourceInventoryFile: sourceInventory,
    SourceInventorySha256: sha256(readFileSync(sourceInventory)),
    TargetReleaseId: "e7ca15f2ee2b",
    TargetReleaseDirectory: targetRelease,
    TargetComposeFile: targetCompose,
    TargetComposeSha256: sha256(readFileSync(targetCompose)),
    TargetEnvFile: targetEnv,
    TargetEnvSha256: sha256(readFileSync(targetEnv)),
    TargetServerImageReference: "easyfire/server:new",
    TargetServerImageId: `sha256:${"c".repeat(64)}`,
    TargetWebappImageReference: "easyfire/webapp:new",
    TargetWebappImageId: `sha256:${"d".repeat(64)}`,
    TargetEnvoyImageReference: "envoyproxy/envoy:v1.31.2",
    TargetEnvoyImageId: `sha256:${"7".repeat(64)}`,
    TargetGotenbergImageReference: "gotenberg/gotenberg:8.17.1",
    TargetGotenbergImageId: `sha256:${"8".repeat(64)}`,
    TargetMigrationImageReference: "easyfire/migration:new",
    TargetMigrationImageId: `sha256:${"e".repeat(64)}`,
    TargetMysqlImageReference: "easyfire/mariadb:new",
    TargetMysqlImageId: `sha256:${"f".repeat(64)}`,
    TargetRedisImageReference: "easyfire/redis:new",
    TargetRedisImageId: `sha256:${"9".repeat(64)}`,
    BackupTaskXmlPath: backupTask,
    BackupTaskXmlSha256: sha256(readFileSync(backupTask)),
    StartupTaskXmlPath: startupTask,
    StartupTaskXmlSha256: sha256(readFileSync(startupTask)),
    BackupMetadataFile: metadata,
    BackupMetadataSha256: sha256(readFileSync(metadata)),
    BackupSidecarFile: sidecar,
    BackupSidecarSha256: sha256(readFileSync(sidecar)),
    CloudflareCredentialFile: cloudflareCredential,
    CloudflareCredentialSha256: sha256(readFileSync(cloudflareCredential)),
    AuthorityOwnerSid: "S-1-5-21-100-200-300-1001",
  };
  return {
    fixture,
    authorityRoot,
    common,
    metadataValue,
    targetRelease,
    targetController: resolve(
      targetRelease,
      "deploy/windows/migration-action.ps1",
    ),
  };
}

test("Plan publishes a schema-2 journal with disjoint lanes and Redis continuity", () => {
  const item = createFixture();
  try {
    const result = runController({ Mode: "Plan", ...item.common });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const plan = parseLastJson(result.stdout);
    assert.equal(plan.SchemaVersion, 2);
    assert.equal(plan.CurrentState, "Planned");
    assert.equal(plan.PreserveOriginals, true);
    assert.notEqual(
      plan.Lanes.Rehearsal.MysqlVolumeName,
      plan.Lanes.Cutover.MysqlVolumeName,
    );
    assert.notEqual(
      plan.Lanes.Rehearsal.RedisVolumeName,
      plan.Lanes.Cutover.RedisVolumeName,
    );
    assert.equal(plan.Lanes.Cutover.LoopbackPort, 80);
    assert.equal(plan.Authority.Target.Images.length, 7);
    assert.equal(
      plan.Authority.ControllerBundleAuthority.Root,
      item.targetRelease,
    );
    assert.ok(
      plan.Authority.ControllerBundleAuthority.Files.every((file) =>
        file.Path.startsWith(`${item.targetRelease}\\`),
      ),
    );
    assert.deepEqual(
      plan.Authority.Target.Images.map((image) => image.Service).sort(),
      ["database_migration", "envoy", "gotenberg", "mysql", "redis", "server", "webapp"],
    );
    assert.equal(
      plan.Authority.Target.Images.find(
        (image) => image.Service === "database_migration",
      ).ImageReference,
      item.common.TargetMigrationImageReference,
    );
    assert.deepEqual(
      plan.Authority.ControllerBundleAuthority.Files.map((file) => file.Name).sort(),
      [
        "deploy/windows/migration-action.ps1",
        "deploy/windows/migration-runtime.psm1",
        "deploy/windows/migration-scheduled-backup.ps1",
        "deploy/windows/migration-state.psm1",
        "deploy/windows/migration-windows.psm1",
        "deploy/windows/production-io.psm1",
        "deploy/windows/production-state.psm1",
        "scripts/production/backup-integrity.psm1",
        "scripts/production/backup.ps1",
        "scripts/production/restore-verify.ps1",
      ],
    );
    const operations = JSON.stringify(plan.Operations);
    assert.match(operations, /CopyRedisSnapshot/);
    assert.match(operations, /CreateFinalSourceBackup/);
    assert.match(operations, /PublishCompletedLast/);
    assert.doesNotMatch(operations, /Delete|RemoveSource|RenameSource/);
    assert.equal(
      JSON.parse(readFileSync(plan.JournalPath, "utf8")).SchemaVersion,
      2,
    );
  } finally {
    rmSync(item.fixture, { recursive: true, force: true });
  }
});

test("Plan rejects a target release outside AuthorityRoot before creating a journal", () => {
  const item = createFixture({ targetUnderAuthority: false });
  try {
    const result = runController({ Mode: "Plan", ...item.common });
    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /TargetReleaseDirectory.*(?:allowed root|AuthorityRoot)/i,
    );
    assert.equal(
      existsSync(
        resolve(
          item.authorityRoot,
          "migrations",
          item.common.MigrationId,
          "migration.journal.json",
        ),
      ),
      false,
    );
  } finally {
    rmSync(item.fixture, { recursive: true, force: true });
  }
});

test("controller rejects a launcher root mismatch and post-Plan bundle hash drift", () => {
  const item = createFixture();
  try {
    const wrongRoot = runController(
      { Mode: "Plan", ...item.common },
      controllerPath,
    );
    assert.notEqual(wrongRoot.status, 0);
    assert.match(
      `${wrongRoot.stdout}\n${wrongRoot.stderr}`,
      /exact TargetReleaseDirectory/i,
    );

    const planned = runController({ Mode: "Plan", ...item.common });
    assert.equal(planned.status, 0, `${planned.stdout}\n${planned.stderr}`);
    const runtimeModule = resolve(
      item.targetRelease,
      "deploy/windows/migration-runtime.psm1",
    );
    writeFileSync(
      runtimeModule,
      `${readFileSync(runtimeModule, "utf8")}\n# test-only hash drift\n`,
      "utf8",
    );
    const drifted = runController({
      Mode: "Rehearse",
      ...item.common,
      ExecuteLive: true,
    });
    assert.notEqual(drifted.status, 0);
    assert.match(
      `${drifted.stdout}\n${drifted.stderr}`,
      /controller bundle drifted from the exact Plan|immutable authority fingerprint changed/i,
    );
  } finally {
    rmSync(item.fixture, { recursive: true, force: true });
  }
});

test("Plan -WhatIf returns exact authority without creating a journal", () => {
  const item = createFixture();
  try {
    const result = runController({ Mode: "Plan", ...item.common, WhatIf: true });
    assert.equal(result.status, 0, result.stderr);
    const plan = parseLastJson(result.stdout);
    assert.equal(plan.CurrentState, "Planned");
    assert.equal(
      spawnSync("powershell.exe", [
        "-NoProfile",
        "-Command",
        `if(Test-Path -LiteralPath '${plan.JournalPath.replaceAll("'", "''")}'){exit 1}`,
      ]).status,
      0,
    );
  } finally {
    rmSync(item.fixture, { recursive: true, force: true });
  }
});

test("authority drift in backup, inventory, target compose, task XML, or credentials fails closed", () => {
  for (const mutate of [
    (item) => writeFileSync(item.metadataValue.BackupFile, "changed", "utf8"),
    (item) => writeFileSync(item.common.SourceInventoryFile, "{}", "utf8"),
    (item) => writeFileSync(item.common.TargetComposeFile, "changed", "utf8"),
    (item) => writeFileSync(item.common.BackupTaskXmlPath, "changed", "utf8"),
    (item) => writeFileSync(item.common.CloudflareCredentialFile, "changed", "utf8"),
  ]) {
    const item = createFixture();
    try {
      mutate(item);
      const result = runController({ Mode: "Plan", ...item.common });
      assert.notEqual(result.status, 0, result.stdout);
    } finally {
      rmSync(item.fixture, { recursive: true, force: true });
    }
  }
});

test("cutover is state-gated rather than unconditionally impossible", () => {
  const item = createFixture();
  try {
    const planResult = runController({ Mode: "Plan", ...item.common });
    assert.equal(planResult.status, 0, planResult.stderr);
    const cutover = runController({
      Mode: "Cutover",
      ...item.common,
      ExecuteLive: true,
    });
    assert.notEqual(cutover.status, 0);
    assert.match(`${cutover.stdout}\n${cutover.stderr}`, /RehearsalVerified/);
    assert.doesNotMatch(
      `${cutover.stdout}\n${cutover.stderr}`,
      /LIVE_EXECUTOR_PROOF_REQUIRED/,
    );
  } finally {
    rmSync(item.fixture, { recursive: true, force: true });
  }
});

test("controller binds its bundle and implements abort, ingress prestate, emergency rollback, and seven-image authority", () => {
  const source = readFileSync(controllerPath, "utf8");
  assert.match(source, /migration-state\.psm1/);
  assert.match(source, /migration-runtime\.psm1/);
  assert.match(source, /migration-windows\.psm1/);
  assert.match(source, /Invoke-EasyFireMigrationAutomaticRollback/);
  assert.match(source, /Invoke-EasyFireMigrationAbortRehearsal/);
  assert.match(source, /RehearsalAbort/);
  assert.match(source, /IngressPausePlan/);
  assert.match(source, /MigrationEmergency/);
  assert.match(source, /EmergencyRestoreVerified/);
  assert.match(source, /ControllerBundleAuthority/);
  assert.match(source, /backup-integrity\.psm1/);
  assert.match(source, /TargetEnvoyImageReference/);
  assert.match(source, /TargetGotenbergImageReference/);
  assert.match(source, /PublishCompletedLast/);
  assert.match(source, /MigrationBaseline/);
  assert.match(source, /MigrationSource/);
  assert.equal(
    source.match(
      /-ExpectedComposeWorkingDirectory\s+\$TargetReleaseDirectory/g,
    )?.length,
    11,
  );
  assert.match(
    source,
    /function Invoke-EasyFireMigrationChildScript[\s\S]*?Assert-EasyFireMigrationControllerBundleAuthority/,
  );
  assert.doesNotMatch(source, /LIVE_EXECUTOR_PROOF_REQUIRED/);
  assert.doesNotMatch(source, /docker(?:\.exe)?\s+volume\s+rm|compose\s+down/i);
  assert.doesNotMatch(source, /Remove-Item|Clear-Content/i);
});

test("controller import order keeps the exported native helper visible", () => {
  const source = readFileSync(controllerPath, "utf8");
  const windowsRoot = resolve(root, "deploy/windows").replaceAll("'", "''");
  const importLines = source.match(/^Import-Module[^\r\n]+$/gm) ?? [];
  assert.equal(importLines.length, 4);
  const probe = [
    "$ErrorActionPreference = 'Stop'",
    ...importLines.map((line) =>
      line.replaceAll("$PSScriptRoot", `'${windowsRoot}'`),
    ),
    "if ($null -eq (Get-Command Invoke-EasyFireNative -ErrorAction SilentlyContinue)) { throw 'Invoke-EasyFireNative is not visible after controller imports.' }",
  ].join("\n");
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    probe,
  ], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
