import { readFile, mkdir, mkdtemp, cp, rm, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { calculateRelease, validatePlan } from './release-version.mjs';
import { preparePackages } from './release-prepare.mjs';
import { RELEASE_PACKAGES, saveManifestAtomically, reconcileCandidate } from './release-state.mjs';
import { verifyCandidateDirectory, waitForSourceAcceptance, createGitHubReader, REPOSITORY } from './release-evidence.mjs';
import { createRegistryTransport } from './release-registry.mjs';
import { runNpm, atomicJson } from './release-process.mjs';
import { startRegistry } from '../tests/fixtures/release-registry-server.mjs';

export function validateConsumerReceipt(receipt, manifest, manager, distribution) {
  const checksums = Object.fromEntries(manifest.entries.map(entry => [entry.filename, entry.sha256]));
  if (receipt?.schemaVersion !== 1 || receipt.status !== 'PASS' || receipt.sourceSha !== manifest.sourceSha || receipt.version !== manifest.version ||
    receipt.manager !== manager || receipt.distribution !== distribution || receipt.initializer !== 'installed-cli' || receipt.tests !== 2 || receipt.attempts !== 2 ||
    Object.keys(receipt.versions ?? {}).length !== 8 || !RELEASE_PACKAGES.every(name => receipt.versions[name] === manifest.version) ||
    JSON.stringify(Object.entries(receipt.packageChecksums ?? {}).sort()) !== JSON.stringify(Object.entries(checksums).sort())) throw new Error('Prepared/registry consumer receipt is missing, stale, incomplete or incompatible.');
  return receipt;
}

export async function verifyPrepared(directory, sourceSha) {
  const candidate = await verifyCandidateDirectory(directory, sourceSha);
  const manifest = JSON.parse(await readFile(join(directory, 'release-manifest.json')));
  const plan = validatePlan(JSON.parse(await readFile(join(directory, 'semantic-plan.json'))));
  if (plan.sourceSha !== sourceSha || manifest.version !== plan.version || manifest.preparation?.planSha256 !== plan.planSha256 || manifest.preparation.sourceTree !== plan.sourceTree ||
    !['semanticVersion', 'packages', 'npmConsumer', 'pnpmConsumer'].every(gate => manifest.acceptance?.[gate] === 'PASS')) throw new Error('Prepared release has not passed the required version/artifact/consumer gates.');
  for (const manager of ['npm', 'pnpm']) validateConsumerReceipt(JSON.parse(await readFile(join(directory, 'prepared-consumers', `${manager}-release.json`))), manifest, manager, 'prepared-tarballs');
  return { candidate, manifest, plan };
}

export async function prepareRelease(root, directory, expectedSha) {
  const plan = await calculateRelease(root, { expectedSha });
  if (plan.status === 'NO_RELEASE') {
    await mkdir(directory, { mode: 0o700 });
    await atomicJson(join(directory, 'semantic-plan.json'), plan);
    return plan;
  }
  const manifest = await preparePackages(root, directory, plan);
  await runNpm(['run', 'test:consumers', '--', 'template'], { cwd: root,
    env: { ...process.env, FORGEQA_SOURCE_SHA: plan.sourceSha, FORGEQA_PREPARED_DIRECTORY: directory, FORGEQA_CONSUMER_REGISTRY: '' }, timeoutMs: 600000 });
  for (const manager of ['npm', 'pnpm']) {
    validateConsumerReceipt(JSON.parse(await readFile(join(directory, 'prepared-consumers', `${manager}-release.json`))), manifest, manager, 'prepared-tarballs');
    manifest.acceptance[`${manager}Consumer`] = 'PASS';
  }
  await saveManifestAtomically(join(directory, 'release-manifest.json'), manifest);
  const accepted = await verifyPrepared(directory, plan.sourceSha);
  await atomicJson(join(directory, 'prepared-acceptance.json'), { schemaVersion: 1, kind: 'forgeqa-prepared-acceptance', status: 'PASS', ...accepted.candidate,
    semanticPlanSha256: plan.planSha256, publicationAuthorized: false });
  return accepted.candidate;
}

export async function withPublicationLock(directory, operation) {
  const lock = join(directory, '.publication.lock');
  let handle;
  try { handle = await open(lock, 'wx', 0o600); }
  catch { throw new Error('Another publication owns this release directory; no concurrent write is permitted.'); }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid })); return await operation(); }
  finally { await handle.close(); await rm(lock, { force: true }); }
}

/** All eight *prepared product tarballs* go through real npm CLI publication,
 * interruption, downloaded-byte reconciliation and registry-installed consumers.
 */
export async function testPreparedRegistry(root, directory, expectedSha) {
  const { manifest } = await verifyPrepared(directory, expectedSha);
  const temporary = await mkdtemp(join(tmpdir(), 'forgeqa-registry-acceptance-'));
  let registry, receipt;
  try {
    registry = await startRegistry();
    await cp(join(directory, 'tarballs'), join(temporary, 'tarballs'), { recursive: true });
    const transport = createRegistryTransport({ directory: temporary, registry: registry.url, allowLoopback: true, timeoutMs: 10000 });
    registry.faults.beforeUpload = count => count === 3;
    let interrupted = false;
    try { await reconcileCandidate(manifest, transport, { allowPublish: true }); }
    catch { interrupted = true; }
    const partial = JSON.parse(await readFile(join(temporary, 'release-manifest.json')));
    if (!interrupted || registry.publications.length !== 3 || partial.status !== 'partial') throw new Error('Real prepared-package interruption was not demonstrated.');
    registry.faults.beforeUpload = null;
    const complete = await reconcileCandidate(partial, transport, { allowPublish: true });
    await reconcileCandidate(complete, transport, { allowPublish: true });
    if (complete.status !== 'candidate-verified' || registry.publications.length !== 8 || new Set(registry.publications).size !== 8) throw new Error('Prepared registry recovery republished or omitted packages.');
    await runNpm(['run', 'test:consumers', '--', 'template'], { cwd: root,
      env: { ...process.env, FORGEQA_SOURCE_SHA: expectedSha, FORGEQA_PREPARED_DIRECTORY: directory, FORGEQA_CONSUMER_REGISTRY: registry.url, FORGEQA_TEST_REGISTRY: 'true' }, timeoutMs: 600000 });
    for (const manager of ['npm', 'pnpm']) validateConsumerReceipt(JSON.parse(await readFile(join(directory, 'registry-consumers', `${manager}-release.json`))), manifest, manager, 'loopback-registry');
    receipt = { schemaVersion: 1, kind: 'forgeqa-registry-acceptance', status: 'PASS', sourceSha: expectedSha, version: manifest.version,
      scope: 'isolated-loopback-registry', interruptedAfter: 3, uniquePublications: 8, npmConsumer: 'PASS', pnpmConsumer: 'PASS', publicNpmPublication: 'NOT_ATTEMPTED' };
  } finally { try { await registry?.close(); } finally { await rm(temporary, { recursive: true, force: true }); } }
  receipt.cleanup = 'PASS';
  await atomicJson(join(directory, 'registry-acceptance.json'), receipt);
  return receipt;
}

export function validateRegistryReceipt(receipt, manifest) {
  if (receipt?.schemaVersion !== 1 || receipt.kind !== 'forgeqa-registry-acceptance' || receipt.status !== 'PASS' || receipt.sourceSha !== manifest.sourceSha ||
    receipt.version !== manifest.version || receipt.scope !== 'isolated-loopback-registry' || receipt.interruptedAfter !== 3 || receipt.uniquePublications !== 8 ||
    receipt.npmConsumer !== 'PASS' || receipt.pnpmConsumer !== 'PASS' || receipt.cleanup !== 'PASS' || receipt.publicNpmPublication !== 'NOT_ATTEMPTED') throw new Error('Isolated registry recovery/consumer acceptance is missing or incompatible.');
  return receipt;
}

export function assertPublicContext(env, sourceSha) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_REF !== 'refs/heads/main' || env.GITHUB_SHA !== sourceSha ||
    env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_WORKFLOW_REF !== `${REPOSITORY}/.github/workflows/release.yml@refs/heads/main` ||
    env.FORGEQA_CONFIRM_SOURCE !== sourceSha || env.FORGEQA_CONFIRM_NPM_SCOPE !== 'true' || !env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) throw new Error('Public publishing requires explicit exact-source/scope confirmation in the trusted OIDC release workflow.');
}

export async function publishCandidate(root, directory, expectedSha) {
  assertPublicContext(process.env, expectedSha);
  const npmVersion = (await runNpm(['--version'])).trim().split('.').map(Number);
  if (npmVersion[0] < 11 || (npmVersion[0] === 11 && (npmVersion[1] < 5 || (npmVersion[1] === 5 && npmVersion[2] < 1)))) throw new Error('npm 11.5.1 or newer is required for trusted publishing.');
  const { candidate, manifest } = await verifyPrepared(directory, expectedSha);
  validateRegistryReceipt(JSON.parse(await readFile(join(directory, 'registry-acceptance.json'))), manifest);
  for (const manager of ['npm', 'pnpm']) validateConsumerReceipt(JSON.parse(await readFile(join(directory, 'registry-consumers', `${manager}-release.json`))), manifest, manager, 'loopback-registry');
  if (process.env.FORGEQA_PREPARED_DIGEST !== candidate.manifestSha256) throw new Error('Downloaded prepared manifest does not match the accepted job output.');
  const workflows = await waitForSourceAcceptance(expectedSha, createGitHubReader(process.env.GITHUB_TOKEN));
  const rechecked = await verifyPrepared(directory, expectedSha);
  if (rechecked.candidate.manifestSha256 !== candidate.manifestSha256) throw new Error('Prepared release changed during source verification.');
  const checkpoint = resolve(root, 'evidence/release-publication');
  await mkdir(checkpoint, { recursive: true, mode: 0o700 });
  return withPublicationLock(checkpoint, async () => {
    await cp(join(directory, 'tarballs'), join(checkpoint, 'tarballs'), { recursive: true });
    const transport = createRegistryTransport({ directory: checkpoint, authorizePublicPublish: true, npmUserConfig: process.env.NPM_CONFIG_USERCONFIG, timeoutMs: 30000 });
    // Registry reconciliation is authoritative even when a previous runner lost its checkpoint.
    const complete = await reconcileCandidate(manifest, transport, { allowPublish: true });
    await runNpm(['run', 'test:consumers', '--', 'template'], { cwd: root,
      env: { ...process.env, FORGEQA_PREPARED_DIRECTORY: directory, FORGEQA_CONSUMER_REGISTRY: 'https://registry.npmjs.org/', FORGEQA_TEST_REGISTRY: 'false' }, timeoutMs: 600000 });
    for (const manager of ['npm', 'pnpm']) validateConsumerReceipt(JSON.parse(await readFile(join(directory, 'registry-consumers', `${manager}-release.json`))), manifest, manager, 'public-npm');
    const receipt = { schemaVersion: 1, kind: 'forgeqa-public-candidate-acceptance', status: 'PASS', ...candidate, workflows,
      publication: complete.status, channel: 'forgeqa-candidate', stablePromotion: 'NOT_ATTEMPTED', registryConsumers: ['npm', 'pnpm'] };
    await atomicJson(join(checkpoint, 'publication-acceptance.json'), receipt);
    return receipt;
  });
}

export async function main() {
  const command = process.argv[2], root = resolve('.'), directory = resolve('evidence/release-prepared'), sourceSha = process.env.FORGEQA_SOURCE_SHA;
  if (process.argv.length !== 3 || !['plan', 'prepare', 'registry-test', 'publish-candidate'].includes(command) || !/^[a-f0-9]{40}$/.test(sourceSha ?? '')) throw new Error('Usage: FORGEQA_SOURCE_SHA=<checkout SHA> node scripts/release-engine.mjs plan|prepare|registry-test|publish-candidate');
  let result;
  if (command === 'plan') result = await calculateRelease(root, { expectedSha: sourceSha });
  else if (command === 'prepare') result = await prepareRelease(root, directory, sourceSha);
  else if (command === 'registry-test') {
    const plan = JSON.parse(await readFile(join(directory, 'semantic-plan.json')));
    result = plan.status === 'NO_RELEASE' ? { status: 'NO_RELEASE', sourceSha } : await testPreparedRegistry(root, directory, sourceSha);
  } else result = await publishCandidate(root, directory, sourceSha);
  console.log(JSON.stringify(result, null, 2));
  if (process.env.GITHUB_OUTPUT && command === 'prepare') {
    const output = result.status === 'NO_RELEASE' ? 'release_planned=false\n' : `release_planned=true\nmanifest_sha256=${result.manifestSha256}\nversion=${result.version}\n`;
    await import('node:fs/promises').then(fs => fs.appendFile(process.env.GITHUB_OUTPUT, output));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); }
  catch (error) {
    console.error(error.message);
    if (process.argv[2] !== 'publish-candidate') {
      if (error.stdout) console.error(error.stdout.slice(-12000));
      if (error.stderr) console.error(error.stderr.slice(-12000));
    }
    process.exitCode = 1;
  }
}
