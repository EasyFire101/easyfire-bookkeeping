import http from 'node:http';

import { ProbeConfig, ProbeObservation } from '../contracts.js';

export function runHttpProbe(probe: ProbeConfig): Promise<ProbeObservation> {
  const startedAt = performance.now();
  return new Promise((resolve) => {
    const request = http.request(
      probe.url,
      {
        method: 'GET',
        timeout: probe.timeoutMs,
        headers: { 'User-Agent': 'EasyFire-Bookkeeping-Guardian/1' },
      },
      (response) => {
        response.resume();
        response.on('end', () => {
          resolve({
            name: probe.name,
            ok: response.statusCode === probe.expectedStatus,
            statusCode: response.statusCode ?? null,
            latencyMs: Math.round(performance.now() - startedAt),
          });
        });
      },
    );
    const fail = () => {
      resolve({
        name: probe.name,
        ok: false,
        statusCode: null,
        latencyMs: Math.round(performance.now() - startedAt),
      });
    };
    request.on('timeout', () => request.destroy(new Error('Probe timed out.')));
    request.on('error', fail);
    request.end();
  });
}
