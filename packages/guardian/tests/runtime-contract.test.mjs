import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  DockerEngineClient,
  INITIAL_STATE,
  parseGuardianConfig,
  parseRuntimeManifest,
  writeJsonAtomic,
} from '../dist/index.js';

const roles = ['envoy', 'webapp', 'server', 'gotenberg', 'mysql', 'redis'];

function runtimeManifest() {
  return {
    schemaVersion: 1,
    project: 'easyfire-bookkeeping',
    generatedAt: '2026-07-21T20:00:00.000Z',
    services: roles.map((role, index) => ({
      role,
      containerName: `easyfire-bookkeeping-${role}`,
      containerId: `${index + 1}`.repeat(64),
      imageId: `sha256:${(index + 7).toString(16).repeat(64)}`,
      requireDockerHealth: true,
      recoveryMode: ['mysql', 'redis'].includes(role)
        ? 'observe-only'
        : 'start-if-stopped',
    })),
  };
}

function guardianConfig() {
  return {
    schemaVersion: 1,
    runtimeManifestPath: '/etc/easyfire-bookkeeping/runtime-manifest.json',
    statePath: '/var/lib/easyfire-bookkeeping-guardian/state.json',
    statusPath: '/var/lib/easyfire-bookkeeping-guardian/status.json',
    dockerSocketPath: '/var/run/docker.sock',
    failureThreshold: 3,
    cooldownSeconds: 900,
    attemptWindowSeconds: 3600,
    maxRecoveryAttempts: 2,
    shadowMode: true,
    probes: [
      {
        name: 'web',
        url: 'http://127.0.0.1:8080/',
        timeoutMs: 3_000,
        expectedStatus: 200,
      },
      {
        name: 'api',
        url: 'http://127.0.0.1:8080/api/system_db',
        timeoutMs: 3_000,
        expectedStatus: 200,
      },
    ],
  };
}

test('runtime manifest accepts exactly six pinned long-running services', () => {
  const parsed = parseRuntimeManifest(runtimeManifest());
  assert.equal(parsed.services.length, 6);
  assert.equal(parsed.services.find((entry) => entry.role === 'mysql').recoveryMode, 'observe-only');
});

test('runtime manifest forbids automatic database recovery', () => {
  const manifest = runtimeManifest();
  manifest.services.find((entry) => entry.role === 'mysql').recoveryMode = 'start-if-stopped';
  assert.throws(
    () => parseRuntimeManifest(manifest),
    /mysql recoveryMode must be observe-only/,
  );
});

test('Guardian probes are local-only and reject public URLs', () => {
  const config = guardianConfig();
  assert.equal(parseGuardianConfig(config).probes.length, 2);
  config.probes[0].url = 'https://bookkeeping.easyfire.fyi/';
  assert.throws(() => parseGuardianConfig(config), /local-only HTTP/);
});

test('Docker adapter starts only a validated pinned container id', async () => {
  const calls = [];
  const id = 'a'.repeat(64);
  const client = new DockerEngineClient('/unused', async (method, requestPath) => {
    calls.push({ method, path: requestPath });
    return { statusCode: 204, body: '' };
  });

  await client.startContainer(id);
  assert.deepEqual(calls, [
    { method: 'POST', path: `/containers/${id}/start` },
  ]);
  await assert.rejects(() => client.startContainer('easyfire-server'), /invalid container id/);
});

test('atomic status store leaves a complete restrictive JSON file', async () => {
  const directory = path.join(
    os.tmpdir(),
    `easyfire-guardian-test-${process.pid}-${Date.now()}`,
  );
  const statePath = path.join(directory, 'state.json');
  await writeJsonAtomic(statePath, INITIAL_STATE);

  const parsed = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.phase, 'healthy');
  assert.deepEqual(await readdir(directory), ['state.json']);
  assert.doesNotMatch(await readFile(statePath, 'utf8'), /password|token|secret/i);
});
