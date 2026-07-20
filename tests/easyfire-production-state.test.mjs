import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, parse, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = resolve(root, "deploy/windows/production-state.psm1");
const psQuote = (value) => `'${String(value).replaceAll("'", "''")}'`;

function invokePowerShell(command) {
  return spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Import-Module ${psQuote(modulePath)} -Force; ${command}`,
    ],
    { encoding: "utf8" },
  );
}

test("journal release manifests accumulate entries linearly", () => {
  const source = readFileSync(modulePath, "utf8");
  const start = source.indexOf("function Get-EasyFireJournalReleaseManifest {");
  const end = source.indexOf("\nfunction ", start + 1);
  assert.notEqual(start, -1, "release-manifest function must exist");
  assert.notEqual(end, -1, "release-manifest function extent must terminate");
  const body = source.slice(start, end);

  assert.match(body, /System\.Collections\.Generic\.List\[object\]/);
  assert.match(body, /\$entryList\.Add\(/);
  assert.match(body, /\$entryList\.ToArray\(\)/);
  assert.doesNotMatch(body, /\$entries\s*\+=/);
});

test("production action IDs and journal paths are canonical and contained", () => {
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), "easyfire-action-id-"));
  const actionId = "3ca632c0-4f63-4a8c-bfa0-59b0cba8ee73";

  try {
    const valid = invokePowerShell(
      `Get-EasyFireJournalPath -ProductionRoot ${psQuote(fixtureRoot)} -ActionId ${psQuote(actionId)}`,
    );
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(
      valid.stdout.trim(),
      resolve(fixtureRoot, "journals", `${actionId}.json`),
    );

    for (const invalid of [
      "../escape",
      "C:\\escape.json",
      "3CA632C0-4F63-4A8C-BFA0-59B0CBA8EE73",
      `${actionId}.json`,
    ]) {
      const result = invokePowerShell(
        `Get-EasyFireJournalPath -ProductionRoot ${psQuote(fixtureRoot)} -ActionId ${psQuote(invalid)}`,
      );
      assert.notEqual(result.status, 0, invalid);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("production and backup mutex names canonicalize path aliases", () => {
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), "easyfire-mutex-name-"));

  try {
    const escapedRoot = psQuote(fixtureRoot);
    const physicalAliases = [`\\\\?\\${fixtureRoot}`];
    const driveRoot = parse(fixtureRoot).root;
    const volumeResult = spawnSync("mountvol.exe", [driveRoot, "/L"], {
      encoding: "utf8",
    });
    const volumeRoot = volumeResult.stdout?.trim();
    if (
      volumeResult.status === 0 &&
      /^\\\\\?\\Volume\{[^}]+\}\\$/i.test(volumeRoot)
    ) {
      physicalAliases.push(
        `${volumeRoot}${fixtureRoot.slice(driveRoot.length)}`,
      );
    }
    const shortResult = spawnSync(
      "cmd.exe",
      ["/d", "/c", `for %I in ("${fixtureRoot}") do @echo %~sI`],
      { encoding: "utf8" },
    );
    const shortRoot = shortResult.stdout?.trim();
    if (shortResult.status === 0 && shortRoot) physicalAliases.push(shortRoot);
    const physicalAliasList = physicalAliases.map(psQuote).join(", ");
    const result = invokePowerShell(
      `$paths = @(${escapedRoot}, (${escapedRoot} + '\\'), (Join-Path ${escapedRoot} '.'), (${escapedRoot}).ToUpperInvariant(), ${physicalAliasList}); [pscustomobject]@{ Production = @($paths | ForEach-Object { Get-EasyFireProductionMutexName -ProductionRoot $_ } | Sort-Object -Unique); Backup = @($paths | ForEach-Object { Get-EasyFireBackupMutexName -ProductionRoot $_ } | Sort-Object -Unique) } | ConvertTo-Json -Compress`,
    );
    assert.equal(result.status, 0, result.stderr);
    const names = JSON.parse(result.stdout);
    assert.equal(names.Production.length, 1);
    assert.equal(names.Backup.length, 1);
    assert.match(
      names.Production[0],
      /^Global\\EasyFireBookkeepingProduction-[A-F0-9]{16}-[A-F0-9]{32}$/,
    );
    assert.match(
      names.Backup[0],
      /^Global\\EasyFireBookkeepingBackup-[A-F0-9]{16}-[A-F0-9]{32}$/,
    );
    assert.notEqual(names.Production[0], names.Backup[0]);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("mutex authority distinguishes directories and rejects unresolved roots", () => {
  const fixtureRoot = mkdtempSync(
    resolve(tmpdir(), "easyfire-mutex-distinct-"),
  );
  const firstRoot = resolve(fixtureRoot, "first");
  const secondRoot = resolve(fixtureRoot, "second");
  mkdirSync(firstRoot);
  mkdirSync(secondRoot);

  try {
    const result = invokePowerShell(
      `[pscustomobject]@{ First = Get-EasyFireProductionMutexName -ProductionRoot ${psQuote(firstRoot)}; Second = Get-EasyFireProductionMutexName -ProductionRoot ${psQuote(secondRoot)} } | ConvertTo-Json -Compress`,
    );
    assert.equal(result.status, 0, result.stderr);
    const names = JSON.parse(result.stdout);
    assert.notEqual(names.First, names.Second);

    const missing = invokePowerShell(
      `Get-EasyFireProductionMutexName -ProductionRoot ${psQuote(resolve(fixtureRoot, "missing"))}`,
    );
    assert.notEqual(
      missing.status,
      0,
      "a missing authority root must fail closed",
    );
    assert.match(missing.stderr, /exist|resolve|authority/i);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("mutex authority rejects a reparse point anywhere in its input chain", () => {
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), "easyfire-mutex-reparse-"));
  const targetRoot = resolve(fixtureRoot, "target");
  const reparseRoot = resolve(fixtureRoot, "authority-link");
  mkdirSync(targetRoot);
  symlinkSync(targetRoot, reparseRoot, "junction");

  try {
    const result = invokePowerShell(
      `Get-EasyFireProductionMutexName -ProductionRoot ${psQuote(reparseRoot)}`,
    );
    assert.notEqual(result.status, 0, "a reparse authority must fail closed");
    assert.match(result.stderr, /reparse/i);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("executable bundle authority binds every exact file and rejects drift", () => {
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), "easyfire-bundle-"));
  const firstPath = resolve(fixtureRoot, "controller.ps1");
  const secondPath = resolve(fixtureRoot, "state.psm1");
  const initial = new Map([
    [firstPath, "controller-v1\n"],
    [secondPath, "state-v1\n"],
  ]);
  for (const [path, contents] of initial) writeFileSync(path, contents);

  try {
    const getResult = invokePowerShell(
      `Get-EasyFireExecutableBundleAuthority -Paths @(${psQuote(firstPath)}, ${psQuote(secondPath)}) | ConvertTo-Json -Depth 5 -Compress`,
    );
    assert.equal(getResult.status, 0, getResult.stderr);
    const authority = JSON.parse(getResult.stdout);
    assert.equal(authority.SchemaVersion, 1);
    assert.equal(authority.Files.length, 2);
    assert.match(authority.FingerprintSha256, /^[A-F0-9]{64}$/);
    for (const file of authority.Files) {
      assert.match(file.Path, /^\\\\\?\\|^\\Device\\/i);
      assert.match(file.Sha256, /^[A-F0-9]{64}$/);
    }
    const fingerprintInput = authority.Files.map(
      ({ Path, Sha256 }) => `${Sha256}  ${Path}`,
    ).join("\n");
    assert.equal(
      authority.FingerprintSha256,
      createHash("sha256")
        .update(fingerprintInput, "utf8")
        .digest("hex")
        .toUpperCase(),
    );

    const aliasGet = invokePowerShell(
      `Get-EasyFireExecutableBundleAuthority -Paths @(${psQuote(`\\\\?\\${firstPath}`)}, ${psQuote(secondPath)}) | ConvertTo-Json -Depth 5 -Compress`,
    );
    assert.equal(aliasGet.status, 0, aliasGet.stderr);
    assert.deepEqual(JSON.parse(aliasGet.stdout), authority);

    const expectedJson = psQuote(JSON.stringify(authority));
    const valid = invokePowerShell(
      `$expected = ${expectedJson} | ConvertFrom-Json; Assert-EasyFireExecutableBundleAuthority -ExpectedAuthority $expected -Paths @(${psQuote(firstPath)}, ${psQuote(secondPath)})`,
    );
    assert.equal(valid.status, 0, valid.stderr);

    for (const [path, contents] of initial) {
      writeFileSync(path, `${contents}tampered\n`);
      const tampered = invokePowerShell(
        `$expected = ${expectedJson} | ConvertFrom-Json; Assert-EasyFireExecutableBundleAuthority -ExpectedAuthority $expected -Paths @(${psQuote(firstPath)}, ${psQuote(secondPath)})`,
      );
      assert.notEqual(tampered.status, 0, `${path} mutation must be rejected`);
      assert.match(tampered.stderr, /bundle|fingerprint|match/i);
      writeFileSync(path, contents);
    }

    const wrongSet = invokePowerShell(
      `$expected = ${expectedJson} | ConvertFrom-Json; Assert-EasyFireExecutableBundleAuthority -ExpectedAuthority $expected -Paths @(${psQuote(firstPath)})`,
    );
    assert.notEqual(
      wrongSet.status,
      0,
      "an incomplete executable set must fail",
    );

    const duplicate = invokePowerShell(
      `Get-EasyFireExecutableBundleAuthority -Paths @(${psQuote(firstPath)}, ${psQuote(firstPath)})`,
    );
    assert.notEqual(duplicate.status, 0, "duplicate canonical paths must fail");
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("executable bundle authority rejects missing and reparse-chain files", () => {
  const fixtureRoot = mkdtempSync(
    resolve(tmpdir(), "easyfire-bundle-reparse-"),
  );
  const targetRoot = resolve(fixtureRoot, "target");
  const reparseRoot = resolve(fixtureRoot, "linked");
  mkdirSync(targetRoot);
  const targetPath = resolve(targetRoot, "controller.ps1");
  writeFileSync(targetPath, "controller\n");
  symlinkSync(targetRoot, reparseRoot, "junction");

  try {
    const missing = invokePowerShell(
      `Get-EasyFireExecutableBundleAuthority -Paths @(${psQuote(resolve(fixtureRoot, "missing.ps1"))})`,
    );
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /exist|resolve|authority/i);

    const reparse = invokePowerShell(
      `Get-EasyFireExecutableBundleAuthority -Paths @(${psQuote(resolve(reparseRoot, "controller.ps1"))})`,
    );
    assert.notEqual(reparse.status, 0);
    assert.match(reparse.stderr, /reparse/i);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("journal validation derives the release directory from the archive hash", () => {
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), "easyfire-journal-"));
  const actionId = "870c9e12-916c-458f-b076-88b1fcd99a1b";
  const sha256 = "ab".repeat(32).toUpperCase();
  const releaseDir = resolve(fixtureRoot, "releases", sha256.slice(0, 12));
  const journalPath = resolve(fixtureRoot, "journal.json");
  const manifestPath = resolve(
    fixtureRoot,
    "journals",
    `${actionId}.release-manifest.json`,
  );

  try {
    const requiredFiles = [
      ".env",
      "docker-compose.prod.yml",
      "scripts/production/backup.ps1",
      "scripts/production/restore-verify.ps1",
    ];
    for (const relative of requiredFiles) {
      const path = resolve(releaseDir, relative);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "fixture", "utf8");
    }
    const sealedEntries = requiredFiles
      .filter((relative) => relative !== ".env")
      .map((relative) => ({
        Path: relative.replaceAll("\\", "/"),
        Length: Buffer.byteLength("fixture"),
        Sha256: createHash("sha256")
          .update("fixture")
          .digest("hex")
          .toUpperCase(),
      }))
      .sort((left, right) => left.Path.localeCompare(right.Path));
    const manifestSha256 = createHash("sha256")
      .update(
        sealedEntries
          .map(({ Path, Length, Sha256 }) => `${Sha256}  ${Length}  ${Path}`)
          .join("\n"),
      )
      .digest("hex")
      .toUpperCase();
    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(
      manifestPath,
      JSON.stringify({
        SchemaVersion: 1,
        ActionId: actionId,
        ArchiveSha256: sha256,
        Manifest: {
          SchemaVersion: 1,
          FileCount: sealedEntries.length,
          Sha256: manifestSha256,
          Entries: sealedEntries,
        },
      }),
      "utf8",
    );
    const journal = {
      SchemaVersion: 2,
      ActionId: actionId,
      AuthorityOwnerSid: "S-1-5-21-999999999-999999999-999999999-1001",
      ProjectName: "easyfire-bookkeeping-prod",
      Stage: "Action",
      status: "completed",
      EnvironmentSha256: createHash("sha256")
        .update("fixture")
        .digest("hex")
        .toUpperCase(),
      ReleaseArchive: { Sha256: sha256, ExtractDir: releaseDir },
      ReleaseManifest: {
        SchemaVersion: 1,
        Path: manifestPath,
        Sha256: manifestSha256,
        FileCount: sealedEntries.length,
      },
    };
    writeFileSync(journalPath, JSON.stringify(journal), "utf8");

    let result = invokePowerShell(
      `$j = Get-Content -LiteralPath ${psQuote(journalPath)} -Raw | ConvertFrom-Json; Test-EasyFireProductionJournal -Journal $j -ExpectedActionId ${psQuote(actionId)} -ProductionRoot ${psQuote(fixtureRoot)} | ConvertTo-Json -Compress`,
    );
    assert.equal(result.status, 0, result.stderr);
    const initialValidation = JSON.parse(result.stdout);
    assert.equal(initialValidation.Valid, true, initialValidation.Reason);

    writeFileSync(resolve(releaseDir, "docker-compose.prod.yml"), "tampered");
    result = invokePowerShell(
      `$j = Get-Content -LiteralPath ${psQuote(journalPath)} -Raw | ConvertFrom-Json; Test-EasyFireProductionJournal -Journal $j -ExpectedActionId ${psQuote(actionId)} -ProductionRoot ${psQuote(fixtureRoot)} | ConvertTo-Json -Compress`,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).Valid, false);
    writeFileSync(resolve(releaseDir, "docker-compose.prod.yml"), "fixture");

    writeFileSync(resolve(releaseDir, ".env"), "tampered");
    result = invokePowerShell(
      `$j = Get-Content -LiteralPath ${psQuote(journalPath)} -Raw | ConvertFrom-Json; Test-EasyFireProductionJournal -Journal $j -ExpectedActionId ${psQuote(actionId)} -ProductionRoot ${psQuote(fixtureRoot)} | ConvertTo-Json -Compress`,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).Valid, false);
    writeFileSync(resolve(releaseDir, ".env"), "fixture");

    journal.ReleaseArchive.ExtractDir = resolve(fixtureRoot, "..", "escape");
    writeFileSync(journalPath, JSON.stringify(journal), "utf8");
    result = invokePowerShell(
      `$j = Get-Content -LiteralPath ${psQuote(journalPath)} -Raw | ConvertFrom-Json; Test-EasyFireProductionJournal -Journal $j -ExpectedActionId ${psQuote(actionId)} -ProductionRoot ${psQuote(fixtureRoot)} | ConvertTo-Json -Compress`,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).Valid, false);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("database release decision permits only a fresh volume set", () => {
  const command = [
    "$cases = @(",
    "  (Get-EasyFireDatabaseReleaseDecision -HasExistingVolume $false),",
    "  (Get-EasyFireDatabaseReleaseDecision -HasExistingVolume $true),",
    "  (Get-EasyFireDatabaseReleaseDecision -HasExistingVolume $true -PriorJournalValid $true -ObservedEngineVersion '10.2.44' -PriorEngineVersion '10.2.44' -ObservedImageId 'sha256:old' -PriorImageId 'sha256:old' -ObservedVolumeName 'prod' -PriorVolumeName 'prod' -CandidateEngineVersion '11.8.6'),",
    "  (Get-EasyFireDatabaseReleaseDecision -HasExistingVolume $true -PriorJournalValid $true -ObservedEngineVersion '11.8.6' -PriorEngineVersion '11.8.6' -ObservedImageId 'sha256:new' -PriorImageId 'sha256:new' -ObservedVolumeName 'prod' -PriorVolumeName 'prod' -CandidateEngineVersion '11.8.6')",
    "); $cases | ConvertTo-Json -Compress",
  ].join(" ");
  const result = invokePowerShell(command);

  assert.equal(result.status, 0, result.stderr);
  const decisions = JSON.parse(result.stdout);
  assert.deepEqual(
    decisions.map(({ Allowed, Mode, Reason }) => ({ Allowed, Mode, Reason })),
    [
      { Allowed: true, Mode: "fresh", Reason: "no_existing_volume" },
      {
        Allowed: false,
        Mode: "blocked",
        Reason: "DATABASE_ENGINE_MIGRATION_REQUIRED",
      },
      {
        Allowed: false,
        Mode: "blocked",
        Reason: "DATABASE_ENGINE_MIGRATION_REQUIRED",
      },
      {
        Allowed: false,
        Mode: "blocked",
        Reason: "DATABASE_ENGINE_MIGRATION_REQUIRED",
      },
    ],
  );
});
