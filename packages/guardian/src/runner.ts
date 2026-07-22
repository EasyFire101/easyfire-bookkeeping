import { readFile } from 'node:fs/promises';

import { DockerEngineClient } from './adapters/docker-engine.js';
import { runHttpProbe } from './adapters/http-probe.js';
import { parseGuardianConfig, parseRuntimeManifest } from './config.js';
import {
  GuardianAction,
  GuardianConfig,
  GuardianDecision,
  GuardianObservation,
  GuardianStatus,
  RuntimeManifest,
} from './contracts.js';
import { decideGuardianAction } from './state-machine.js';
import { readGuardianState, writeJsonAtomic } from './status-store.js';

export interface GuardianDependencies {
  now: () => Date;
  docker: DockerEngineClient;
  probe: typeof runHttpProbe;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

function makeStatus(
  observation: GuardianObservation,
  decision: GuardianDecision,
): GuardianStatus {
  return {
    schemaVersion: 1,
    observedAt: observation.observedAt,
    phase: decision.state.phase,
    reason: decision.reason,
    action: decision.action,
    dockerAvailable: observation.dockerAvailable,
    services: observation.services.map((service) => ({
      role: service.role,
      containerName: service.containerName,
      state: service.state,
      healthy: service.healthy,
      identityMatches:
        service.observedContainerId === service.expectedContainerId &&
        service.observedImageId === service.expectedImageId,
    })),
    probes: observation.probes,
    consecutiveFailures: decision.state.consecutiveFailures,
    cooldownUntil: decision.state.cooldownUntil,
    recoveryAttemptsInWindow: decision.state.recoveryAttempts.length,
  };
}

export async function runGuardian(
  config: GuardianConfig,
  manifest: RuntimeManifest,
  dependencies?: Partial<GuardianDependencies>,
): Promise<GuardianStatus> {
  const now = dependencies?.now ?? (() => new Date());
  const docker = dependencies?.docker ?? new DockerEngineClient(config.dockerSocketPath);
  const probe = dependencies?.probe ?? runHttpProbe;
  const observedAt = now();
  const dockerAvailable = await docker.ping();
  const services = dockerAvailable
    ? await docker.observeManifest(manifest)
    : [];
  const probes = await Promise.all(config.probes.map((candidate) => probe(candidate)));
  const observation: GuardianObservation = {
    observedAt: observedAt.toISOString(),
    dockerAvailable,
    services,
    probes,
  };
  const prior = await readGuardianState(config.statePath);
  let decision = decideGuardianAction(prior, observation, config, observedAt);

  if (decision.action.kind === 'start-container') {
    try {
      await docker.startContainer(decision.action.containerId);
    }
    catch (error) {
      const reason = `Pinned container start failed: ${error instanceof Error ? error.message : 'unknown error'}`;
      const action: GuardianAction = { kind: 'none' };
      decision = {
        state: {
          ...decision.state,
          phase: 'escalated',
          lastReason: reason,
        },
        action,
        reason,
      };
    }
  }

  const status = makeStatus(observation, decision);
  await writeJsonAtomic(config.statePath, decision.state);
  await writeJsonAtomic(config.statusPath, status);
  return status;
}

export async function runGuardianFromConfigPath(configPath: string): Promise<GuardianStatus> {
  const config = parseGuardianConfig(await readJson(configPath));
  const manifest = parseRuntimeManifest(await readJson(config.runtimeManifestPath));
  return runGuardian(config, manifest);
}
