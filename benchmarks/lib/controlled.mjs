import { summarizeControlled as summarizeBase } from './controlled-base.mjs';
import { checkedProfile, summarizeProfiles } from './profiling.mjs';
export { LOCAL_CONDITIONS, controlledSchedule, distribution, validateCleanInventory } from './controlled-base.mjs';

export function summarizeControlled(records, repetitions, options = {}) {
  const summary = summarizeBase(records, repetitions);
  const present = records.some(record => record.lifecycle !== undefined);
  if (!present && !options.requireTiming) return summary; // Read historical coarse records honestly.
  const profiles = records.map(record => checkedProfile(record.lifecycle, {
    sourceSha: record.sourceSha, runId: record.runId, shardIndex: 1, shardTotal: 1
  }, record.runMs));
  if (profiles.some((profile, index) => profile.attempts !== records[index].identities.length)) throw new Error('Timing attempt inventory does not match executed tests.');
  summary.lifecycle = summarizeProfiles(profiles);
  for (const condition of summary.conditions) condition.lifecycle = summarizeProfiles(profiles.filter((_, index) => records[index].condition === condition.id));
  summary.limitations = summary.limitations.filter(value => !value.startsWith('Readiness, in-process'));
  summary.limitations.push('Lifecycle spans overlap; unattributed CLI time includes discovery, worker setup/teardown, instrumentation and runtime gaps. Attempt work is summed separately.');
  // Completing local timing never grants distributed performance comparability.
  return summary;
}
