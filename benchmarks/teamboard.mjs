#!/usr/bin/env node
import { conditionById } from './lib/contract.mjs';
import { parseArguments, writeFailureRecord } from './teamboard/common.mjs';
import { distributedMerge, distributedShard } from './teamboard/distributed.mjs';
import { distributedPlan, localBenchmark } from './teamboard/local.mjs';

function usage() {
  return `ForgeQA TeamBoard benchmark harness\n\nCommands:\n  local --condition serial-1x1|local-1x2|local-1x4 --repetition N [--output DIR]\n  plan --condition distributed-2x1|distributed-4x1 --repetition N [--output DIR]\n  shard --condition ID --repetition N --shard-index N --manifest FILE [--output DIR]\n  merge --condition ID --repetition N --manifest FILE --plan-record FILE --input DIR [--output DIR]\n`;
}

const parsed = parseArguments(process.argv.slice(2));
try {
  if (!parsed.command || ['help', '--help'].includes(parsed.command)) {
    process.stdout.write(usage());
  } else if (parsed.command === 'local') {
    await localBenchmark(parsed.options);
  } else if (parsed.command === 'plan') {
    await distributedPlan(parsed.options);
  } else if (parsed.command === 'shard') {
    await distributedShard(parsed.options);
  } else if (parsed.command === 'merge') {
    await distributedMerge(parsed.options);
  } else {
    throw new Error(`Unknown benchmark command: ${parsed.command}\n${usage()}`);
  }
} catch (error) {
  try {
    await writeFailureRecord(parsed, error, conditionById);
  } catch (recordError) {
    process.stderr.write(`Unable to write benchmark failure record: ${recordError instanceof Error ? recordError.message : String(recordError)}\n`);
  }
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
}
