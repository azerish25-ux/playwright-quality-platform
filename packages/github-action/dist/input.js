function key(name) { return `INPUT_${name.replace(/ /g, '_').replace(/-/g, '_').toUpperCase()}`; }
export function input(name, required = false) { const value = (process.env[key(name)] ?? '').trim(); if (required && !value)
    throw new Error(`Required input missing: ${name}`); return value; }
export function integerInput(name, fallback, min, max) { const raw = input(name); const value = raw ? Number(raw) : fallback; if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`Input ${name} must be an integer from ${min} to ${max}.`); return value; }
export function enumInput(name, values, fallback) { const raw = input(name); if (!raw)
    return fallback; if (!values.includes(raw))
    throw new Error(`Input ${name} must be one of ${values.join(', ')}.`); return raw; }
//# sourceMappingURL=input.js.map