const mode = process.argv[2] ?? 'help';
if (mode === 'synthetic-factory') {
  process.argv.splice(2, 1);
  await import('./synthetic/factory-throughput.mjs');
} else if (mode === 'synthetic-reporter') {
  process.argv.splice(2, 1);
  await import('./synthetic/reporter-scaling.mjs');
} else {
  await import('./teamboard.mjs');
}
