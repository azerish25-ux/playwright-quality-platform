import { resolve, relative, isAbsolute } from 'node:path';
import { ConfigurationError } from './errors.js';
import { redactValue } from './redaction.js';
import { stableHash } from './stable.js';
const allowed = new Set(['project', 'consumer', 'environment', 'environments', 'suites', 'browsers', 'workers', 'shards', 'retries', 'timeout', 'outputDir', 'historyDir', 'quarantineFile', 'qualityGates', 'selectionMap', 'artifactPolicy', 'github']);
const browsers = new Set(['chromium', 'firefox', 'webkit']);
export function defineForgeConfig(input) { validateInput(input); return Object.freeze({ ...input }); }
export function parseDuration(value) {
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || value <= 0)
            throw new ConfigurationError(`Invalid duration: ${value}`);
        return Math.round(value);
    }
    const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value.trim());
    if (!match)
        throw new ConfigurationError(`Invalid duration: ${value}. Use ms, s, m, or h.`);
    const amount = Number(match[1]);
    const unit = match[2];
    const multiplier = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[unit];
    const result = Math.round(amount * multiplier);
    if (result <= 0 || result > 86_400_000)
        throw new ConfigurationError(`Duration out of range: ${value}`);
    return result;
}
function integer(name, value, min, max) {
    if (!Number.isInteger(value) || value < min || value > max)
        throw new ConfigurationError(`${name} must be an integer between ${min} and ${max}.`);
    return value;
}
function safePath(root, value, label) {
    const candidate = resolve(root, value);
    const rel = relative(root, candidate);
    if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel))
        throw new ConfigurationError(`${label} escapes the project root.`);
    return candidate;
}
function validateInput(input) {
    for (const key of Object.keys(input))
        if (!allowed.has(key))
            throw new ConfigurationError(`Unknown configuration option: ${key}`);
    if (!input.project?.trim())
        throw new ConfigurationError('project is required.');
    if (!input.environments || !Object.keys(input.environments).length)
        throw new ConfigurationError('At least one environment is required.');
    for (const [name, profile] of Object.entries(input.environments)) {
        if (!name.trim() || !profile.baseUrl)
            throw new ConfigurationError(`Environment ${name || '<empty>'} requires baseUrl.`);
        let url;
        try {
            url = new URL(profile.baseUrl);
        }
        catch {
            throw new ConfigurationError(`Environment ${name} has an invalid baseUrl.`);
        }
        if (!['http:', 'https:'].includes(url.protocol))
            throw new ConfigurationError(`Environment ${name} must use HTTP or HTTPS.`);
    }
    if (input.browsers)
        for (const browser of input.browsers)
            if (!browsers.has(browser))
                throw new ConfigurationError(`Unsupported browser: ${browser}`);
    if (input.workers !== undefined)
        integer('workers', input.workers, 1, 128);
    if (input.shards !== undefined)
        integer('shards', input.shards, 1, 256);
    if (input.retries !== undefined)
        integer('retries', input.retries, 0, 3);
    if (input.timeout !== undefined)
        parseDuration(input.timeout);
}
export function resolveForgeConfig(input, options = {}) {
    validateInput(input);
    const env = options.env ?? process.env;
    const root = resolve(options.cwd ?? process.cwd());
    const environment = options.environment ?? env.FORGEQA_ENVIRONMENT ?? input.environment ?? Object.keys(input.environments)[0];
    if (!environment || !(environment in input.environments))
        throw new ConfigurationError(`Unknown environment: ${environment ?? '<unset>'}`);
    const selected = input.environments[environment];
    const fromEnvironment = {};
    if (env.FORGEQA_WORKERS)
        fromEnvironment.workers = integer('FORGEQA_WORKERS', Number(env.FORGEQA_WORKERS), 1, 128);
    if (env.FORGEQA_RETRIES)
        fromEnvironment.retries = integer('FORGEQA_RETRIES', Number(env.FORGEQA_RETRIES), 0, 3);
    if (env.FORGEQA_SHARDS)
        fromEnvironment.shards = integer('FORGEQA_SHARDS', Number(env.FORGEQA_SHARDS), 1, 256);
    if (env.FORGEQA_BASE_URL)
        selected.baseUrl = env.FORGEQA_BASE_URL;
    const merged = { ...input, ...fromEnvironment, ...options.cli };
    validateInput(merged);
    const materialized = {
        ...merged,
        consumer: merged.consumer ?? merged.project,
        environment,
        baseUrl: selected.baseUrl,
        browsers: merged.browsers ?? ['chromium'],
        workers: merged.workers ?? 1,
        shards: merged.shards ?? 1,
        retries: merged.retries ?? 0,
        timeoutMs: parseDuration(merged.timeout ?? '30s'),
        outputDir: safePath(root, merged.outputDir ?? 'forgeqa-results', 'outputDir'),
        historyDir: safePath(root, merged.historyDir ?? '.forgeqa/history', 'historyDir'),
        quarantineFile: safePath(root, merged.quarantineFile ?? '.forgeqa/quarantine.json', 'quarantineFile'),
        qualityGates: {
            failOnRetryRecovered: true,
            unexpectedSkipBudget: 0,
            maxQuarantineEntries: 20,
            requireCompleteShards: true,
            minimumHistorySamples: 20,
            ...merged.qualityGates
        },
        artifactPolicy: { trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'retain-on-failure', retentionDays: 7, ...merged.artifactPolicy },
        github: { summary: true, prComment: false, ...merged.github }
    };
    const hashInput = { ...materialized, environments: Object.fromEntries(Object.entries(materialized.environments).map(([name, profile]) => [name, { ...profile, variables: undefined }])) };
    const redacted = redactValue(hashInput);
    return Object.freeze({ ...materialized, redacted, configHash: stableHash(redacted) });
}
//# sourceMappingURL=config.js.map