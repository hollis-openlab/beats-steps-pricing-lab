/** Indicative TradFi snapshots are intentionally separate from trade settlement. */
export type SourceQuote = { symbol: string; bid?: string; ask?: string; responseAt?: number; receivedAt: number; marketStatus?: string; error?: string; kind: 'quote-snapshot'; eligibleForSettlement: false };
let cache: { at: number; quotes: SourceQuote[] } | undefined, pending: Promise<SourceQuote[]> | undefined;
export async function sourceQuotes(): Promise<SourceQuote[]> {
  if (cache && Date.now() - cache.at < 30_000) return cache.quotes;
  if (pending) return pending;
  pending = Promise.all(['EURUSD', 'XAUUSD'].map(async symbol => {
    const base = { symbol, kind: 'quote-snapshot' as const, eligibleForSettlement: false as const };
    try {
      const response = await fetch(`https://api.gateio.ws/api/v4/tradfi/symbols/${symbol}/tickers`, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json(), { bid_price: bid, ask_price: ask, status } = result.data ?? {};
      if (typeof bid !== 'string' || typeof ask !== 'string' || !Number.isFinite(Number(bid)) || !Number.isFinite(Number(ask)) || Number(bid) <= 0 || Number(ask) < Number(bid) || !Number.isSafeInteger(result.timestamp)) throw new Error('Invalid quote snapshot');
      return { ...base, bid, ask, marketStatus: String(status), responseAt: result.timestamp, receivedAt: Date.now() };
    } catch (error) { return { ...base, receivedAt: Date.now(), error: String(error) }; }
  })).then(quotes => { cache = { at: Date.now(), quotes }; return quotes; }).finally(() => { pending = undefined; });
  return pending;
}
