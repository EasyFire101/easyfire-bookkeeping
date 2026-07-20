import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

const NODE_IMAGE =
  "node:22.23.1-alpine3.23@sha256:8516dce0483394d5708d4b2ee6cacb79fb1d617ea4e2787c2120bcca92ce372e";

test("Node and pnpm are supported and consistently pinned", () => {
  const packageJson = JSON.parse(read("package.json"));

  assert.equal(read(".nvmrc").trim(), "22.23.1");
  assert.equal(packageJson.packageManager, "pnpm@10.34.5");
  assert.equal(packageJson.engines.node, ">=22.0.0 <23");
  assert.match(
    read("pnpm-workspace.yaml"),
    /allowBuilds:[\s\S]*bcrypt: true[\s\S]*esbuild: true[\s\S]*msgpackr-extract: true[\s\S]*nx: true/,
  );

  for (const path of [
    "packages/server/Dockerfile",
    "packages/webapp/Dockerfile",
    "docker/migration/Dockerfile",
  ]) {
    const dockerfile = read(path);
    assert.match(dockerfile, new RegExp(NODE_IMAGE.replaceAll("/", "\\/")));
    assert.match(dockerfile, /corepack prepare pnpm@10\.34\.5 --activate/);
    assert.doesNotMatch(dockerfile, /npm install -g pnpm|pnpm add/);
    const installs = [...dockerfile.matchAll(/pnpm install[^\r\n]*/g)].map(
      ([command]) => command,
    );
    assert.ok(installs.length > 0, `${path} must install through pnpm`);
    for (const command of installs) {
      assert.match(command, /--network-concurrency=8/);
      assert.match(command, /--fetch-retries=5/);
      assert.match(command, /--fetch-retry-mintimeout=2000/);
      assert.match(command, /--fetch-retry-maxtimeout=60000/);
    }
  }

  assert.match(
    read("packages/webapp/Dockerfile"),
    /pnpm install --frozen-lockfile/,
  );
});

test("production images and release tags are immutable", () => {
  const compose = read("docker-compose.prod.yml");

  for (const image of [
    "envoyproxy/envoy:v1.30.11@sha256:b5cc70f5fe5503858817e897ae1da5d873dc32cbc493790b4e330b8a42c4af9d",
    "gotenberg/gotenberg:7.10.2@sha256:d03b8a04c6e6c5e568b38f57352266dee4674849b71818774025f8f48d869a9a",
  ]) {
    assert.match(compose, new RegExp(image.replaceAll("/", "\\/")));
  }
  assert.match(
    compose,
    /\$\{IMAGE_TAG:\?IMAGE_TAG must be an immutable release tag\}/,
  );
  assert.match(
    compose,
    /\$\{MARIADB_IMAGE_TAG:\?MARIADB_IMAGE_TAG must be an immutable database release tag\}/,
  );
  assert.match(
    compose,
    /\$\{MARIADB_VOLUME_NAME:\?MARIADB_VOLUME_NAME must identify the durable database volume\}/,
  );
  assert.match(
    compose,
    /\$\{REDIS_VOLUME_NAME:\?REDIS_VOLUME_NAME must identify the durable Redis volume\}/,
  );
  assert.doesNotMatch(compose, /MARIADB_AUTO_UPGRADE/);
  assert.doesNotMatch(
    compose,
    /IMAGE_TAG:-latest|v1\.30-latest|gotenberg:7(?:\s|$)/m,
  );

  assert.match(
    read("docker/mariadb/Dockerfile"),
    /mariadb:11\.8\.6@sha256:78a5047d3ba33975f183f183c2464cc7f1eab13ec8667e57cc9a5821d6da7577/,
  );
  assert.match(
    read("docker/redis/Dockerfile"),
    /redis:7\.4\.9-alpine3\.21@sha256:6ab0b6e7381779332f97b8ca76193e45b0756f38d4c0dcda72dbb3c32061ab99/,
  );
  assert.match(
    read("packages/webapp/Dockerfile"),
    /nginx:1\.30\.4-alpine3\.24@sha256:97d490c12ba55b4946b01546d1c3ed324e8d41ab1c9fcb2a616aa470620e5b46/,
  );
});

test("downloaded production executables and scripts are versioned and verified", () => {
  const migration = read("docker/migration/Dockerfile");
  const productionIo = read("deploy/windows/production-io.psm1");

  assert.match(migration, /81b1373f17855a4dc21156cfe1694c31d7d1792e/);
  assert.match(
    migration,
    /b7a04f38de1e51e7455ecf63151c8c7e405bd2d45a2d4e16f6419db737a125d6/,
  );
  assert.match(migration, /sha256sum -c/);
  assert.match(migration, /--strict/);
  assert.match(migration, /--timeout=60/);
  assert.doesNotMatch(migration, /wait-for-it\/master/);

  assert.match(
    productionIo,
    /CCB0756DE288D3C2C076D19764CA53E0849A10F2DD9C23F8656AC42BDEB45001/,
  );
  assert.match(
    productionIo,
    /Get-EasyFireSha256Hex -Path \$expectedExecutable/,
  );
  assert.match(
    productionIo,
    /Join-Path \$\{env:ProgramFiles\} 'cloudflared\\cloudflared\.exe'/,
  );
  assert.match(productionIo, /--no-autoupdate/);
  assert.doesNotMatch(productionIo, /releases\/latest\/download/);
  assert.match(
    productionIo,
    /\^"'\s*\+\s*\[regex\]::Escape\(\$expectedExecutable\)/,
  );
});

test("standalone production helpers default to the production Compose project", () => {
  for (const path of [
    "scripts/production/backup.ps1",
    "scripts/production/preflight.ps1",
    "scripts/production/postcheck.ps1",
    "scripts/production/restore.ps1",
    "scripts/production/rollback.ps1",
  ]) {
    assert.match(
      read(path),
      /ProjectName\s*=\s*["']easyfire-bookkeeping-prod["']/,
      path,
    );
  }
});

test("standalone startup and task-template entry points are retired", () => {
  for (const path of [
    "deploy/windows/start-stack.ps1",
    "deploy/windows/startup-commands.ps1",
  ]) {
    const helper = read(path);
    assert.match(helper, /RETIRED:/);
    assert.doesNotMatch(
      helper,
      /\bdocker\b|Register-ScheduledTask|New-ScheduledTaskAction/,
      path,
    );
  }
});

test("server production image receives every directly imported runtime package", () => {
  const serverPackage = JSON.parse(read("packages/server/package.json"));

  assert.equal(serverPackage.dependencies.mustache, "^3.0.3");
  assert.equal(serverPackage.devDependencies.mustache, undefined);
});

test("every tenant connection honors the configured database prefix", () => {
  const tenancyModule = read(
    "packages/server/src/modules/Tenancy/TenancyDB/TenancyDB.module.ts",
  );

  assert.match(tenancyModule, /tenantDatabase\.dbNamePrefix/);
  assert.doesNotMatch(tenancyModule, /bigcapital_tenant_/);
  assert.match(tenancyModule, /loadExtensions:\s*\['\.js', '\.ts'\]/);
});
