import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = resolve(root, "deploy/windows/production-io.psm1");
const psQuote = (value) => `'${String(value).replaceAll("'", "''")}'`;

function invokePowerShell(command) {
  return spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Import-Module ${psQuote(modulePath)} -Force -ErrorAction Stop; ${command}`,
    ],
    { encoding: "utf8" },
  );
}

function createZip(source, archive) {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      [
        "Add-Type -AssemblyName System.IO.Compression.FileSystem;",
        `[System.IO.Compression.ZipFile]::CreateFromDirectory(${psQuote(source)}, ${psQuote(archive)})`,
      ].join(" "),
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
}

test("release manifest uses linear materialization and handles 15,000 files", () => {
  const source = readFileSync(modulePath, "utf8");
  assert.match(
    source,
    /Collections\.Generic\.List\[object\]/,
    "the manifest must not grow a PowerShell array once per file",
  );
  assert.doesNotMatch(source, /\$entries\s*\+=/);

  const fixtureRoot = mkdtempSync(
    resolve(tmpdir(), "easyfire-manifest-scale-"),
  );
  try {
    for (let directory = 0; directory < 150; directory += 1) {
      const folder = resolve(fixtureRoot, String(directory).padStart(3, "0"));
      mkdirSync(folder);
      for (let file = 0; file < 100; file += 1) {
        writeFileSync(
          resolve(folder, `${String(file).padStart(3, "0")}.txt`),
          `${directory}:${file}`,
          "utf8",
        );
      }
    }

    const started = performance.now();
    const result = invokePowerShell(
      [
        `$m = Get-EasyFireReleaseManifest -ReleaseDirectory ${psQuote(fixtureRoot)};`,
        `[pscustomobject]@{ FileCount = $m.FileCount; EntryCount = @($m.Entries).Count; First = $m.Entries[0].Path; Last = $m.Entries[$m.Entries.Count - 1].Path; Sha256 = $m.Sha256 } | ConvertTo-Json -Compress`,
      ].join(" "),
    );
    const elapsedMs = performance.now() - started;
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(result.stdout);
    assert.deepEqual(manifest, {
      FileCount: 15000,
      EntryCount: 15000,
      First: "000/000.txt",
      Last: "149/099.txt",
      Sha256: manifest.Sha256,
    });
    assert.match(manifest.Sha256, /^[A-F0-9]{64}$/);
    assert.ok(
      elapsedMs < 90000,
      `15,000-file manifest took ${Math.round(elapsedMs)}ms`,
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("expected image authority is exact, canonical, and immutable during comparison", () => {
  const serverId = `sha256:${"a".repeat(64)}`;
  const workerId = `sha256:${"b".repeat(64)}`;
  const fakeDocker = [
    `$module = Get-Module production-io;`,
    `& $module { $script:EasyFireImageIds = @{ 'easyfire/server:sealed' = '${serverId}'; 'easyfire/worker:sealed' = '${workerId}' }; function script:Invoke-EasyFireNative { param([string]$FilePath,[string[]]$ArgumentList,[switch]$AllowFailure) $reference = [string]$ArgumentList[2]; if (-not $script:EasyFireImageIds.ContainsKey($reference)) { throw ('Missing fake image: ' + $reference) }; $item = [pscustomobject]@{ Id = $script:EasyFireImageIds[$reference]; RepoTags = @($reference); RepoDigests = @() }; $json = $item | ConvertTo-Json -Depth 5 -Compress; $text = '[' + $json + ']'; [pscustomobject]@{ ExitCode = 0; Output = @($text); Text = $text } } };`,
  ].join(" ");
  const command = [
    fakeDocker,
    `$a = Get-EasyFireExpectedImageAuthority -ImageReferences @('easyfire/worker:sealed','easyfire/server:sealed');`,
    `$before = $a | ConvertTo-Json -Depth 20 -Compress;`,
    `$copy = $before | ConvertFrom-Json;`,
    `$equal = Test-EasyFireExpectedImageAuthorityEqual -EstablishedAuthority $a -ObservedAuthority $copy;`,
    `$copy.Images[0].ImageId = 'sha256:${"c".repeat(64)}';`,
    `$different = Test-EasyFireExpectedImageAuthorityEqual -EstablishedAuthority $a -ObservedAuthority $copy;`,
    `$after = $a | ConvertTo-Json -Depth 20 -Compress;`,
    `[pscustomobject]@{ Authority = $a; Equal = $equal; Different = $different; Unchanged = ($before -ceq $after) } | ConvertTo-Json -Depth 20 -Compress`,
  ].join(" ");
  const result = invokePowerShell(command);
  assert.equal(result.status, 0, result.stderr);
  const proof = JSON.parse(result.stdout);
  assert.equal(proof.Equal, true);
  assert.equal(proof.Different, false);
  assert.equal(proof.Unchanged, true);
  assert.equal(proof.Authority.SchemaVersion, 1);
  assert.equal(proof.Authority.ImageCount, 2);
  assert.deepEqual(proof.Authority.Images, [
    { Reference: "easyfire/server:sealed", ImageId: serverId },
    { Reference: "easyfire/worker:sealed", ImageId: workerId },
  ]);
  assert.deepEqual(proof.Authority.ReferenceToImageId, {
    "easyfire/server:sealed": serverId,
    "easyfire/worker:sealed": workerId,
  });
  assert.match(proof.Authority.Fingerprint, /^[A-F0-9]{64}$/);

  for (const references of [
    "@('easyfire/server:sealed','easyfire/server:sealed')",
    "@('-malformed:tag')",
    "@('easyfire/missing:sealed')",
  ]) {
    const failure = invokePowerShell(
      `${fakeDocker} Get-EasyFireExpectedImageAuthority -ImageReferences ${references}`,
    );
    assert.notEqual(failure.status, 0, `${references} must fail closed`);
  }
});

test("ZIP release extraction rejects runtime env files and preserves failed evidence", () => {
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), "easyfire-zip-release-"));
  const releases = resolve(fixtureRoot, "releases");
  const safeSource = resolve(fixtureRoot, "safe-source");
  const unsafeSource = resolve(fixtureRoot, "unsafe-source");
  const safeArchive = resolve(fixtureRoot, "safe.zip");
  const unsafeArchive = resolve(fixtureRoot, "unsafe.zip");
  const safeDestination = resolve(releases, "SAFE");
  const unsafeDestination = resolve(releases, "UNSAFE");
  const actionId = "870c9e12-916c-458f-b076-88b1fcd99a1b";

  try {
    mkdirSync(releases);
    mkdirSync(safeSource);
    writeFileSync(resolve(safeSource, "release.txt"), "sealed", "utf8");
    createZip(safeSource, safeArchive);
    let result = invokePowerShell(
      `Expand-EasyFireZipRelease -ArchivePath ${psQuote(safeArchive)} -DestinationPath ${psQuote(safeDestination)} -ReleasesRoot ${psQuote(releases)} -ActionId ${psQuote(actionId)}`,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      readFileSync(resolve(safeDestination, "release.txt"), "utf8"),
      "sealed",
    );

    mkdirSync(unsafeSource);
    writeFileSync(resolve(unsafeSource, ".env"), "SECRET=forbidden", "utf8");
    createZip(unsafeSource, unsafeArchive);
    result = invokePowerShell(
      `Expand-EasyFireZipRelease -ArchivePath ${psQuote(unsafeArchive)} -DestinationPath ${psQuote(unsafeDestination)} -ReleasesRoot ${psQuote(releases)} -ActionId ${psQuote(actionId)}`,
    );
    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /must not contain a runtime \.env/i,
    );
    assert.equal(existsSync(unsafeDestination), false);
    assert.equal(
      existsSync(unsafeArchive),
      true,
      "failed archive evidence should be preserved",
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("inventory fingerprint binds container config, network, mount, and volume identity", () => {
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), "easyfire-inventory-"));
  const inventoryPath = resolve(fixtureRoot, "inventory.json");
  const base = {
    Containers: [
      {
        Id: "a".repeat(64),
        Name: "easyfire-server",
        Project: "easyfire-bookkeeping-prod",
        Service: "server",
        ComposeConfigHash: "b".repeat(64),
        ComposeOneOff: "False",
        ImageReference: "easyfire-bookkeeping/server:archive-proof",
        ImageId: `sha256:${"c".repeat(64)}`,
        RestartPolicy: "unless-stopped",
        RestartMaximumRetryCount: 0,
        PortBindings: [
          { ContainerPort: "80/tcp", HostIp: "127.0.0.1", HostPort: "8080" },
        ],
        Mounts: [
          {
            Type: "bind",
            Source: "C:\\sealed\\envoy.yaml",
            Destination: "/etc/envoy/envoy.yaml",
            Mode: "ro",
            ReadWrite: false,
            Propagation: "",
          },
        ],
        Networks: [
          {
            Name: "easyfire-bookkeeping-prod_bigcapital_network",
            NetworkId: "d".repeat(64),
            EndpointId: "e".repeat(64),
            IpAddress: "172.20.0.3",
            Aliases: ["server"],
          },
        ],
      },
    ],
    Networks: [
      {
        Id: "d".repeat(64),
        Name: "easyfire-bookkeeping-prod_bigcapital_network",
        Driver: "bridge",
        Scope: "local",
        Internal: false,
        Project: "easyfire-bookkeeping-prod",
        LogicalName: "bigcapital_network",
        Options: [],
      },
    ],
    Volumes: [
      {
        Name: "easyfire_prod_mysql_proof",
        CreatedAt: "2026-07-19T00:00:00Z",
        Driver: "local",
        Scope: "local",
        Project: "easyfire-bookkeeping-prod",
        LogicalName: "mysql",
        Options: [],
      },
    ],
    ReservedVolumeNames: ["easyfire_prod_mysql_proof"],
    ForeignVolumeConsumers: [
      {
        VolumeName: "easyfire_prod_mysql_proof",
        ContainerId: "f".repeat(64),
        ContainerName: "foreign-consumer",
        Project: "another-project",
        Service: "database",
        State: "exited",
        MountDestination: "/var/lib/mysql",
        ReadWrite: true,
      },
    ],
  };
  const fingerprint = (inventory) => {
    writeFileSync(inventoryPath, JSON.stringify(inventory), "utf8");
    const result = invokePowerShell(
      `$i = Get-Content -LiteralPath ${psQuote(inventoryPath)} -Raw | ConvertFrom-Json; Get-EasyFireInventoryFingerprint -Inventory $i`,
    );
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };

  try {
    const original = fingerprint(base);
    for (const mutate of [
      (value) => {
        value.Containers[0].ComposeConfigHash = "f".repeat(64);
      },
      (value) => {
        value.Containers[0].Networks[0].EndpointId = "1".repeat(64);
      },
      (value) => {
        value.Containers[0].Mounts[0].Destination = "/changed";
      },
      (value) => {
        value.Containers[0].RestartPolicy = "always";
      },
      (value) => {
        value.Containers[0].PortBindings[0].HostPort = "9090";
      },
      (value) => {
        value.Volumes[0].Scope = "global";
      },
      (value) => {
        value.ReservedVolumeNames.push("bigcapital_prod_mysql");
      },
      (value) => {
        value.ForeignVolumeConsumers[0].ContainerId = "2".repeat(64);
      },
    ]) {
      const changed = structuredClone(base);
      mutate(changed);
      assert.notEqual(fingerprint(changed), original);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("inventory exposes legacy, action-derived, and project-labeled volume conflicts", () => {
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), "easyfire-volume-scan-"));
  const docker = resolve(fixtureRoot, "docker.cmd");

  try {
    writeFileSync(
      docker,
      [
        "@echo off",
        'if "%1"=="ps" exit /b 0',
        'if "%1"=="network" exit /b 0',
        'if "%1"=="volume" (',
        "  echo bigcapital_prod_mysql",
        "  echo easyfire_prod_redis_0123456789ab",
        "  echo project_labeled_custom",
        "  exit /b 0",
        ")",
        "exit /b 1",
      ].join("\r\n"),
      "utf8",
    );
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Import-Module ${psQuote(modulePath)} -Force -ErrorAction Stop; (Get-EasyFireComposeInventory -ProjectName 'easyfire-bookkeeping-prod' -ExactVolumeNames @('easyfire_prod_mysql_aaaaaaaaaaaa','easyfire_prod_redis_aaaaaaaaaaaa') -LegacyVolumeNames @('bigcapital_prod_mysql','bigcapital_prod_redis')).ReservedVolumeNames | ConvertTo-Json -Compress`,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, PATH: `${fixtureRoot};${process.env.PATH}` },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [
      "bigcapital_prod_mysql",
      "easyfire_prod_redis_0123456789ab",
      "project_labeled_custom",
    ]);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("inventory captures exact host ports and foreign exact-volume consumers", () => {
  const fixtureRoot = mkdtempSync(
    resolve(tmpdir(), "easyfire-inventory-consumers-"),
  );
  const projectId = "a".repeat(64);
  const foreignId = "f".repeat(64);
  const mysqlVolume = "easyfire_prod_mysql_aaaaaaaaaaaa";
  const redisVolume = "easyfire_prod_redis_aaaaaaaaaaaa";
  const project = [
    {
      Id: projectId,
      Name: "/easyfire-server",
      Image: `sha256:${"1".repeat(64)}`,
      Config: {
        Image: "easyfire/server:sealed",
        Labels: {
          "com.docker.compose.project": "easyfire-bookkeeping-prod",
          "com.docker.compose.service": "server",
          "com.docker.compose.config-hash": "2".repeat(64),
          "com.docker.compose.oneoff": "False",
        },
      },
      State: { Status: "running" },
      HostConfig: {
        RestartPolicy: { Name: "unless-stopped", MaximumRetryCount: 0 },
        PortBindings: {
          "80/tcp": [
            { HostIp: "127.0.0.1", HostPort: "8080" },
            { HostIp: "::1", HostPort: "8080" },
          ],
        },
      },
      NetworkSettings: { Networks: {} },
      Mounts: [
        {
          Type: "volume",
          Name: mysqlVolume,
          Source: mysqlVolume,
          Destination: "/var/lib/mysql",
          Mode: "rw",
          RW: true,
          Propagation: "",
        },
      ],
    },
  ];
  const foreign = [
    {
      Id: foreignId,
      Name: "/foreign-consumer",
      Config: {
        Labels: {
          "com.docker.compose.project": "another-project",
          "com.docker.compose.service": "database",
        },
      },
      State: { Status: "exited" },
      Mounts: [
        {
          Type: "volume",
          Name: mysqlVolume,
          Source: mysqlVolume,
          Destination: "/foreign/mysql",
          Mode: "ro",
          RW: false,
          Propagation: "",
        },
      ],
    },
  ];

  try {
    writeFileSync(
      resolve(fixtureRoot, "project.json"),
      JSON.stringify(project),
    );
    writeFileSync(
      resolve(fixtureRoot, "foreign.json"),
      JSON.stringify(foreign),
    );
    for (const volume of [mysqlVolume, redisVolume]) {
      writeFileSync(
        resolve(fixtureRoot, `${volume}.json`),
        JSON.stringify([
          {
            Name: volume,
            CreatedAt: "2026-07-19T00:00:00Z",
            Driver: "local",
            Scope: "local",
            Labels: {
              "com.docker.compose.project": "easyfire-bookkeeping-prod",
              "com.docker.compose.volume": volume.includes("mysql")
                ? "mysql"
                : "redis",
            },
            Options: {},
          },
        ]),
      );
    }
    const command = [
      `$fixtureRoot = ${psQuote(fixtureRoot)};`,
      `$module = Get-Module production-io;`,
      `& $module { param($root) $script:EasyFireIoFixtureRoot = $root; function script:Invoke-EasyFireNative { param([string]$FilePath,[string[]]$ArgumentList,[switch]$AllowFailure) $argsText = $ArgumentList -join ' '; $output = @(); if ($argsText -eq 'volume ls --format {{.Name}}') { $output = @('${mysqlVolume}','${redisVolume}') } elseif ($argsText -like 'volume ls --filter label=*') { $output = @('${mysqlVolume}','${redisVolume}') } elseif ($argsText -like 'volume ls --filter name=*') { $output = @(([string]$ArgumentList[3]).Substring(5)) } elseif ($argsText -eq 'ps -a --filter label=com.docker.compose.project=easyfire-bookkeeping-prod --format {{.ID}}') { $output = @('${projectId}') } elseif ($argsText -like 'ps -a --filter volume=${mysqlVolume} *') { $output = @('${projectId}','${foreignId}') } elseif ($argsText -like 'ps -a --filter volume=${redisVolume} *') { $output = @() } elseif ($argsText -eq 'inspect ${projectId}') { $output = @(Get-Content -LiteralPath (Join-Path $script:EasyFireIoFixtureRoot 'project.json') -Raw) } elseif ($argsText -eq 'inspect ${foreignId}') { $output = @(Get-Content -LiteralPath (Join-Path $script:EasyFireIoFixtureRoot 'foreign.json') -Raw) } elseif ($argsText -eq 'network ls --filter label=com.docker.compose.project=easyfire-bookkeeping-prod --format {{.Name}}') { $output = @() } elseif ($argsText -eq 'volume inspect ${mysqlVolume}') { $output = @(Get-Content -LiteralPath (Join-Path $script:EasyFireIoFixtureRoot '${mysqlVolume}.json') -Raw) } elseif ($argsText -eq 'volume inspect ${redisVolume}') { $output = @(Get-Content -LiteralPath (Join-Path $script:EasyFireIoFixtureRoot '${redisVolume}.json') -Raw) } else { throw "Unexpected fake Docker call: $argsText" }; [pscustomobject]@{ ExitCode = 0; Output = $output; Text = ($output -join "\`n") } } } $fixtureRoot;`,
      `$inventory = Get-EasyFireComposeInventory -ProjectName 'easyfire-bookkeeping-prod' -ExactVolumeNames @('${mysqlVolume}','${redisVolume}');`,
      `[pscustomobject]@{ Ports = $inventory.Containers[0].PortBindings; Foreign = $inventory.ForeignVolumeConsumers; Fingerprint = (Get-EasyFireInventoryFingerprint -Inventory $inventory) } | ConvertTo-Json -Depth 20 -Compress`,
    ].join(" ");
    const result = invokePowerShell(command);
    assert.equal(result.status, 0, result.stderr);
    const inventory = JSON.parse(result.stdout);
    assert.deepEqual(inventory.Ports, [
      { ContainerPort: "80/tcp", HostIp: "::1", HostPort: "8080" },
      { ContainerPort: "80/tcp", HostIp: "127.0.0.1", HostPort: "8080" },
    ]);
    assert.deepEqual(inventory.Foreign, [
      {
        VolumeName: mysqlVolume,
        ContainerId: foreignId,
        ContainerName: "foreign-consumer",
        Project: "another-project",
        Service: "database",
        State: "exited",
        MountDestination: "/foreign/mysql",
        ReadWrite: false,
      },
    ]);
    assert.match(inventory.Fingerprint, /^[A-F0-9]{64}$/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("connector correlation accepts one local client and rejects ambiguous clients", () => {
  const connectorId = "11111111-1111-4111-8111-111111111111";
  const connections = {
    success: true,
    result: [
      {
        id: connectorId,
        arch: "windows_amd64",
        run_at: "2026-07-19T12:00:05Z",
        version: "2026.7.1",
        conns: Array.from({ length: 4 }, (_, index) => ({
          id: `22222222-2222-4222-8222-22222222222${index}`,
          client_id: connectorId,
          client_version: "2026.7.1",
          is_pending_reconnect: false,
        })),
      },
    ],
  };
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), "easyfire-connector-"));
  const fixturePath = resolve(fixtureRoot, "connections.json");

  try {
    writeFileSync(fixturePath, JSON.stringify(connections), "utf8");
    const result = invokePowerShell(
      [
        `$connections = Get-Content -LiteralPath ${psQuote(fixturePath)} -Raw | ConvertFrom-Json;`,
        `$module = Get-Module production-io;`,
        `$identity = & $module { param($value) Get-EasyFireCorrelatedConnectorIdentity -ConnectionsResponse $value -ProcessCreatedAtUtc ([datetime]'2026-07-19T12:00:00Z') -LocalVersion '2026.7.1' -ExpectedArchitecture 'windows_amd64' } $connections;`,
        `$identity | ConvertTo-Json -Compress`,
      ].join(" "),
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      ConnectorClientId: connectorId,
      ConnectorRunAtUtc: "2026-07-19T12:00:05.0000000Z",
      ConnectorVersion: "2026.7.1",
      ConnectorArchitecture: "windows_amd64",
      ConnectorActiveConnectionCount: 4,
    });

    const ambiguous = structuredClone(connections);
    ambiguous.result.push({
      ...structuredClone(connections.result[0]),
      id: "33333333-3333-4333-8333-333333333333",
      conns: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          client_id: "33333333-3333-4333-8333-333333333333",
          client_version: "2026.7.1",
          is_pending_reconnect: false,
        },
      ],
    });
    writeFileSync(fixturePath, JSON.stringify(ambiguous), "utf8");
    for (const invocation of [
      "-ProcessCreatedAtUtc ([datetime]'2026-07-19T12:00:00Z') -LocalVersion '2026.7.1'",
      "-ProcessCreatedAtUtc ([datetime]'2026-07-19T10:00:00Z') -LocalVersion '2026.7.1'",
      "-ProcessCreatedAtUtc ([datetime]'2026-07-19T12:00:00Z') -LocalVersion '2026.7.0'",
    ]) {
      if (!invocation.includes("12:00:00Z') -LocalVersion '2026.7.1'")) {
        writeFileSync(fixturePath, JSON.stringify(connections), "utf8");
      } else {
        writeFileSync(fixturePath, JSON.stringify(ambiguous), "utf8");
      }
      const failure = invokePowerShell(
        [
          `$connections = Get-Content -LiteralPath ${psQuote(fixturePath)} -Raw | ConvertFrom-Json;`,
          `$module = Get-Module production-io;`,
          `& $module { param($value) Get-EasyFireCorrelatedConnectorIdentity -ConnectionsResponse $value ${invocation} -ExpectedArchitecture 'windows_amd64' } $connections`,
        ].join(" "),
      );
      assert.notEqual(failure.status, 0, invocation);
    }

    const source = readFileSync(modulePath, "utf8");
    for (const field of [
      "TunnelConfigurationFingerprint",
      "ServiceCommandIdentity",
      "ConnectorClientId",
      "ConnectorRunAtUtc",
    ]) {
      assert.match(source, new RegExp(`\\b${field}\\b`));
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
