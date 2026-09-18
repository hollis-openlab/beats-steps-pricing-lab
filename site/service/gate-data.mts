/** Exact, overlapping acquisition and integrity checks shared by repair and collection. */
import { mkdir, readFile, writeFile, rename, appendFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { eventTimeNs } from '../lib/engine/market.ts';

export const COLLECTOR_VERSION = 'gate-v2-overlap-exact-ns';
export const root = path.resolve(import.meta.dirname, '../..');
export type Trade = { id: string; sequence_id: string; create_time_ms: string; price: string; amount: string; side: string; currency_pair: string; [key: string]: unknown };
export type Shard = { pair: string; from: number; to: number; file: string; count: number; sha256: string; firstSequence?: string; lastSequence?: string; originalSha256?: string; addedTrades?: number };
export type Manifest = { source: string; start: string; end: string; collectedAt: string; metadata: Record<string, unknown>; shards: Shard[]; collectorVersion?: string; integrity?: { missingSequences: number; checkedAt: string; scope: string }; [key: string]: unknown };
export const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const decimal = (value: string): string => value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
function validateTrade(row: Trade, pair: string): void {
  if (!row || row.currency_pair !== pair || typeof row.id !== 'string' || !/^\d+$/.test(row.id) || typeof row.sequence_id !== 'string' || !/^\d+$/.test(row.sequence_id)) throw new Error(`Invalid trade identity: ${pair}`);
  for (const key of ['price', 'amount'] as const) if (typeof row[key] !== 'string' || !/^\d+(\.\d+)?$/.test(row[key]) || !Number.isFinite(Number(row[key])) || Number(row[key]) <= 0) throw new Error(`Invalid ${key}: ${pair}`);
  if (!['buy', 'sell'].includes(row.side)) throw new Error(`Invalid trade side: ${pair}`);
  eventTimeNs(row.create_time_ms);
}
export function canonicalTrades(input: Trade[], pair: string, from: number, to: number): Trade[] {
  const lower = BigInt(from) * 1_000_000_000n, upper = BigInt(to) * 1_000_000_000n;
  const unique = new Map<string, Trade>();
  for (const row of input) {
    validateTrade(row, pair);
    const at = eventTimeNs(row.create_time_ms);
    if (at < lower || at >= upper) continue;
    const old = unique.get(row.sequence_id);
    if (old && (old.id !== row.id || eventTimeNs(old.create_time_ms) !== at || decimal(old.price) !== decimal(row.price) || decimal(old.amount) !== decimal(row.amount) || old.side !== row.side)) throw new Error(`Conflicting duplicate: ${pair} ${row.sequence_id}`);
    unique.set(row.sequence_id, row);
  }
  return [...unique.values()].sort((a, b) => {
    const delta = eventTimeNs(a.create_time_ms) - eventTimeNs(b.create_time_ms);
    return delta < 0n ? -1 : delta > 0n ? 1 : BigInt(a.sequence_id) < BigInt(b.sequence_id) ? -1 : 1;
  });
}
export function sequenceGaps(rows: Trade[]): { before: Trade; after: Trade; missing: number }[] {
  const gaps: { before: Trade; after: Trade; missing: number }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const diff = BigInt(rows[i].sequence_id) - BigInt(rows[i - 1].sequence_id);
    if (diff <= 0n) throw new Error(`Non-increasing market sequence at ${rows[i].sequence_id}`);
    if (diff > 1n) gaps.push({ before: rows[i - 1], after: rows[i], missing: Number(diff - 1n) });
  }
  return gaps;
}
export async function fetchInterval(pair: string, from: number, to: number, request: (url: string) => Promise<unknown> = requestJson, limit = 1000, maxPages = 101): Promise<Trade[]> {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from <= 0 || to <= from) throw new Error('Invalid acquisition interval');
  // Overlap both ends; crop locally at exact nanosecond [from,to) boundaries.
  const base = `https://api.gateio.ws/api/v4/spot/trades?currency_pair=${encodeURIComponent(pair)}&from=${from - 1}&to=${to + 1}&limit=${limit}`;
  const first = await request(base);
  if (!Array.isArray(first)) throw new Error(`Invalid trade response: ${pair}`);
  if (first.length < limit) return canonicalTrades(first, pair, from, to);
  if (to - from > 1) {
    const middle = Math.floor((from + to) / 2);
    return canonicalTrades([...await fetchInterval(pair, from, middle, request, limit, maxPages), ...await fetchInterval(pair, middle, to, request, limit, maxPages)], pair, from, to);
  }
  const rows = [...first], seen = new Set(first.map(row => row.sequence_id));
  for (let page = 2; page <= maxPages; page++) {
    const next = await request(`${base}&page=${page}`);
    if (!Array.isArray(next)) throw new Error('Invalid pagination');
    if (next.length && next.every(row => seen.has(row.sequence_id))) throw new Error(`Pagination made no progress: ${pair} ${from}`);
    for (const row of next) seen.add(row.sequence_id);
    rows.push(...next);
    if (next.length < limit) return canonicalTrades(rows, pair, from, to);
  }
  throw new Error(`Single second exceeds supported pagination: ${pair} ${from}`);
}
export async function requestJson(url: string): Promise<unknown> {
  await mkdir(path.join(root, 'data/raw/gate-v2'), { recursive: true });
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      const body = await response.text();
      await appendFile(path.join(root, 'data/raw/gate-v2/requests.ndjson'), JSON.stringify({ url, status: response.status, sha256: sha256(body), receivedAt: new Date().toISOString(), attempt }) + '\n');
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
      return JSON.parse(body);
    } catch (error) {
      if (attempt === 5) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.min(8000, 500 * 2 ** attempt)));
    }
  }
  throw new Error('Unreachable');
}
export async function atomicJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n');
  await rename(temporary, file);
}
export async function readShard(shard: Shard): Promise<Trade[]> {
  const packed = await readFile(path.join(root, shard.file));
  if (sha256(packed) !== shard.sha256) throw new Error(`Hash mismatch: ${shard.file}`);
  const raw = JSON.parse(gunzipSync(packed).toString());
  if (!Array.isArray(raw)) throw new Error(`Invalid shard: ${shard.file}`);
  const rows = canonicalTrades(raw, shard.pair, shard.from, shard.to);
  if (rows.length !== raw.length || rows.length !== shard.count) throw new Error(`Count/duplicate/boundary mismatch: ${shard.file}`);
  return rows;
}
export async function saveShard(pair: string, from: number, to: number, input: Trade[], extra: Partial<Shard> = {}): Promise<Shard> {
  const rows = canonicalTrades(input, pair, from, to);
  const gaps = sequenceGaps(rows);
  if (gaps.length) throw new Error(`Unresolved sequences: ${pair} ${from}, ${gaps.reduce((sum, gap) => sum + gap.missing, 0)} missing`);
  const file = `data/raw/gate-v2/${pair}-${from}.json.gz`, destination = path.join(root, file), packed = gzipSync(JSON.stringify(rows));
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(`${destination}.${process.pid}.tmp`, packed);
  await rename(`${destination}.${process.pid}.tmp`, destination);
  const shard: Shard = { ...extra, pair, from, to, file, count: rows.length, sha256: sha256(packed), firstSequence: rows[0]?.sequence_id, lastSequence: rows.at(-1)?.sequence_id };
  await atomicJson(`${destination}.integrity.json`, { collectorVersion: COLLECTOR_VERSION, ...shard });
  return shard;
}
export async function cachedShard(pair: string, from: number, to: number, originalSha256?: string): Promise<Shard | null> {
  try {
    const shard = JSON.parse(await readFile(path.join(root, `data/raw/gate-v2/${pair}-${from}.json.gz.integrity.json`), 'utf8'));
    if (shard.collectorVersion !== COLLECTOR_VERSION || shard.pair !== pair || shard.from !== from || shard.to !== to || (originalSha256 && shard.originalSha256 !== originalSha256)) return null;
    const rows = await readShard(shard);
    if (sequenceGaps(rows).length || rows[0]?.sequence_id !== shard.firstSequence || rows.at(-1)?.sequence_id !== shard.lastSequence) return null;
    return shard;
  } catch { return null; }
}
export function verifyManifestContinuity(shards: Shard[]): void {
  for (const pair of new Set(shards.map(row => row.pair))) {
    const ordered = shards.filter(row => row.pair === pair).sort((a, b) => a.from - b.from);
    let previous: string | undefined;
    for (let i = 0; i < ordered.length; i++) {
      const shard = ordered[i];
      if (i && ordered[i - 1].to !== shard.from) throw new Error(`Missing/overlapping shard: ${pair} ${shard.from}`);
      if (shard.count && (!shard.firstSequence || !shard.lastSequence || BigInt(shard.lastSequence) - BigInt(shard.firstSequence) + 1n !== BigInt(shard.count))) throw new Error(`Invalid sequence certificate: ${pair} ${shard.from}`);
      if (previous && shard.firstSequence && BigInt(shard.firstSequence) !== BigInt(previous) + 1n) throw new Error(`Cross-shard sequence gap: ${pair} ${previous} -> ${shard.firstSequence}`);
      if (shard.lastSequence) previous = shard.lastSequence;
    }
  }
}
