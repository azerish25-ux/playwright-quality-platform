export type ActionEnvironment = Readonly<Record<string, string | undefined>>;

function key(name: string): string {
  // GitHub preserves hyphens in action input IDs; @actions/core only normalizes spaces.
  return `INPUT_${name.replace(/ /g, '_').toUpperCase()}`;
}

export function input(name: string, required = false, env: ActionEnvironment = process.env): string {
  const value = (env[key(name)] ?? '').trim();
  if (required && !value) throw new Error(`Required input missing: ${name}`);
  return value;
}

export function integerInput(
  name: string,
  fallback: number,
  min: number,
  max: number,
  env: ActionEnvironment = process.env,
): number {
  const raw = input(name, false, env);
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Input ${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

export function optionalIntegerInput(
  name: string,
  min: number,
  max: number,
  env: ActionEnvironment = process.env,
): number | undefined {
  const raw = input(name, false, env);
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Input ${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

export function booleanInput(name: string, fallback: boolean, env: ActionEnvironment = process.env): boolean {
  const raw = input(name, false, env).toLowerCase();
  if (!raw) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`Input ${name} must be true or false.`);
}

export function enumInput<T extends string>(
  name: string,
  values: readonly T[],
  fallback: T,
  env: ActionEnvironment = process.env,
): T {
  const raw = input(name, false, env) as T;
  if (!raw) return fallback;
  if (!values.includes(raw)) throw new Error(`Input ${name} must be one of ${values.join(', ')}.`);
  return raw;
}

export function listInput(name: string, fallback: readonly string[], env: ActionEnvironment = process.env): string[] {
  const raw = input(name, false, env);
  const values = (raw ? raw.split(',') : [...fallback]).map((value) => value.trim()).filter(Boolean);
  if (!values.length) throw new Error(`Input ${name} must contain at least one value.`);
  for (const value of values) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(value)) {
      throw new Error(`Input ${name} contains an invalid value: ${value}`);
    }
  }
  return [...new Set(values)];
}
