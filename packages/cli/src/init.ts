import { lstat, mkdir, readFile, writeFile, link, unlink, realpath } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute, parse as parsePath, join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ConfigurationError } from '@azerish25-ux/forgeqa-core';
import { templateFiles } from './templates.js';
import type { Parsed } from './runner.js';

async function noSymlinks(path: string): Promise<void> {
  const root = parsePath(path).root;
  let current = root;
  for (const part of relative(root, path).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new ConfigurationError(`Refusing symlink path: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }
}

// Resolve parent aliases (including macOS /var -> /private/var) before
// establishing the destination boundary. Dry runs must not create directories.
async function canonicalDestination(requested: string): Promise<string> {
  let parent = dirname(requested);
  const suffix = [basename(requested)];
  for (;;) {
    try { return resolve(await realpath(parent), ...suffix); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      try {
        if ((await lstat(parent)).isSymbolicLink()) throw new ConfigurationError(`Refusing dangling parent symlink: ${parent}`);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
      }
      const next = dirname(parent);
      if (next === parent) throw new ConfigurationError('Cannot resolve the destination parent.');
      suffix.unshift(basename(parent));
      parent = next;
    }
  }
}

export async function initCommand(parsed: Parsed): Promise<void> {
  const destination = await canonicalDestination(resolve(String(parsed.options.get('destination') ?? '.')));
  const manager = String(parsed.options.get('package-manager') ?? 'npm');
  const template = String(parsed.options.get('template') ?? 'demo');
  if (!['npm', 'pnpm'].includes(manager) || !['demo', 'existing'].includes(template)) {
    throw new ConfigurationError('Use --package-manager npm|pnpm and --template demo|existing.');
  }
  await noSymlinks(destination);
  const files = templateFiles(manager as 'npm' | 'pnpm', template as 'demo' | 'existing');
  const plan: Array<{ path: string; action: 'create' | 'unchanged' | 'conflict' }> = [];
  for (const [name, content] of Object.entries(files)) {
    const path = resolve(destination, name);
    const rel = relative(destination, path);
    if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) {
      throw new ConfigurationError('Template path escapes destination.');
    }
    await noSymlinks(path);
    let action: 'create' | 'unchanged' | 'conflict' = 'create';
    try { action = await readFile(path, 'utf8') === content ? 'unchanged' : 'conflict'; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    plan.push({ path: name, action });
  }
  const conflicts = plan.filter(entry => entry.action === 'conflict');
  const createdPaths: string[] = [];
  if (!conflicts.length && !parsed.options.get('dry-run')) {
    for (const entry of plan.filter(item => item.action === 'create')) {
      const path = resolve(destination, entry.path);
      const content = files[entry.path]!;
      await noSymlinks(path);
      await mkdir(dirname(path), { recursive: true });
      await noSymlinks(path);
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
      try {
        try {
          // Hard-link creation is exclusive: another initializer cannot be overwritten.
          await link(temporary, path);
          createdPaths.push(entry.path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          await noSymlinks(path);
          if (!(await lstat(path)).isFile() || await readFile(path, 'utf8') !== content) {
            throw new ConfigurationError('Initialization encountered a concurrent conflicting file. Existing and already-created files were preserved.', {
              path: entry.path, createdPaths, recoverable: true
            });
          }
          // Identical concurrent work is idempotent, not a failed initialization.
          entry.action = 'unchanged';
        }
      } finally {
        await unlink(temporary);
      }
    }
  }
  const result = { destination, template, files: plan, conflicts, installation: { performed: false, command: `${manager} install` } };
  process.stdout.write((parsed.options.get('json') ? JSON.stringify(result) : conflicts.length
    ? `Initialization has ${conflicts.length} conflicts. No files were changed.\n${conflicts.map(entry => entry.path).join('\n')}`
    : `${parsed.options.get('dry-run') ? 'Planned' : 'Initialized'} ${template} consumer at ${destination}. Installation was not performed.`) + '\n');
  if (conflicts.length) process.exitCode = 2;
}
