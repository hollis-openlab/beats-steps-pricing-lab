import { parentPort } from 'node:worker_threads';
import { loadLibraries } from './library.mts';
import { makeSnapshot } from '../lib/engine/pricing.ts';
import type { ModelInput } from '../lib/engine/types.ts';
const libraries = loadLibraries();
parentPort!.on('message', (job: { generation: number; inputs: ModelInput[] }) => {
  try { parentPort!.postMessage({ generation: job.generation, snapshots: job.inputs.map(input => makeSnapshot(libraries[input.asset], input)) }); }
  catch (error) { parentPort!.postMessage({ generation: job.generation, error: String(error) }); }
});
parentPort!.postMessage({ ready: true });
