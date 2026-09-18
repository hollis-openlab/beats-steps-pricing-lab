import type { Asset, Tick } from '../lib/engine/types.ts';
import { eventTimeNs } from '../lib/engine/market.ts';
import { fetchInterval } from './gate-data.mts';
import { fetchFuturesInterval } from './gate-futures.mts';
import { gateTick } from './feed.mts';
import { marketEndpoint } from './transport.mts';

const decimal = (s?: string) => s?.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
export function sameTrade(a: Tick, b: Tick): boolean {
  return a.id === b.id && a.sequence === b.sequence && a.p === b.p && a.side === b.side && decimal(a.amount) === decimal(b.amount)
    && (a.sourceTime && b.sourceTime ? eventTimeNs(a.sourceTime) === eventTimeNs(b.sourceTime) : a.t === b.t);
}
/** Merges overlap by market sequence, preserving the first actual receipt time.
 * Missing records, altered duplicates and reversed source clocks fail closed. */
export function reconcileTicks(history: Tick[], fetched: Tick[], buffered: Tick[]): Tick[] {
  const records = new Map<string, Tick>();
  for (const tick of [...history, ...buffered, ...fetched]) {
    if (!tick.sequence) throw new Error('Recovery requires market sequence');
    const old = records.get(tick.sequence);
    if (old && !sameTrade(old, tick)) throw new Error(`Conflicting recovery evidence: ${tick.sequence}`);
    if (!old) records.set(tick.sequence, { ...tick });
  }
  const ticks = [...records.values()].sort((a, b) => BigInt(a.sequence!) < BigInt(b.sequence!) ? -1 : 1);
  let previous: Tick | undefined;
  for (const tick of ticks) {
    if (previous && BigInt(tick.sequence!) !== BigInt(previous.sequence!) + 1n) throw new Error('Recovery still contains a sequence gap');
    if (previous && (tick.t < previous.t || (tick.sourceTime && previous.sourceTime && eventTimeNs(tick.sourceTime) < eventTimeNs(previous.sourceTime)))) throw new Error('Recovery contains reversed event clocks');
    if (previous) { tick.priceChangedAt = previous.p === tick.p ? previous.priceChangedAt : tick.t; tick.quietCensored = previous.p === tick.p ? previous.quietCensored : false; }
    else { tick.priceChangedAt ??= tick.t; tick.quietCensored ??= true; }
    previous = tick;
  }
  return ticks;
}

export async function recoverTrades(asset: Asset, precision: number, from: number, to: number): Promise<Tick[]> {
  if (asset === 'LOWVOL_SIM') throw new Error('Synthetic instruments have no exchange recovery');
  if (to - from > 720_000) throw new Error('Recovery exceeds the bounded live window');
  const fetchTrades = asset === 'XAU_USDT' ? fetchFuturesInterval : fetchInterval;
  const rows = await fetchTrades(asset, Math.floor(from / 1000) - 1, Math.ceil(to / 1000) + 1, async url => {
    const original = new URL(url);
    const response = await fetch(marketEndpoint('rest', original.pathname + original.search), { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Recovery HTTP ${response.status}`);
    return response.json();
  });
  const receivedAt = Date.now();
  return rows.map(row => gateTick(row, precision, receivedAt));
}

export function settlementCovered(ticks: Tick[], expiry: number, now: number, healthy: boolean): boolean {
  // A heartbeat alone cannot establish the absence of late trades. Wait for a
  // contiguous source event strictly after expiry (including all tied expiry events), plus the configured receipt delay.
  return healthy && now >= expiry + 2000 && (ticks.at(-1)?.t ?? -Infinity) > expiry;
}
