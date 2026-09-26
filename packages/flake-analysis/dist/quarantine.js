import { RESULT_SCHEMA_VERSION } from '@azerish25-ux/forgeqa-core';
export function validateQuarantine(records, knownTests, now = new Date(), maxDays = 14) { const tests = new Set(knownTests); const errors = []; const warnings = []; const seen = new Set(); for (const record of records) {
    if (record.schemaVersion !== RESULT_SCHEMA_VERSION)
        errors.push(`${record.testId}: unsupported schema version`);
    if (!record.owner.trim())
        errors.push(`${record.testId}: owner is required`);
    if (!record.reason.trim() || !record.issue.trim())
        errors.push(`${record.testId}: reason and issue are required`);
    if (seen.has(record.testId))
        errors.push(`${record.testId}: duplicate record`);
    seen.add(record.testId);
    if (!tests.has(record.testId))
        errors.push(`${record.testId}: unknown/orphaned test`);
    const created = Date.parse(record.createdAt), expires = Date.parse(record.expiresAt);
    if (!Number.isFinite(created) || !Number.isFinite(expires))
        errors.push(`${record.testId}: invalid dates`);
    else {
        if (expires <= created)
            errors.push(`${record.testId}: expiry must follow creation`);
        if (expires - created > maxDays * 86_400_000)
            errors.push(`${record.testId}: expiry exceeds ${maxDays} days`);
        if (expires <= now.getTime())
            errors.push(`${record.testId}: expired`);
        else if (expires - now.getTime() <= 3 * 86_400_000)
            warnings.push(`${record.testId}: expires within three days`);
    }
} return { valid: !errors.length, errors, warnings }; }
//# sourceMappingURL=quarantine.js.map