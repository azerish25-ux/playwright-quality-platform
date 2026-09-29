import { readFileSync } from 'node:fs';

// Resolve beside dist/ (or src/ while developing), never from the consumer's cwd.
// Release preparation changes package.json after compilation; runtime/template
// versions must therefore read installed metadata rather than a compiled literal.
const metadata: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
if (!metadata || typeof metadata !== 'object' || !('name' in metadata) || metadata.name !== '@azerish25-ux/forgeqa-cli' ||
    !('version' in metadata) || typeof metadata.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(metadata.version)) {
  throw new Error('Installed Deadpan CLI package metadata is invalid.');
}
export const VERSION: string = metadata.version;
