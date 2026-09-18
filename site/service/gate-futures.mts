import { canonicalTrades, requestJson, type Trade } from './gate-data.mts';

/** Gate futures REST timestamps are seconds; WS create_time_ms is milliseconds. */
export function futuresTrade(row: Record<string, unknown>, pair: string, transport: 'rest' | 'ws' = 'rest'): Trade {
  if (row.contract !== pair || (typeof row.id === 'number' && !Number.isSafeInteger(row.id)) || !/^\d+$/.test(String(row.id))) throw new Error('Invalid futures trade identity');
  const size = String(row.size);
  if (!/^-?\d+(\.\d+)?$/.test(size) || !Number.isFinite(Number(size)) || Number(size) === 0) throw new Error('Invalid futures trade size');
  const stamp = String(transport === 'ws' ? row.create_time_ms : row.create_time);
  if (!/^\d+(\.\d+)?$/.test(stamp)) throw new Error('Invalid futures event time');
  const [whole, fraction = ''] = stamp.split('.');
  const millis = transport === 'ws' ? stamp : `${BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0').slice(0, 3))}${fraction.length > 3 ? '.' + fraction.slice(3) : ''}`;
  if (Number(millis) < 1_500_000_000_000 || Number(millis) > Date.now() + 5000) throw new Error('Futures event clock out of range');
  return { ...row, id: String(row.id), sequence_id: String(row.id), create_time_ms: millis, price: row.price as string, amount: size.replace(/^-/, ''), side: Number(size) > 0 ? 'buy' : 'sell', currency_pair: pair, market: 'gate-futures-usdt' };
}

export async function fetchFuturesInterval(pair: string, from: number, to: number, request: (url: string) => Promise<unknown> = requestJson): Promise<Trade[]> {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from <= 0 || to <= from) throw new Error('Invalid futures interval');
  const rows: Trade[] = [], seen = new Set<string>();
  for (let page = 0; page < 100; page++) {
    const url = new URL('https://api.gateio.ws/api/v4/futures/usdt/trades');
    url.search = new URLSearchParams({ contract: pair, from: String(from - 1), to: String(to + 1), limit: '1000', offset: String(page * 1000) }).toString();
    let result: unknown, next: Trade[] = [];
    for (let retry = 0; retry < 3; retry++) {
      result = await request(url.href);
      if (!Array.isArray(result)) throw new Error('Invalid futures trade response');
      next = result.map(row => futuresTrade(row, pair));
      if (!next.length || !next.every(row => seen.has(row.id))) break;
      await new Promise(resolve => setTimeout(resolve, 250 * (retry + 1)));
    }
    if (next.length && next.every(row => seen.has(row.id))) {
      // Some historical ranges stop advancing at the exchange offset ceiling.
      // Split by time rather than treating a repeated page as complete data.
      if (to - from <= 1) throw new Error(`Futures pagination made no progress at ${from}`);
      const middle = Math.floor((from + to) / 2);
      return canonicalTrades([...await fetchFuturesInterval(pair, from, middle, request), ...await fetchFuturesInterval(pair, middle, to, request)], pair, from, to);
    }
    next.forEach(row => seen.add(row.id)); rows.push(...next);
    if (next.length < 1000) return canonicalTrades(rows, pair, from, to);
  }
  throw new Error('Futures interval exceeds 100,000 trades; use a shorter interval');
}
