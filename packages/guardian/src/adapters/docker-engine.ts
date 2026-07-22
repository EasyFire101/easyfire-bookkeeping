import http from 'node:http';

import {
  RuntimeManifest,
  RuntimeService,
  ServiceObservation,
} from '../contracts.js';

interface DockerContainerInspect {
  Id: string;
  Image: string;
  Name: string;
  State: {
    Status?: string;
    Running?: boolean;
    Health?: { Status?: string };
  };
}

export interface DockerResponse {
  statusCode: number;
  body: string;
}

export type DockerTransport = (
  method: string,
  path: string,
) => Promise<DockerResponse>;

function requestDockerSocket(
  socketPath: string,
  method: string,
  path: string,
): Promise<DockerResponse> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        socketPath,
        method,
        path,
        headers: { Host: 'localhost' },
        timeout: 5_000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let length = 0;
        response.on('data', (chunk: Buffer) => {
          length += chunk.length;
          if (length > 2_000_000) {
            request.destroy(new Error('Docker response exceeded 2 MB.'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    request.on('timeout', () => request.destroy(new Error('Docker request timed out.')));
    request.on('error', reject);
    request.end();
  });
}

export class DockerEngineClient {
  private readonly transport: DockerTransport;

  constructor(
    socketPath: string,
    transport?: DockerTransport,
  ) {
    this.transport = transport ?? ((method, path) => requestDockerSocket(socketPath, method, path));
  }

  async ping(): Promise<boolean> {
    try {
      const response = await this.transport('GET', '/_ping');
      return response.statusCode === 200 && response.body.trim() === 'OK';
    }
    catch {
      return false;
    }
  }

  async observeService(service: RuntimeService): Promise<ServiceObservation> {
    const response = await this.transport(
      'GET',
      `/containers/${encodeURIComponent(service.containerName)}/json`,
    );
    if (response.statusCode === 404) {
      return {
        role: service.role,
        containerName: service.containerName,
        expectedContainerId: service.containerId,
        observedContainerId: null,
        expectedImageId: service.imageId,
        observedImageId: null,
        state: 'missing',
        healthy: false,
      };
    }
    if (response.statusCode !== 200) {
      throw new Error(`Docker inspect returned ${response.statusCode} for ${service.role}.`);
    }
    const inspect = JSON.parse(response.body) as DockerContainerInspect;
    const state = inspect.State.Running
      ? 'running'
      : inspect.State.Status === 'exited' || inspect.State.Status === 'created'
        ? 'stopped'
        : 'unknown';
    const healthStatus = inspect.State.Health?.Status;
    const healthy =
      state === 'running' &&
      (service.requireDockerHealth ? healthStatus === 'healthy' : true);
    return {
      role: service.role,
      containerName: service.containerName,
      expectedContainerId: service.containerId,
      observedContainerId: inspect.Id,
      expectedImageId: service.imageId,
      observedImageId: inspect.Image,
      state,
      healthy,
    };
  }

  async observeManifest(manifest: RuntimeManifest): Promise<ServiceObservation[]> {
    return Promise.all(manifest.services.map((service) => this.observeService(service)));
  }

  async startContainer(containerId: string): Promise<void> {
    if (!/^[a-f0-9]{12,64}$/.test(containerId)) {
      throw new Error('Refusing invalid container id.');
    }
    const response = await this.transport(
      'POST',
      `/containers/${containerId}/start`,
    );
    if (response.statusCode !== 204 && response.statusCode !== 304) {
      throw new Error(`Docker start returned ${response.statusCode}.`);
    }
  }
}
