#!/usr/local/bin/node

import { constants } from 'node:fs';
import {
  link,
  lstat,
  open,
  realpath,
  unlink,
} from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const EXIT = Object.freeze({
  OK: 0,
  USAGE: 64,
  DATA: 65,
  SOURCE: 66,
  PLATFORM: 69,
  TARGET: 73,
  PERMISSION: 77,
  INTERNAL: 70,
});

const MAX_ENV_BYTES = 1024 * 1024;
const LEGACY_JWT_KEY = 'JWT_SECRET';
const MODERN_JWT_KEY = 'APP_JWT_SECRET';
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RELEASE_COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const MYSQL_VOLUME_PATTERN =
  /^easyfire_bookkeeping_vm_[a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?_mysql$/;
const REDIS_VOLUME_PATTERN =
  /^easyfire_bookkeeping_vm_[a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?_redis$/;
const REQUIRED_BASE_URL =
  'https://easyfire-bookkeeping-newsec.taild63e9b.ts.net';
const MATERIALIZED_KEYS = Object.freeze([
  'IMAGE_TAG',
  'MARIADB_IMAGE_TAG',
  'MARIADB_VOLUME_NAME',
  'REDIS_VOLUME_NAME',
  'PUBLIC_PROXY_PORT',
  'BASE_URL',
  'SIGNUP_DISABLED',
  'SIGNUP_ALLOWED_DOMAINS',
  'SIGNUP_ALLOWED_EMAILS',
]);
const CANONICAL_BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export class EnvConversionError extends Error {
  constructor(exitCode, message) {
    super(message);
    this.name = 'EnvConversionError';
    this.exitCode = exitCode;
  }
}

const fail = (exitCode, message) => {
  throw new EnvConversionError(exitCode, message);
};

const lineRecords = (input) => {
  if (!Buffer.isBuffer(input)) {
    fail(EXIT.DATA, 'E_ENV_INPUT: environment input must be a byte buffer.');
  }
  if (input.length === 0 || input.length > MAX_ENV_BYTES) {
    fail(
      EXIT.DATA,
      'E_ENV_SIZE: environment input must contain between 1 and 1048576 bytes.',
    );
  }
  if (input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf) {
    fail(EXIT.DATA, 'E_ENV_ENCODING: UTF-8 BOM is unsupported.');
  }
  if (input.includes(0x00)) {
    fail(EXIT.DATA, 'E_ENV_ENCODING: NUL bytes are unsupported.');
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(input);
  } catch {
    fail(EXIT.DATA, 'E_ENV_ENCODING: environment input must be valid UTF-8.');
  }

  const records = [];
  let start = 0;
  let lineNumber = 1;
  for (let index = 0; index < input.length; index += 1) {
    if (input[index] === 0x0d && input[index + 1] !== 0x0a) {
      fail(
        EXIT.DATA,
        `E_ENV_LINE_ENDING: bare carriage return at line ${lineNumber}.`,
      );
    }
    if (input[index] !== 0x0a) continue;

    const contentEnd = input[index - 1] === 0x0d ? index - 1 : index;
    records.push({
      content: input.subarray(start, contentEnd),
      ending: input.subarray(contentEnd, index + 1),
      lineNumber,
    });
    start = index + 1;
    lineNumber += 1;
  }
  if (start < input.length) {
    records.push({
      content: input.subarray(start),
      ending: Buffer.alloc(0),
      lineNumber,
    });
  }
  return records;
};

const firstNonWhitespace = (value) => {
  let index = 0;
  while (value[index] === 0x20 || value[index] === 0x09) index += 1;
  return index;
};

const parseEnvironment = (input) => {
  const records = lineRecords(input);
  const assignments = new Map();

  for (const record of records) {
    const first = firstNonWhitespace(record.content);
    if (first === record.content.length || record.content[first] === 0x23) {
      record.kind = 'pass-through';
      continue;
    }

    const equalsIndex = record.content.indexOf(0x3d);
    if (equalsIndex <= 0) {
      fail(
        EXIT.DATA,
        `E_ENV_MALFORMED: malformed environment entry at line ${record.lineNumber}.`,
      );
    }
    const keyBytes = record.content.subarray(0, equalsIndex);
    const key = keyBytes.toString('ascii');
    if (!KEY_PATTERN.test(key) || !Buffer.from(key, 'ascii').equals(keyBytes)) {
      fail(
        EXIT.DATA,
        `E_ENV_MALFORMED: malformed environment entry at line ${record.lineNumber}.`,
      );
    }
    if (assignments.has(key)) {
      fail(
        EXIT.DATA,
        `E_ENV_DUPLICATE_KEY: duplicate environment key at line ${record.lineNumber}.`,
      );
    }

    const value = record.content.subarray(equalsIndex + 1);
    const valueStart = firstNonWhitespace(value);
    if (value[valueStart] === 0x22 || value[valueStart] === 0x27) {
      fail(
        EXIT.DATA,
        `E_ENV_AMBIGUOUS_VALUE: quoted value is unsupported at line ${record.lineNumber}.`,
      );
    }
    if (value.length > 0 && value[value.length - 1] === 0x5c) {
      fail(
        EXIT.DATA,
        `E_ENV_AMBIGUOUS_VALUE: multiline continuation is unsupported at line ${record.lineNumber}.`,
      );
    }
    const hasComposeInlineComment = value.some(
      (byte, index) =>
        byte === 0x23 &&
        index > 0 &&
        (value[index - 1] === 0x20 || value[index - 1] === 0x09),
    );
    if (
      value.includes(0x24) ||
      value[0] === 0x20 ||
      value[0] === 0x09 ||
      value[value.length - 1] === 0x20 ||
      value[value.length - 1] === 0x09 ||
      hasComposeInlineComment
    ) {
      fail(
        EXIT.DATA,
        `E_ENV_COMPOSE_SYNTAX: unquoted value would be transformed by Docker Compose at line ${record.lineNumber}.`,
      );
    }

    Object.assign(record, {
      kind: 'assignment',
      key,
      equalsIndex,
      value,
    });
    assignments.set(key, record);
  }

  return { assignments, records };
};

const validateJwtSecret = (value) => {
  const encoded = value.toString('ascii');
  const isAscii = Buffer.from(encoded, 'ascii').equals(value);
  let decoded;
  if (isAscii && CANONICAL_BASE64.test(encoded)) {
    decoded = Buffer.from(encoded, 'base64');
  }
  if (
    !decoded ||
    decoded.length < 64 ||
    decoded.toString('base64') !== encoded
  ) {
    fail(
      EXIT.DATA,
      'E_ENV_JWT_POLICY: JWT secret must be canonical base64 decoding to at least 64 bytes.',
    );
  }
};

export const convertEnvironmentBytes = (input) => {
  const { assignments, records } = parseEnvironment(input);
  const legacy = assignments.get(LEGACY_JWT_KEY);
  const modern = assignments.get(MODERN_JWT_KEY);

  if (!legacy) {
    fail(
      EXIT.DATA,
      'E_ENV_JWT_MISSING: legacy JWT_SECRET is required for conversion.',
    );
  }
  validateJwtSecret(legacy.value);
  if (
    modern &&
    (modern.value.length !== legacy.value.length ||
      !timingSafeEqual(modern.value, legacy.value))
  ) {
    fail(
      EXIT.DATA,
      'E_ENV_JWT_MISMATCH: APP_JWT_SECRET does not match JWT_SECRET.',
    );
  }

  const converted = [];
  for (const record of records) {
    if (record.kind === 'assignment' && record.key === LEGACY_JWT_KEY) {
      if (modern) continue;
      converted.push(Buffer.from(MODERN_JWT_KEY, 'ascii'));
      converted.push(record.content.subarray(record.equalsIndex));
      converted.push(record.ending);
      continue;
    }
    converted.push(record.content, record.ending);
  }
  return Buffer.concat(converted);
};

const validateMaterializationOptions = (options, exitCode = EXIT.DATA) => {
  if (
    typeof options?.releaseCommit !== 'string' ||
    !RELEASE_COMMIT_PATTERN.test(options.releaseCommit)
  ) {
    fail(
      exitCode,
      'E_ENV_RELEASE_COMMIT: release commit must be exactly 40 lowercase hexadecimal characters.',
    );
  }
  if (
    typeof options?.mysqlVolume !== 'string' ||
    !MYSQL_VOLUME_PATTERN.test(options.mysqlVolume)
  ) {
    fail(
      exitCode,
      'E_ENV_MYSQL_VOLUME: MySQL volume must be a bounded isolated easyfire_bookkeeping_vm_*_mysql name.',
    );
  }
  if (
    typeof options?.redisVolume !== 'string' ||
    !REDIS_VOLUME_PATTERN.test(options.redisVolume)
  ) {
    fail(
      exitCode,
      'E_ENV_REDIS_VOLUME: Redis volume must be a bounded isolated easyfire_bookkeeping_vm_*_redis name.',
    );
  }
  const mysqlLane = options.mysqlVolume.slice(0, -'_mysql'.length);
  const redisLane = options.redisVolume.slice(0, -'_redis'.length);
  if (mysqlLane !== redisLane) {
    fail(
      exitCode,
      'E_ENV_VOLUME_PAIR: MySQL and Redis volumes must identify the same isolated deployment lane.',
    );
  }
  if (options?.baseUrl !== REQUIRED_BASE_URL) {
    fail(
      exitCode,
      'E_ENV_BASE_URL: base URL must be the exact private Newsec Tailscale HTTPS endpoint.',
    );
  }
};

const preferredLineEnding = (records) => {
  const firstEnding = records.find((record) => record.ending.length > 0)?.ending;
  return firstEnding ? Buffer.from(firstEnding) : Buffer.from('\n', 'ascii');
};

export const materializeEnvironmentBytes = (input, options) => {
  validateMaterializationOptions(options);
  const { assignments, records } = parseEnvironment(input);
  const legacy = assignments.get(LEGACY_JWT_KEY);
  const modern = assignments.get(MODERN_JWT_KEY);

  if (!legacy) {
    fail(
      EXIT.DATA,
      'E_ENV_JWT_MISSING: legacy JWT_SECRET is required for conversion.',
    );
  }
  validateJwtSecret(legacy.value);
  if (
    modern &&
    (modern.value.length !== legacy.value.length ||
      !timingSafeEqual(modern.value, legacy.value))
  ) {
    fail(
      EXIT.DATA,
      'E_ENV_JWT_MISMATCH: APP_JWT_SECRET does not match JWT_SECRET.',
    );
  }

  const imageTag = `git-${options.releaseCommit}`;
  const desired = new Map([
    ['IMAGE_TAG', imageTag],
    ['MARIADB_IMAGE_TAG', imageTag],
    ['MARIADB_VOLUME_NAME', options.mysqlVolume],
    ['REDIS_VOLUME_NAME', options.redisVolume],
    ['PUBLIC_PROXY_PORT', '8080'],
    ['BASE_URL', options.baseUrl],
    ['SIGNUP_DISABLED', 'true'],
    ['SIGNUP_ALLOWED_DOMAINS', ''],
    ['SIGNUP_ALLOWED_EMAILS', ''],
  ]);
  const found = new Set();
  const converted = [];

  for (const record of records) {
    if (record.kind === 'assignment' && record.key === LEGACY_JWT_KEY) {
      if (modern) continue;
      converted.push(Buffer.from(MODERN_JWT_KEY, 'ascii'));
      converted.push(record.content.subarray(record.equalsIndex));
      converted.push(record.ending);
      continue;
    }
    if (record.kind === 'assignment' && desired.has(record.key)) {
      found.add(record.key);
      converted.push(
        Buffer.from(`${record.key}=${desired.get(record.key)}`, 'ascii'),
        record.ending,
      );
      continue;
    }
    converted.push(record.content, record.ending);
  }

  const missing = MATERIALIZED_KEYS.filter((key) => !found.has(key));
  if (missing.length > 0) {
    const ending = preferredLineEnding(records);
    const current = Buffer.concat(converted);
    converted.length = 0;
    converted.push(current);
    if (current[current.length - 1] !== 0x0a) converted.push(ending);
    for (const key of missing) {
      converted.push(Buffer.from(`${key}=${desired.get(key)}`, 'ascii'), ending);
    }
  }

  const output = Buffer.concat(converted);
  if (output.length > MAX_ENV_BYTES) {
    fail(EXIT.DATA, 'E_ENV_SIZE: materialized environment exceeds 1048576 bytes.');
  }
  return output;
};

const assertCanonicalAbsolutePath = (candidate, kind) => {
  if (
    typeof candidate !== 'string' ||
    candidate.length === 0 ||
    candidate.includes('\0') ||
    !path.isAbsolute(candidate) ||
    path.resolve(candidate) !== candidate
  ) {
    fail(
      kind === 'source' ? EXIT.SOURCE : EXIT.TARGET,
      kind === 'source'
        ? 'E_SOURCE_PATH: source path must be absolute and canonical.'
        : 'E_TARGET_PATH: target path must be absolute and canonical.',
    );
  }
};

const secureMode = (stat) => stat.mode & 0o777;

const readSecureSource = async (sourcePath) => {
  assertCanonicalAbsolutePath(sourcePath, 'source');
  let resolved;
  try {
    resolved = await realpath(sourcePath);
  } catch {
    fail(EXIT.SOURCE, 'E_SOURCE_OPEN: source environment is unavailable.');
  }
  if (resolved !== sourcePath) {
    fail(EXIT.SOURCE, 'E_SOURCE_UNSAFE: source path must not contain symlinks.');
  }

  let handle;
  try {
    handle = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.uid !== 0 ||
      (secureMode(stat) & 0o077) !== 0 ||
      stat.size < 1 ||
      stat.size > MAX_ENV_BYTES
    ) {
      fail(
        EXIT.SOURCE,
        'E_SOURCE_UNSAFE: source must be a root-owned, root-only regular file within the size limit.',
      );
    }
    return await handle.readFile();
  } catch (error) {
    if (error instanceof EnvConversionError) throw error;
    fail(EXIT.SOURCE, 'E_SOURCE_OPEN: source environment is unavailable.');
  } finally {
    await handle?.close().catch(() => {});
  }
};

const assertSecureTargetParent = async (targetPath) => {
  assertCanonicalAbsolutePath(targetPath, 'target');
  const parentPath = path.dirname(targetPath);
  let resolvedParent;
  let parentStat;
  try {
    [resolvedParent, parentStat] = await Promise.all([
      realpath(parentPath),
      lstat(parentPath),
    ]);
  } catch {
    fail(EXIT.TARGET, 'E_TARGET_PARENT: target parent is unavailable.');
  }
  if (
    resolvedParent !== parentPath ||
    !parentStat.isDirectory() ||
    parentStat.uid !== 0 ||
    (secureMode(parentStat) & 0o022) !== 0
  ) {
    fail(
      EXIT.TARGET,
      'E_TARGET_PARENT: target parent must be root-owned, symlink-free, and not group/world-writable.',
    );
  }
  return parentPath;
};

const inspectExistingTarget = async (targetPath, expected) => {
  let targetStat;
  try {
    targetStat = await lstat(targetPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    fail(EXIT.TARGET, 'E_TARGET_OPEN: target environment cannot be inspected.');
  }
  if (targetStat.isSymbolicLink() || !targetStat.isFile()) {
    fail(
      EXIT.TARGET,
      'E_TARGET_UNSAFE: existing target must be a regular file, never a symlink.',
    );
  }

  let handle;
  try {
    handle = await open(targetPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.uid !== 0 ||
      secureMode(stat) !== 0o600 ||
      stat.nlink !== 1 ||
      stat.size > MAX_ENV_BYTES
    ) {
      fail(
        EXIT.TARGET,
        'E_TARGET_UNSAFE: existing target must be root-owned mode 0600 with one link.',
      );
    }
    const actual = await handle.readFile();
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      fail(
        EXIT.TARGET,
        'E_TARGET_MISMATCH: existing target differs; refusing to overwrite it.',
      );
    }
    return true;
  } catch (error) {
    if (error instanceof EnvConversionError) throw error;
    fail(EXIT.TARGET, 'E_TARGET_OPEN: target environment cannot be inspected.');
  } finally {
    await handle?.close().catch(() => {});
  }
};

const createTemporaryFile = async (parentPath, targetName) => {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const suffix = randomBytes(12).toString('hex');
    const temporaryPath = path.join(
      parentPath,
      `.${targetName}.tmp-${process.pid}-${suffix}`,
    );
    try {
      const handle = await open(
        temporaryPath,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          constants.O_NOFOLLOW,
        0o600,
      );
      return { handle, temporaryPath };
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        fail(EXIT.TARGET, 'E_TARGET_CREATE: target temporary file cannot be created.');
      }
    }
  }
  fail(EXIT.TARGET, 'E_TARGET_CREATE: target temporary name allocation failed.');
};

const publishTarget = async (targetPath, contents, parentPath) => {
  const targetName = path.basename(targetPath);
  const { handle, temporaryPath } = await createTemporaryFile(
    parentPath,
    targetName,
  );
  let handleOpen = true;
  let temporaryExists = true;
  let directoryHandle;
  try {
    await handle.chmod(0o600);
    await handle.writeFile(contents);
    await handle.sync();
    const stat = await handle.stat();
    if (stat.uid !== 0 || secureMode(stat) !== 0o600) {
      fail(
        EXIT.TARGET,
        'E_TARGET_CREATE: target temporary file did not retain root mode 0600.',
      );
    }
    await handle.close();
    handleOpen = false;

    try {
      await link(temporaryPath, targetPath);
    } catch (error) {
      if (error?.code === 'EEXIST') {
        const matched = await inspectExistingTarget(targetPath, contents);
        return matched ? 'existing-match' : 'unreachable';
      }
      fail(EXIT.TARGET, 'E_TARGET_CREATE: atomic target publication failed.');
    }

    directoryHandle = await open(parentPath, constants.O_RDONLY);
    await directoryHandle.sync();
    await unlink(temporaryPath);
    temporaryExists = false;
    await directoryHandle.sync();
    return 'created';
  } catch (error) {
    if (error instanceof EnvConversionError) throw error;
    fail(EXIT.TARGET, 'E_TARGET_CREATE: atomic target publication failed.');
  } finally {
    if (handleOpen) await handle.close().catch(() => {});
    if (temporaryExists) await unlink(temporaryPath).catch(() => {});
    await directoryHandle?.close().catch(() => {});
  }
};

export const prepareProductionEnvironment = async ({
  sourcePath,
  targetPath,
  releaseCommit,
  mysqlVolume,
  redisVolume,
  baseUrl,
}) => {
  if (process.platform !== 'linux') {
    fail(EXIT.PLATFORM, 'E_PLATFORM: this helper runs only on Linux.');
  }
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) {
    fail(EXIT.PERMISSION, 'E_ROOT_REQUIRED: run this helper as root.');
  }
  if (sourcePath === targetPath) {
    fail(EXIT.TARGET, 'E_TARGET_PATH: source and target must be different files.');
  }

  const source = await readSecureSource(sourcePath);
  const converted = materializeEnvironmentBytes(source, {
    releaseCommit,
    mysqlVolume,
    redisVolume,
    baseUrl,
  });
  const parentPath = await assertSecureTargetParent(targetPath);
  if (await inspectExistingTarget(targetPath, converted)) return 'existing-match';
  return publishTarget(targetPath, converted, parentPath);
};

const parseArguments = (argv) => {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
    return { help: true };
  }
  const parsed = {};
  const argumentsByOption = Object.freeze({
    '--source': 'sourcePath',
    '--target': 'targetPath',
    '--release-commit': 'releaseCommit',
    '--mysql-volume': 'mysqlVolume',
    '--redis-volume': 'redisVolume',
    '--base-url': 'baseUrl',
  });
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!Object.hasOwn(argumentsByOption, option) || !value) {
      fail(
        EXIT.USAGE,
        'E_USAGE: use --source <path> --target <path> --release-commit <40hex> --mysql-volume <name> --redis-volume <name> --base-url <private-url>.',
      );
    }
    const property = argumentsByOption[option];
    if (parsed[property]) {
      fail(EXIT.USAGE, `E_USAGE: duplicate ${option} argument.`);
    }
    parsed[property] = value;
  }
  const required = [
    ['sourcePath', '--source'],
    ['targetPath', '--target'],
    ['releaseCommit', '--release-commit'],
    ['mysqlVolume', '--mysql-volume'],
    ['redisVolume', '--redis-volume'],
    ['baseUrl', '--base-url'],
  ];
  if (required.every(([property]) => !parsed[property])) {
    fail(
      EXIT.USAGE,
      'E_USAGE: required --source, --target, --release-commit, --mysql-volume, --redis-volume, and --base-url arguments are missing.',
    );
  }
  for (const [property, option] of required) {
    if (!parsed[property]) {
      fail(EXIT.USAGE, `E_USAGE: required ${option} argument is missing.`);
    }
  }
  validateMaterializationOptions(parsed, EXIT.USAGE);
  return parsed;
};

const main = async () => {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(
        'Usage: linux-convert-production-env.mjs --source <absolute-path> --target <absolute-path> --release-commit <40hex> --mysql-volume <isolated-name> --redis-volume <isolated-name> --base-url <private-newsec-url>\n',
      );
      return EXIT.OK;
    }
    const status = await prepareProductionEnvironment(options);
    process.stdout.write(`EASYFIRE_ENV_READY status=${status}\n`);
    return EXIT.OK;
  } catch (error) {
    if (error instanceof EnvConversionError) {
      process.stderr.write(`${error.message}\n`);
      return error.exitCode;
    }
    process.stderr.write('E_INTERNAL: environment conversion failed.\n');
    return EXIT.INTERNAL;
  }
};

const isMain =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) process.exitCode = await main();
