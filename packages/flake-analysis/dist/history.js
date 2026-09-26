import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { IntegrityError, sha256, stableStringify } from '@azerish25-ux/forgeqa-core';
function safe(root, file) { const full = resolve(root, file); const rel = relative(resolve(root), full); if (rel.startsWith('..') || isAbsolute(rel))
    throw new IntegrityError('History path escapes storage root.'); return full; }
export async function writeHistory(root, result, provenance) { const payload = stableStringify(result); const record = { schemaVersion: 1, provenance, importedAt: new Date().toISOString(), result, checksum: sha256(payload) }; const file = safe(root, `${result.runId.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`); await mkdir(dirname(file), { recursive: true }); const temp = `${file}.${process.pid}.tmp`; await writeFile(temp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 }); await rename(temp, file); return file; }
export async function readHistory(file) { const record = JSON.parse(await readFile(file, 'utf8')); if (record.schemaVersion !== 1)
    throw new IntegrityError('Unsupported history schema.'); if (sha256(stableStringify(record.result)) !== record.checksum)
    throw new IntegrityError('History checksum mismatch.'); return record; }
//# sourceMappingURL=history.js.map