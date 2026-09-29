import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ConfigurationError, recoverResources, type RecoveryAdapter, type RecoverOptions } from '@azerish25-ux/forgeqa-core';
import type { Parsed } from './runner.js';

/** Recovery options are isolated from run-selection flags and reject duplicate/value-bearing booleans. */
export function parseRecovery(argv: string[]): Parsed {
  const booleans = new Set(['apply', 'dry-run', 'json', 'help']);
  const allowed = new Set([...booleans, 'root', 'adapter-module', 'consumer', 'namespace', 'max-owners', 'timeout-ms', 'budget-ms']);
  const options = new Map<string, string | boolean>(), positionals: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    if (!token.startsWith('--')) { if (token.startsWith('-')) throw new ConfigurationError(`Unknown recovery option: ${token}`); positionals.push(token); continue; }
    const split = token.indexOf('='), name = token.slice(2, split < 0 ? undefined : split);
    if (!allowed.has(name) || options.has(name)) throw new ConfigurationError(`Unknown or duplicate recovery option: --${name}`);
    if (booleans.has(name)) { if (split >= 0) throw new ConfigurationError(`--${name} takes no value.`); options.set(name, true); continue; }
    const value = split < 0 ? argv[++index] : token.slice(split + 1);
    if (!value || value.startsWith('--')) throw new ConfigurationError(`--${name} requires a value.`);
    options.set(name, value);
  }
  return { command: ['recovery'], options, positionals };
}

/** Adapter modules are explicitly selected trusted code, never paths taken from recovery metadata. */
export async function recoveryCommand(parsed: Parsed): Promise<void> {
  const allowed = new Set(['root', 'adapter-module', 'consumer', 'namespace', 'max-owners', 'timeout-ms', 'budget-ms', 'json', 'dry-run', 'apply']);
  if (parsed.positionals.length || [...parsed.options.keys()].some(key => !allowed.has(key))) throw new ConfigurationError('Unsupported recovery argument. Use forgeqa recovery --help.');
  if (parsed.options.has('apply') && parsed.options.has('dry-run')) throw new ConfigurationError('Choose --dry-run or --apply, not both.');
  const options: RecoverOptions = { apply: parsed.options.has('apply') };
  for (const key of ['root', 'consumer', 'namespace'] as const) if (parsed.options.has(key)) options[key] = String(parsed.options.get(key));
  for (const [flag, key] of [['max-owners', 'maxOwners'], ['timeout-ms', 'timeoutMs'], ['budget-ms', 'budgetMs']] as const) {
    if (parsed.options.has(flag)) options[key] = Number(parsed.options.get(flag));
  }
  if (parsed.options.has('adapter-module')) {
    const path = resolve(String(parsed.options.get('adapter-module')));
    if (!/\.(?:mjs|js)$/.test(path)) throw new ConfigurationError('Recovery adapter module must be a trusted .mjs or .js module.');
    const loaded: unknown = (await import(pathToFileURL(path).href) as { recoveryAdapters?: unknown }).recoveryAdapters;
    if (!Array.isArray(loaded)) throw new ConfigurationError('Recovery module must export recoveryAdapters as an array.');
    options.adapters = loaded as RecoveryAdapter[];
  }
  const result = await recoverResources(options);
  process.stdout.write(parsed.options.has('json') ? `${JSON.stringify(result)}\n`
    : `${result.dryRun ? 'Recovery dry-run' : 'Recovery'}: ${result.ownersScanned} owners inspected, ${result.reclaimed} resources reclaimed. ${result.incomplete ? 'Unresolved resources require attention.' : 'No recovery integrity failures.'}\n`);
  if (result.incomplete) process.exitCode = 3;
}
