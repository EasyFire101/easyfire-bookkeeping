import {
  DATA_ROLES,
  GuardianDecision,
  GuardianObservation,
  GuardianPolicy,
  GuardianState,
  STATELESS_ROLES,
  ServiceObservation,
  StatelessRole,
} from './contracts.js';

const statelessRoles = new Set<string>(STATELESS_ROLES);
const dataRoles = new Set<string>(DATA_ROLES);

function isStateless(
  service: ServiceObservation,
): service is ServiceObservation & { role: StatelessRole } {
  return statelessRoles.has(service.role);
}

function withState(
  prior: GuardianState,
  values: Partial<GuardianState>,
): GuardianState {
  return {
    ...prior,
    ...values,
    schemaVersion: 1,
  };
}

function noAction(
  state: GuardianState,
  reason: string,
): GuardianDecision {
  return {
    state: withState(state, { lastReason: reason }),
    action: { kind: 'none' },
    reason,
  };
}

function isIdentityMismatch(service: ServiceObservation): boolean {
  return (
    service.observedContainerId !== service.expectedContainerId ||
    service.observedImageId !== service.expectedImageId
  );
}

function getFailureFingerprint(observation: GuardianObservation): string {
  const targets = [
    ...observation.services
      .filter((service) => service.state !== 'running' || !service.healthy)
      .map(
        (service) =>
          `service:${service.role}:${service.state}:${service.healthy ? 'healthy' : 'unhealthy'}`,
      ),
    ...observation.probes
      .filter((probe) => !probe.ok)
      .map((probe) => `probe:${probe.name}`),
  ].sort();
  return targets.length > 0 ? targets.join('|') : 'unclassified-failure';
}

export function decideGuardianAction(
  prior: GuardianState,
  observation: GuardianObservation,
  policy: GuardianPolicy,
  now: Date,
): GuardianDecision {
  const nowMs = now.getTime();
  const attemptWindowStart = nowMs - policy.attemptWindowSeconds * 1_000;
  const recentAttempts = prior.recoveryAttempts.filter(
    (attempt) => new Date(attempt.at).getTime() >= attemptWindowStart,
  );
  const base = withState(prior, { recoveryAttempts: recentAttempts });

  if (!observation.dockerAvailable) {
    return noAction(
      withState(base, {
        phase: 'escalated',
        consecutiveFailures: 0,
        failureFingerprint: null,
      }),
      'Docker Engine is unavailable; Guardian is observe-only for engine failures.',
    );
  }

  const identityMismatch = observation.services.find(isIdentityMismatch);
  if (identityMismatch) {
    return noAction(
      withState(base, {
        phase: 'escalated',
        consecutiveFailures: 0,
        failureFingerprint: null,
      }),
      `Container identity mismatch for ${identityMismatch.role}; recovery refused.`,
    );
  }

  const dataFailure = observation.services.find(
    (service) =>
      dataRoles.has(service.role) &&
      (service.state !== 'running' || !service.healthy),
  );
  if (dataFailure) {
    return noAction(
      withState(base, {
        phase: 'escalated',
        consecutiveFailures: 0,
        failureFingerprint: null,
      }),
      `Data service ${dataFailure.role} is unhealthy; automatic recovery is forbidden.`,
    );
  }

  const servicesHealthy = observation.services.every(
    (service) => service.state === 'running' && service.healthy,
  );
  const probesHealthy = observation.probes.every((probe) => probe.ok);
  if (servicesHealthy && probesHealthy) {
    const cooldownActive =
      base.cooldownUntil !== null &&
      new Date(base.cooldownUntil).getTime() > nowMs;
    const reason = cooldownActive
      ? 'All observations are healthy; recovery cooldown remains active.'
      : 'All service identities, health states, and HTTP probes passed.';
    return noAction(
      withState(base, {
        phase: cooldownActive ? 'cooldown' : 'healthy',
        consecutiveFailures: 0,
        failureFingerprint: null,
        cooldownUntil: cooldownActive ? base.cooldownUntil : null,
      }),
      reason,
    );
  }

  const failureFingerprint = getFailureFingerprint(observation);
  const failureCount = base.failureFingerprint === failureFingerprint
    ? base.consecutiveFailures + 1
    : 1;
  const failedState = withState(base, {
    phase: 'suspect',
    consecutiveFailures: failureCount,
    failureFingerprint,
  });

  if (failureCount < policy.failureThreshold) {
    return noAction(
      failedState,
      `Failure ${failureCount} of ${policy.failureThreshold}; awaiting confirmation.`,
    );
  }

  const cooldownActive =
    base.cooldownUntil !== null &&
    new Date(base.cooldownUntil).getTime() > nowMs;
  if (cooldownActive) {
    return noAction(
      withState(failedState, { phase: 'cooldown' }),
      `Recovery cooldown remains active until ${base.cooldownUntil}.`,
    );
  }

  const runningUnhealthy = observation.services.find(
    (service) =>
      isStateless(service) &&
      service.state === 'running' &&
      !service.healthy,
  );
  if (runningUnhealthy) {
    return noAction(
      withState(failedState, { phase: 'escalated' }),
      `Stateless service ${runningUnhealthy.role} is running but unhealthy; restart is forbidden.`,
    );
  }

  const unsafeStatelessState = observation.services.find(
    (service) =>
      isStateless(service) &&
      service.state !== 'running' &&
      service.state !== 'stopped',
  );
  if (unsafeStatelessState) {
    return noAction(
      withState(failedState, { phase: 'escalated' }),
      `Stateless service ${unsafeStatelessState.role} has state ${unsafeStatelessState.state}; recovery refused.`,
    );
  }

  const stoppedStateless = observation.services.filter(
    (service): service is ServiceObservation & { role: StatelessRole } =>
      isStateless(service) && service.state === 'stopped',
  );
  if (stoppedStateless.length !== 1) {
    return noAction(
      withState(failedState, { phase: 'escalated' }),
      stoppedStateless.length === 0
        ? 'HTTP or health probes failed without one safely startable stopped container.'
        : 'Multiple stateless containers are stopped; automatic recovery is ambiguous.',
    );
  }

  if (recentAttempts.length >= policy.maxRecoveryAttempts) {
    return noAction(
      withState(failedState, { phase: 'escalated' }),
      'Recovery attempt budget is exhausted; Guardian is alert-only.',
    );
  }

  const target = stoppedStateless[0];
  if (policy.shadowMode) {
    const reason = `Shadow mode would start pinned ${target.role} container ${target.expectedContainerId}.`;
    return {
      state: withState(failedState, { lastReason: reason }),
      action: {
        kind: 'would-start-container',
        role: target.role,
        containerId: target.expectedContainerId,
      },
      reason,
    };
  }

  const cooldownUntil = new Date(
    nowMs + policy.cooldownSeconds * 1_000,
  ).toISOString();
  const reason = `Starting pinned stopped ${target.role} container after ${failureCount} confirmed failures.`;
  return {
    state: withState(failedState, {
      phase: 'recovering',
      cooldownUntil,
      recoveryAttempts: [
        ...recentAttempts,
        {
          at: now.toISOString(),
          role: target.role,
          containerId: target.expectedContainerId,
        },
      ],
      lastReason: reason,
    }),
    action: {
      kind: 'start-container',
      role: target.role,
      containerId: target.expectedContainerId,
    },
    reason,
  };
}
