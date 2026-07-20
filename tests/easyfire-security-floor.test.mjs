import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (path) =>
  JSON.parse(readFileSync(resolve(root, path), "utf8"));
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("critical production dependency floors stay patched", () => {
  const rootPackage = readJson("package.json");
  const serverPackage = readJson("packages/server/package.json");
  const webappPackage = readJson("packages/webapp/package.json");
  const emailPackage = readJson("shared/email-components/package.json");
  const pdfPackage = readJson("shared/pdf-templates/package.json");
  const workspace = read("pnpm-workspace.yaml");
  const lockfile = read("pnpm-lock.yaml");
  const appModule = read("packages/server/src/modules/App/App.module.ts");
  const main = read("packages/server/src/main.ts");

  assert.equal(serverPackage.dependencies["form-data"], "^4.0.6");
  assert.equal(serverPackage.dependencies["@casl/ability"], "^6.8.1");
  assert.equal(webappPackage.dependencies["@casl/ability"], "^6.8.1");
  assert.equal(webappPackage.dependencies["@casl/react"], "^6.0.0");
  assert.match(workspace, /^\s+fast-xml-parser: 4\.5\.7$/m);
  for (const nestPackage of [
    "@nestjs/common",
    "@nestjs/core",
    "@nestjs/platform-express",
    "@nestjs/platform-socket.io",
    "@nestjs/websockets",
  ]) {
    assert.equal(serverPackage.dependencies[nestPackage], "10.4.20");
  }
  assert.equal(serverPackage.devDependencies["@nestjs/testing"], "10.4.20");
  assert.equal(serverPackage.dependencies.axios, "1.18.1");
  assert.equal(webappPackage.dependencies.axios, "1.18.1");
  assert.equal(serverPackage.dependencies["class-validator"], "0.14.2");
  assert.equal(serverPackage.dependencies.lodash, "4.18.1");
  assert.equal(webappPackage.dependencies.lodash, "4.18.1");
  assert.equal(serverPackage.dependencies.bcrypt, "6.0.0");
  assert.equal(serverPackage.dependencies.multer, "2.2.0");
  assert.equal(serverPackage.dependencies.nodemailer, "9.0.1");
  assert.equal(serverPackage.dependencies["socket.io"], "4.8.3");
  assert.equal(webappPackage.dependencies["js-cookie"], "3.0.7");
  assert.equal(webappPackage.dependencies.semver, "6.3.1");
  assert.equal(webappPackage.dependencies["socket.io-client"], "4.8.3");
  assert.equal(rootPackage.devDependencies.tsup, "^8.3.0");
  assert.equal(rootPackage.dependencies?.tsup, undefined);
  assert.equal(emailPackage.devDependencies["vite-plugin-dts"], "^4.3.0");
  assert.equal(emailPackage.dependencies["vite-plugin-dts"], undefined);
  for (const buildOnlyDependency of [
    "cross-env",
    "dotenv-webpack",
    "eslint",
    "sass",
  ]) {
    assert.equal(
      webappPackage.devDependencies[buildOnlyDependency],
      {
        "cross-env": "^7.0.2",
        "dotenv-webpack": "^8.0.1",
        eslint: "^8.33.0",
        sass: "^1.68.0",
      }[buildOnlyDependency],
    );
    assert.equal(webappPackage.dependencies[buildOnlyDependency], undefined);
  }
  for (const buildOnlyDependency of [
    "@typescript-eslint/eslint-plugin",
    "@typescript-eslint/parser",
  ]) {
    assert.equal(webappPackage.devDependencies[buildOnlyDependency], "^2.10.0");
    assert.equal(webappPackage.dependencies[buildOnlyDependency], undefined);
  }
  for (const buildOnlyDependency of [
    "@types/lodash",
    "css-loader",
    "declaration-bundler-webpack-plugin",
    "fork-ts-checker-webpack-plugin",
    "style-loader",
    "tailwindcss",
    "ts-loader",
    "webpack",
    "webpack-cli",
  ]) {
    assert.equal(pdfPackage.dependencies[buildOnlyDependency], undefined);
    assert.ok(
      pdfPackage.devDependencies[buildOnlyDependency],
      `missing PDF build-only dev dependency: ${buildOnlyDependency}`,
    );
  }
  assert.equal(serverPackage.devDependencies["@types/multer"], "2.1.0");
  assert.equal(serverPackage.dependencies["@types/multer"], undefined);
  assert.equal(
    serverPackage.dependencies.xlsx,
    "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz",
  );
  for (const removed of [
    "@nestjs/serve-static",
    "express-validator",
    "nestjs-redis",
    "serialize-interceptor",
  ]) {
    assert.equal(serverPackage.dependencies[removed], undefined);
  }
  assert.equal(webappPackage.dependencies.plaid, undefined);
  for (const override of [
    "multer: 2.2.0",
    "cross-spawn@7: 7.0.6",
    "lodash: 4.18.1",
    "lodash-es: 4.18.1",
    "validator: 13.15.35",
    "fast-uri: 3.1.2",
    "fast-loops: 1.1.4",
    "glob@10: 10.5.0",
    "jws: 3.2.3",
    "linkify-it: 5.0.1",
    "js-cookie: 3.0.7",
    '"minimatch@3": 3.1.4',
    '"minimatch@5": 5.1.8',
    '"minimatch@9": 9.0.7',
    "picomatch@2: 2.3.2",
    "socket.io: 4.8.3",
    "socket.io-parser: 4.2.6",
    "ws: 8.21.0",
    '"plaid@10>axios": 0.33.0',
    '"posthog-node@4>axios": 1.18.1',
    '"@nestjs/platform-express@10>express": 4.22.2',
    '"@bull-board/express@5>express": 4.22.2',
    '"express@4>path-to-regexp": 0.1.13',
    '"react-router@5>path-to-regexp": 1.9.0',
  ]) {
    assert.ok(
      workspace.includes(override),
      `missing workspace override: ${override}`,
    );
  }
  assert.match(lockfile, /@nestjs\/common@10\.4\.20/);
  assert.match(lockfile, /@nestjs\/testing@10\.4\.20/);
  assert.match(lockfile, /axios@1\.18\.1/);
  assert.match(lockfile, /class-validator@0\.14\.2/);
  assert.match(lockfile, /lodash@4\.18\.1/);
  assert.match(lockfile, /bcrypt@6\.0\.0/);
  assert.match(lockfile, /multer@2\.2\.0/);
  assert.match(lockfile, /nodemailer@9\.0\.1/);
  assert.match(lockfile, /socket\.io@4\.8\.3/);
  assert.match(lockfile, /js-cookie@3\.0\.7/);
  assert.doesNotMatch(lockfile, /js-cookie@2\.2\.1/);
  assert.match(lockfile, /minimatch@3\.1\.4/);
  assert.match(lockfile, /minimatch@5\.1\.8/);
  assert.match(lockfile, /minimatch@9\.0\.7/);
  assert.match(lockfile, /glob@10\.5\.0/);
  assert.doesNotMatch(lockfile, /glob@10\.4\.2/);
  assert.match(lockfile, /picomatch@2\.3\.2/);
  assert.doesNotMatch(lockfile, /picomatch@2\.3\.1/);
  assert.match(lockfile, /cross-spawn@7\.0\.6/);
  assert.doesNotMatch(lockfile, /cross-spawn@7\.0\.3/);
  assert.match(lockfile, /semver@6\.3\.1/);
  assert.match(lockfile, /socket\.io-client@4\.8\.3/);
  assert.match(lockfile, /jws@3\.2\.3/);
  assert.match(lockfile, /lodash-es@4\.18\.1/);
  assert.match(lockfile, /ws@8\.21\.0/);
  assert.match(
    lockfile,
    /xlsx@https:\/\/cdn\.sheetjs\.com\/xlsx-0\.20\.3\/xlsx-0\.20\.3\.tgz:[\s\S]*?integrity: sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP\+Neh0SJUzV\/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH\+3AJA==/,
  );
  assert.doesNotMatch(lockfile, /^  '@nestjs\/serve-static@/m);
  assert.doesNotMatch(lockfile, /^  nestjs-redis@/m);
  assert.doesNotMatch(lockfile, /^  serialize-interceptor@/m);
  assert.doesNotMatch(appModule, /ServeStaticModule/);
  assert.match(
    main,
    /app\.useStaticAssets\(global\.__public_dirname,\s*\{\s*prefix:\s*['"]\/public['"]\s*\}\)/,
  );
  assert.equal(emailPackage.devDependencies.vitest, "^3.2.7");
  assert.equal(emailPackage.dependencies.vitest, undefined);
});

test("production JWT and signup configuration fail closed", () => {
  const jwtConfig = read("packages/server/src/common/config/jwt.ts");
  const signupConfig = read(
    "packages/server/src/common/config/signup-restrictions.ts",
  );
  const compose = read("docker-compose.prod.yml");
  const productionEnv = read(".env.production.example");
  const productionAction = read("deploy/windows/production-action.ps1");
  const jwtStrategy = read(
    "packages/server/src/modules/Auth/strategies/Jwt.strategy.ts",
  );
  const e2eWorkflow = read(".github/workflows/e2e.yml");

  assert.doesNotMatch(jwtConfig, /123123/);
  assert.match(jwtConfig, /NODE_ENV\s*===\s*['"]production['"]/);
  assert.match(jwtConfig, /APP_JWT_SECRET/);
  assert.match(signupConfig, /NODE_ENV\s*===\s*['"]production['"]/);
  assert.match(
    compose,
    /APP_JWT_SECRET=\$\{APP_JWT_SECRET:\?APP_JWT_SECRET must be configured\}/,
  );
  assert.match(
    compose,
    /SIGNUP_DISABLED=\$\{SIGNUP_DISABLED:\?SIGNUP_DISABLED must be configured\}/,
  );
  assert.doesNotMatch(compose, /- JWT_SECRET=/);
  assert.match(productionEnv, /^APP_JWT_SECRET=/m);
  assert.doesNotMatch(productionEnv, /^JWT_SECRET=/m);
  assert.match(productionAction, /"APP_JWT_SECRET=\$jwtSecret"/);
  assert.doesNotMatch(productionAction, /^JWT_SECRET=\$jwtSecret$/m);
  assert.match(jwtStrategy, /algorithms:\s*\[['"]HS384['"]\]/);
  assert.doesNotMatch(e2eWorkflow, /^\s*JWT_SECRET=/m);
  assert.match(e2eWorkflow, /APP_JWT_SECRET=.{64,}/);
  assert.match(e2eWorkflow, /Server did not become healthy within 60 seconds/);
});

test("standalone restore is a non-mutating retired compatibility entry point", () => {
  const restore = read("scripts/production/restore.ps1");

  assert.match(restore, /retired standalone restore entry point/i);
  assert.match(restore, /not an authorized production mutation path/i);
  assert.doesNotMatch(
    restore,
    /^\s*(docker|Remove-Item|Move-Item|Register-ScheduledTask|Unregister-ScheduledTask|Invoke-RestMethod)\b/im,
  );
  assert.doesNotMatch(restore, /Read-Host|RESTORE/);
});

test("retired restore refuses every invocation before inspecting backup data", () => {
  const restore = resolve(root, "scripts/production/restore.ps1");
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      restore,
      "-BackupFile",
      "C:\\definitely-missing\\backup.sql.gz",
      "-DryRun",
    ],
    { encoding: "utf8" },
  );

  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /retired standalone restore entry point|not an authorized production mutation path/i,
  );
});

test("a matching hash cannot make invalid gzip data a verified backup", () => {
  const fixtureRoot = mkdtempSync(
    resolve(tmpdir(), "easyfire-backup-integrity-"),
  );
  const backup = resolve(fixtureRoot, "mysql-proof-full-20260719.sql.gz");
  const sidecar = backup.replace(/\.sql\.gz$/, ".sha256");
  const invalidArchive = Buffer.from("not-a-gzip-archive", "utf8");
  const sha256 = createHash("sha256").update(invalidArchive).digest("hex");
  const modulePath = resolve(root, "scripts/production/backup-integrity.psm1");

  try {
    writeFileSync(backup, invalidArchive);
    writeFileSync(
      sidecar,
      `${sha256}  mysql-proof-full-20260719.sql.gz`,
      "utf8",
    );
    const escapedModule = modulePath.replaceAll("'", "''");
    const escapedBackup = backup.replaceAll("'", "''");
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Import-Module '${escapedModule}' -Force; Test-EasyFireBackupPair -BackupFile '${escapedBackup}' | ConvertTo-Json -Compress`,
      ],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    const verification = JSON.parse(result.stdout.trim());
    assert.equal(verification.Valid, false);
    assert.equal(verification.Reason, "gzip_invalid");
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("retired standalone rollback cannot reach Docker", () => {
  const fixtureRoot = mkdtempSync(
    resolve(tmpdir(), "easyfire-retired-rollback-"),
  );
  const fakeDocker = resolve(fixtureRoot, "docker.cmd");
  const sentinel = resolve(fixtureRoot, "called.txt");
  const rollback = resolve(root, "scripts/production/rollback.ps1");

  try {
    writeFileSync(
      fakeDocker,
      '@echo off\r\necho called>"%~dp0called.txt"\r\nexit /b 99\r\n',
      "utf8",
    );
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        rollback,
        "-TargetImageTag",
        "synthetic-retired-proof",
      ],
      {
        encoding: "utf8",
        env: { ...process.env, PATH: `${fixtureRoot};${process.env.PATH}` },
      },
    );

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /RETIRED/i);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /production-action\.ps1 -Stage Rollback/,
    );
    assert.equal(existsSync(sentinel), false);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("retired owner bootstrap fails closed at every stage without Docker", () => {
  const fixtureRoot = mkdtempSync(
    resolve(tmpdir(), "easyfire-retired-owner-bootstrap-"),
  );
  const fakeDocker = resolve(fixtureRoot, "docker.cmd");
  const sentinel = resolve(fixtureRoot, "called.txt");
  const bootstrapOwner = resolve(
    root,
    "scripts/production/bootstrap-owner.ps1",
  );
  const stages = ["Preflight", "Action", "Postcheck", "Rollback"];

  try {
    writeFileSync(
      fakeDocker,
      '@echo off\r\necho called>"%~dp0called.txt"\r\nexit /b 99\r\n',
      "utf8",
    );

    for (const stage of stages) {
      const result = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          bootstrapOwner,
          "-Stage",
          stage,
        ],
        {
          encoding: "utf8",
          env: { ...process.env, PATH: `${fixtureRoot};${process.env.PATH}` },
        },
      );
      const output = `${result.stdout}\n${result.stderr}`;

      assert.notEqual(result.status, 0, `${stage} unexpectedly succeeded`);
      assert.match(output, /RETIRED/i, `${stage} did not report retirement`);
      assert.match(
        output,
        /No API, Docker, database, task, service, credential, or filesystem mutation was attempted/i,
        `${stage} did not report its fail-closed boundary`,
      );
      assert.equal(existsSync(sentinel), false, `${stage} invoked Docker`);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("production controller rejects invalid and prior action IDs before Docker", () => {
  const fixtureRoot = mkdtempSync(
    resolve(tmpdir(), "easyfire-controller-gate-"),
  );
  const fakeDocker = resolve(fixtureRoot, "docker.cmd");
  const sentinel = resolve(fixtureRoot, "called.txt");
  const action = resolve(root, "deploy/windows/production-action.ps1");
  const baseArguments = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    action,
    "-Stage",
    "Preflight",
    "-ReleaseArchive",
    resolve(fixtureRoot, "missing.zip"),
    "-ExpectedArchiveSha256",
    "0".repeat(64),
    "-ProductionRoot",
    fixtureRoot,
    "-CloudflareCredentialFile",
    resolve(fixtureRoot, "missing.json"),
  ];

  try {
    writeFileSync(
      fakeDocker,
      '@echo off\r\necho called>"%~dp0called.txt"\r\nexit /b 99\r\n',
      "utf8",
    );
    let result = spawnSync(
      "powershell.exe",
      [...baseArguments, "-ActionId", "../invalid"],
      {
        encoding: "utf8",
        env: { ...process.env, PATH: `${fixtureRoot};${process.env.PATH}` },
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /canonical GUID/i);
    assert.equal(existsSync(sentinel), false);

    result = spawnSync(
      "powershell.exe",
      [
        ...baseArguments,
        "-ActionId",
        "870c9e12-916c-458f-b076-88b1fcd99a1b",
        "-PriorActionId",
        "3ca632c0-4f63-4a8c-bfa0-59b0cba8ee73",
      ],
      {
        encoding: "utf8",
        env: { ...process.env, PATH: `${fixtureRoot};${process.env.PATH}` },
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /DATABASE_ENGINE_MIGRATION_REQUIRED/,
    );
    assert.equal(existsSync(sentinel), false);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("canonical production action is confirmation-bound and fail-closed", () => {
  const action = read("deploy/windows/production-action.ps1");
  const io = read("deploy/windows/production-io.psm1");
  const state = read("deploy/windows/production-state.psm1");
  const backup = read("scripts/production/backup.ps1");
  const restoreVerify = read("scripts/production/restore-verify.ps1");

  assert.match(action, /ConfirmActionId is required for Stage Action/);
  assert.match(action, /ConvertTo-EasyFireCanonicalActionId/);
  assert.match(action, /A current Preflight receipt is required/);
  assert.match(action, /Journal compare-and-swap authority changed/);
  assert.match(state, /Global\\EasyFireBookkeepingProduction/);
  assert.match(state, /Get-EasyFireBackupMutexName/);
  assert.match(action, /FRESH_INSTALL_ONLY/);
  assert.match(action, /DATABASE_ENGINE_MIGRATION_REQUIRED/);
  assert.match(action, /ReservedVolumeNames/);
  assert.match(action, /bigcapital_prod_mysql/);
  assert.match(action, /Get-EasyFireZipManifest/);
  assert.match(action, /Release archive must not contain a runtime \.env file/);
  assert.match(action, /EnvironmentSha256/);
  assert.match(
    action,
    /Runtime environment no longer matches the journal authority/,
  );
  assert.match(
    state,
    /Journal environment SHA-256 authority is missing or invalid/,
  );
  assert.match(action, /MARIADB_IMAGE_TAG=\$\(\$script:MariaDbImageTag\)/);
  assert.match(
    action,
    /MARIADB_VOLUME_NAME=\$\(\$script:ExpectedMysqlVolume\)/,
  );
  assert.match(action, /action_completed_pending_postcheck/);
  assert.match(action, /ApprovedInventoryFingerprint/);
  assert.match(action, /Postcheck refuses to adopt changed container/);
  assert.match(action, /Server runtime signup lock is not exact/);
  assert.match(action, /BaselineBackup/);
  assert.match(action, /-Kind 'Emergency'/);
  assert.match(action, /Enter-EasyFireBackupFence/);
  assert.match(action, /DurableVolumeFingerprint/);
  assert.match(action, /ROLLBACK_PASSED_VOLUMES_PRESERVED/);
  assert.match(action, /Retired scheduled task must be absent/);
  assert.match(action, /\$task\.TaskPath/);
  assert.match(action, /ExecutionTimeLimit.*PT2H/s);
  assert.match(
    action,
    /Assert-EasyFireAuthorityPathChain -Path \$Path -TrustedRoot \$script:ResolvedProductionRoot/,
  );
  assert.match(action, /credentials\\cloudflare\.json/);
  assert.match(action, /\[IO\.File\]::Open/);
  assert.match(action, /ControllerBundleAuthority/);
  assert.match(state, /Get-EasyFireExecutableBundleAuthority/);
  assert.match(action, /BuiltImageAuthority/);
  assert.match(io, /Get-EasyFireExpectedImageAuthority/);
  assert.match(action, /migration_preparing/);
  assert.match(action, /'create', '--no-build', 'database_migration'/);
  assert.match(action, /StartAuthorizedAtUtc/);
  assert.match(action, /DurableVolumePlan/);
  assert.match(action, /Assert-EasyFireRollbackReadback/);
  assert.match(action, /ScheduledBackup/);
  assert.match(action, /BACKUP_PUBLISHED/);
  assert.match(action, /ForeignVolumeConsumers/);
  assert.match(action, /127\.0\.0\.1:80 to 80\/tcp/);
  assert.match(
    action,
    /Assert-EasyFireNoReparsePathChain -Path \$script:ResolvedReleaseArchive/,
  );
  assert.doesNotMatch(action, /--force-recreate/);
  assert.match(backup, /Get-EasyFireBackupMutexName/);
  assert.match(backup, /Get-EasyFirePinnedBackupNames/);
  assert.match(backup, /BaselineBackup.*EmergencyBackup/s);
  assert.match(
    action,
    /\$existingEmergencyReceipt[\s\S]*if \(-not \$existingEmergencyReceipt\)[\s\S]*\$mysql[\s\S]*Get-EasyFireVerifiedBackupReceipt -Journal \$Journal -Kind 'Emergency'[\s\S]*Enter-EasyFireBackupFence/,
  );
  assert.doesNotMatch(action, /\bRemove-Item\b|--volumes|\bvolume\s+rm\b/);
  assert.doesNotMatch(action, /\bNew-Service\b|\bRemove-Service\b|sc\.exe/);
  assert.doesNotMatch(io, /Method\s*=\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);
  assert.match(io, /Method\s*=\s*'GET'/);
  assert.match(io, /service token does not belong to the verified tunnel/);
  assert.match(io, /is_pending_reconnect/);
  assert.match(restoreVerify, /--network none/);
  assert.match(restoreVerify, /Test-EasyFireBackupPair/);
});
