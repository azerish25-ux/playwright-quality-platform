import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';

const root = resolve(process.cwd());
const contract = JSON.parse(await readFile(resolve(root, 'tests/compatibility/fixtures/pre-release-contracts.v1.json'), 'utf8'));
const staging = await mkdtemp(join(tmpdir(), 'forgeqa-package-hardening-'));
const tarballDirectory = resolve(staging, 'tarballs');
const extractionDirectory = resolve(staging, 'extract');
const evidenceDirectory = resolve(root, 'evidence/hardening');
await Promise.all([
  mkdir(tarballDirectory, { recursive: true, mode: 0o700 }),
  mkdir(extractionDirectory, { recursive: true, mode: 0o700 }),
  mkdir(evidenceDirectory, { recursive: true, mode: 0o700 }),
]);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    env: { ...process.env, CI: '1', NO_COLOR: '1', ...options.env },
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(' ')} exited ${result.status}.`,
      result.stdout?.trim(),
      result.stderr?.trim(),
    ].filter(Boolean).join('\n'));
  }
  return result;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function within(parent, candidate) {
  const path = relative(parent, candidate);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`));
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Unsupported packaged entry type at ${path}.`);
  }
  return files;
}

function flattenedExportTargets(exportsValue) {
  if (typeof exportsValue === 'string') return [exportsValue];
  if (!exportsValue || typeof exportsValue !== 'object') return [];
  return Object.values(exportsValue).flatMap(flattenedExportTargets);
}

const packageRecords = [];
const tarballsByName = new Map();
try {
  for (const expected of contract.packages) {
    const packageDirectory = resolve(root, 'packages', expected.directory);
    const pack = run(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
      'pack',
      '--json',
      '--ignore-scripts',
      '--pack-destination',
      tarballDirectory,
      packageDirectory,
    ]);
    let metadata;
    try {
      const parsed = JSON.parse(pack.stdout);
      assert(Array.isArray(parsed) && parsed.length === 1, `${expected.name}: npm pack returned an unexpected result.`);
      metadata = parsed[0];
    } catch (error) {
      throw new Error(`${expected.name}: npm pack did not return valid JSON.\n${pack.stdout}`, { cause: error });
    }
    assert(metadata.name === expected.name, `${expected.name}: npm pack changed the package name.`);
    assert(metadata.version === contract.packageVersion, `${expected.name}: npm pack changed the package version.`);
    assert(Number.isSafeInteger(metadata.entryCount) && metadata.entryCount > 0 && metadata.entryCount <= 500, `${expected.name}: invalid tarball entry count.`);
    assert(Number.isSafeInteger(metadata.size) && metadata.size > 0 && metadata.size <= 5 * 1024 * 1024, `${expected.name}: tarball exceeds five MiB.`);

    const listed = metadata.files.map((entry) => entry.path.replaceAll('\\', '/')).sort();
    const forbidden = listed.filter((path) => /(?:^|\/)(?:src|tests?|node_modules|coverage|evidence|forgeqa-results|test-results|\.git|\.env|\.npmrc)(?:\/|$)/i.test(path));
    assert(forbidden.length === 0, `${expected.name}: forbidden package paths: ${forbidden.join(', ')}`);
    for (const required of ['package.json', 'README.md', 'LICENSE', 'dist/index.js', 'dist/index.d.ts']) {
      assert(listed.includes(required), `${expected.name}: tarball is missing ${required}.`);
    }

    const tarball = resolve(tarballDirectory, metadata.filename);
    assert(within(tarballDirectory, tarball), `${expected.name}: tarball path escaped staging.`);
    const bytes = await readFile(tarball);
    assert(typeof metadata.integrity === 'string' && /^sha512-[A-Za-z0-9+/=]+$/.test(metadata.integrity), `${expected.name}: npm integrity metadata is malformed.`);

    const extracted = resolve(extractionDirectory, expected.directory);
    await mkdir(extracted, { recursive: true, mode: 0o700 });
    run('tar', ['-xzf', tarball, '-C', extracted]);
    const packageRoot = resolve(extracted, 'package');
    assert(within(extracted, packageRoot), `${expected.name}: extracted package escaped staging.`);
    const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
    assert(manifest.name === expected.name && manifest.version === contract.packageVersion, `${expected.name}: extracted manifest mismatch.`);
    assert(manifest.main === expected.main && manifest.types === expected.types, `${expected.name}: extracted entrypoint mismatch.`);
    assert(manifest.type === 'module', `${expected.name}: package is no longer ESM-first.`);
    assert(manifest.license === 'MIT' && manifest.publishConfig?.access === 'public', `${expected.name}: release metadata mismatch.`);

    for (const group of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const [name, value] of Object.entries(manifest[group] ?? {})) {
        assert(typeof value === 'string' && !/^(?:workspace|file|link):/.test(value), `${expected.name}: ${group}.${name} contains an unresolved local protocol.`);
      }
    }
    for (const target of new Set([manifest.main, manifest.types, ...flattenedExportTargets(manifest.exports), ...Object.values(manifest.bin ?? {})])) {
      if (typeof target !== 'string') continue;
      const candidate = resolve(packageRoot, target);
      assert(within(packageRoot, candidate), `${expected.name}: export target escapes its package.`);
      await stat(candidate).catch(() => { throw new Error(`${expected.name}: packaged target ${target} is missing.`); });
    }

    const extractedFiles = await walk(packageRoot);
    for (const path of extractedFiles) {
      if (!/\.(?:js|mjs|cjs|ts|json|md)$/i.test(path)) continue;
      const text = await readFile(path, 'utf8');
      assert(!/(?:workspace|link):[^\s"']+/.test(text), `${expected.name}: unresolved workspace/link protocol in ${relative(packageRoot, path)}.`);
      assert(!/(?:from\s*|import\s*\(|require\s*\()\s*["'][^"']*(?:\/src\/|\.\.\/src)/.test(text), `${expected.name}: private source import in ${relative(packageRoot, path)}.`);
      assert(!/FORGEQA_CANARY_SECRET|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY|npm_[A-Za-z0-9]{20,}/.test(text), `${expected.name}: credential-like content in ${relative(packageRoot, path)}.`);
    }

    tarballsByName.set(expected.name, tarball);
    packageRecords.push({
      directory: expected.directory,
      name: expected.name,
      version: metadata.version,
      filename: basename(tarball),
      size: bytes.byteLength,
      sha256: sha256(bytes),
      entryCount: metadata.entryCount,
      files: listed,
    });
  }

  const dependencies = Object.fromEntries([...tarballsByName.entries()].map(([name, path]) => [name, `file:${path.replaceAll('\\', '/')}`]));
  for (const external of ['@playwright/test', '@types/node', 'playwright', 'playwright-core', 'jiti']) {
    const externalPath = resolve(root, 'node_modules', ...external.split('/'));
    await stat(externalPath);
    dependencies[external] = `file:${externalPath.replaceAll('\\', '/')}`;
  }
  const consumers = [];
  for (const manager of ['npm', 'pnpm']) {
    const consumer = resolve(staging, `consumer-${manager}`);
    await mkdir(consumer, { recursive: true, mode: 0o700 });
    await writeFile(resolve(consumer, 'package.json'), `${JSON.stringify({
      name: `forgeqa-hardening-${manager}`,
      version: '1.0.0',
      private: true,
      type: 'module',
      dependencies,
    }, null, 2)}\n`);
    await writeFile(resolve(consumer, 'index.mjs'), `${contract.packages.map((entry, index) => `import * as p${index} from '${entry.name}';`).join('\n')}\nconst modules = [${contract.packages.map((_, index) => `p${index}`).join(',')}];\nif (modules.some((value) => !value || Object.keys(value).length === 0)) throw new Error('A public package exposed no exports.');\nconsole.log(JSON.stringify(modules.map((value) => Object.keys(value).sort())));\n`);
    await writeFile(resolve(consumer, 'index.ts'), `${contract.packages.map((entry, index) => `import * as p${index} from '${entry.name}';`).join('\n')}\nexport const packageExportCounts = [${contract.packages.map((_, index) => `Object.keys(p${index}).length`).join(',')}];\n`);
    await writeFile(resolve(consumer, 'tsconfig.json'), `${JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        lib: ['ES2022', 'ESNext.Disposable'],
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        types: ['node'],
        strict: true,
        noEmit: true,
        skipLibCheck: false,
      },
      include: ['index.ts'],
    }, null, 2)}\n`);

    if (manager === 'npm') {
      run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: consumer });
    } else {
      run(process.execPath, [resolve(root, 'node_modules/pnpm/bin/pnpm.cjs'), 'install', '--ignore-scripts', '--no-frozen-lockfile'], { cwd: consumer });
    }
    const imported = run(process.execPath, ['index.mjs'], { cwd: consumer });
    run(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], { cwd: consumer });
    const cli = run(process.execPath, [resolve(consumer, 'node_modules/@azerish25-ux/forgeqa-cli/dist/cli.js'), '--help'], { cwd: consumer });
    assert(/ForgeQA|forgeqa/i.test(cli.stdout), `${manager}: packaged CLI help is unavailable.`);
    consumers.push({ manager, imports: JSON.parse(imported.stdout), cliHelp: cli.stdout.split(/\r?\n/)[0] });
  }

  const evidence = {
    schemaVersion: 1,
    kind: 'forgeqa-package-hardening',
    sourceSha: process.env.FORGEQA_SOURCE_SHA ?? null,
    generatedAt: new Date().toISOString(),
    packageCount: packageRecords.length,
    packages: packageRecords,
    consumers,
  };
  await writeFile(resolve(evidenceDirectory, 'package-audit.json'), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  console.log(`Package hardening passed for ${packageRecords.length} tarballs and ${consumers.length} clean consumers.`);
} finally {
  await rm(staging, { recursive: true, force: true });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
