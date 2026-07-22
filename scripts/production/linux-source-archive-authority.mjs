import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { createGunzip } from 'node:zlib';

const BLOCK_BYTES = 512;
const MAX_ARCHIVE_ENTRIES = 250_000;
const MAX_COMPRESSED_BYTES = 8 * 1024 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 16 * 1024 * 1024 * 1024;
const MAX_PAX_BYTES = 4096;
const COMMIT = /^[a-f0-9]{40}$/;

function refuse(message) {
  throw new Error(message);
}

function sameState(left, right) {
  return (
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.ino === right.ino &&
    left.dev === right.dev
  );
}

function allZero(buffer) {
  return buffer.every((byte) => byte === 0);
}

function parseTarNumber(buffer, start, length, label) {
  const field = buffer.subarray(start, start + length);
  if ((field[0] & 0x80) !== 0) refuse(`${label} uses unsupported base-256 encoding.`);
  const text = field.toString('ascii').replace(/\0.*$/, '').trim();
  if (!/^[0-7]+$/.test(text)) refuse(`${label} is not a canonical octal value.`);
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) refuse(`${label} is out of range.`);
  return value;
}

function verifyTarHeader(header) {
  const recorded = parseTarNumber(header, 148, 8, 'Source tar header checksum');
  let observed = 0;
  for (let index = 0; index < header.length; index += 1) {
    observed += index >= 148 && index < 156 ? 0x20 : header[index];
  }
  if (recorded !== observed) refuse('Source tar header checksum mismatch.');
}

function decodeTarField(header, start, length, label) {
  const field = header.subarray(start, start + length);
  const end = field.indexOf(0);
  const bytes = end === -1 ? field : field.subarray(0, end);
  const value = bytes.toString('utf8');
  if (!Buffer.from(value, 'utf8').equals(bytes)) refuse(`${label} is not valid UTF-8.`);
  return value;
}

function canonicalArchivePath(header, directory) {
  const name = decodeTarField(header, 0, 100, 'Source tar name');
  const prefix = decodeTarField(header, 345, 155, 'Source tar prefix');
  const raw = prefix ? `${prefix}/${name}` : name;
  const candidate = directory && raw.endsWith('/') ? raw.slice(0, -1) : raw;
  const segments = candidate.split('/');
  if (
    candidate.length === 0 ||
    candidate.startsWith('/') ||
    /^[A-Za-z]:/.test(candidate) ||
    candidate.includes('\\') ||
    (!directory && raw.endsWith('/')) ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    refuse(`Source tar contains an unsafe or non-canonical path: ${raw || '<empty>'}.`);
  }
  return candidate;
}

function parsePaxRecords(bytes) {
  const records = new Map();
  let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(0x20, offset);
    if (space === -1) refuse('Git archive pax record has no length separator.');
    const lengthText = bytes.subarray(offset, space).toString('ascii');
    if (!/^[1-9][0-9]*$/.test(lengthText)) refuse('Git archive pax length is invalid.');
    const length = Number.parseInt(lengthText, 10);
    const end = offset + length;
    if (!Number.isSafeInteger(length) || end > bytes.length || bytes[end - 1] !== 0x0a) {
      refuse('Git archive pax record is truncated or has an invalid length.');
    }
    const content = bytes.subarray(space + 1, end - 1);
    const equals = content.indexOf(0x3d);
    if (equals <= 0) refuse('Git archive pax record has no key/value separator.');
    const keyBytes = content.subarray(0, equals);
    const valueBytes = content.subarray(equals + 1);
    const key = keyBytes.toString('utf8');
    const value = valueBytes.toString('utf8');
    if (
      !Buffer.from(key, 'utf8').equals(keyBytes) ||
      !Buffer.from(value, 'utf8').equals(valueBytes) ||
      records.has(key)
    ) {
      refuse('Git archive pax records contain invalid UTF-8 or a duplicate key.');
    }
    records.set(key, value);
    offset = end;
  }
  return records;
}

class AsyncByteReader {
  constructor(readable) {
    this.iterator = readable[Symbol.asyncIterator]();
    this.buffer = Buffer.alloc(0);
    this.offset = 0;
    this.ended = false;
    this.expandedBytes = 0;
  }

  async pull() {
    if (this.offset < this.buffer.length) return true;
    if (this.ended) return false;
    const { value, done } = await this.iterator.next();
    if (done) {
      this.ended = true;
      this.buffer = Buffer.alloc(0);
      this.offset = 0;
      return false;
    }
    this.buffer = Buffer.from(value);
    this.offset = 0;
    this.expandedBytes += this.buffer.length;
    if (this.expandedBytes > MAX_EXPANDED_BYTES) {
      refuse('Source archive exceeds the expanded-byte safety bound.');
    }
    return true;
  }

  async consume(length, label, onChunk = () => {}) {
    let remaining = length;
    while (remaining > 0) {
      if (!(await this.pull())) refuse(`${label} is truncated.`);
      const available = this.buffer.length - this.offset;
      const take = Math.min(available, remaining);
      const chunk = this.buffer.subarray(this.offset, this.offset + take);
      onChunk(chunk);
      this.offset += take;
      remaining -= take;
    }
  }

  async readExact(length, label) {
    const output = Buffer.alloc(length);
    let written = 0;
    await this.consume(length, label, (chunk) => {
      chunk.copy(output, written);
      written += chunk.length;
    });
    return output;
  }

  async requireZeroRemainder() {
    while (await this.pull()) {
      const chunk = this.buffer.subarray(this.offset);
      if (!allZero(chunk)) refuse('Source tar contains data after its end markers.');
      this.offset = this.buffer.length;
    }
  }
}

function ancestors(entryPath) {
  const parts = entryPath.split('/');
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
}

async function inspectGitArchive(sourceArchivePath, releaseCommit, artifactSpecs) {
  if (!COMMIT.test(releaseCommit)) refuse('releaseCommit is not a lowercase Git commit id.');
  const before = await lstat(sourceArchivePath);
  if (before.isSymbolicLink() || !before.isFile()) {
    refuse('Source archive must be a regular non-symlink file.');
  }
  if (before.size === 0 || before.size > MAX_COMPRESSED_BYTES) {
    refuse('Source archive exceeds the compressed-byte safety bound.');
  }
  if (path.resolve(await realpath(sourceArchivePath)) !== path.resolve(sourceArchivePath)) {
    refuse('Source archive must use its canonical path.');
  }

  const compressedHash = createHash('sha256');
  let compressedBytes = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      compressedBytes += chunk.length;
      compressedHash.update(chunk);
      callback(null, chunk);
    },
  });
  const input = createReadStream(sourceArchivePath);
  const gunzip = createGunzip();
  input.once('error', (error) => gunzip.destroy(error));
  meter.once('error', (error) => gunzip.destroy(error));
  input.pipe(meter).pipe(gunzip);
  const reader = new AsyncByteReader(gunzip);
  const expected = new Map(artifactSpecs.map(([artifactPath, mode]) => [
    artifactPath,
    { mode, folded: artifactPath.toLowerCase() },
  ]));
  if (expected.size !== artifactSpecs.length) refuse('Release artifact specifications are duplicated.');
  const seen = new Set();
  const seenFolded = new Map();
  const kinds = new Map();
  const requiredDirectories = new Set();
  const artifacts = new Map();
  let embeddedCommit;
  let entries = 0;

  try {
    while (true) {
      const header = await reader.readExact(BLOCK_BYTES, 'Source tar header');
      if (allZero(header)) {
        const second = await reader.readExact(BLOCK_BYTES, 'Source tar second end marker');
        if (!allZero(second)) refuse('Source tar has only one zero end marker.');
        await reader.requireZeroRemainder();
        break;
      }
      verifyTarHeader(header);
      entries += 1;
      if (entries > MAX_ARCHIVE_ENTRIES) refuse('Source tar exceeds the entry-count safety bound.');
      const typeByte = header[156];
      const type = typeByte === 0 ? '0' : String.fromCharCode(typeByte);
      const directory = type === '5';
      const entryPath = canonicalArchivePath(header, directory);
      const folded = entryPath.toLowerCase();
      if (seen.has(entryPath)) refuse(`Source tar contains duplicate entry ${entryPath}.`);
      if (seenFolded.has(folded)) {
        refuse(`Source tar contains a case-ambiguous path for ${entryPath}.`);
      }
      seen.add(entryPath);
      seenFolded.set(folded, entryPath);
      const size = parseTarNumber(header, 124, 12, `${entryPath} size`);
      const mode = parseTarNumber(header, 100, 8, `${entryPath} mode`);
      if ((mode & ~0o777) !== 0) {
        refuse(`Source tar entry ${entryPath} has unsupported special mode bits.`);
      }

      if (type === '1' || type === '2') refuse(`Source tar link entry is forbidden: ${entryPath}.`);
      if (!['0', '5', 'g'].includes(type)) {
        refuse(`Source tar entry ${entryPath} has unsupported type ${type}.`);
      }
      if (type === 'g') {
        if (entryPath !== 'pax_global_header' || embeddedCommit !== undefined || entries !== 1) {
          refuse('Source tar Git global pax header is missing, duplicated, or misplaced.');
        }
        if (size === 0 || size > MAX_PAX_BYTES) refuse('Git archive pax header size is invalid.');
        const pax = parsePaxRecords(await reader.readExact(size, 'Git archive pax header'));
        if (pax.size !== 1 || !pax.has('comment')) {
          refuse('Git archive pax header must contain only the embedded commit comment.');
        }
        embeddedCommit = pax.get('comment');
      }
      else {
        if (embeddedCommit === undefined) refuse('Source tar is missing the leading Git commit header.');
        for (const ancestor of ancestors(entryPath)) {
          if (kinds.get(ancestor) === 'file') {
            refuse(`Source tar path has a file ancestor: ${entryPath}.`);
          }
          requiredDirectories.add(ancestor);
        }
        if (!directory && requiredDirectories.has(entryPath)) {
          refuse(`Source tar file conflicts with an existing descendant path: ${entryPath}.`);
        }
        kinds.set(entryPath, directory ? 'directory' : 'file');
        if (directory) {
          if (size !== 0) refuse(`Source tar directory ${entryPath} has payload bytes.`);
        }
        else {
          const expectedEntry = expected.get(entryPath);
          const hash = expectedEntry ? createHash('sha256') : undefined;
          await reader.consume(size, `Source tar entry ${entryPath}`, (chunk) => hash?.update(chunk));
          if (expectedEntry) {
            if (mode !== Number.parseInt(expectedEntry.mode, 8)) {
              refuse(`Release artifact ${entryPath} archive mode does not match ${expectedEntry.mode}.`);
            }
            artifacts.set(entryPath, {
              sha256: hash.digest('hex'),
              bytes: size,
              mode: expectedEntry.mode,
            });
          }
        }
      }
      const padding = (BLOCK_BYTES - (size % BLOCK_BYTES)) % BLOCK_BYTES;
      if (padding > 0) {
        const paddingBytes = await reader.readExact(padding, `${entryPath} padding`);
        if (!allZero(paddingBytes)) refuse(`Source tar entry ${entryPath} has nonzero padding.`);
      }
    }
  }
  finally {
    gunzip.destroy();
    meter.destroy();
    input.destroy();
  }

  const after = await stat(sourceArchivePath);
  if (!sameState(before, after) || compressedBytes !== before.size) {
    refuse('Source archive changed during streaming verification.');
  }
  if (embeddedCommit !== releaseCommit) {
    refuse('Source archive embedded Git commit does not match releaseCommit.');
  }
  for (const [artifactPath] of expected) {
    if (!artifacts.has(artifactPath)) {
      refuse(`Source archive is missing bound release artifact ${artifactPath}.`);
    }
  }
  return {
    sourceArchive: {
      sha256: compressedHash.digest('hex'),
      bytes: compressedBytes,
    },
    artifacts,
  };
}

async function hashSourceFile(filePath, expectedMode, label) {
  const before = await lstat(filePath);
  if (before.isSymbolicLink() || !before.isFile()) {
    refuse(`${label} must be a regular non-symlink file.`);
  }
  if (path.resolve(await realpath(filePath)) !== path.resolve(filePath)) {
    refuse(`${label} must use its canonical path.`);
  }
  if (
    process.platform !== 'win32' &&
    (before.mode & 0o7777) !== Number.parseInt(expectedMode, 8)
  ) {
    refuse(`${label} sourceRoot mode does not match ${expectedMode}.`);
  }
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(filePath)) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  const after = await stat(filePath);
  if (!sameState(before, after)) refuse(`${label} changed during verification.`);
  return { sha256: hash.digest('hex'), bytes };
}

export async function verifySourceArchiveProvenance({
  sourceArchivePath,
  sourceRoot,
  releaseCommit,
  artifactSpecs,
}) {
  const rootState = await lstat(sourceRoot);
  if (rootState.isSymbolicLink() || !rootState.isDirectory()) {
    refuse('Source root must be a regular non-symlink directory.');
  }
  if (path.resolve(await realpath(sourceRoot)) !== path.resolve(sourceRoot)) {
    refuse('Source root must use its canonical path.');
  }
  const inspected = await inspectGitArchive(sourceArchivePath, releaseCommit, artifactSpecs);
  const artifacts = [];
  for (const [artifactPath, mode] of artifactSpecs) {
    const target = path.resolve(sourceRoot, ...artifactPath.split('/'));
    if (!target.startsWith(`${path.resolve(sourceRoot)}${path.sep}`)) {
      refuse(`Release artifact escapes source root: ${artifactPath}.`);
    }
    const source = await hashSourceFile(target, mode, `Release artifact ${artifactPath}`);
    const archived = inspected.artifacts.get(artifactPath);
    if (source.sha256 !== archived.sha256 || source.bytes !== archived.bytes) {
      refuse(`Release artifact ${artifactPath} does not match its exact source archive entry.`);
    }
    artifacts.push({ path: artifactPath, ...source, mode });
  }
  return { sourceArchive: inspected.sourceArchive, artifacts };
}
