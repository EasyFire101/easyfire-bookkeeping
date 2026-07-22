#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { pathToFileURL } from 'node:url';

import {
  collectBoundInputs,
  readVerifiedDeploymentChain,
  validateDatabaseState,
} from './linux-deploy-authority.mjs';
import {
  FIXED_PLAN_PATH,
  PROTECTED_ACCOUNTING_TABLES,
} from './linux-deploy-plan.mjs';
import { parseManifestBoundRelease } from './linux-release-authority-verify.mjs';

export { PROTECTED_ACCOUNTING_TABLES };

export const OUTPUT =
  '/etc/easyfire-bookkeeping/activation-proof/authentication.json';
const ORIGIN = 'http://127.0.0.1:8080';
const SHA = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const DEPLOYMENT_ID = /^direct-vm-[0-9]{8}-[a-f0-9]{8}$/;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export class NativeAuthProofRefusal extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'NativeAuthProofRefusal';
    this.code = code;
  }
}
const refuse = (code, message) => {
  throw new NativeAuthProofRefusal(code, message);
};
const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys, label) => {
  if (!isObject(value)) refuse('E_SHAPE', `${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((entry, index) => entry !== expected[index])
  ) {
    refuse('E_SHAPE', `${label} has missing or unexpected fields.`);
  }
};
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const requireSha = (value, label) => {
  if (typeof value !== 'string' || !SHA.test(value)) {
    refuse('E_HASH', `${label} is invalid.`);
  }
};
const requireTime = (value, label) => {
  if (
    typeof value !== 'string' ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    refuse('E_TIME', `${label} is invalid.`);
  }
};

const validateDataProof = (proof) => {
  exactKeys(
    proof,
    [
      'systemTableCount',
      'tenantTableCount',
      'identityCounts',
      'protectedTableCounts',
      'redisDatabaseSize',
      'redisKeyUpperBound',
      'mariadbCheckSha256',
    ],
    'Native authentication data proof',
  );
  const protectedEntries = Object.entries(proof.protectedTableCounts ?? {}).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  const expectedTables = [...PROTECTED_ACCOUNTING_TABLES].sort((left, right) =>
    left.localeCompare(right),
  );
  if (
    proof.systemTableCount !== 17 ||
    proof.tenantTableCount !== 70 ||
    JSON.stringify(proof.identityCounts) !== JSON.stringify([1, 1, 1, 1]) ||
    protectedEntries.length !== expectedTables.length ||
    protectedEntries.some(
      ([table, count], index) => table !== expectedTables[index] || count !== 0,
    ) ||
    !Number.isSafeInteger(proof.redisDatabaseSize) ||
    proof.redisDatabaseSize < 0 ||
    !Number.isSafeInteger(proof.redisKeyUpperBound) ||
    proof.redisKeyUpperBound < 1 ||
    proof.redisDatabaseSize > proof.redisKeyUpperBound
  ) {
    refuse(
      'E_DATA_PROOF',
      'Native authentication live data invariants are incomplete or ambiguous.',
    );
  }
  requireSha(proof.mariadbCheckSha256, 'MariaDB integrity hash');
  return proof;
};

const validateAuthority = (authority) => {
  exactKeys(
    authority,
    [
      'deploymentId',
      'releaseCommit',
      'releaseManifestSha256',
      'checkpointManifestSha256',
      'deploymentPlanSha256',
      'deploymentReceiptSha256',
      'collectorPath',
      'collectorSha256',
    ],
    'Native authentication authority',
  );
  if (
    !DEPLOYMENT_ID.test(authority.deploymentId) ||
    !COMMIT.test(authority.releaseCommit) ||
    authority.collectorPath !==
      `/opt/easyfire-bookkeeping/releases/${authority.releaseCommit}/scripts/production/linux-native-auth-proof.mjs`
  ) {
    refuse('E_AUTHORITY', 'Native authentication authority is invalid.');
  }
  for (const field of [
    'releaseManifestSha256',
    'checkpointManifestSha256',
    'deploymentPlanSha256',
    'deploymentReceiptSha256',
    'collectorSha256',
  ]) {
    requireSha(authority[field], `Native authentication authority ${field}`);
  }
  return authority;
};

const responseField = (value, ...names) => {
  const document = value?.data ?? value;
  for (const name of names) {
    if (document?.[name] !== undefined && document?.[name] !== null) {
      return String(document[name]);
    }
  }
  return '';
};

export function validateAuthenticatedSessionBinding({
  email,
  userId,
  tenantId,
  organizationId,
  account,
  organization,
}) {
  const binding = {
    userId: String(userId),
    tenantId: String(tenantId),
    organizationId: String(organizationId),
  };
  const accountId = responseField(account, 'id', 'user_id', 'userId');
  const accountTenantId = responseField(account, 'tenant_id', 'tenantId');
  const accountEmail = responseField(account, 'email').trim().toLowerCase();
  const organizationTenantId = responseField(
    organization,
    'id',
    'tenant_id',
    'tenantId',
  );
  const observedOrganizationId = responseField(
    organization,
    'organization_id',
    'organizationId',
  );
  if (
    !binding.userId ||
    !binding.tenantId ||
    !binding.organizationId ||
    accountId !== binding.userId ||
    accountTenantId !== binding.tenantId ||
    accountEmail !== String(email).trim().toLowerCase() ||
    organizationTenantId !== binding.tenantId ||
    observedOrganizationId !== binding.organizationId
  ) {
    refuse(
      'E_SESSION_BINDING',
      'Authenticated account and organization responses do not match the signed-in principal.',
    );
  }
  return binding;
}

export function buildNativeAuthenticationProof({
  authority,
  completedAt,
  ownerConfirmed,
  principalBindingSha256,
  accountResponseSha256,
  organizationResponseSha256,
  dataProof,
}) {
  const bound = validateAuthority(authority);
  requireTime(completedAt, 'Native authentication completion time');
  if (ownerConfirmed !== true) {
    refuse(
      'E_OWNER_CONFIRMATION',
      'The authenticated owner must explicitly confirm the credential boundary.',
    );
  }
  for (const [value, label] of [
    [principalBindingSha256, 'Principal binding'],
    [accountResponseSha256, 'Account response'],
    [organizationResponseSha256, 'Organization response'],
  ]) {
    requireSha(value, label);
  }
  const validatedData = validateDataProof(dataProof);
  return {
    schemaVersion: 1,
    project: 'easyfire-bookkeeping',
    kind: 'easyfire-bookkeeping-native-authentication-proof',
    status: 'passed',
    completedAt,
    deploymentId: bound.deploymentId,
    releaseCommit: bound.releaseCommit,
    releaseManifestSha256: bound.releaseManifestSha256,
    checkpointManifestSha256: bound.checkpointManifestSha256,
    deploymentPlanSha256: bound.deploymentPlanSha256,
    deploymentReceiptSha256: bound.deploymentReceiptSha256,
    method: 'native-password-interactive',
    inputMethod: 'interactive-tty',
    ownerConfirmed: true,
    authenticatedApi: {
      account: 'passed',
      organization: 'passed',
      accountResponseSha256,
      organizationResponseSha256,
      principalBindingSha256,
    },
    dataValidation: {
      systemTableCount: validatedData.systemTableCount,
      tenantTableCount: validatedData.tenantTableCount,
      identityCounts: validatedData.identityCounts,
      protectedAccountingTableCount: PROTECTED_ACCOUNTING_TABLES.length,
      protectedAccountingCountsExact: true,
      redisDatabaseSize: validatedData.redisDatabaseSize,
      redisKeyUpperBound: validatedData.redisKeyUpperBound,
      mariadbCheckSha256: validatedData.mariadbCheckSha256,
    },
    collector: {
      executablePath: bound.collectorPath,
      executableSha256: bound.collectorSha256,
      outputPath: OUTPUT,
      createNew: true,
    },
    secretMaterialPersisted: false,
  };
}

export function validateNativeAuthenticationProof(candidate) {
  const proof = candidate;
  exactKeys(
    proof,
    [
      'schemaVersion',
      'project',
      'kind',
      'status',
      'completedAt',
      'deploymentId',
      'releaseCommit',
      'releaseManifestSha256',
      'checkpointManifestSha256',
      'deploymentPlanSha256',
      'deploymentReceiptSha256',
      'method',
      'inputMethod',
      'ownerConfirmed',
      'authenticatedApi',
      'dataValidation',
      'collector',
      'secretMaterialPersisted',
    ],
    'Native authentication proof',
  );
  exactKeys(
    proof.authenticatedApi,
    [
      'account',
      'organization',
      'accountResponseSha256',
      'organizationResponseSha256',
      'principalBindingSha256',
    ],
    'Native authentication API proof',
  );
  exactKeys(
    proof.dataValidation,
    [
      'systemTableCount',
      'tenantTableCount',
      'identityCounts',
      'protectedAccountingTableCount',
      'protectedAccountingCountsExact',
      'redisDatabaseSize',
      'redisKeyUpperBound',
      'mariadbCheckSha256',
    ],
    'Native authentication data validation',
  );
  exactKeys(
    proof.collector,
    ['executablePath', 'executableSha256', 'outputPath', 'createNew'],
    'Native authentication collector',
  );
  requireTime(proof.completedAt, 'Native authentication completion time');
  if (
    proof.schemaVersion !== 1 ||
    proof.project !== 'easyfire-bookkeeping' ||
    proof.kind !== 'easyfire-bookkeeping-native-authentication-proof' ||
    proof.status !== 'passed' ||
    !DEPLOYMENT_ID.test(proof.deploymentId ?? '') ||
    !COMMIT.test(proof.releaseCommit ?? '') ||
    proof.method !== 'native-password-interactive' ||
    proof.inputMethod !== 'interactive-tty' ||
    proof.ownerConfirmed !== true ||
    proof.authenticatedApi?.account !== 'passed' ||
    proof.authenticatedApi?.organization !== 'passed' ||
    proof.dataValidation?.systemTableCount !== 17 ||
    proof.dataValidation?.tenantTableCount !== 70 ||
    JSON.stringify(proof.dataValidation?.identityCounts) !==
      JSON.stringify([1, 1, 1, 1]) ||
    proof.dataValidation?.protectedAccountingTableCount !==
      PROTECTED_ACCOUNTING_TABLES.length ||
    proof.dataValidation?.protectedAccountingCountsExact !== true ||
    !Number.isSafeInteger(proof.dataValidation?.redisDatabaseSize) ||
    proof.dataValidation.redisDatabaseSize < 0 ||
    !Number.isSafeInteger(proof.dataValidation?.redisKeyUpperBound) ||
    proof.dataValidation.redisKeyUpperBound < 1 ||
    proof.dataValidation?.redisDatabaseSize >
      proof.dataValidation?.redisKeyUpperBound ||
    proof.collector?.executablePath !==
      `/opt/easyfire-bookkeeping/releases/${proof.releaseCommit}/scripts/production/linux-native-auth-proof.mjs` ||
    proof.collector?.outputPath !== OUTPUT ||
    proof.collector?.createNew !== true ||
    proof.secretMaterialPersisted !== false
  ) {
    refuse('E_AUTH_PROOF', 'Native authentication proof is incomplete or unbound.');
  }
  for (const value of [
    proof.releaseManifestSha256,
    proof.checkpointManifestSha256,
    proof.deploymentPlanSha256,
    proof.deploymentReceiptSha256,
    proof.authenticatedApi.accountResponseSha256,
    proof.authenticatedApi.organizationResponseSha256,
    proof.authenticatedApi.principalBindingSha256,
    proof.dataValidation.mariadbCheckSha256,
    proof.collector.executableSha256,
  ]) {
    requireSha(value, 'Native authentication proof hash');
  }
  return proof;
}

const assertSecureFile = async (file, mode = 0o600) => {
  const resolved = await realpath(file).catch(() => null);
  const metadata = await lstat(file).catch(() => null);
  if (
    resolved !== file ||
    !metadata?.isFile() ||
    metadata.uid !== 0 ||
    (metadata.mode & 0o777) !== mode ||
    metadata.size < 1 ||
    metadata.size > 4 * 1024 * 1024
  ) {
    refuse('E_FILE_AUTHORITY', `Required file authority is invalid: ${file}`);
  }
};

const readRuntimeAuthority = async (planPath) => {
  const inputs = await collectBoundInputs(planPath, { fixedPlan: true });
  const chain = await readVerifiedDeploymentChain(inputs);
  const collectorPath =
    `/opt/easyfire-bookkeeping/releases/${inputs.plan.releaseCommit}` +
    '/scripts/production/linux-native-auth-proof.mjs';
  if ((await realpath(process.argv[1]).catch(() => null)) !== collectorPath) {
    refuse('E_EXECUTOR_PATH', 'Native authentication collector is not release-owned.');
  }
  await assertSecureFile(collectorPath, 0o644);
  const collectorBytes = await readFile(collectorPath);
  const manifestBytes = await readFile(inputs.plan.releaseManifest.path);
  const manifest = parseManifestBoundRelease(JSON.parse(manifestBytes));
  const artifact = manifest.artifacts.find(
    ({ path: artifactPath }) =>
      artifactPath === 'scripts/production/linux-native-auth-proof.mjs',
  );
  if (
    manifest.releaseCommit !== inputs.plan.releaseCommit ||
    sha256(manifestBytes) !== inputs.plan.releaseManifest.sha256 ||
    !artifact ||
    artifact.mode !== '0644' ||
    artifact.bytes !== collectorBytes.length ||
    artifact.sha256 !== sha256(collectorBytes)
  ) {
    refuse('E_EXECUTOR_HASH', 'Native authentication collector is not manifest-bound.');
  }
  return {
    inputs,
    authority: {
      deploymentId: inputs.plan.deploymentId,
      releaseCommit: inputs.plan.releaseCommit,
      releaseManifestSha256: inputs.plan.releaseManifest.sha256,
      checkpointManifestSha256: inputs.plan.checkpoint.manifestSha256,
      deploymentPlanSha256: inputs.planSha256,
      deploymentReceiptSha256: chain.deploymentReceiptSha256,
      collectorPath,
      collectorSha256: sha256(collectorBytes),
    },
  };
};

const requestJson = async (pathname, options = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${ORIGIN}${pathname}`, {
      ...options,
      redirect: 'error',
      signal: controller.signal,
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!response.ok || bytes.length < 2 || bytes.length > MAX_RESPONSE_BYTES) {
      refuse('E_HTTP', `Native authentication HTTP proof failed at ${pathname}.`);
    }
    let value;
    try {
      value = JSON.parse(bytes.toString('utf8'));
    } catch {
      refuse('E_HTTP_JSON', `Native authentication response was invalid at ${pathname}.`);
    }
    return { value, bytes, status: response.status };
  } catch (error) {
    if (error instanceof NativeAuthProofRefusal) throw error;
    refuse('E_HTTP', `Native authentication HTTP request failed at ${pathname}.`);
  } finally {
    clearTimeout(timeout);
  }
};

const runStty = (argument) =>
  new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/stty', [argument], {
      shell: false,
      stdio: ['inherit', 'ignore', 'ignore'],
    });
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 ? resolve() : reject(new Error('stty failed')),
    );
  });

const readInteractiveInputs = async () => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    refuse('E_TTY', 'Native owner authentication requires an interactive TTY.');
  }
  const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  let email;
  let password;
  let confirmation;
  try {
    email = (await terminal.question('Owner email: ')).trim();
    await runStty('-echo');
    try {
      password = await terminal.question('Owner password (not stored): ');
    } finally {
      await runStty('echo').catch(() => undefined);
      process.stdout.write('\n');
    }
    confirmation = (
      await terminal.question(
        'Confirm this is the sole owner account and authorize this one sign-in by typing CONFIRM: ',
      )
    ).trim();
  } finally {
    terminal.close();
  }
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    password.length < 1 ||
    password.length > 4096 ||
    confirmation !== 'CONFIRM'
  ) {
    password = '';
    refuse('E_OWNER_INPUT', 'Owner credential entry or confirmation was not completed.');
  }
  return { email, password };
};

const writeExclusive = async (file, value) => {
  const handle = await open(
    file,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600,
  ).catch((error) => {
    if (error?.code === 'EEXIST') {
      refuse('E_ALREADY_EXISTS', `Refusing to replace ${file}.`);
    }
    throw error;
  });
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.chmod(0o600);
    await handle.sync();
  } finally {
    await handle.close();
  }
  const directory = await open(path.dirname(file), constants.O_RDONLY);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
};

const assertOutputAbsent = async (file) => {
  const exists = await lstat(file)
    .then(() => true)
    .catch((error) => {
      if (error?.code === 'ENOENT') return false;
      throw error;
    });
  if (exists) refuse('E_ALREADY_EXISTS', `Refusing to replace ${file}.`);
};

async function collect(planPath, outputPath) {
  if (process.platform !== 'linux' || process.getuid?.() !== 0) {
    refuse('E_ROOT', 'Native authentication proof requires Linux root.');
  }
  await assertOutputAbsent(outputPath);
  const runtime = await readRuntimeAuthority(planPath);
  const input = await readInteractiveInputs();
  let token = '';
  try {
    const signin = await requestJson('/api/auth/signin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: input.email, password: input.password }),
    });
    input.password = '';
    const value = signin.value?.data ?? signin.value;
    token = value?.access_token ?? value?.accessToken;
    const organizationId = value?.organization_id ?? value?.organizationId;
    const tenantId = value?.tenant_id ?? value?.tenantId;
    const userId = value?.user_id ?? value?.userId;
    if (
      ![token, organizationId, tenantId, userId].every(
        (candidate) => typeof candidate === 'string' || Number.isSafeInteger(candidate),
      ) ||
      typeof token !== 'string' ||
      token.length < 32 ||
      token.length > 8192
    ) {
      refuse('E_SIGNIN', 'Native sign-in response was incomplete.');
    }
    const headers = {
      authorization: `Bearer ${token}`,
      'organization-id': String(organizationId),
    };
    const [account, organization, dataProof] = await Promise.all([
      requestJson('/api/auth/account', { headers }),
      requestJson('/api/organization/current', { headers }),
      validateDatabaseState(
        runtime.inputs.plan,
        runtime.inputs.environment,
        'native-authentication-proof',
      ),
    ]);
    const session = validateAuthenticatedSessionBinding({
      email: input.email,
      userId,
      tenantId,
      organizationId,
      account: account.value,
      organization: organization.value,
    });
    const proof = buildNativeAuthenticationProof({
      authority: runtime.authority,
      completedAt: new Date().toISOString(),
      ownerConfirmed: true,
      principalBindingSha256: sha256(
        `easyfire-owner\0${session.userId}\0${session.tenantId}\0${session.organizationId}`,
      ),
      accountResponseSha256: sha256(account.bytes),
      organizationResponseSha256: sha256(organization.bytes),
      dataProof,
    });
    await writeExclusive(outputPath, proof);
    return proof;
  } finally {
    input.password = '';
    token = '';
  }
}

export function parseArguments(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    return { help: true };
  }
  let mode;
  let planPath;
  let outputPath;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--collect' && !mode) mode = 'collect';
    else if (argument === '--plan' && !planPath) planPath = args[++index];
    else if (argument === '--output' && !outputPath) outputPath = args[++index];
    else refuse('E_USAGE', 'Use the exact native authentication proof command.');
  }
  if (
    mode !== 'collect' ||
    planPath !== FIXED_PLAN_PATH ||
    outputPath !== OUTPUT
  ) {
    refuse('E_USAGE', 'Native authentication proof requires the fixed plan and output paths.');
  }
  return { help: false, mode, planPath, outputPath };
}

const usage =
  `Usage: linux-native-auth-proof.mjs --collect --plan ${FIXED_PLAN_PATH} --output ${OUTPUT}\n`;

async function runCli() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage);
    return;
  }
  const proof = await collect(options.planPath, options.outputPath);
  process.stdout.write(
    `${JSON.stringify({ status: proof.status, output: options.outputPath })}\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  runCli().catch((error) => {
    process.stderr.write(
      `${error?.code ?? 'E_NATIVE_AUTH'}: ${error?.message ?? String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
