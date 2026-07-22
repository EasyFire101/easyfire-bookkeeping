import {
  DATA_ROLES,
  GuardianConfig,
  RuntimeManifest,
  RuntimeService,
  STATELESS_ROLES,
} from './contracts.js';

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
}

function assertAbsolutePath(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.startsWith('/')) {
    throw new Error(`${label} must be an absolute Linux path.`);
  }
}

export function parseGuardianConfig(value: unknown): GuardianConfig {
  assertObject(value, 'Guardian config');
  if (value.schemaVersion !== 1) {
    throw new Error('Guardian config schemaVersion must be 1.');
  }
  assertAbsolutePath(value.runtimeManifestPath, 'runtimeManifestPath');
  assertAbsolutePath(value.statePath, 'statePath');
  assertAbsolutePath(value.statusPath, 'statusPath');
  assertAbsolutePath(value.dockerSocketPath, 'dockerSocketPath');
  assertInteger(value.failureThreshold, 'failureThreshold', 2, 10);
  assertInteger(value.cooldownSeconds, 'cooldownSeconds', 60, 86_400);
  assertInteger(value.attemptWindowSeconds, 'attemptWindowSeconds', 300, 604_800);
  assertInteger(value.maxRecoveryAttempts, 'maxRecoveryAttempts', 1, 10);
  if (typeof value.shadowMode !== 'boolean') {
    throw new Error('shadowMode must be boolean.');
  }
  if (!Array.isArray(value.probes) || value.probes.length < 2 || value.probes.length > 10) {
    throw new Error('probes must contain 2 through 10 local HTTP probes.');
  }

  const names = new Set<string>();
  const probes = value.probes.map((candidate, index) => {
    assertObject(candidate, `probes[${index}]`);
    if (typeof candidate.name !== 'string' || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(candidate.name)) {
      throw new Error(`probes[${index}].name is invalid.`);
    }
    if (names.has(candidate.name)) {
      throw new Error(`Duplicate probe name: ${candidate.name}.`);
    }
    names.add(candidate.name);
    if (typeof candidate.url !== 'string') {
      throw new Error(`probes[${index}].url must be a string.`);
    }
    const url = new URL(candidate.url);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
      throw new Error(`Probe ${candidate.name} must use local-only HTTP.`);
    }
    assertInteger(candidate.timeoutMs, `probes[${index}].timeoutMs`, 250, 30_000);
    assertInteger(candidate.expectedStatus, `probes[${index}].expectedStatus`, 100, 599);
    return {
      name: candidate.name,
      url: url.toString(),
      timeoutMs: candidate.timeoutMs,
      expectedStatus: candidate.expectedStatus,
    };
  });

  return {
    schemaVersion: 1,
    runtimeManifestPath: value.runtimeManifestPath,
    statePath: value.statePath,
    statusPath: value.statusPath,
    dockerSocketPath: value.dockerSocketPath,
    failureThreshold: value.failureThreshold,
    cooldownSeconds: value.cooldownSeconds,
    attemptWindowSeconds: value.attemptWindowSeconds,
    maxRecoveryAttempts: value.maxRecoveryAttempts,
    shadowMode: value.shadowMode,
    probes,
  };
}

const requiredRoles = [
  ...STATELESS_ROLES,
  ...DATA_ROLES.filter((role) => role !== 'migration'),
] as RuntimeService['role'][];

export function parseRuntimeManifest(value: unknown): RuntimeManifest {
  assertObject(value, 'Runtime manifest');
  if (value.schemaVersion !== 1 || value.project !== 'easyfire-bookkeeping') {
    throw new Error('Runtime manifest identity is invalid.');
  }
  if (typeof value.generatedAt !== 'string' || Number.isNaN(Date.parse(value.generatedAt))) {
    throw new Error('Runtime manifest generatedAt must be an ISO timestamp.');
  }
  if (!Array.isArray(value.services) || value.services.length !== requiredRoles.length) {
    throw new Error(`Runtime manifest must contain exactly ${requiredRoles.length} long-running services.`);
  }

  const roles = new Set<string>();
  const names = new Set<string>();
  const ids = new Set<string>();
  const services = value.services.map((candidate, index) => {
    assertObject(candidate, `services[${index}]`);
    if (typeof candidate.role !== 'string' || !requiredRoles.includes(candidate.role as RuntimeService['role'])) {
      throw new Error(`services[${index}].role is invalid.`);
    }
    const role = candidate.role as RuntimeService['role'];
    if (roles.has(role)) {
      throw new Error(`Duplicate runtime role: ${role}.`);
    }
    roles.add(role);
    if (typeof candidate.containerName !== 'string' || !/^easyfire-bookkeeping-[a-z0-9-]+$/.test(candidate.containerName)) {
      throw new Error(`services[${index}].containerName is outside the Bookkeeping namespace.`);
    }
    if (names.has(candidate.containerName)) {
      throw new Error(`Duplicate container name: ${candidate.containerName}.`);
    }
    names.add(candidate.containerName);
    if (typeof candidate.containerId !== 'string' || !/^[a-f0-9]{12,64}$/.test(candidate.containerId)) {
      throw new Error(`services[${index}].containerId is invalid.`);
    }
    if (ids.has(candidate.containerId)) {
      throw new Error(`Duplicate container id: ${candidate.containerId}.`);
    }
    ids.add(candidate.containerId);
    if (typeof candidate.imageId !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(candidate.imageId)) {
      throw new Error(`services[${index}].imageId must be a sha256 image id.`);
    }
    if (typeof candidate.requireDockerHealth !== 'boolean') {
      throw new Error(`services[${index}].requireDockerHealth must be boolean.`);
    }
    const expectedMode = STATELESS_ROLES.includes(role as never)
      ? 'start-if-stopped'
      : 'observe-only';
    if (candidate.recoveryMode !== expectedMode) {
      throw new Error(`${role} recoveryMode must be ${expectedMode}.`);
    }
    return {
      role,
      containerName: candidate.containerName,
      containerId: candidate.containerId,
      imageId: candidate.imageId,
      requireDockerHealth: candidate.requireDockerHealth,
      recoveryMode: expectedMode,
    } as RuntimeService;
  });

  for (const role of requiredRoles) {
    if (!roles.has(role)) {
      throw new Error(`Runtime manifest is missing role ${role}.`);
    }
  }

  return {
    schemaVersion: 1,
    project: 'easyfire-bookkeeping',
    generatedAt: value.generatedAt,
    services,
  };
}
