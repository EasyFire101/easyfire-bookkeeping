import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';

import {
  ALL_SERVICES,
  buildComposeArguments,
  COMPOSE_VERSION,
  DeploymentRefusal,
  DOCKER_SOCKET,
  DOCKER_VERSION,
  HOSTNAME,
  REHEARSAL_HOSTNAME,
  isObject,
  LONG_RUNNING_SERVICES,
  MAX_COMMAND_OUTPUT,
  PROJECT,
  refuse,
  RELEASE_ROLES,
  SERVICE_CONTRACT,
  STATELESS_SERVICES,
} from './linux-deploy-plan.mjs';

const DOCKER_API_PREFIX = '/v1.47';
const sha256Bytes = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sanitizedEnvironment = () => ({
  PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  HOME: '/root',
  LANG: 'C',
  LC_ALL: 'C',
  DOCKER_HOST: `unix://${DOCKER_SOCKET}`,
});

export const runCommand = async (
  executable,
  args,
  {
    label,
    timeoutMs = 180_000,
    allowedExitCodes = [0],
    maxOutputBytes = MAX_COMMAND_OUTPUT,
  },
) =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env: sanitizedEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let timedOut = false;
    let overflow = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
    }, timeoutMs);
    const collect = (target) => (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        overflow = true;
        child.kill('SIGTERM');
      } else target.push(chunk);
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    child.once('error', () => {
      clearTimeout(timer);
      reject(new DeploymentRefusal('E_COMMAND_START', `${label} could not start.`));
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new DeploymentRefusal('E_COMMAND_TIMEOUT', `${label} timed out.`));
      } else if (overflow) {
        reject(
          new DeploymentRefusal('E_COMMAND_OUTPUT', `${label} exceeded its output limit.`),
        );
      } else if (signal || !allowedExitCodes.includes(code)) {
        reject(new DeploymentRefusal('E_COMMAND_FAILED', `${label} failed.`));
      } else {
        resolve({ code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
      }
    });
  });

export const docker = (args, options) => runCommand('docker', args, options);
const parseJsonOutput = (result, label) => {
  try {
    return JSON.parse(result.stdout.toString('utf8'));
  } catch {
    refuse('E_COMMAND_JSON', `${label} returned invalid JSON.`);
  }
};

export const inspectContainers = async (
  names,
  label = 'Docker container inspection',
) => {
  const result = await docker(['container', 'inspect', ...names], {
    label,
    timeoutMs: 30_000,
    maxOutputBytes: 4 * 1024 * 1024,
  });
  const parsed = parseJsonOutput(result, label);
  if (!Array.isArray(parsed) || parsed.length !== names.length) {
    refuse('E_DOCKER_INSPECT', `${label} returned an incomplete set.`);
  }
  return parsed;
};

const inspectImages = async (references) => {
  const label = 'Docker image inspection';
  const result = await docker(['image', 'inspect', ...references], {
    label,
    timeoutMs: 30_000,
    maxOutputBytes: 4 * 1024 * 1024,
  });
  const parsed = parseJsonOutput(result, label);
  if (!Array.isArray(parsed) || parsed.length !== references.length) {
    refuse('E_DOCKER_INSPECT', 'Docker image inspection returned an incomplete set.');
  }
  return parsed;
};

export const verifyReleaseImageIdentity = (expected, observed) => {
  if (!isObject(observed) || observed.Id !== expected.engineImageId) {
    refuse('E_IMAGE_IDENTITY', `Loaded ${expected.role} engine image is invalid.`);
  }
  const references = [
    ...(Array.isArray(observed.RepoTags) ? observed.RepoTags : []),
    ...(Array.isArray(observed.RepoDigests) ? observed.RepoDigests : []),
  ];
  if (expected.reference.includes('@')) {
    const [tagged, digest] = expected.reference.split('@');
    const separator = tagged.lastIndexOf(':');
    const repoDigest = `${tagged.slice(0, separator)}@${digest}`;
    if (!references.includes(repoDigest)) {
      refuse('E_IMAGE_IDENTITY', `Loaded ${expected.role} repo digest is invalid.`);
    }
  } else if (!references.includes(expected.reference)) {
    refuse('E_IMAGE_IDENTITY', `Loaded ${expected.role} release tag is invalid.`);
  }
  return {
    reference: expected.reference,
    ociIndexDigest: expected.ociIndexDigest,
    linuxAmd64ManifestDigest: expected.linuxAmd64ManifestDigest,
    engineImageId: observed.Id,
  };
};

const verifyProjectResourceSet = async (plan) => {
  const expected = {
    container: ALL_SERVICES.map((service) => SERVICE_CONTRACT[service].name),
    volume: [plan.resources.mysqlVolume, plan.resources.redisVolume],
    network: [plan.resources.network],
  };
  for (const [kind, names] of Object.entries(expected)) {
    const result = await docker(
      [
        kind,
        'ls',
        ...(kind === 'container' ? ['--all'] : []),
        '--filter',
        `label=com.docker.compose.project=${PROJECT}`,
        '--format',
        kind === 'container' ? '{{.Names}}' : '{{.Name}}',
      ],
      {
        label: `Exact project ${kind} inventory`,
        timeoutMs: 30_000,
        maxOutputBytes: 512 * 1024,
      },
    );
    const actual = result.stdout.toString('utf8').trim().split(/\r?\n/).filter(Boolean).sort();
    const wanted = [...names].sort();
    if (
      actual.length !== wanted.length ||
      actual.some((name, index) => name !== wanted[index])
    ) {
      refuse('E_RESOURCE_SET', `Project ${kind} inventory is not exact.`);
    }
  }
};

export const getDockerIdentity = async (expectedHostname = HOSTNAME) => {
  if (![HOSTNAME, REHEARSAL_HOSTNAME].includes(expectedHostname)) {
    refuse(
      'E_DOCKER_IDENTITY',
      'Expected Docker hostname is outside the deployment contract.',
    );
  }
  const infoResult = await docker(['info', '--format', '{{json .}}'], {
    label: 'Docker engine identity inspection',
    timeoutMs: 30_000,
    maxOutputBytes: 2 * 1024 * 1024,
  });
  const versionResult = await docker(
    ['version', '--format', '{{json .Server}}'],
    {
      label: 'Docker server version inspection',
      timeoutMs: 30_000,
      maxOutputBytes: 512 * 1024,
    },
  );
  const composeResult = await docker(['compose', 'version', '--short'], {
    label: 'Docker Compose version inspection',
    timeoutMs: 30_000,
    maxOutputBytes: 64 * 1024,
  });
  const info = parseJsonOutput(infoResult, 'Docker engine identity inspection');
  const version = parseJsonOutput(versionResult, 'Docker server version inspection');
  const composeVersion = composeResult.stdout.toString('utf8').trim().replace(/^v/, '');
  if (
    info.Name !== expectedHostname ||
    info.OSType !== 'linux' ||
    info.Architecture !== 'x86_64' ||
    info.DockerRootDir !== '/var/lib/docker' ||
    version.Version !== DOCKER_VERSION ||
    composeVersion !== COMPOSE_VERSION ||
    typeof info.ID !== 'string' ||
    info.ID.length < 8
  ) {
    refuse('E_DOCKER_IDENTITY', 'Docker engine identity or pinned version is invalid.');
  }
  return {
    id: info.ID,
    name: info.Name,
    osType: info.OSType,
    architecture: info.Architecture,
    dockerRootDir: info.DockerRootDir,
    serverVersion: version.Version,
    apiVersion: version.ApiVersion,
    composeVersion,
  };
};

export const assertNoExistingDockerResources = async (plan, releaseManifest) => {
  for (const [kind, command] of [
    [
      'containers',
      ['container', 'ls', '--all', '--quiet', '--no-trunc', '--filter', `label=com.docker.compose.project=${PROJECT}`],
    ],
    ['volumes', ['volume', 'ls', '--quiet', '--filter', `label=com.docker.compose.project=${PROJECT}`]],
    ['networks', ['network', 'ls', '--quiet', '--filter', `label=com.docker.compose.project=${PROJECT}`]],
  ]) {
    const result = await docker(command, {
      label: `Existing project ${kind} inspection`,
      timeoutMs: 30_000,
      maxOutputBytes: 512 * 1024,
    });
    if (result.stdout.toString('utf8').trim()) {
      refuse('E_RESOURCE_COLLISION', `Existing project ${kind} were found.`);
    }
  }
  for (const contract of Object.values(SERVICE_CONTRACT)) {
    const result = await docker(['container', 'inspect', contract.name], {
      label: 'Exact container-name collision inspection',
      timeoutMs: 30_000,
      allowedExitCodes: [0, 1],
      maxOutputBytes: 512 * 1024,
    });
    if (result.code === 0) {
      refuse('E_RESOURCE_COLLISION', 'An exact Bookkeeping container name already exists.');
    }
  }
  for (const [kind, name] of [
    ['volume', plan.resources.mysqlVolume],
    ['volume', plan.resources.redisVolume],
    ['network', plan.resources.network],
  ]) {
    const result = await docker([kind, 'inspect', name], {
      label: `Exact ${kind}-name collision inspection`,
      timeoutMs: 30_000,
      allowedExitCodes: [0, 1],
      maxOutputBytes: 512 * 1024,
    });
    if (result.code === 0) {
      refuse('E_RESOURCE_COLLISION', `An exact Bookkeeping ${kind} name already exists.`);
    }
  }
  for (const image of releaseManifest.images.values()) {
    const result = await docker(['image', 'inspect', image.reference], {
      label: 'Preexisting release image inspection',
      timeoutMs: 30_000,
      allowedExitCodes: [0, 1],
      maxOutputBytes: 512 * 1024,
    });
    if (result.code === 0) {
      const inspected = parseJsonOutput(result, 'Preexisting release image inspection');
      if (!Array.isArray(inspected) || inspected.length !== 1) {
        refuse(
          'E_DOCKER_INSPECT',
          'Preexisting release image inspection returned an incomplete set.',
        );
      }
      verifyReleaseImageIdentity(image, inspected[0]);
    }
  }
};

const dockerApiRequest = async (method, endpoint, body) => {
  const bytes = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        socketPath: DOCKER_SOCKET,
        method,
        path: `${DOCKER_API_PREFIX}${endpoint}`,
        headers: {
          Host: 'docker',
          'Content-Type': 'application/json',
          'Content-Length': bytes.length,
        },
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_COMMAND_OUTPUT) request.destroy();
          else chunks.push(chunk);
        });
        response.once('end', () => {
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            reject(new DeploymentRefusal('E_DOCKER_API', 'Docker Engine API request failed.'));
          } else resolve(Buffer.concat(chunks));
        });
      },
    );
    request.setTimeout(30_000, () => request.destroy());
    request.once('error', () =>
      reject(new DeploymentRefusal('E_DOCKER_API', 'Docker Engine API request failed.')),
    );
    request.end(bytes);
  });
};

const parseApiJson = (bytes, label) => {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    refuse('E_DOCKER_API', `${label} returned invalid JSON.`);
  }
};

const createDockerExec = async (containerName, command, environment, attachStdin) => {
  const response = await dockerApiRequest(
    'POST',
    `/containers/${encodeURIComponent(containerName)}/exec`,
    {
      AttachStdin: attachStdin,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      Env: environment,
      Cmd: command,
    },
  );
  const parsed = parseApiJson(response, 'Docker exec creation');
  if (!isObject(parsed) || !/^[a-f0-9]{64}$/.test(parsed.Id ?? '')) {
    refuse('E_DOCKER_API', 'Docker Engine returned an invalid exec identity.');
  }
  return parsed.Id;
};

const consumeFrames = (buffer, outputs) => {
  let remaining = buffer;
  while (remaining.length >= 8) {
    const length = remaining.readUInt32BE(4);
    if (length > MAX_COMMAND_OUTPUT) {
      refuse('E_DOCKER_EXEC_OUTPUT', 'Docker exec frame exceeds its output limit.');
    }
    if (remaining.length < 8 + length) break;
    const payload = remaining.subarray(8, 8 + length);
    outputs.total += payload.length;
    if (outputs.total > MAX_COMMAND_OUTPUT) {
      refuse('E_DOCKER_EXEC_OUTPUT', 'Docker exec output exceeds its limit.');
    }
    if (remaining[0] === 1) outputs.stdout.push(payload);
    if (remaining[0] === 2) outputs.stderr.push(payload);
    remaining = remaining.subarray(8 + length);
  }
  return remaining;
};

const startDockerExec = async (execId, input, timeoutMs) =>
  new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: DOCKER_SOCKET, allowHalfOpen: true });
    const body = Buffer.from(JSON.stringify({ Detach: false, Tty: false }));
    const head = Buffer.from(
      `POST ${DOCKER_API_PREFIX}/exec/${execId}/start HTTP/1.1\r\n` +
        'Host: docker\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n' +
        `Content-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n`,
    );
    const outputs = { stdout: [], stderr: [], total: 0 };
    let headers = Buffer.alloc(0);
    let frames = Buffer.alloc(0);
    let upgraded = false;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input?.destroy();
      socket.destroy();
      if (error) reject(error);
      else if (frames.length !== 0) {
        reject(new DeploymentRefusal('E_DOCKER_EXEC_STREAM', 'Docker exec stream ended mid-frame.'));
      } else {
        resolve({ stdout: Buffer.concat(outputs.stdout), stderr: Buffer.concat(outputs.stderr) });
      }
    };
    const timer = setTimeout(
      () => finish(new DeploymentRefusal('E_DOCKER_EXEC_TIMEOUT', 'Docker exec timed out.')),
      timeoutMs,
    );
    const beginInput = () => {
      if (!input) return socket.end();
      input.on('data', (chunk) => {
        if (!socket.write(chunk)) input.pause();
      });
      socket.on('drain', () => input.resume());
      input.once('end', () => socket.end());
      input.once('error', () =>
        finish(new DeploymentRefusal('E_RESTORE_STREAM', 'Database restore stream failed.')),
      );
    };
    socket.once('connect', () => socket.write(Buffer.concat([head, body])));
    socket.on('data', (chunk) => {
      try {
        if (!upgraded) {
          headers = Buffer.concat([headers, chunk]);
          const boundary = headers.indexOf('\r\n\r\n');
          if (boundary < 0) {
            if (headers.length > 64 * 1024) {
              finish(new DeploymentRefusal('E_DOCKER_EXEC_STREAM', 'Docker exec headers are invalid.'));
            }
            return;
          }
          if (!/^HTTP\/1\.[01] 101\b/.test(headers.subarray(0, boundary).toString('ascii'))) {
            finish(new DeploymentRefusal('E_DOCKER_EXEC_STREAM', 'Docker exec did not upgrade its stream.'));
            return;
          }
          upgraded = true;
          frames = consumeFrames(headers.subarray(boundary + 4), outputs);
          headers = Buffer.alloc(0);
          beginInput();
        } else frames = consumeFrames(Buffer.concat([frames, chunk]), outputs);
      } catch (error) {
        finish(error);
      }
    });
    socket.once('end', () => finish());
    socket.once('close', () => finish());
    socket.once('error', () =>
      finish(new DeploymentRefusal('E_DOCKER_EXEC_STREAM', 'Docker exec stream failed.')),
    );
  });

export const runDockerExec = async ({
  containerName,
  command,
  environment = [],
  input,
  timeoutMs = 180_000,
  label,
}) => {
  const execId = await createDockerExec(containerName, command, environment, Boolean(input));
  const output = await startDockerExec(execId, input, timeoutMs);
  const state = parseApiJson(
    await dockerApiRequest('GET', `/exec/${execId}/json`),
    'Docker exec inspection',
  );
  if (!isObject(state) || state.Running !== false || state.ExitCode !== 0) {
    refuse('E_DOCKER_EXEC_FAILED', `${label} failed.`);
  }
  return output;
};

export const validateComposeConfig = async (plan, manifest) => {
  const result = await docker(buildComposeArguments(plan, ['config', '--format', 'json']), {
    label: 'Docker Compose configuration validation',
    timeoutMs: 60_000,
    maxOutputBytes: MAX_COMMAND_OUTPUT,
  });
  const config = parseJsonOutput(result, 'Docker Compose configuration validation');
  if (!isObject(config) || !isObject(config.services)) {
    refuse('E_COMPOSE_CONFIG', 'Compose configuration has no service map.');
  }
  const names = Object.keys(config.services).sort();
  const expectedNames = [...ALL_SERVICES].sort();
  if (names.length !== expectedNames.length || names.some((name, i) => name !== expectedNames[i])) {
    refuse('E_COMPOSE_CONFIG', 'Compose configuration service set is invalid.');
  }
  for (const serviceName of ALL_SERVICES) {
    const service = config.services[serviceName];
    const contract = SERVICE_CONTRACT[serviceName];
    if (
      !isObject(service) ||
      service.container_name !== contract.name ||
      service.image !== manifest.images.get(contract.role).reference ||
      service.restart !== 'no'
    ) {
      refuse('E_COMPOSE_CONFIG', `Compose ${serviceName} identity is invalid.`);
    }
    const ports = Array.isArray(service.ports) ? service.ports : [];
    if (serviceName === 'envoy') {
      if (
        ports.length !== 1 ||
        ports[0].host_ip !== '127.0.0.1' ||
        String(ports[0].published) !== '8080' ||
        Number(ports[0].target) !== 80 ||
        (ports[0].protocol ?? 'tcp') !== 'tcp'
      ) {
        refuse('E_NETWORK_EXPOSURE', 'Compose must publish only 127.0.0.1:8080.');
      }
    } else if (ports.length !== 0) {
      refuse('E_NETWORK_EXPOSURE', `Compose ${serviceName} publishes a port.`);
    }
  }
  if (
    Object.keys(config.networks ?? {}).length !== 1 ||
    Object.keys(config.volumes ?? {}).length !== 2 ||
    config.networks?.bigcapital_network?.name !== plan.resources.network ||
    config.volumes?.mysql?.name !== plan.resources.mysqlVolume ||
    config.volumes?.redis?.name !== plan.resources.redisVolume
  ) {
    refuse('E_COMPOSE_CONFIG', 'Compose network or volume names are not plan-bound.');
  }
  return sha256Bytes(result.stdout);
};

export const verifyLoadedImages = async (manifest) => {
  const entries = [...manifest.images.values()];
  const inspected = await inspectImages(entries.map((entry) => entry.reference));
  const identities = {};
  for (let index = 0; index < entries.length; index += 1) {
    const expected = entries[index];
    identities[expected.role] = verifyReleaseImageIdentity(expected, inspected[index]);
  }
  return identities;
};

export const verifyContainerContract = (
  container,
  serviceName,
  plan,
  manifest,
  restart,
) => {
  const contract = SERVICE_CONTRACT[serviceName];
  const image = manifest.images.get(contract.role);
  if (
    !isObject(container) ||
    container.Name !== `/${contract.name}` ||
    !/^[a-f0-9]{64}$/.test(container.Id ?? '') ||
    container.Image !== image.engineImageId ||
    container.Config?.Image !== image.reference ||
    container.Config?.Labels?.['com.docker.compose.project'] !== PROJECT ||
    container.Config?.Labels?.['com.docker.compose.service'] !== serviceName ||
    container.HostConfig?.RestartPolicy?.Name !== restart
  ) {
    refuse('E_CONTAINER_IDENTITY', `Container ${serviceName} identity is invalid.`);
  }
  const networks = Object.keys(container.NetworkSettings?.Networks ?? {});
  if (networks.length !== 1 || networks[0] !== plan.resources.network) {
    refuse('E_CONTAINER_NETWORK', `Container ${serviceName} network is invalid.`);
  }
  const mounts = Array.isArray(container.Mounts) ? container.Mounts : [];
  if (serviceName === 'mysql' || serviceName === 'redis') {
    const volume = serviceName === 'mysql' ? plan.resources.mysqlVolume : plan.resources.redisVolume;
    if (
      mounts.length !== 1 ||
      mounts[0].Type !== 'volume' ||
      mounts[0].Name !== volume ||
      mounts[0].Destination !== contract.mountTarget ||
      mounts[0].RW !== true
    ) {
      refuse('E_CONTAINER_MOUNT', `Container ${serviceName} mount is invalid.`);
    }
  } else if (serviceName === 'envoy') {
    if (
      mounts.length !== 1 ||
      mounts[0].Type !== 'bind' ||
      mounts[0].Source !== `${plan.releasePath}/docker/envoy/envoy.yaml` ||
      mounts[0].Destination !== contract.mountTarget ||
      mounts[0].RW !== false
    ) {
      refuse('E_CONTAINER_MOUNT', 'Container Envoy bind mount is invalid.');
    }
  } else if (mounts.length !== 0) {
    refuse('E_CONTAINER_MOUNT', `Container ${serviceName} has an unexpected mount.`);
  }
  const bindings = container.HostConfig?.PortBindings ?? {};
  if (serviceName === 'envoy') {
    const published = bindings['80/tcp'];
    if (
      Object.keys(bindings).length !== 1 ||
      !Array.isArray(published) ||
      published.length !== 1 ||
      published[0].HostIp !== '127.0.0.1' ||
      published[0].HostPort !== '8080'
    ) {
      refuse('E_NETWORK_EXPOSURE', 'Envoy runtime port binding is invalid.');
    }
  } else if (Object.keys(bindings).length !== 0) {
    refuse('E_NETWORK_EXPOSURE', `Container ${serviceName} publishes a port.`);
  }
};

export const verifyCreatedResources = async (plan, manifest) => {
  await verifyProjectResourceSet(plan);
  const containers = await inspectContainers(
    ALL_SERVICES.map((service) => SERVICE_CONTRACT[service].name),
    'Created container inspection',
  );
  const identities = {};
  for (let index = 0; index < ALL_SERVICES.length; index += 1) {
    const service = ALL_SERVICES[index];
    const container = containers[index];
    verifyContainerContract(container, service, plan, manifest, 'no');
    if (
      container.State.Status !== 'created' ||
      container.State.Running !== false ||
      container.State.StartedAt !== '0001-01-01T00:00:00Z' ||
      container.State.FinishedAt !== '0001-01-01T00:00:00Z' ||
      container.RestartCount !== 0
    ) {
      refuse('E_CONTAINER_STATE', `Container ${service} was not freshly created.`);
    }
    identities[service] = {
      name: SERVICE_CONTRACT[service].name,
      id: container.Id,
      imageId: container.Image,
    };
  }
  const volumeResult = await docker(
    ['volume', 'inspect', plan.resources.mysqlVolume, plan.resources.redisVolume],
    { label: 'Created volume inspection', timeoutMs: 30_000, maxOutputBytes: 1024 * 1024 },
  );
  const volumes = parseJsonOutput(volumeResult, 'Created volume inspection');
  for (const [index, name] of [plan.resources.mysqlVolume, plan.resources.redisVolume].entries()) {
    if (
      !Array.isArray(volumes) ||
      volumes[index]?.Name !== name ||
      volumes[index]?.Driver !== 'local' ||
      volumes[index]?.Labels?.['com.docker.compose.project'] !== PROJECT
    ) {
      refuse('E_VOLUME_IDENTITY', 'Created volume identity is invalid.');
    }
  }
  const networkResult = await docker(['network', 'inspect', plan.resources.network], {
    label: 'Created network inspection',
    timeoutMs: 30_000,
    maxOutputBytes: 1024 * 1024,
  });
  const networks = parseJsonOutput(networkResult, 'Created network inspection');
  const network = Array.isArray(networks) ? networks[0] : null;
  if (
    networks?.length !== 1 ||
    network?.Name !== plan.resources.network ||
    network?.Driver !== 'bridge' ||
    network?.Internal !== false ||
    network?.Labels?.['com.docker.compose.project'] !== PROJECT ||
    !/^[a-f0-9]{64}$/.test(network?.Id ?? '')
  ) {
    refuse('E_NETWORK_IDENTITY', 'Created network identity is invalid.');
  }
  return { containers: identities, networkId: network.Id };
};

export const verifyExistingResources = async (plan, recorded) => {
  await verifyProjectResourceSet(plan);
  const volumeResult = await docker(
    ['volume', 'inspect', plan.resources.mysqlVolume, plan.resources.redisVolume],
    {
      label: 'Existing volume identity inspection',
      timeoutMs: 30_000,
      maxOutputBytes: 1024 * 1024,
    },
  );
  const volumes = parseJsonOutput(volumeResult, 'Existing volume identity inspection');
  for (const [index, name] of [plan.resources.mysqlVolume, plan.resources.redisVolume].entries()) {
    if (
      volumes?.[index]?.Name !== name ||
      volumes[index]?.Driver !== 'local' ||
      volumes[index]?.Labels?.['com.docker.compose.project'] !== PROJECT
    ) {
      refuse('E_VOLUME_DRIFT', 'Persistent volume identity drifted.');
    }
  }
  const networkResult = await docker(['network', 'inspect', plan.resources.network], {
    label: 'Existing network identity inspection',
    timeoutMs: 30_000,
    maxOutputBytes: 1024 * 1024,
  });
  const [network] = parseJsonOutput(networkResult, 'Existing network identity inspection');
  if (
    network?.Name !== plan.resources.network ||
    network?.Id !== recorded.networkId ||
    network?.Driver !== 'bridge' ||
    network?.Internal !== false ||
    network?.Labels?.['com.docker.compose.project'] !== PROJECT
  ) {
    refuse('E_NETWORK_DRIFT', 'Runtime network identity drifted.');
  }
};

export const verifyRunningHealth = async (
  services,
  plan,
  manifest,
  restart = 'no',
) => {
  const containers = await inspectContainers(
    services.map((service) => SERVICE_CONTRACT[service].name),
    'Running container inspection',
  );
  for (let index = 0; index < services.length; index += 1) {
    verifyContainerContract(containers[index], services[index], plan, manifest, restart);
    if (
      containers[index].State?.Status !== 'running' ||
      containers[index].State?.Running !== true ||
      containers[index].State?.Health?.Status !== 'healthy'
    ) {
      refuse('E_CONTAINER_HEALTH', `Container ${services[index]} is not healthy.`);
    }
  }
  return containers;
};

export const inspectMigration = async (plan, manifest) => {
  const [container] = await inspectContainers(
    [SERVICE_CONTRACT.database_migration.name],
    'Migration container inspection',
  );
  verifyContainerContract(container, 'database_migration', plan, manifest, 'no');
  return container;
};

export const verifyRuntimeContainerState = (container, service) => {
  if (container.State?.Running === true && container.State?.Status === 'running') {
    if (container.State?.Health?.Status !== 'healthy') {
      refuse('E_CONTAINER_HEALTH', `Runtime ${service} is running but not healthy.`);
    }
  } else if (
    !(
      container.State?.Running === false &&
      ['created', 'exited'].includes(container.State?.Status)
    )
  ) {
    refuse('E_CONTAINER_STATE', `Runtime ${service} state is invalid.`);
  }
};
