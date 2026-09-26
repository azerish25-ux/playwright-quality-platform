const SECRET_KEY = /(?:authorization|cookie|set-cookie|password|passwd|secret|token|api[-_]?key|session|storage[-_]?state)/i;
const BEARER = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const ASSIGNMENT = /\b(password|passwd|secret|token|api[_-]?key|session)\s*[:=]\s*([^\s,;]+)/gi;
export function redactText(input, replacement = '[REDACTED]') {
    return input.replace(BEARER, replacement).replace(JWT, replacement).replace(ASSIGNMENT, (_m, key) => `${key}=${replacement}`);
}
export function redactUrl(input, replacement = '[REDACTED]') {
    try {
        const url = new URL(input);
        for (const key of [...url.searchParams.keys()])
            if (SECRET_KEY.test(key))
                url.searchParams.set(key, replacement);
        url.username = url.username ? replacement : '';
        url.password = url.password ? replacement : '';
        return url.toString();
    }
    catch {
        return redactText(input, replacement);
    }
}
export function redactValue(value, options = {}, path = []) {
    const replacement = options.replacement ?? '[REDACTED]';
    const allowed = new Set(options.allowedKeys ?? []);
    if (typeof value === 'string')
        return value.includes('://') ? redactUrl(value, replacement) : redactText(value, replacement);
    if (Array.isArray(value))
        return value.map((entry, index) => redactValue(entry, options, [...path, String(index)]));
    if (value && typeof value === 'object') {
        const output = {};
        for (const [key, entry] of Object.entries(value)) {
            const sensitive = !allowed.has(key) && (SECRET_KEY.test(key) || options.extraKeys?.some((rule) => rule.test(key)));
            output[key] = sensitive ? replacement : redactValue(entry, options, [...path, key]);
        }
        return output;
    }
    return value;
}
//# sourceMappingURL=redaction.js.map