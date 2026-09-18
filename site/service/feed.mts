import { eventTime, priceUnits } from '../lib/engine/market.ts';
import type { Tick } from '../lib/engine/types.ts';
import { futuresTrade } from './gate-futures.mts';
function identity(value: unknown): string {
  if ((typeof value !== 'string' && typeof value !== 'number') || (typeof value === 'number' && !Number.isSafeInteger(value)) || !/^\d+$/.test(String(value))) throw new Error('Invalid or unsafe market identity');
  return String(value);
}
export function gateTick(row: Record<string, unknown>, precision: number, receivedAt: number): Tick {
  const id = identity(row.id), sequence = identity(row.id_market ?? row.sequence_id);
  if (row.range !== undefined && row.range !== `${sequence}-${sequence}`) throw new Error('Aggregated sequence cannot represent an exact individual trade');
  if (typeof row.create_time_ms !== 'string' || typeof row.price !== 'string' || typeof row.amount !== 'string' || !/^\d+(\.\d+)?$/.test(row.amount) || !Number.isFinite(Number(row.amount)) || Number(row.amount) <= 0 || !['buy', 'sell'].includes(String(row.side))) throw new Error('Invalid market payload');
  const t = eventTime(row.create_time_ms);
  if (!Number.isFinite(receivedAt) || t > receivedAt + 5000) throw new Error('Invalid source clock');
  return { t, p: priceUnits(row.price, precision), id, sequence, sourceTime: row.create_time_ms, receivedAt, amount: row.amount, side: row.side as 'buy' | 'sell' };
}
export function gateFuturesTick(row: Record<string, unknown>, contract: string, precision: number, receivedAt: number): Tick {
  return gateTick(futuresTrade(row, contract, 'ws'), precision, receivedAt);
}
export function feedProblem(previous: Tick | undefined, tick: Tick, warmupComplete: boolean): string | null {
  if (previous?.sequence && (!tick.sequence || BigInt(tick.sequence) !== BigInt(previous.sequence) + 1n)) return '市场成交序号不连续，需重新同步';
  if (previous && tick.t < previous.t) return '检测到乱序行情，需核对结算证据';
  if (warmupComplete && tick.receivedAt !== undefined && tick.receivedAt - tick.t > 2000) return '检测到迟到行情，需核对结算证据';
  return null;
}
