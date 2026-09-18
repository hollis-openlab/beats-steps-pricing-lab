import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import type { Asset, Library } from '../lib/engine/types.ts';
export function loadLibraries(): Record<Asset, Library> {
  const release = JSON.parse(readFileSync(new URL('../public/data/model-release.json', import.meta.url), 'utf8'));
  const libraries = Object.fromEntries(['BTC_USDT', 'ETH_USDT', 'XAU_USDT'].map(asset => {
    const record = release.libraries[asset];
    if (!/^data\/artifacts\/[A-Z_]+-library-v5\.json\.gz$/.test(record.file)) throw new Error('Unexpected model artifact path');
    const packed = readFileSync(new URL(`../../${record.file}`, import.meta.url));
    if (createHash('sha256').update(packed).digest('hex') !== record.sha256) throw new Error(`Model hash mismatch: ${asset}`);
    const library = JSON.parse(gunzipSync(packed).toString());
    if (library.modelVersion !== release.version || library.asset !== asset || library.featureScale.length !== 6) throw new Error('Incompatible model artifact');
    return [asset, library];
  })) as Record<Asset, Library>;
  const demo = JSON.parse(readFileSync(new URL('../public/data/lowvol-simulation.json', import.meta.url), 'utf8'));
  if (demo.library.file !== 'data/artifacts/LOWVOL_SIM-library-v1.json.gz') throw new Error('Unexpected simulation artifact');
  const packed = readFileSync(new URL(`../../${demo.library.file}`, import.meta.url));
  if (createHash('sha256').update(packed).digest('hex') !== demo.library.sha256) throw new Error('Simulation artifact hash mismatch');
  const library: Library = JSON.parse(gunzipSync(packed).toString());
  if (library.asset !== 'LOWVOL_SIM' || library.modelVersion !== 'synthetic-lowvol-v1') throw new Error('Incompatible simulation artifact');
  libraries.LOWVOL_SIM = library;
  return libraries;
}
