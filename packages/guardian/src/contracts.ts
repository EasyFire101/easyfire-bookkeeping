export const STATELESS_ROLES = [
  'envoy',
  'webapp',
  'server',
  'gotenberg',
] as const;

export const DATA_ROLES = ['mysql', 'redis', 'migration'] as const;

export type StatelessRole = (typeof STATELESS_ROLES)[number];
export type DataRole = (typeof DATA_ROLES)[number];
export type ServiceRole = StatelessRole | DataRole;
export type GuardianPhase =
  | 'healthy'
  | 'suspect'
  | 'recovering'
  | 'cooldown'
  | 'escalated';

export interface ServiceObservation {
  role: ServiceRole;
  containerName: string;
  expectedContainerId: string;
  observedContainerId: string | null;
  expectedImageId: string;
  observedImageId: string | null;
  state: 'running' | 'stopped' | 'missing' | 'unknown';
  healthy: boolean;
}

export interface ProbeObservation {
  name: string;
  ok: boolean;
  statusCode: number | null;
  latencyMs: number | null;
}

export interface GuardianObservation {
  observedAt: string;
  dockerAvailable: boolean;
  services: ServiceObservation[];
  probes: ProbeObservation[];
}

export interface RecoveryAttempt {
  at: string;
  role: StatelessRole;
  containerId: string;
}

export interface GuardianState {
  schemaVersion: 1;
  phase: GuardianPhase;
  consecutiveFailures: number;
  recoveryAttempts: RecoveryAttempt[];
  cooldownUntil: string | null;
  lastReason: string;
}

export interface GuardianPolicy {
  failureThreshold: number;
  cooldownSeconds: number;
  attemptWindowSeconds: number;
  maxRecoveryAttempts: number;
  shadowMode: boolean;
}

export type GuardianAction =
  | { kind: 'none' }
  | { kind: 'would-start-container'; role: StatelessRole; containerId: string }
  | { kind: 'start-container'; role: StatelessRole; containerId: string };

export interface GuardianDecision {
  state: GuardianState;
  action: GuardianAction;
  reason: string;
}

export interface RuntimeService {
  role: Exclude<ServiceRole, 'migration'>;
  containerName: string;
  containerId: string;
  imageId: string;
  requireDockerHealth: boolean;
  recoveryMode: 'start-if-stopped' | 'observe-only';
}

export interface RuntimeManifest {
  schemaVersion: 1;
  project: 'easyfire-bookkeeping';
  generatedAt: string;
  services: RuntimeService[];
}

export interface ProbeConfig {
  name: string;
  url: string;
  timeoutMs: number;
  expectedStatus: number;
}

export interface GuardianConfig extends GuardianPolicy {
  schemaVersion: 1;
  runtimeManifestPath: string;
  statePath: string;
  statusPath: string;
  dockerSocketPath: string;
  probes: ProbeConfig[];
}

export interface GuardianStatus {
  schemaVersion: 1;
  observedAt: string;
  phase: GuardianPhase;
  reason: string;
  action: GuardianAction;
  dockerAvailable: boolean;
  services: Array<{
    role: ServiceRole;
    containerName: string;
    state: ServiceObservation['state'];
    healthy: boolean;
    identityMatches: boolean;
  }>;
  probes: ProbeObservation[];
  consecutiveFailures: number;
  cooldownUntil: string | null;
  recoveryAttemptsInWindow: number;
}

export const INITIAL_STATE: GuardianState = {
  schemaVersion: 1,
  phase: 'healthy',
  consecutiveFailures: 0,
  recoveryAttempts: [],
  cooldownUntil: null,
  lastReason: 'not-yet-observed',
};
