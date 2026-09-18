/** Fixture injection is opt-in and restricted to a loopback test server. */
export const fixtureMode = process.env.PAPER_TEST_MODE === '1';
export type MarketKind = 'spot' | 'futures';
export function marketEndpoint(kind: 'rest' | 'ws', path = '', market: MarketKind = 'spot'): string {
  const override = fixtureMode ? process.env.PAPER_FEED_FIXTURE_URL : undefined;
  if (!override) return kind === 'ws' ? market === 'futures' ? 'wss://fx-ws.gateio.ws/v4/ws/usdt' : 'wss://api.gateio.ws/ws/v4/' : `https://api.gateio.ws${path}`;
  const base = new URL(override);
  if (base.hostname !== '127.0.0.1' || base.protocol !== 'http:') throw new Error('Test transport must be HTTP loopback');
  if (kind === 'ws') { base.protocol = 'ws:'; base.pathname = `/ws/${market}`; return base.href; }
  return new URL(path, base).href;
}
export const warmupMs = fixtureMode ? 50 : 65_000;
