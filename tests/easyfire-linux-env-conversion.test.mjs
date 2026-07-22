import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const helperPath = path.join(
  root,
  'scripts/production/linux-convert-production-env.mjs',
);

const validSecret = Buffer.alloc(64, 0xa5).toString('base64');
const releaseCommit = 'a'.repeat(40);
const materializationOptions = Object.freeze({
  releaseCommit,
  mysqlVolume: 'easyfire_bookkeeping_vm_20260721_abcdef12_mysql',
  redisVolume: 'easyfire_bookkeeping_vm_20260721_abcdef12_redis',
  baseUrl: 'https://easyfire-bookkeeping-newsec.taild63e9b.ts.net',
});

const loadHelper = async () => import(pathToFileURL(helperPath).href);

test('maps the legacy JWT key without changing one byte of its value', async () => {
  const { convertEnvironmentBytes } = await loadHelper();
  const input = Buffer.from(
    [
      '# preserved comment',
      'DB_PASSWORD=value=with=equals',
      `JWT_SECRET=${validSecret}`,
      'MAIL_FROM_NAME=EasyFire Bookkeeping',
      '',
    ].join('\r\n'),
    'utf8',
  );

  const output = convertEnvironmentBytes(input);
  const expected = Buffer.from(
    [
      '# preserved comment',
      'DB_PASSWORD=value=with=equals',
      `APP_JWT_SECRET=${validSecret}`,
      'MAIL_FROM_NAME=EasyFire Bookkeeping',
      '',
    ].join('\r\n'),
    'utf8',
  );

  assert.deepEqual(output, expected);
  assert.equal(output.includes(Buffer.from(`APP_JWT_SECRET=${validSecret}`)), true);
  assert.equal(output.includes(Buffer.from('\nJWT_SECRET=')), false);
});

test('accepts a matching modern key but removes the legacy key', async () => {
  const { convertEnvironmentBytes } = await loadHelper();
  const input = Buffer.from(
    `APP_JWT_SECRET=${validSecret}\nJWT_SECRET=${validSecret}\n`,
    'utf8',
  );

  assert.equal(
    convertEnvironmentBytes(input).toString('utf8'),
    `APP_JWT_SECRET=${validSecret}\n`,
  );
});

test('materializes the exact Linux deployment values while preserving every unrelated byte', async () => {
  const { materializeEnvironmentBytes } = await loadHelper();
  const input = Buffer.from(
    [
      '# do not normalize this comment',
      'IMAGE_TAG=old-tag',
      'MARIADB_VOLUME_NAME=old_mysql',
      `JWT_SECRET=${validSecret}`,
      'MAIL_PASSWORD=value=with=equals',
      'SIGNUP_ALLOWED_DOMAINS=example.com',
      'PUBLIC_PROXY_PORT=25185',
      '',
    ].join('\r\n'),
    'utf8',
  );

  const output = materializeEnvironmentBytes(input, materializationOptions);
  const expected = Buffer.from(
    [
      '# do not normalize this comment',
      `IMAGE_TAG=git-${releaseCommit}`,
      `MARIADB_VOLUME_NAME=${materializationOptions.mysqlVolume}`,
      `APP_JWT_SECRET=${validSecret}`,
      'MAIL_PASSWORD=value=with=equals',
      'SIGNUP_ALLOWED_DOMAINS=',
      'PUBLIC_PROXY_PORT=8080',
      `MARIADB_IMAGE_TAG=git-${releaseCommit}`,
      `REDIS_VOLUME_NAME=${materializationOptions.redisVolume}`,
      `BASE_URL=${materializationOptions.baseUrl}`,
      'SIGNUP_DISABLED=true',
      'SIGNUP_ALLOWED_EMAILS=',
      '',
    ].join('\r\n'),
    'utf8',
  );

  assert.deepEqual(output, expected);
  assert.equal(output.includes(Buffer.from(`APP_JWT_SECRET=${validSecret}`)), true);
  assert.equal(output.includes(Buffer.from('\r\nJWT_SECRET=')), false);
});

test('appends missing Linux keys deterministically without adding a newline to an existing value', async () => {
  const { materializeEnvironmentBytes } = await loadHelper();
  const input = Buffer.from(`JWT_SECRET=${validSecret}`, 'utf8');

  assert.equal(
    materializeEnvironmentBytes(input, materializationOptions).toString('utf8'),
    [
      `APP_JWT_SECRET=${validSecret}`,
      `IMAGE_TAG=git-${releaseCommit}`,
      `MARIADB_IMAGE_TAG=git-${releaseCommit}`,
      `MARIADB_VOLUME_NAME=${materializationOptions.mysqlVolume}`,
      `REDIS_VOLUME_NAME=${materializationOptions.redisVolume}`,
      'PUBLIC_PROXY_PORT=8080',
      `BASE_URL=${materializationOptions.baseUrl}`,
      'SIGNUP_DISABLED=true',
      'SIGNUP_ALLOWED_DOMAINS=',
      'SIGNUP_ALLOWED_EMAILS=',
      '',
    ].join('\n'),
  );
});

test('preserves CRLF endings when all Linux keys must be appended', async () => {
  const { materializeEnvironmentBytes } = await loadHelper();
  const input = Buffer.from(
    `# windows checkpoint\r\nJWT_SECRET=${validSecret}\r\nUNCHANGED=two words\r\n`,
    'utf8',
  );

  const output = materializeEnvironmentBytes(input, materializationOptions);
  assert.equal(output.includes(Buffer.from('\r\nIMAGE_TAG=')), true);
  assert.equal(output.includes(Buffer.from('\nIMAGE_TAG=')), true);
  assert.equal(output.toString('utf8').replaceAll('\r\n', '').includes('\n'), false);
  assert.equal(
    output.includes(Buffer.from('UNCHANGED=two words\r\nIMAGE_TAG=')),
    true,
  );
});

test('rejects unsafe Linux materialization options without echoing their values', async () => {
  const { EXIT, materializeEnvironmentBytes } = await loadHelper();
  const source = Buffer.from(`JWT_SECRET=${validSecret}\n`, 'utf8');
  const fixtures = [
    {
      property: 'releaseCommit',
      value: 'A'.repeat(40),
      message: 'E_ENV_RELEASE_COMMIT',
    },
    {
      property: 'mysqlVolume',
      value: 'easyfire_bookkeeping_vm_safe_mysql\nINJECTED=true',
      message: 'E_ENV_MYSQL_VOLUME',
    },
    {
      property: 'redisVolume',
      value: 'easyfire_prod_redis',
      message: 'E_ENV_REDIS_VOLUME',
    },
    {
      property: 'baseUrl',
      value: 'https://bookkeeping.example.com',
      message: 'E_ENV_BASE_URL',
    },
  ];

  for (const fixture of fixtures) {
    assert.throws(
      () =>
        materializeEnvironmentBytes(source, {
          ...materializationOptions,
          [fixture.property]: fixture.value,
        }),
      (error) => {
        assert.equal(error.exitCode, EXIT.DATA);
        assert.match(error.message, new RegExp(`^${fixture.message}:`));
        assert.equal(error.message.includes(fixture.value), false);
        assert.equal(error.message.includes(validSecret), false);
        return true;
      },
    );
  }
});

test('rejects duplicates, mismatches, malformed lines, and quoted or multiline ambiguity', async () => {
  const { EnvConversionError, EXIT, convertEnvironmentBytes } =
    await loadHelper();

  const cases = [
    {
      name: 'duplicate key',
      source: `DB_HOST=mysql\nDB_HOST=other\nJWT_SECRET=${validSecret}\n`,
      message: 'E_ENV_DUPLICATE_KEY: duplicate environment key at line 2.',
    },
    {
      name: 'modern-key mismatch',
      source: `APP_JWT_SECRET=${Buffer.alloc(64, 0xb6).toString('base64')}\nJWT_SECRET=${validSecret}\n`,
      message:
        'E_ENV_JWT_MISMATCH: APP_JWT_SECRET does not match JWT_SECRET.',
    },
    {
      name: 'export syntax',
      source: `export JWT_SECRET=${validSecret}\n`,
      message: 'E_ENV_MALFORMED: malformed environment entry at line 1.',
    },
    {
      name: 'quoted value',
      source: `JWT_SECRET="${validSecret}"\n`,
      message: 'E_ENV_AMBIGUOUS_VALUE: quoted value is unsupported at line 1.',
    },
    {
      name: 'continuation',
      source: `JWT_SECRET=${validSecret}\\\ncontinued\n`,
      message:
        'E_ENV_AMBIGUOUS_VALUE: multiline continuation is unsupported at line 1.',
    },
  ];

  for (const fixture of cases) {
    assert.throws(
      () => convertEnvironmentBytes(Buffer.from(fixture.source, 'utf8')),
      (error) => {
        assert.equal(error instanceof EnvConversionError, true, fixture.name);
        assert.equal(error.exitCode, EXIT.DATA, fixture.name);
        assert.equal(error.message, fixture.message, fixture.name);
        assert.equal(error.message.includes(validSecret), false, fixture.name);
        return true;
      },
    );
  }
});

test('rejects every unquoted Docker Compose env-file byte transformation', async () => {
  const { EnvConversionError, EXIT, convertEnvironmentBytes } =
    await loadHelper();
  const cases = [
    ['dollar substitution', 'MAIL_PASSWORD=$TOKEN'],
    ['braced substitution', 'MAIL_PASSWORD=${TOKEN}'],
    ['leading whitespace trimming', 'MAIL_PASSWORD= secret'],
    ['trailing whitespace trimming', 'MAIL_PASSWORD=secret '],
    ['inline comment stripping', 'MAIL_PASSWORD=secret # comment'],
  ];

  for (const [name, unsafe] of cases) {
    assert.throws(
      () =>
        convertEnvironmentBytes(
          Buffer.from(`${unsafe}\nJWT_SECRET=${validSecret}\n`, 'utf8'),
        ),
      (error) => {
        assert.equal(error instanceof EnvConversionError, true, name);
        assert.equal(error.exitCode, EXIT.DATA, name);
        assert.equal(
          error.message,
          'E_ENV_COMPOSE_SYNTAX: unquoted value would be transformed by Docker Compose at line 1.',
          name,
        );
        assert.equal(error.message.includes('secret'), false, name);
        assert.equal(error.message.includes('$TOKEN'), false, name);
        return true;
      },
    );
  }
});

test('validates the existing production JWT policy without generating or rotating a secret', async () => {
  const { EXIT, convertEnvironmentBytes } = await loadHelper();

  assert.throws(
    () =>
      convertEnvironmentBytes(
        Buffer.from(`JWT_SECRET=${Buffer.alloc(63).toString('base64')}\n`),
      ),
    (error) => {
      assert.equal(error.exitCode, EXIT.DATA);
      assert.equal(
        error.message,
        'E_ENV_JWT_POLICY: JWT secret must be canonical base64 decoding to at least 64 bytes.',
      );
      return true;
    },
  );

  assert.throws(
    () =>
      convertEnvironmentBytes(
        Buffer.from(`JWT_SECRET=${validSecret.slice(0, -1)}\n`),
      ),
    /E_ENV_JWT_POLICY/,
  );
});

test('the Linux publisher is root-only, no-follow, mode 0600, atomic, and never invokes a shell', async () => {
  const source = await readFile(helperPath, 'utf8');

  assert.match(source, /^#!\/usr\/local\/bin\/node/);
  assert.match(source, /process\.platform !== 'linux'/);
  assert.match(source, /process\.getuid\(\) !== 0/);
  assert.match(source, /O_NOFOLLOW/);
  assert.match(source, /0o600/);
  assert.match(source, /timingSafeEqual/);
  assert.match(source, /await link\(temporaryPath, targetPath\)/);
  assert.match(source, /await directoryHandle\.sync\(\)/);
  assert.match(source, /targetStat\.isSymbolicLink\(\)/);
  assert.match(source, /E_TARGET_MISMATCH/);
  assert.match(source, /stat\.nlink !== 1/);
  assert.doesNotMatch(source, /node:child_process|\bexecSync\b|\bspawnSync\b/);
  assert.doesNotMatch(source, /JWT secret value|console\.(?:log|error)\([^\n]*secret/i);
});

test('CLI usage errors have a stable code/message and do not inspect secret input', () => {
  const result = spawnSync(process.execPath, [helperPath], {
    encoding: 'utf8',
    windowsHide: true,
  });

  assert.equal(result.status, 64);
  assert.equal(
    result.stderr.trim(),
    'E_USAGE: required --source, --target, --release-commit, --mysql-volume, --redis-volume, and --base-url arguments are missing.',
  );
  assert.equal(result.stdout, '');
});

test('CLI accepts only the complete nonsecret Linux materialization contract', () => {
  const result = spawnSync(
    process.execPath,
    [
      helperPath,
      '--source',
      '/root/source.env',
      '--target',
      '/etc/easyfire-bookkeeping/production.env',
      '--release-commit',
      releaseCommit,
      '--mysql-volume',
      materializationOptions.mysqlVolume,
      '--redis-volume',
      materializationOptions.redisVolume,
      '--base-url',
      materializationOptions.baseUrl,
    ],
    { encoding: 'utf8', windowsHide: true },
  );

  // Argument validation completes before the deliberate Linux/root boundary.
  assert.equal(result.status, 69);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.trim(), 'E_PLATFORM: this helper runs only on Linux.');
  assert.equal(result.stderr.includes(validSecret), false);
});
