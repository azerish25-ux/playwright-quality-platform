import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, lstat, mkdir, readFile, readdir, realpath, stat, } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { booleanInput, enumInput, input, integerInput, listInput, optionalIntegerInput, } from './input.js';
class ActionFailure extends Error {
    exitCode;
    constructor(message, exitCode = 3) {
        super(message);
        this.name = 'ActionFailure';
        this.exitCode = exitCode;
    }
}
const MAX_CAPTURE_BYTES = 1_048_576;
const SECRET_ENVIRONMENT = /(?:^|_)(?:TOKEN|SECRET|PASSWORD|AUTH)(?:_|$)/i;
export function parseActionInputs(env = process.env) {
    const suite = input('suite', false, env) || 'smoke';
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(suite))
        throw new Error('Input suite contains unsupported characters.');
    const environment = input('environment', false, env) || 'local';
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(environment))
        throw new Error('Input environment contains unsupported characters.');
    const shardCount = integerInput('shard-count', 1, 1, 256, env);
    const shardIndex = optionalIntegerInput('shard-index', 1, shardCount, env);
    const mode = enumInput('mode', ['run', 'plan', 'merge'], 'run', env);
    const values = {
        mode,
        suite,
        browsers: listInput('browsers', ['chromium'], env),
        environment,
        workingDirectory: input('working-directory', false, env) || '.',
        config: input('config', false, env) || 'forgeqa.config.ts',
        playwrightConfig: input('playwright-config', false, env) || 'playwright.config.ts',
        packageManager: enumInput('package-manager', ['auto', 'npm', 'pnpm', 'none'], 'auto', env),
        installDependencies: booleanInput('install-dependencies', true, env),
        browserInstall: enumInput('browser-install', ['none', 'install', 'with-deps'], 'install', env),
        buildCommand: input('build-command', false, env),
        applicationCommand: input('application-command', false, env),
        readinessUrl: input('readiness-url', false, env),
        readinessTimeoutSeconds: integerInput('readiness-timeout-seconds', 60, 1, 900, env),
        workers: integerInput('workers', 1, 1, 128, env),
        shardCount,
        maxLocalShards: integerInput('max-local-shards', 4, 1, 16, env),
        manifest: input('manifest', false, env),
        evidenceDirectory: input('evidence-directory', false, env),
        outputDirectory: input('output-directory', false, env) || '.forgeqa/action',
        cliPath: input('cli-path', false, env),
        artifactRetentionDays: integerInput('artifact-retention-days', 7, 1, 90, env),
        reportingMode: enumInput('reporting-mode', ['summary', 'none'], 'summary', env),
        ...(shardIndex === undefined ? {} : { shardIndex }),
    };
    if (values.mode === 'plan' && values.shardIndex !== undefined) {
        throw new Error('Input shard-index is not valid in plan mode.');
    }
    if (values.mode === 'merge' && (!values.manifest || !values.evidenceDirectory)) {
        throw new Error('Merge mode requires manifest and evidence-directory inputs.');
    }
    if (values.mode === 'run' && values.shardIndex !== undefined && values.shardCount > 1 && !values.manifest) {
        throw new Error('Explicit distributed shard execution requires a manifest input produced by plan mode.');
    }
    if (values.applicationCommand && !values.readinessUrl) {
        throw new Error('application-command requires readiness-url so ForgeQA never races an unready application.');
    }
    if (values.installDependencies && values.packageManager === 'none') {
        throw new Error('package-manager none requires install-dependencies false.');
    }
    return values;
}
export function classifyOutcome(code) {
    if (code === 0)
        return 'success';
    if (code === 1)
        return 'quality-failure';
    if (code === 130)
        return 'interrupted';
    return 'infrastructure-failure';
}
function isWithin(root, candidate) {
    const path = relative(root, candidate);
    return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}
async function existingAncestor(path) {
    let current = path;
    while (!existsSync(current)) {
        const parent = dirname(current);
        if (parent === current)
            throw new ActionFailure(`No existing parent for path: ${path}`, 2);
        current = parent;
    }
    return current;
}
export async function resolveWorkingDirectory(workspace, requested) {
    const workspaceReal = await realpath(workspace);
    const candidate = resolve(workspaceReal, requested);
    const candidateReal = await realpath(candidate).catch(() => {
        throw new ActionFailure(`Working directory does not exist: ${requested}`, 2);
    });
    if (!isWithin(workspaceReal, candidateReal))
        throw new ActionFailure('working-directory escapes GITHUB_WORKSPACE.', 2);
    if (!(await stat(candidateReal)).isDirectory())
        throw new ActionFailure('working-directory is not a directory.', 2);
    return candidateReal;
}
async function ensureDirectoryWithin(root, requested) {
    const rootReal = await realpath(root);
    const candidate = resolve(rootReal, requested);
    if (!isWithin(rootReal, candidate))
        throw new ActionFailure(`Path escapes working directory: ${requested}`, 2);
    const ancestor = await realpath(await existingAncestor(candidate));
    if (!isWithin(rootReal, ancestor))
        throw new ActionFailure(`Path resolves outside working directory: ${requested}`, 2);
    await mkdir(candidate, { recursive: true, mode: 0o700 });
    const real = await realpath(candidate);
    if (!isWithin(rootReal, real))
        throw new ActionFailure(`Path resolves outside working directory: ${requested}`, 2);
    return real;
}
async function requireRegularFileWithin(root, requested, label) {
    const rootReal = await realpath(root);
    const candidate = resolve(rootReal, requested);
    const real = await realpath(candidate).catch(() => {
        throw new ActionFailure(`${label} does not exist: ${requested}`, 2);
    });
    if (!isWithin(rootReal, real))
        throw new ActionFailure(`${label} escapes the workspace.`, 2);
    const metadata = await lstat(real);
    if (!metadata.isFile() || metadata.isSymbolicLink())
        throw new ActionFailure(`${label} must be a regular file.`, 2);
    return real;
}
function childEnvironment(env, allowRegistryAuth = false) {
    const output = {};
    for (const [name, value] of Object.entries(env)) {
        if (value === undefined)
            continue;
        if (/^(?:GITHUB_TOKEN|GH_TOKEN|ACTIONS_RUNTIME_TOKEN|ACTIONS_ID_TOKEN_REQUEST_TOKEN|ACTIONS_ID_TOKEN_REQUEST_URL)$/.test(name))
            continue;
        if (!allowRegistryAuth && /^(?:NODE_AUTH_TOKEN|NPM_TOKEN)$/.test(name))
            continue;
        if (/^INPUT_(?:GITHUB_TOKEN|TOKEN)$/.test(name))
            continue;
        output[name] = value;
    }
    return output;
}
function redact(text, env) {
    let value = text;
    for (const [name, secret] of Object.entries(env)) {
        if (!secret || secret.length < 4 || !SECRET_ENVIRONMENT.test(name))
            continue;
        value = value.split(secret).join('[REDACTED]');
    }
    return value;
}
function terminateOwned(child, force = false) {
    if (!child.pid)
        return;
    if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', ...(force ? ['/F'] : [])], {
            stdio: 'ignore',
            shell: false,
        });
        killer.on('error', () => child.kill(force ? 'SIGKILL' : 'SIGTERM'));
    }
    else {
        try {
            process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
        }
        catch (error) {
            if (error.code !== 'ESRCH')
                child.kill(force ? 'SIGKILL' : 'SIGTERM');
        }
    }
}
async function runProcess(command, args, options) {
    return await new Promise((done, reject) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env,
            shell: false,
            detached: process.platform !== 'win32',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let interrupted = false;
        let forced;
        const stop = () => {
            terminateOwned(child);
            forced = setTimeout(() => terminateOwned(child, true), 5_000);
            forced.unref();
        };
        const timer = setTimeout(() => {
            timedOut = true;
            stop();
        }, options.timeoutMs);
        timer.unref();
        const interrupt = () => { interrupted = true; stop(); };
        process.once('SIGINT', interrupt);
        process.once('SIGTERM', interrupt);
        const cleanup = () => {
            clearTimeout(timer);
            if (forced)
                clearTimeout(forced);
            process.off('SIGINT', interrupt);
            process.off('SIGTERM', interrupt);
        };
        child.stdout?.on('data', (chunk) => {
            const text = chunk.toString();
            stdout = (stdout + text).slice(-MAX_CAPTURE_BYTES);
            if (options.mirror)
                process.stdout.write(text);
        });
        child.stderr?.on('data', (chunk) => {
            const text = chunk.toString();
            stderr = (stderr + text).slice(-MAX_CAPTURE_BYTES);
            if (options.mirror)
                process.stderr.write(text);
        });
        child.once('error', (error) => {
            cleanup();
            reject(error);
        });
        child.once('close', (code, signal) => {
            cleanup();
            const secrets = options.secretEnvironment ?? process.env;
            done({
                code: interrupted ? 130 : timedOut ? 3 : code ?? (signal ? 3 : 3),
                stdout: redact(stdout, secrets),
                stderr: redact(stderr, secrets),
                signal,
            });
        });
    });
}
function trustedShell(command) {
    if (process.platform === 'win32')
        return { executable: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', command] };
    return { executable: '/bin/sh', args: ['-eu', '-c', command] };
}
async function runTrustedCommand(command, cwd, env, label) {
    if (!command)
        return;
    const shell = trustedShell(command);
    const result = await runProcess(shell.executable, shell.args, {
        cwd,
        env: childEnvironment(env),
        timeoutMs: 15 * 60_000,
        mirror: true,
        secretEnvironment: env,
    });
    if (result.code !== 0)
        throw new ActionFailure(`${label} failed with exit code ${result.code}.`, 3);
}
function startApplication(command, cwd, env) {
    const shell = trustedShell(command);
    const child = spawn(shell.executable, shell.args, {
        cwd,
        env: childEnvironment(env),
        shell: false,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.on('error', (error) => process.stderr.write(`Application process error: ${redact(error.message, env)}\n`));
    child.stdout?.on('data', (chunk) => process.stdout.write(redact(chunk.toString(), env)));
    child.stderr?.on('data', (chunk) => process.stderr.write(redact(chunk.toString(), env)));
    return child;
}
async function stopApplication(child) {
    if (!child || child.exitCode !== null || child.signalCode !== null)
        return;
    terminateOwned(child);
    await new Promise((resolveStop) => {
        const timer = setTimeout(() => {
            terminateOwned(child, true);
            resolveStop();
        }, 5_000);
        timer.unref();
        child.once('close', () => {
            clearTimeout(timer);
            resolveStop();
        });
    });
}
export function validateReadinessUrl(value) {
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new ActionFailure('readiness-url must be a valid HTTP or HTTPS URL.', 2);
    }
    if (!['http:', 'https:'].includes(url.protocol))
        throw new ActionFailure('readiness-url must use HTTP or HTTPS.', 2);
    if (url.username || url.password)
        throw new ActionFailure('readiness-url must not contain credentials.', 2);
    return url;
}
async function waitForReadiness(value, seconds, child) {
    const url = validateReadinessUrl(value);
    const deadline = Date.now() + seconds * 1_000;
    let last = 'no response';
    while (Date.now() < deadline) {
        if (child && (child.exitCode !== null || child.signalCode !== null)) {
            throw new ActionFailure(`Application exited before readiness (${child.exitCode ?? child.signalCode}).`, 3);
        }
        try {
            const response = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(5_000) });
            if (response.status >= 200 && response.status < 500)
                return;
            last = `HTTP ${response.status}`;
        }
        catch (error) {
            last = error instanceof Error ? error.message : String(error);
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
    }
    throw new ActionFailure(`Application did not become ready within ${seconds}s: ${last}`, 3);
}
async function detectPackageManager(inputs, cwd) {
    if (inputs.packageManager !== 'auto')
        return inputs.packageManager;
    if (existsSync(resolve(cwd, 'pnpm-lock.yaml')))
        return 'pnpm';
    if (existsSync(resolve(cwd, 'package-lock.json')))
        return 'npm';
    if (!inputs.installDependencies)
        return 'none';
    throw new ActionFailure('No supported lockfile was found. Set package-manager explicitly or disable dependency installation.', 2);
}
async function installDependencies(inputs, cwd, env) {
    if (!inputs.installDependencies)
        return;
    const manager = await detectPackageManager(inputs, cwd);
    const invocation = manager === 'pnpm'
        ? { command: 'pnpm', args: ['install', '--frozen-lockfile', '--ignore-scripts'] }
        : { command: 'npm', args: ['ci', '--ignore-scripts'] };
    const result = await runProcess(invocation.command, invocation.args, {
        cwd,
        env: childEnvironment(env, true),
        timeoutMs: 15 * 60_000,
        mirror: true,
        secretEnvironment: env,
    });
    if (result.code !== 0)
        throw new ActionFailure(`Dependency installation failed with exit code ${result.code}.`, 3);
}
async function resolveConsumerModule(cwd, specifier) {
    const require = createRequire(resolve(cwd, 'package.json'));
    try {
        return require.resolve(specifier);
    }
    catch {
        throw new ActionFailure(`Cannot resolve ${specifier} from the consumer. Install the documented ForgeQA dependencies first.`, 2);
    }
}
async function resolveCliPath(inputs, workspace, cwd) {
    if (inputs.cliPath)
        return await requireRegularFileWithin(workspace, inputs.cliPath, 'cli-path');
    try {
        const entry = await resolveConsumerModule(cwd, '@azerish25-ux/forgeqa-cli');
        const cli = resolve(dirname(entry), 'cli.js');
        const metadata = await lstat(cli);
        if (metadata.isFile() && !metadata.isSymbolicLink())
            return cli;
    }
    catch (error) {
        if (!(error instanceof ActionFailure))
            throw error;
    }
    const development = resolve(cwd, 'packages/cli/dist/cli.js');
    if (existsSync(development) && (await lstat(development)).isFile())
        return development;
    throw new ActionFailure('ForgeQA CLI is unavailable. Install @azerish25-ux/forgeqa-cli or provide cli-path.', 2);
}
async function installBrowsers(inputs, cwd, env) {
    if (inputs.browserInstall === 'none')
        return;
    const browsers = inputs.browsers.filter((browser) => ['chromium', 'firefox', 'webkit'].includes(browser));
    if (!browsers.length)
        return;
    const cli = await resolveConsumerModule(cwd, '@playwright/test/cli');
    const args = [cli, 'install', ...(inputs.browserInstall === 'with-deps' ? ['--with-deps'] : []), ...browsers];
    const result = await runProcess(process.execPath, args, {
        cwd,
        env: childEnvironment(env),
        timeoutMs: 15 * 60_000,
        mirror: true,
        secretEnvironment: env,
    });
    if (result.code !== 0)
        throw new ActionFailure(`Playwright browser installation failed with exit code ${result.code}.`, 3);
}
function parseJsonOutput(stdout) {
    const lines = stdout.trim().split(/\r?\n/).filter(Boolean).reverse();
    for (const line of lines) {
        try {
            const value = JSON.parse(line);
            if (value && typeof value === 'object' && !Array.isArray(value))
                return value;
        }
        catch {
            // Continue to the preceding bounded line; diagnostic tools may print non-JSON notices to stdout.
        }
    }
    return undefined;
}
async function invokeCli(context, args, timeoutMs = 15 * 60_000) {
    const result = await runProcess(process.execPath, [context.cliPath, ...args], {
        cwd: context.workingDirectory,
        env: childEnvironment(context.env),
        timeoutMs,
        mirror: false,
        secretEnvironment: context.env,
    });
    const value = parseJsonOutput(result.stdout);
    if (!value && result.code <= 1) {
        throw new ActionFailure(`ForgeQA CLI returned non-JSON output. ${result.stderr || result.stdout}`.trim(), 3);
    }
    if (result.stderr)
        process.stderr.write(`${result.stderr.trim()}\n`);
    return { ...result, ...(value ? { value } : {}) };
}
function commonCliArguments(context, workers) {
    return [
        '--suite', context.inputs.suite,
        '--browsers', context.inputs.browsers.join(','),
        '--environment', context.inputs.environment,
        '--workers', String(workers),
        '--config', context.configPath,
        '--playwright-config', context.playwrightConfigPath,
        '--output', context.outputDirectory,
    ];
}
function stringField(value, key) {
    const field = value?.[key];
    return typeof field === 'string' ? field : '';
}
function numberField(value, key) {
    const field = value?.[key];
    return typeof field === 'number' && Number.isFinite(field) ? field : 0;
}
async function plan(context, workers) {
    const result = await invokeCli(context, [
        'plan', ...commonCliArguments(context, workers),
        '--shard', `1/${context.inputs.shardCount}`,
        '--json',
    ]);
    if (result.code !== 0)
        throw new ActionFailure(`ForgeQA planning failed with exit code ${result.code}.`, result.code === 1 ? 1 : 3);
    const manifestPath = stringField(result.value, 'manifestPath');
    const runId = stringField(result.value, 'runId');
    if (!manifestPath || !runId)
        throw new ActionFailure('ForgeQA plan did not return a runId and manifestPath.', 3);
    const manifest = await requireRegularFileWithin(context.workspace, manifestPath, 'Generated manifest');
    return { ...result, manifestPath: manifest, runId };
}
async function runShard(context, manifestPath, shardIndex, workers) {
    return await invokeCli(context, [
        'run', ...commonCliArguments(context, workers),
        '--shard', `${shardIndex}/${context.inputs.shardCount}`,
        '--manifest', manifestPath,
        '--json',
    ]);
}
async function boundedJson(path) {
    const bytes = await readFile(path);
    if (bytes.length > 32 * 1024 * 1024)
        throw new ActionFailure(`JSON evidence exceeds 32 MiB: ${path}`, 3);
    const value = JSON.parse(bytes.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new ActionFailure(`Invalid JSON object: ${path}`, 3);
    return value;
}
async function findFinalizedEvidence(root, expected) {
    const rootReal = await realpath(root);
    const found = [];
    let entries = 0;
    const walk = async (directory, depth) => {
        if (depth > 16)
            throw new ActionFailure('Shard evidence nesting exceeds 16 directories.', 3);
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            entries += 1;
            if (entries > 10_000)
                throw new ActionFailure('Shard evidence contains too many entries.', 3);
            const path = resolve(directory, entry.name);
            if (entry.isSymbolicLink())
                throw new ActionFailure(`Shard evidence contains a symbolic link: ${relative(rootReal, path)}`, 3);
            if (entry.isDirectory())
                await walk(path, depth + 1);
            else if (entry.isFile() && entry.name === 'attempts.ndjson.final.json')
                found.push(path);
        }
    };
    await walk(rootReal, 0);
    found.sort();
    if (found.length !== expected) {
        throw new ActionFailure(`Expected ${expected} finalized shard reports but found ${found.length}.`, 3);
    }
    const indexes = new Set();
    for (const path of found) {
        const value = await boundedJson(path);
        const index = numberField(value, 'shardIndex');
        const total = numberField(value, 'shardTotal');
        if (!Number.isInteger(index) || index < 1 || total !== expected || indexes.has(index)) {
            throw new ActionFailure('Shard evidence has missing, duplicate, or contradictory dimensions.', 3);
        }
        indexes.add(index);
    }
    return found;
}
async function mergeEvidence(context, manifestPath, reports) {
    const output = await ensureDirectoryWithin(context.outputDirectory, 'merged');
    return await invokeCli(context, [
        'report', 'merge', '--manifest', manifestPath, '--output', output, ...reports, '--json',
    ]);
}
async function pool(count, concurrency, task) {
    const values = new Array(count);
    let next = 0;
    const worker = async () => {
        while (true) {
            const index = next;
            next += 1;
            if (index >= count)
                return;
            values[index] = await task(index);
        }
    };
    await Promise.all(Array.from({ length: Math.min(count, concurrency) }, () => worker()));
    return values;
}
async function countFlakes(reportPath) {
    if (!reportPath || !existsSync(reportPath))
        return 0;
    const report = await boundedJson(reportPath);
    const attempts = Array.isArray(report.attempts) ? report.attempts : [];
    const grouped = new Map();
    for (const value of attempts) {
        if (!value || typeof value !== 'object')
            continue;
        const attempt = value;
        if (typeof attempt.executionId !== 'string' || typeof attempt.outcome !== 'string' || typeof attempt.retry !== 'number')
            continue;
        const list = grouped.get(attempt.executionId) ?? [];
        list.push({ retry: attempt.retry, outcome: attempt.outcome });
        grouped.set(attempt.executionId, list);
    }
    let flakes = 0;
    for (const values of grouped.values()) {
        values.sort((left, right) => left.retry - right.retry);
        const first = values[0];
        const last = values.at(-1);
        if (first && last && ['failed', 'timed-out'].includes(first.outcome) && last.outcome === 'passed')
            flakes += 1;
    }
    return flakes;
}
async function prepareContext(inputs, env) {
    const workspace = await realpath(env.GITHUB_WORKSPACE || process.cwd());
    const workingDirectory = await resolveWorkingDirectory(workspace, inputs.workingDirectory);
    const outputDirectory = await ensureDirectoryWithin(workingDirectory, inputs.outputDirectory);
    const configPath = inputs.mode === 'merge'
        ? resolve(workingDirectory, inputs.config)
        : await requireRegularFileWithin(workspace, resolve(workingDirectory, inputs.config), 'ForgeQA config');
    const playwrightConfigPath = inputs.mode === 'merge'
        ? resolve(workingDirectory, inputs.playwrightConfig)
        : await requireRegularFileWithin(workspace, resolve(workingDirectory, inputs.playwrightConfig), 'Playwright config');
    await installDependencies(inputs, workingDirectory, env);
    await runTrustedCommand(inputs.buildCommand, workingDirectory, env, 'build-command');
    const cliPath = await resolveCliPath(inputs, workspace, workingDirectory);
    if (inputs.mode !== 'merge')
        await installBrowsers(inputs, workingDirectory, env);
    return { inputs, env, workspace, workingDirectory, outputDirectory, cliPath, configPath, playwrightConfigPath };
}
function resultFrom(context, code, value, fields = {}) {
    const runId = fields.runId || stringField(value, 'runId');
    const evidencePath = fields.evidencePath || stringField(value, 'runDir') || context.outputDirectory;
    const reportPath = fields.reportPath !== undefined ? fields.reportPath : (evidencePath ? resolve(evidencePath, 'index.html') : '');
    const artifactName = [
        'forgeqa',
        (context.env.GITHUB_RUN_ID || 'local').replace(/[^A-Za-z0-9._-]/g, '_'),
        (context.env.GITHUB_RUN_ATTEMPT || '1').replace(/[^A-Za-z0-9._-]/g, '_'),
        fields.shardIndex ? `shard-${fields.shardIndex}-of-${context.inputs.shardCount}` : context.inputs.mode,
    ].join('-');
    const repository = context.env.GITHUB_REPOSITORY;
    const server = context.env.GITHUB_SERVER_URL || 'https://github.com';
    const runUrl = repository && context.env.GITHUB_RUN_ID ? `${server}/${repository}/actions/runs/${context.env.GITHUB_RUN_ID}` : '';
    return {
        exitCode: code,
        outcome: classifyOutcome(code),
        mode: context.inputs.mode,
        runId,
        testCount: numberField(value, 'tests'),
        attemptCount: numberField(value, 'attempts'),
        flakyCount: 0,
        shardCount: context.inputs.shardCount,
        manifestPath: fields.manifestPath || stringField(value, 'manifestPath'),
        evidencePath,
        reportPath,
        artifactName,
        runUrl,
        ...(fields.shardIndex === undefined ? {} : { shardIndex: fields.shardIndex }),
    };
}
async function executePrepared(context) {
    const inputs = context.inputs;
    let application;
    try {
        if (inputs.mode !== 'merge' && inputs.applicationCommand) {
            application = startApplication(inputs.applicationCommand, context.workingDirectory, context.env);
            await waitForReadiness(inputs.readinessUrl, inputs.readinessTimeoutSeconds, application);
        }
        else if (inputs.mode !== 'merge' && inputs.readinessUrl) {
            await waitForReadiness(inputs.readinessUrl, inputs.readinessTimeoutSeconds, undefined);
        }
        if (inputs.mode === 'plan') {
            const planned = await plan(context, inputs.workers);
            return resultFrom(context, 0, planned.value, {
                runId: planned.runId,
                manifestPath: planned.manifestPath,
                evidencePath: dirname(planned.manifestPath),
                reportPath: '',
            });
        }
        if (inputs.mode === 'merge') {
            const manifest = await requireRegularFileWithin(context.workspace, inputs.manifest, 'manifest');
            const evidence = await realpath(resolve(context.workspace, inputs.evidenceDirectory)).catch(() => {
                throw new ActionFailure(`evidence-directory does not exist: ${inputs.evidenceDirectory}`, 2);
            });
            if (!isWithin(context.workspace, evidence))
                throw new ActionFailure('evidence-directory escapes the workspace.', 2);
            const reports = await findFinalizedEvidence(evidence, inputs.shardCount);
            const merged = await mergeEvidence(context, manifest, reports);
            const mergedRoot = resolve(context.outputDirectory, 'merged');
            const result = resultFrom(context, merged.code, merged.value, {
                manifestPath: manifest,
                evidencePath: mergedRoot,
                reportPath: resolve(mergedRoot, 'index.html'),
            });
            result.flakyCount = await countFlakes(resolve(mergedRoot, 'report.json'));
            return result;
        }
        if (inputs.shardIndex !== undefined) {
            const manifest = inputs.manifest
                ? await requireRegularFileWithin(context.workspace, inputs.manifest, 'manifest')
                : (await plan(context, inputs.workers)).manifestPath;
            const shard = await runShard(context, manifest, inputs.shardIndex, inputs.workers);
            return resultFrom(context, shard.code, shard.value, {
                manifestPath: manifest,
                evidencePath: stringField(shard.value, 'runDir') || context.outputDirectory,
                reportPath: inputs.shardCount === 1 ? resolve(stringField(shard.value, 'runDir'), 'index.html') : '',
                shardIndex: inputs.shardIndex,
            });
        }
        const concurrency = Math.min(inputs.shardCount, inputs.maxLocalShards, inputs.workers);
        const workers = Math.max(1, Math.floor(inputs.workers / Math.max(1, concurrency)));
        const planned = await plan(context, workers);
        const shards = await pool(inputs.shardCount, Math.max(1, concurrency), async (index) => {
            return await runShard(context, planned.manifestPath, index + 1, workers);
        });
        if (inputs.shardCount === 1) {
            const shard = shards[0];
            const result = resultFrom(context, shard.code, shard.value, {
                runId: planned.runId,
                manifestPath: planned.manifestPath,
                evidencePath: stringField(shard.value, 'runDir') || context.outputDirectory,
            });
            result.flakyCount = await countFlakes(resolve(result.evidencePath, 'report.json'));
            return result;
        }
        const reports = shards.map((shard) => stringField(shard.value, 'shardReport')).filter(Boolean);
        if (reports.length !== inputs.shardCount) {
            return resultFrom(context, shards.some((shard) => shard.code === 130) ? 130 : 3, undefined, {
                runId: planned.runId,
                manifestPath: planned.manifestPath,
                evidencePath: context.outputDirectory,
                reportPath: '',
            });
        }
        const merged = await mergeEvidence(context, planned.manifestPath, reports);
        const infrastructure = shards.find((shard) => shard.code !== 0 && shard.code !== 1);
        const interrupted = shards.find((shard) => shard.code === 130);
        const code = interrupted ? 130 : infrastructure ? 3 : merged.code;
        const mergedRoot = resolve(context.outputDirectory, 'merged');
        const result = resultFrom(context, code, merged.value, {
            runId: planned.runId,
            manifestPath: planned.manifestPath,
            evidencePath: mergedRoot,
            reportPath: resolve(mergedRoot, 'index.html'),
        });
        result.flakyCount = await countFlakes(resolve(mergedRoot, 'report.json'));
        return result;
    }
    finally {
        await stopApplication(application);
    }
}
async function append(path, value) {
    if (path)
        await appendFile(path, value);
    else
        process.stdout.write(value);
}
async function writeOutput(path, name, value) {
    if (!path) {
        process.stdout.write(`${name}=${value}\n`);
        return;
    }
    const delimiter = `FORGEQA_${randomUUID().replace(/-/g, '')}`;
    await appendFile(path, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}
function inline(value) {
    return value.replace(/[\r\n`|]/g, ' ').slice(0, 500);
}
async function publishResult(result, inputs, env) {
    const outputs = {
        outcome: result.outcome,
        'run-id': result.runId,
        'test-count': String(result.testCount),
        'attempt-count': String(result.attemptCount),
        'flaky-count': String(result.flakyCount),
        'shard-count': String(result.shardCount),
        'shard-index': result.shardIndex === undefined ? '' : String(result.shardIndex),
        'manifest-path': result.manifestPath,
        'evidence-path': result.evidencePath,
        'report-path': result.reportPath,
        'artifact-name': result.artifactName,
        'artifact-retention-days': String(inputs.artifactRetentionDays),
        'run-url': result.runUrl,
    };
    for (const [name, value] of Object.entries(outputs))
        await writeOutput(env.GITHUB_OUTPUT, name, value);
    if (inputs.reportingMode === 'none')
        return;
    const summary = [
        '# ForgeQA',
        '',
        `- Outcome: **${inline(result.outcome)}**`,
        `- Mode: \`${inline(result.mode)}\``,
        `- Run: \`${inline(result.runId || 'unavailable')}\``,
        `- Tests / attempts / flaky: **${result.testCount} / ${result.attemptCount} / ${result.flakyCount}**`,
        `- Shards: **${result.shardIndex ?? 'local or merged'}/${result.shardCount}**`,
        `- Evidence: \`${inline(result.evidencePath || 'unavailable')}\``,
        `- Report: \`${inline(result.reportPath || 'not produced for an individual distributed shard')}\``,
        ...(result.runUrl ? [`- Workflow: ${inline(result.runUrl)}`] : []),
        ...(result.error ? ['', `> ${inline(result.error)}`] : []),
        '',
    ].join('\n');
    await append(env.GITHUB_STEP_SUMMARY, summary);
}
function fallbackInputs() {
    return {
        mode: 'run', suite: 'smoke', browsers: ['chromium'], environment: 'local', workingDirectory: '.',
        config: 'forgeqa.config.ts', playwrightConfig: 'playwright.config.ts', packageManager: 'auto',
        installDependencies: false, browserInstall: 'none', buildCommand: '', applicationCommand: '', readinessUrl: '',
        readinessTimeoutSeconds: 60, workers: 1, shardCount: 1, maxLocalShards: 1, manifest: '',
        evidenceDirectory: '', outputDirectory: '.forgeqa/action', cliPath: '', artifactRetentionDays: 7,
        reportingMode: 'summary',
    };
}
export async function executeAction(env = process.env) {
    let inputs;
    try {
        inputs = parseActionInputs(env);
        const context = await prepareContext(inputs, env);
        const result = await executePrepared(context);
        await publishResult(result, inputs, env);
        return result;
    }
    catch (error) {
        const safeInputs = inputs ?? fallbackInputs();
        const code = error instanceof ActionFailure ? error.exitCode : error instanceof Error && /^Input |^Required input/.test(error.message) ? 2 : 3;
        const message = redact(error instanceof Error ? error.message : String(error), env);
        const workspace = env.GITHUB_WORKSPACE || process.cwd();
        const result = {
            exitCode: code,
            outcome: classifyOutcome(code),
            mode: safeInputs.mode,
            runId: '',
            testCount: 0,
            attemptCount: 0,
            flakyCount: 0,
            shardCount: safeInputs.shardCount,
            manifestPath: '',
            evidencePath: resolve(workspace, safeInputs.workingDirectory, safeInputs.outputDirectory),
            reportPath: '',
            artifactName: `forgeqa-${(env.GITHUB_RUN_ID || 'local').replace(/[^A-Za-z0-9._-]/g, '_')}-${safeInputs.mode}`,
            runUrl: '',
            error: message,
            ...(safeInputs.shardIndex === undefined ? {} : { shardIndex: safeInputs.shardIndex }),
        };
        await publishResult(result, safeInputs, env).catch(() => undefined);
        return result;
    }
}
export async function main() {
    const result = await executeAction(process.env);
    if (result.error)
        process.stderr.write(`ForgeQA action: ${result.error}\n`);
    if (result.exitCode !== 0)
        process.exitCode = result.exitCode;
}
const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
    main().catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
        process.exitCode = 3;
    });
}
//# sourceMappingURL=main.js.map