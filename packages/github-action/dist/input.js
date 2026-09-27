function key(name) {
    return `INPUT_${name.replace(/ /g, '_').replace(/-/g, '_').toUpperCase()}`;
}
export function input(name, required = false, env = process.env) {
    const value = (env[key(name)] ?? '').trim();
    if (required && !value)
        throw new Error(`Required input missing: ${name}`);
    return value;
}
export function integerInput(name, fallback, min, max, env = process.env) {
    const raw = input(name, false, env);
    const value = raw ? Number(raw) : fallback;
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new Error(`Input ${name} must be an integer from ${min} to ${max}.`);
    }
    return value;
}
export function optionalIntegerInput(name, min, max, env = process.env) {
    const raw = input(name, false, env);
    if (!raw)
        return undefined;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new Error(`Input ${name} must be an integer from ${min} to ${max}.`);
    }
    return value;
}
export function booleanInput(name, fallback, env = process.env) {
    const raw = input(name, false, env).toLowerCase();
    if (!raw)
        return fallback;
    if (raw === 'true')
        return true;
    if (raw === 'false')
        return false;
    throw new Error(`Input ${name} must be true or false.`);
}
export function enumInput(name, values, fallback, env = process.env) {
    const raw = input(name, false, env);
    if (!raw)
        return fallback;
    if (!values.includes(raw))
        throw new Error(`Input ${name} must be one of ${values.join(', ')}.`);
    return raw;
}
export function listInput(name, fallback, env = process.env) {
    const raw = input(name, false, env);
    const values = (raw ? raw.split(',') : [...fallback]).map((value) => value.trim()).filter(Boolean);
    if (!values.length)
        throw new Error(`Input ${name} must contain at least one value.`);
    for (const value of values) {
        if (!/^[A-Za-z0-9._-]{1,64}$/.test(value)) {
            throw new Error(`Input ${name} contains an invalid value: ${value}`);
        }
    }
    return [...new Set(values)];
}
//# sourceMappingURL=input.js.map