import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INITIAL_STATE,
  decideGuardianAction,
} from '../dist/index.js';

const now = new Date('2026-07-21T20:00:00.000Z');
const policy = {
  failureThreshold: 3,
  cooldownSeconds: 900,
  attemptWindowSeconds: 3600,
  maxRecoveryAttempts: 2,
  shadowMode: false,
};

function service(role, overrides = {}) {
  const id = `${role}-container-id`;
  const image = `sha256:${role}-image`;
  return {
    role,
    containerName: `easyfire-${role}`,
    expectedContainerId: id,
    observedContainerId: id,
    expectedImageId: image,
    observedImageId: image,
    state: 'running',
    healthy: true,
    ...overrides,
  };
}

function observation(overrides = {}) {
  return {
    observedAt: now.toISOString(),
    dockerAvailable: true,
    services: [
      service('mysql'),
      service('redis'),
      service('envoy'),
      service('webapp'),
      service('server'),
      service('gotenberg'),
    ],
    probes: [
      { name: 'web', ok: true, statusCode: 200, latencyMs: 10 },
      { name: 'api', ok: true, statusCode: 200, latencyMs: 9 },
    ],
    ...overrides,
  };
}

function priorForFailure(failedObservation, overrides = {}) {
  const first = decideGuardianAction(
    INITIAL_STATE,
    failedObservation,
    policy,
    now,
  );
  assert.equal(first.state.consecutiveFailures, 1);
  assert.equal(typeof first.state.failureFingerprint, 'string');
  return {
    ...first.state,
    consecutiveFailures: 2,
    ...overrides,
  };
}

test('healthy observation resets failure state without recovery', () => {
  const prior = {
    ...INITIAL_STATE,
    phase: 'suspect',
    consecutiveFailures: 2,
  };
  const decision = decideGuardianAction(prior, observation(), policy, now);

  assert.equal(decision.state.phase, 'healthy');
  assert.equal(decision.state.consecutiveFailures, 0);
  assert.equal(decision.state.failureFingerprint, null);
  assert.deepEqual(decision.action, { kind: 'none' });
});

test('first matching failure becomes suspect and never acts early', () => {
  const services = observation().services.map((entry) =>
    entry.role === 'server'
      ? { ...entry, state: 'stopped', healthy: false }
      : entry,
  );
  const decision = decideGuardianAction(
    INITIAL_STATE,
    observation({ services }),
    policy,
    now,
  );

  assert.equal(decision.state.phase, 'suspect');
  assert.equal(decision.state.consecutiveFailures, 1);
  assert.deepEqual(decision.action, { kind: 'none' });
});

test('third matching stopped stateless failure starts only its pinned id', () => {
  const services = observation().services.map((entry) =>
    entry.role === 'server'
      ? { ...entry, state: 'stopped', healthy: false }
      : entry,
  );
  const failedObservation = observation({ services });
  const prior = priorForFailure(failedObservation);
  const decision = decideGuardianAction(
    prior,
    failedObservation,
    policy,
    now,
  );

  assert.equal(decision.state.phase, 'recovering');
  assert.deepEqual(decision.action, {
    kind: 'start-container',
    role: 'server',
    containerId: 'server-container-id',
  });
  assert.equal(decision.state.recoveryAttempts.length, 1);
});

test('data service failure always escalates and is never recovered', () => {
  const services = observation().services.map((entry) =>
    entry.role === 'mysql'
      ? { ...entry, state: 'stopped', healthy: false }
      : entry,
  );
  const decision = decideGuardianAction(
    { ...INITIAL_STATE, consecutiveFailures: 2 },
    observation({ services }),
    policy,
    now,
  );

  assert.equal(decision.state.phase, 'escalated');
  assert.deepEqual(decision.action, { kind: 'none' });
});

test('identity mismatch fails closed before any recovery', () => {
  const services = observation().services.map((entry) =>
    entry.role === 'server'
      ? {
          ...entry,
          observedContainerId: 'unexpected-container',
          state: 'stopped',
          healthy: false,
        }
      : entry,
  );
  const decision = decideGuardianAction(
    { ...INITIAL_STATE, consecutiveFailures: 2 },
    observation({ services }),
    policy,
    now,
  );

  assert.equal(decision.state.phase, 'escalated');
  assert.match(decision.reason, /identity/i);
  assert.deepEqual(decision.action, { kind: 'none' });
});

test('running but unhealthy stateless service is never restarted', () => {
  const services = observation().services.map((entry) =>
    entry.role === 'webapp' ? { ...entry, healthy: false } : entry,
  );
  const failedObservation = observation({ services });
  const decision = decideGuardianAction(
    priorForFailure(failedObservation),
    failedObservation,
    policy,
    now,
  );

  assert.equal(decision.state.phase, 'escalated');
  assert.match(decision.reason, /running.*unhealthy/i);
  assert.deepEqual(decision.action, { kind: 'none' });
});

test('shadow mode records the exact action but cannot mutate', () => {
  const services = observation().services.map((entry) =>
    entry.role === 'envoy'
      ? { ...entry, state: 'stopped', healthy: false }
      : entry,
  );
  const failedObservation = observation({ services });
  const shadowPolicy = { ...policy, shadowMode: true };
  const first = decideGuardianAction(
    INITIAL_STATE,
    failedObservation,
    shadowPolicy,
    now,
  );
  const decision = decideGuardianAction(
    { ...first.state, consecutiveFailures: 2 },
    failedObservation,
    shadowPolicy,
    now,
  );

  assert.equal(decision.state.phase, 'suspect');
  assert.deepEqual(decision.action, {
    kind: 'would-start-container',
    role: 'envoy',
    containerId: 'envoy-container-id',
  });
  assert.equal(decision.state.recoveryAttempts.length, 0);
});

test('recovery budget exhaustion enters alert-only escalated state', () => {
  const services = observation().services.map((entry) =>
    entry.role === 'server'
      ? { ...entry, state: 'stopped', healthy: false }
      : entry,
  );
  const failedObservation = observation({ services });
  const prior = priorForFailure(failedObservation, {
    recoveryAttempts: [
      {
        at: '2026-07-21T19:20:00.000Z',
        role: 'server',
        containerId: 'server-container-id',
      },
      {
        at: '2026-07-21T19:40:00.000Z',
        role: 'server',
        containerId: 'server-container-id',
      },
    ],
  });
  const decision = decideGuardianAction(
    prior,
    failedObservation,
    policy,
    now,
  );

  assert.equal(decision.state.phase, 'escalated');
  assert.match(decision.reason, /budget/i);
  assert.deepEqual(decision.action, { kind: 'none' });
});

test('a different failure target starts a new confirmation sequence', () => {
  const serverServices = observation().services.map((entry) =>
    entry.role === 'server'
      ? { ...entry, state: 'stopped', healthy: false }
      : entry,
  );
  const serverObservation = observation({ services: serverServices });
  const prior = priorForFailure(serverObservation);
  const webappServices = observation().services.map((entry) =>
    entry.role === 'webapp'
      ? { ...entry, state: 'stopped', healthy: false }
      : entry,
  );

  const decision = decideGuardianAction(
    prior,
    observation({ services: webappServices }),
    policy,
    now,
  );

  assert.equal(decision.state.phase, 'suspect');
  assert.equal(decision.state.consecutiveFailures, 1);
  assert.notEqual(decision.state.failureFingerprint, prior.failureFingerprint);
  assert.deepEqual(decision.action, { kind: 'none' });
});
