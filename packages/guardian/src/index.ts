export * from './contracts.js';
export * from './config.js';
export * from './adapters/docker-engine.js';
export * from './adapters/http-probe.js';
export * from './status-store.js';
export * from './runner.js';
export * from './state-machine.js';

import { pathToFileURL } from 'node:url';

import { runGuardianFromConfigPath } from './runner.js';

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  const configPath = process.argv[2] ?? '/etc/easyfire-bookkeeping/guardian.json';
  runGuardianFromConfigPath(configPath)
    .then((status) => {
      process.stdout.write(`${JSON.stringify(status)}\n`);
      process.exitCode = status.phase === 'escalated' ? 2 : 0;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown Guardian failure.';
      process.stderr.write(`Guardian refused to act: ${message}\n`);
      process.exitCode = 1;
    });
}
