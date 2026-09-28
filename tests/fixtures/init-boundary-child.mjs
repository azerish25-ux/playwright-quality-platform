// Test-only process barrier around a real filesystem operation. No production
// environment flag, sleep or test hook is added to the CLI.
import filesystem from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';

const [destination, phase] = process.argv.slice(2);
if (!process.send || !['before-link', 'after-link'].includes(phase)) throw new Error('The initialization boundary fixture requires IPC and a valid phase.');
const original = filesystem.link;
let first = true;
async function barrier(path, temporary) {
  const resume = new Promise(resolve => process.once('message', resolve));
  process.send({ phase, path, temporary });
  await resume;
}
filesystem.link = async (temporary, path) => {
  const selected = first;
  first = false;
  if (selected && phase === 'before-link') await barrier(path, temporary);
  const result = await original(temporary, path);
  if (selected && phase === 'after-link') await barrier(path, temporary);
  return result;
};
syncBuiltinESMExports();
try {
  const { main } = await import('../../packages/cli/dist/cli.js');
  await main(['init', '--destination', destination, '--json']);
} catch (error) {
  const { toForgeError } = await import('@azerish25-ux/forgeqa-core');
  const forge = toForgeError(error);
  console.log(JSON.stringify({ exitCode: forge.exitCode, error: { message: forge.message, details: forge.details } }));
  process.exitCode = forge.exitCode;
} finally {
  filesystem.link = original;
  syncBuiltinESMExports();
  if (process.connected) process.disconnect();
}
