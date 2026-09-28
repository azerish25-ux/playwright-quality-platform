import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export function runNode(script, args, options = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 15 * 60 * 1000,
    maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? 3,
    signal: result.signal ?? null,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

export function parseJsonOutput(result, label) {
  let value;
  try {
    value = JSON.parse(result.stdout);
  } catch {
    throw new Error(`${label} produced invalid JSON.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  if (result.status !== 0) {
    throw new Error(`${label} failed with status ${result.status}.\n${result.stderr || result.stdout}`);
  }
  return value;
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function resetDirectory(path) {
  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
}

export async function copyDirectory(source, destination) {
  await mkdir(dirname(destination), { recursive: true });
  await cp(resolve(source), resolve(destination), {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
}

export async function findFiles(root, filename) {
  const { readdir } = await import('node:fs/promises');
  const output = [];
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const full = resolve(path, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name === filename) output.push(full);
    }
  }
  await walk(root);
  return output.sort();
}
