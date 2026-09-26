#!/usr/bin/env node
import { access, lstat, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import { ConfigurationError, evaluateGates, toForgeError } from '@azerish25-ux/forgeqa-core';
import { mergeShardResults, toHtmlReport, toJsonReport, toJUnit, toMarkdownSummary } from '@azerish25-ux/forgeqa-reporter';
import { calculateReliability, validateQuarantine } from '@azerish25-ux/forgeqa-flake-analysis';
import { templateFiles } from './templates.js';
const VERSION = '0.1.0';
function parse(argv) { const command = []; const options = new Map(); const positionals = []; let i = 0; while (i < argv.length && !argv[i].startsWith('-') && command.length < 2) {
    command.push(argv[i]);
    i += 1;
} for (; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
        const [name, inline] = token.slice(2).split('=', 2);
        if (inline !== undefined)
            options.set(name, inline);
        else if (argv[i + 1] && !argv[i + 1].startsWith('-')) {
            options.set(name, argv[++i]);
        }
        else
            options.set(name, true);
    }
    else
        positionals.push(token);
} return { command, options, positionals }; }
function jsonMode(parsed) { return parsed.options.get('json') === true; }
function emit(parsed, value, human) { process.stdout.write(jsonMode(parsed) ? `${JSON.stringify(value)}\n` : `${human}\n`); }
function rootSafe(root, path) { const full = resolve(root, path); const rel = relative(root, full); if (rel.startsWith('..') || isAbsolute(rel))
    throw new ConfigurationError(`Path escapes destination: ${path}`); return full; }
async function atomicWrite(path, content) { await mkdir(dirname(path), { recursive: true }); const temp = `${path}.${process.pid}.tmp`; await writeFile(temp, content, { flag: 'wx' }); await rename(temp, path); }
async function init(parsed) {
    const destination = resolve(String(parsed.options.get('destination') || '.'));
    const packageManager = String(parsed.options.get('package-manager') || 'npm');
    if (!['npm', 'pnpm'].includes(packageManager))
        throw new ConfigurationError('package-manager must be npm or pnpm.');
    await mkdir(destination, { recursive: true });
    const real = await realpath(destination);
    const plan = [];
    for (const [name, content] of Object.entries(templateFiles(packageManager))) {
        const path = rootSafe(real, name);
        let action = 'create';
        try {
            const stat = await lstat(path);
            if (stat.isSymbolicLink())
                throw new ConfigurationError(`Refusing symlink target: ${name}`);
            const existing = await readFile(path, 'utf8');
            action = existing === content ? 'unchanged' : 'conflict';
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
        plan.push({ path: name, action });
        if (action === 'create' && parsed.options.get('dry-run') !== true)
            await atomicWrite(path, content);
    }
    const conflicts = plan.filter((entry) => entry.action === 'conflict');
    emit(parsed, { destination: real, files: plan, conflicts }, conflicts.length ? `Initialization proposed ${plan.length} files with ${conflicts.length} conflicts; no existing content was overwritten.` : `Initialized ForgeQA in ${real}.`);
    if (conflicts.length)
        process.exitCode = 2;
}
async function loadJson(path) { return JSON.parse(await readFile(resolve(path), 'utf8')); }
async function doctor(parsed) { const checks = []; const nodeVersion = process.versions.node ?? '0.0.0'; checks.push({ name: 'node', status: Number(nodeVersion.split('.')[0]) >= 22 ? 'pass' : 'fail', detail: nodeVersion }); for (const file of ['package.json', 'forgeqa.config.ts']) {
    try {
        await access(file);
        checks.push({ name: file, status: 'pass', detail: 'present' });
    }
    catch {
        checks.push({ name: file, status: 'fail', detail: 'missing' });
    }
} try {
    await access('.forgeqa/quarantine.json');
    const records = await loadJson('.forgeqa/quarantine.json');
    const validation = validateQuarantine(records, records.map((r) => r.testId));
    checks.push({ name: 'quarantine', status: validation.valid ? 'pass' : 'fail', detail: validation.errors.join('; ') || 'valid' });
}
catch {
    checks.push({ name: 'quarantine', status: 'warn', detail: 'not configured' });
} const failed = checks.some((check) => check.status === 'fail'); emit(parsed, { checks, ok: !failed }, checks.map((c) => `${c.status.toUpperCase()} ${c.name}: ${c.detail}`).join('\n')); if (failed)
    process.exitCode = 2; }
async function plan(parsed) { const suites = String(parsed.options.get('suite') || 'smoke').split(','); const browsers = String(parsed.options.get('browsers') || 'chromium').split(','); const workers = Number(parsed.options.get('workers') || 1); const shard = String(parsed.options.get('shard') || '1/1'); const value = { suites, browsers, workers, shard, reason: 'explicit CLI selection', estimatedConcurrency: workers * browsers.length }; emit(parsed, value, `Suites: ${suites.join(', ')}\nBrowsers: ${browsers.join(', ')}\nWorkers: ${workers}\nShard: ${shard}`); }
async function child(command, args, cwd) { return await new Promise((resolve, reject) => { const childProcess = spawn(command, args, { cwd, stdio: 'inherit', shell: false, env: { ...process.env } }); childProcess.once('error', reject); childProcess.once('exit', (code, signal) => resolve(signal ? 3 : code ?? 3)); }); }
async function run(parsed) { await plan(parsed); const native = parsed.options.get('native-command'); if (native) {
    const code = await child(String(native), [], process.cwd());
    process.exitCode = code;
    return;
} emit(parsed, { outcome: 'not-run', exitCode: 3, message: 'No --native-command supplied. ForgeQA refuses to claim execution without a configured runner.' }, 'No native runner command was supplied; execution was not performed.'); process.exitCode = 3; }
async function reportMerge(parsed) { const manifestPath = String(parsed.options.get('manifest') || ''); if (!manifestPath || !parsed.positionals.length)
    throw new ConfigurationError('report merge requires --manifest and shard report paths.'); const manifest = await loadJson(manifestPath); const shards = await Promise.all(parsed.positionals.map(loadJson)); const merged = mergeShardResults(shards, manifest); const output = String(parsed.options.get('output') || 'forgeqa-results'); await mkdir(output, { recursive: true }); await Promise.all([atomicWrite(resolve(output, 'report.json'), toJsonReport(merged)), atomicWrite(resolve(output, 'junit.xml'), toJUnit(merged)), atomicWrite(resolve(output, 'summary.md'), toMarkdownSummary(merged)), atomicWrite(resolve(output, 'index.html'), toHtmlReport(merged))]); emit(parsed, { output, completion: merged.completion }, `Merged ${shards.length} shards into ${output}.`); if (merged.completion !== 'complete')
    process.exitCode = 3; }
async function gate(parsed) { const run = await loadJson(String(parsed.options.get('report') || parsed.positionals[0] || '')); let quarantines = []; try {
    quarantines = await loadJson(String(parsed.options.get('quarantine') || '.forgeqa/quarantine.json'));
}
catch { } const decision = evaluateGates(run, quarantines, { failOnRetryRecovered: true, unexpectedSkipBudget: 0, requireCompleteShards: true, maxQuarantineEntries: 20 }); emit(parsed, decision, decision.violations.length ? decision.violations.map((v) => `${v.severity.toUpperCase()} ${v.id}: ${v.message}`).join('\n') : 'All quality gates passed.'); if (decision.outcome === 'fail')
    process.exitCode = 1; }
async function flakes(parsed) { const run = await loadJson(String(parsed.options.get('report') || parsed.positionals[0] || '')); const metrics = calculateReliability(run.attempts, Number(parsed.options.get('minimum-samples') || 20)); emit(parsed, metrics, JSON.stringify(metrics, null, 2)); }
async function quarantineValidate(parsed) { const records = await loadJson(String(parsed.options.get('file') || '.forgeqa/quarantine.json')); const tests = String(parsed.options.get('known-tests') || records.map((r) => r.testId).join(',')).split(',').filter(Boolean); const result = validateQuarantine(records, tests); emit(parsed, result, result.errors.concat(result.warnings).join('\n') || 'Quarantine policy is valid.'); if (!result.valid)
    process.exitCode = 1; }
function help() { return `ForgeQA ${VERSION}\n\nCommands:\n  forgeqa init [--destination DIR] [--package-manager npm|pnpm] [--dry-run] [--json]\n  forgeqa doctor [--json]\n  forgeqa plan [--suite NAME] [--browsers LIST] [--workers N] [--shard I/N] [--json]\n  forgeqa run [selection options] [--native-command COMMAND]\n  forgeqa repeat\n  forgeqa report merge --manifest FILE --output DIR SHARD...\n  forgeqa report serve\n  forgeqa history import\n  forgeqa flakes --report FILE\n  forgeqa quarantine validate [--file FILE]\n  forgeqa quarantine add|remove\n  forgeqa gate --report FILE\n  forgeqa migrate\n\nExit codes: 0 compliant success, 1 quality failure, 2 usage/configuration, 3 infrastructure/report integrity, 130 interruption.\n`; }
export async function main(argv = process.argv.slice(2)) { const parsed = parse(argv); const key = parsed.command.join(' '); if (!key || parsed.options.has('help') || key === 'help') {
    process.stdout.write(help());
    return;
} if (parsed.options.has('version') || key === 'version') {
    process.stdout.write(`${VERSION}\n`);
    return;
} switch (key) {
    case 'init':
        await init(parsed);
        break;
    case 'doctor':
        await doctor(parsed);
        break;
    case 'plan':
        await plan(parsed);
        break;
    case 'run':
        await run(parsed);
        break;
    case 'report merge':
        await reportMerge(parsed);
        break;
    case 'gate':
        await gate(parsed);
        break;
    case 'flakes':
        await flakes(parsed);
        break;
    case 'quarantine validate':
        await quarantineValidate(parsed);
        break;
    case 'repeat':
    case 'report serve':
    case 'history import':
    case 'quarantine add':
    case 'quarantine remove':
    case 'migrate': throw new ConfigurationError(`${key} requires project-specific inputs and is intentionally fail-closed in this source release.`);
    default: throw new ConfigurationError(`Unknown command: ${key}`);
} }
main().catch((error) => { const forge = toForgeError(error); process.stderr.write(`${forge.code}: ${forge.message}\n`); if (Object.keys(forge.details).length)
    process.stderr.write(`${JSON.stringify(forge.details)}\n`); process.exitCode = forge.exitCode; });
//# sourceMappingURL=cli.js.map