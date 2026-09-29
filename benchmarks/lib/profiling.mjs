import { validateExecutionTiming } from '../../packages/core/dist/timing.js';
import { distribution } from './controlled-base.mjs';

export const TIMING_STAGES = Object.freeze(['applicationReadiness', 'testWindow', 'forgeqaFinalization', 'allReportersFinalization', 'applicationShutdown']);
export function checkedProfile(profile, identity, cliRunMs) {
  if (profile?.schemaVersion !== 1 || profile.kind !== 'forgeqa-execution-timing') throw new Error('Missing or unsupported lifecycle profile.');
  for (const key of ['sourceSha', 'runId', 'shardIndex', 'shardTotal']) if (profile.identity?.[key] !== identity[key]) throw new Error('Profile identity disagrees with its expected owner.');
  const checked = validateExecutionTiming(profile.records, identity, cliRunMs);
  for (const key of ['clockId', 'cliRunMs', 'observedLifecycleMs', 'observedPhaseUnionMs', 'unattributedCliMs', 'attemptWorkMs', 'attempts']) {
    if (profile[key] !== checked[key]) throw new Error(`Derived timing field ${key} disagrees with the raw observations.`);
  }
  for (const key of TIMING_STAGES) if (profile.stages?.[key] !== checked.stages[key]) throw new Error(`Derived timing stage ${key} disagrees with its raw span.`);
  return checked;
}
export function summarizeProfiles(profiles) {
  if (!profiles.length) throw new Error('No validated lifecycle profiles.');
  return {
    schemaVersion: 1,
    status: 'PASS',
    semantics: 'Per-host observed spans; stages overlap. Attempt work is not wall time. Cross-host clocks are never subtracted.',
    stages: Object.fromEntries(TIMING_STAGES.map(name => [name, distribution(profiles.map(profile => profile.stages[name]))])),
    observedPhaseUnionMs: distribution(profiles.map(profile => profile.observedPhaseUnionMs)),
    unattributedCliMs: distribution(profiles.map(profile => profile.unattributedCliMs)),
    attemptWorkMs: distribution(profiles.map(profile => profile.attemptWorkMs))
  };
}

export function profilesForRecord(record) {
  if (record?.timingVersion !== 1 || !Array.isArray(record.lifecycle?.profiles) || record.lifecycle.profiles.length !== record.shards) throw new Error('Missing distributed lifecycle records.');
  const shards = new Set();
  let attempts = 0;
  const profiles = record.lifecycle.profiles.map(profile => {
    const index = profile?.identity?.shardIndex;
    if (!Number.isSafeInteger(index) || index < 1 || index > record.shards || shards.has(index)) throw new Error('Missing, duplicated or incompatible profile shard.');
    shards.add(index);
    const checked = checkedProfile(profile, { sourceSha: record.sourceSha, runId: record.runId, shardIndex: index, shardTotal: record.shards }, profile.cliRunMs);
    attempts += checked.attempts;
    return checked;
  });
  if (Math.abs(profiles.reduce((sum, profile) => sum + profile.cliRunMs, 0) - record.durations?.testAggregateMs) > 0.001 || Math.abs(Math.max(...profiles.map(profile => profile.cliRunMs)) - record.durations?.testWallMs) > 0.001 || !Number.isFinite(record.durations?.testAggregateMs) || !Number.isFinite(record.durations?.testWallMs)) throw new Error('Profile elapsed times disagree with the recorded shard durations.');
  if (attempts !== record.attempts) throw new Error('Profile inventory differs from actual benchmark attempts.');
  return profiles;
}
