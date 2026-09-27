import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

export function parseForgeQaSummary(stdout) {
  const value = stdout.trim();
  if (!value) throw new Error('ForgeQA consumer produced no JSON summary on stdout.');

  let summary;
  try {
    summary = JSON.parse(value);
  } catch (failure) {
    const detail = failure instanceof Error ? failure.message : String(failure);
    throw new Error(`ForgeQA consumer summary was not valid JSON: ${detail}`);
  }

  if (summary === null || typeof summary !== 'object' || Array.isArray(summary)) {
    throw new Error('ForgeQA consumer summary must be a JSON object.');
  }
  if (typeof summary.runDir !== 'string' || summary.runDir.length === 0) {
    throw new Error('ForgeQA consumer summary did not include a run directory.');
  }
  if (!Number.isInteger(summary.exitCode)) {
    throw new Error('ForgeQA consumer summary did not include an integer exit code.');
  }
  return summary;
}

export async function retainConsumerRun({
  manager,
  consumer,
  evidenceDirectory,
  result,
  sanitize = value => value
}) {
  if (!/^[a-z0-9-]+$/.test(manager)) throw new Error(`Invalid consumer manager ${JSON.stringify(manager)}.`);
  if (!result || typeof result.stdout !== 'string' || typeof result.stderr !== 'string') {
    throw new Error('Consumer command result must include stdout and stderr strings.');
  }

  const destination = resolve(evidenceDirectory, manager);
  const summary = (() => {
    try {
      return parseForgeQaSummary(result.stdout);
    } catch (failure) {
      return { parseFailure: failure };
    }
  })();

  if ('parseFailure' in summary) {
    await rm(destination, { recursive: true, force: true });
    await mkdir(destination, { recursive: true });
    await writeCommandEvidence(destination, result, sanitize);
    throw summary.parseFailure;
  }

  const resultsRoot = resolve(consumer, 'forgeqa-results');
  const runDirectory = resolve(summary.runDir);
  const containment = relative(resultsRoot, runDirectory);
  if (containment === '' || (!containment.startsWith('..') && !isAbsolute(containment))) {
    await rm(destination, { recursive: true, force: true });
    await cp(runDirectory, destination, { recursive: true });
    await writeCommandEvidence(destination, result, sanitize);
    await writeFile(
      join(destination, 'command-summary.json'),
      sanitize(`${JSON.stringify(summary, null, 2)}\n`),
      'utf8'
    );
    return { summary, destination };
  }

  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await writeCommandEvidence(destination, result, sanitize);
  throw new Error(`ForgeQA consumer run directory escaped its owned results root: ${summary.runDir}`);
}

async function writeCommandEvidence(destination, result, sanitize) {
  const metadata = {
    exitCode: result.code ?? null,
    signal: result.signal ?? null,
    timedOut: result.timedOut === true
  };
  await writeFile(join(destination, 'command.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  await writeFile(join(destination, 'command.stdout.txt'), sanitize(result.stdout), 'utf8');
  await writeFile(join(destination, 'command.stderr.txt'), sanitize(result.stderr), 'utf8');
}
