import { createServer, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import { CONFIG, frozenRtp } from '../lib/engine/pricing.ts';
import { settleTicket } from '../lib/engine/settlement.ts';
import type { Asset, Convention, ModelInput, PaperTicket, Snapshot, Tick } from '../lib/engine/types.ts';
import { loadLibraries } from './library.mts';
import { PaperLedger, payloadHash } from './ledger.mts';
import { gateTick, gateFuturesTick, feedProblem } from './feed.mts';
import { reconcileTicks, recoverTrades, sameTrade, settlementCovered } from './recovery.mts';
import { marketEndpoint, warmupMs, type MarketKind } from './transport.mts';
import { sourceQuotes } from './sources.mts';
import { ASSETS, MARKET_ASSETS, type MarketAsset } from '../lib/assets.ts';

const assets: Asset[] = ASSETS;
const libraries = loadLibraries();
const ledger = new PaperLedger(process.env.PAPER_LEDGER_PATH ?? fileURLToPath(new URL('../../.run/paper-ledger.sqlite', import.meta.url)), 10_000, 10_000, true);
ledger.audit();
if (!process.env.PAPER_LEDGER_PATH) {
  try { ledger.importLegacy(JSON.parse(readFileSync(new URL('../../data/raw/before-v2/service-snapshot.json', import.meta.url), 'utf8')).tickets ?? []); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
const port = Number(process.env.PRICING_PORT ?? 4318);
const cases = JSON.parse(readFileSync(new URL('../public/data/replay-index.json', import.meta.url), 'utf8')) as { id: string; asset: Asset; name: string; start: number; end: number; eventAt: number }[];
const study = JSON.parse(readFileSync(new URL('../public/data/study.json', import.meta.url), 'utf8'));
let mode: 'replay' | 'live' = 'replay', convention: Convention = 'carried', speed = 1, playing = true;
let generation = 0, busy = false, workerReady = false, engineError: string | null = null;
let now = 0, replayId = 'BTC_USDT-ordinary', replayEnd = 0;
type LiveFeed = { market: MarketKind; assets: MarketAsset[]; socket: WebSocket | null; connected: boolean; lastMessage: number; reconnect?: ReturnType<typeof setTimeout> };
const liveFeeds: LiveFeed[] = [
  { market: 'spot', assets: ['BTC_USDT', 'ETH_USDT'], socket: null, connected: false, lastMessage: 0 },
  { market: 'futures', assets: ['XAU_USDT'], socket: null, connected: false, lastMessage: 0 },
];
let liveStarted = 0;
const feedFor = (asset: Asset) => liveFeeds.find(feed => feed.assets.some(a => a === asset));
function stopLive() {
  for (const feed of liveFeeds) {
    if (feed.reconnect) clearTimeout(feed.reconnect);
    feed.reconnect = undefined; feed.connected = false;
    const socket = feed.socket; feed.socket = null; socket?.close();
  }
}
let histories: Record<Asset, Tick[]> = { BTC_USDT: [], ETH_USDT: [], XAU_USDT: [], LOWVOL_SIM: [] };
let replay: Record<Asset, Tick[]> = { BTC_USDT: [], ETH_USDT: [], XAU_USDT: [], LOWVOL_SIM: [] }, cursors: Record<Asset, number> = { BTC_USDT: 0, ETH_USDT: 0, XAU_USDT: 0, LOWVOL_SIM: 0 };
let snapshots: Partial<Record<Asset, Snapshot>> = {};
const quoteVersions = new Map<string, Snapshot>();
const tickets: PaperTicket[] = ledger.tickets();
const liveIssues: Partial<Record<Asset, string>> = {};
const recovering = new Set<Asset>();
const recoveryStarted: Partial<Record<Asset, number>> = {};
let liveBuffer: Record<Asset, Tick[]> = { BTC_USDT: [], ETH_USDT: [], XAU_USDT: [], LOWVOL_SIM: [] };
const recoveryCounts = { attempted: 0, completed: 0, failed: 0, recoveredTrades: 0 };
function invalidateQuotes() { generation++; snapshots = {}; quoteVersions.clear(); }
const recentAcceptTimes: number[] = [];
let rejected = 0;
const worker = new Worker(new URL('./pricing-worker.mts', import.meta.url));
worker.on('message', (message: { ready?: boolean; generation?: number; snapshots?: Snapshot[]; error?: string }) => {
  if (message.ready) { workerReady = true; requestPricing(); return; }
  busy = false;
  if (message.generation !== generation) return;
  if (message.error) engineError = message.error;
  else { engineError = null; for (const s of message.snapshots ?? []) { snapshots[s.asset] = s; quoteVersions.set(s.version, s); } for (const [version, quote] of quoteVersions) if (quote.asOf < now - 1500 || !version.startsWith(`${generation}-`)) quoteVersions.delete(version); }
});
worker.on('error', error => { busy = false; engineError = error.message; workerReady = false; });
function input(asset: Asset): ModelInput {
  const history = histories[asset];
  let i = 0;
  while (i < history.length - 1 && history[i + 1].t < now - 65_000) i++;
  return { asset, now, history: history.slice(i).filter(t => t.t <= now), mode, convention, version: `${generation}-${now.toString(36)}-${asset.slice(0, 3)}-${history.at(-1)?.id ?? 'none'}` };
}
function requestPricing() {
  if (busy || !workerReady) return;
  const inputs = assets.filter(a => histories[a].length > 0).map(input);
  if (!inputs.length) return;
  busy = true; worker.postMessage({ generation, inputs });
}
function refundOpen(reason: string) {
  for (let i = 0; i < tickets.length; i++) if (tickets[i].status === 'open') tickets[i] = ledger.settle({ ...tickets[i], status: 'void', payout: tickets[i].stake, settledAt: now }, reason);
  console.log(JSON.stringify({ event: 'reset', reason, time: now }));
}
function loadReplay(id: string) {
  const selected = cases.find(c => c.id === id);
  if (!selected) throw new Error('Unknown replay case');
  generation++; refundOpen('切换回放区间'); snapshots = {}; mode = 'replay'; replayId = id;
  stopLive();
  now = selected.start; replayEnd = selected.end;
  for (const asset of assets) { delete liveIssues[asset]; delete recoveryStarted[asset]; }
  histories = { BTC_USDT: [], ETH_USDT: [], XAU_USDT: [], LOWVOL_SIM: [] }; replay = { BTC_USDT: [], ETH_USDT: [], XAU_USDT: [], LOWVOL_SIM: [] }; cursors = { BTC_USDT: 0, ETH_USDT: 0, XAU_USDT: 0, LOWVOL_SIM: 0 };
  // Cases are asset-specific. No unsynchronised second asset is fabricated.
  const loaded = JSON.parse(readFileSync(new URL(`../public/data/${id}.json`, import.meta.url), 'utf8'));
  replay[selected.asset] = loaded.trades;
  advanceReplay(); requestPricing();
}
function advanceReplay() {
  for (const asset of assets) {
    while (cursors[asset] < replay[asset].length && replay[asset][cursors[asset]].t <= now) histories[asset].push(replay[asset][cursors[asset]++]);
  }
}
function appendLive(asset: Asset, tick: Tick) {
  const h = histories[asset];
  const duplicate = h.find(t => t.id === tick.id);
  if (duplicate) {
    if (!sameTrade(duplicate, tick)) throw new Error('Conflicting duplicate trade');
    return;
  }
  const previous = h.at(-1);
  const problem = feedProblem(previous, tick, liveStarted + warmupMs < Date.now());
  if (problem) {
    liveIssues[asset] = problem;
    ledger.record('market-integrity-incident', { asset, previous, tick, reason: liveIssues[asset], affectedTicketIds: tickets.filter(ticket => ticket.asset === asset && tick.t >= ticket.acceptedAt && tick.t <= (ticket.kind === 'beats' ? ticket.window!.end : ticket.acceptedAt + ticket.horizon! * 1000)).map(ticket => ticket.id) });
    liveBuffer[asset].push(tick); invalidateQuotes(); void recoverAsset(asset); return;
  }

  tick.priceChangedAt = !previous || previous.p !== tick.p ? tick.t : previous.priceChangedAt;
  tick.quietCensored = !previous ? true : previous.p !== tick.p ? false : previous.quietCensored;
  ledger.record('market-tick', { asset, tick });
  h.push(tick); if (h.length > 1 && tick.t < h[h.length - 2].t) h.sort((a, b) => a.t - b.t || (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
}
async function recoverAsset(asset: Asset) {
  const feed = feedFor(asset);
  if (!feed) throw new Error('This instrument is available in historical replay only');
  if (recovering.has(asset) || mode !== 'live' || !feed.connected) return;
  recovering.add(asset); recoveryStarted[asset] ??= Date.now(); liveIssues[asset] = '正在回补并核对市场成交序号'; recoveryCounts.attempted++;
  const socket = feed.socket;
  try {
    const previous = histories[asset];
    const from = previous.at(-1)?.t ?? Date.now() - 65_000;
    const fetched = await recoverTrades(asset, libraries[asset].precision, from, Date.now());
    if (socket !== feed.socket || mode !== 'live') return;
    const known = new Set(previous.map(t => t.sequence));
    const merged = reconcileTicks(previous, fetched, liveBuffer[asset]);
    // Need both a price and coverage reaching the buffered WebSocket stream.
    if (!merged.length) throw new Error('No recovery price available');
    const added = merged.filter(t => !known.has(t.sequence));
    ledger.record('market-recovered', { asset, from, to: Date.now(), added, firstSequence: merged[0].sequence, lastSequence: merged.at(-1)!.sequence });
    histories[asset] = merged; liveBuffer[asset] = []; delete liveIssues[asset]; delete recoveryStarted[asset];
    recoveryCounts.completed++; recoveryCounts.recoveredTrades += added.length; invalidateQuotes();
    requestPricing();
  } catch (error) {
    if (socket !== feed.socket || mode !== 'live') return;
    recoveryCounts.failed++; liveIssues[asset] = `回补尚未完成：${String(error)}`;
    ledger.record('market-recovery-failed', { asset, error: String(error) });
  } finally { recovering.delete(asset); }
}
function connectLive(feed: LiveFeed) {
  if (mode !== 'live') return;
  const channel = `${feed.market}.trades`;
  const socket = new WebSocket(marketEndpoint('ws', '', feed.market)); feed.socket = socket;
  socket.addEventListener('open', () => { if (socket !== feed.socket) return; feed.connected = true; feed.lastMessage = Date.now(); socket.send(JSON.stringify({ time: Math.floor(Date.now() / 1000), channel, event: 'subscribe', payload: feed.assets })); for (const asset of feed.assets) { liveIssues[asset] = '等待历史与实时行情同步'; void recoverAsset(asset); } });
  socket.addEventListener('message', event => {
    if (socket !== feed.socket || mode !== 'live') return;
    feed.lastMessage = Date.now();
    try {
      const message = JSON.parse(String(event.data));
      if (message.error) throw new Error(`Exchange subscription error: ${JSON.stringify(message.error)}`);
      if (message.channel !== channel || message.event !== 'update') return;
      for (const row of Array.isArray(message.result) ? message.result : [message.result]) {
        const asset = (feed.market === 'spot' ? row.currency_pair : row.contract) as Asset;
        if (!feed.assets.some(a => a === asset)) throw new Error('Unexpected market subscription');
        const tick = feed.market === 'spot' ? gateTick(row, libraries[asset].precision, Date.now()) : gateFuturesTick(row, asset, libraries[asset].precision, Date.now());
        if (liveIssues[asset] || recovering.has(asset)) { if (liveBuffer[asset].length >= 100_000) throw new Error('Recovery buffer limit exceeded'); liveBuffer[asset].push(tick); }
        else appendLive(asset, tick);
      }
    } catch (error) { ledger.record('market-parse-error', { market: feed.market, error: String(error), receivedAt: Date.now() }); for (const asset of feed.assets) { liveIssues[asset] = '行情解析失败，等待回补'; recoveryStarted[asset] ??= Date.now(); } socket.close(); }
  });
  socket.addEventListener('close', () => {
    if (socket !== feed.socket) return;
    feed.connected = false; invalidateQuotes();
    for (const asset of feed.assets) { liveIssues[asset] = '实时行情断线，等待重连与回补'; recoveryStarted[asset] ??= Date.now(); }
    if (mode === 'live') feed.reconnect = setTimeout(() => connectLive(feed), 3000);
  });
  socket.addEventListener('error', () => { if (socket === feed.socket) feed.connected = false; });
}
function startLive() {
  stopLive();
  generation++; refundOpen('切换实时行情'); mode = 'live'; snapshots = {};
  histories = { BTC_USDT: [], ETH_USDT: [], XAU_USDT: [], LOWVOL_SIM: [] }; liveBuffer = { BTC_USDT: [], ETH_USDT: [], XAU_USDT: [], LOWVOL_SIM: [] }; now = Date.now(); liveStarted = now;
  for (const asset of MARKET_ASSETS) { delete liveIssues[asset]; delete recoveryStarted[asset]; }
  liveFeeds.forEach(connectLive);
}
function health() {
  const assetHealth = Object.fromEntries(assets.map(asset => { const feed = feedFor(asset); return [asset, mode === 'replay' || Boolean(feed?.connected && Date.now() - feed.lastMessage < 20_000 && !liveIssues[asset] && histories[asset].length)]; })) as Record<Asset, boolean>;
  const healthy = MARKET_ASSETS.every(asset => assetHealth[asset]);
  return { modelVersions: Object.fromEntries(assets.map(a => [a, libraries[a].modelVersion])), paperOnly: true, mode, convention, now, speed, playing, replayId, replayEnd, liveConnected: liveFeeds.every(feed => feed.connected), liveAgeMs: mode === 'live' ? Math.max(...liveFeeds.map(feed => Date.now() - feed.lastMessage)) : 0, warmupSeconds: mode === 'live' ? Math.max(0, Math.ceil((liveStarted + warmupMs - Date.now()) / 1000)) : 0, healthy, assetHealth, engineError, workerReady, computing: busy, rejected, totalTickets: tickets.length, openLiability: ledger.summary().reservedCents / 100, ledger: ledger.summary(), liveIssues, settlementDelayMs: 2000, recoveryTimeoutMs: 120_000, recovering: [...recovering], recoveryCounts, pendingCorrections: ledger.corrections().filter(c => c.status === 'pending').length, clocks: Object.fromEntries(assets.map(asset => { const t = histories[asset].at(-1); return [asset, t ? { tradeAgeMs: now - t.t, priceAgeMs: now - (t.priceChangedAt ?? t.t), priceAgeCensored: t.quietCensored ?? true, receivedAgeMs: t.receivedAt ? Date.now() - t.receivedAt : null, transportDelayMs: t.receivedAt ? t.receivedAt - t.t : null } : null]; })) };
}
const betSchema = z.object({ requestId: z.string().uuid(), asset: z.enum(['BTC_USDT', 'ETH_USDT', 'XAU_USDT', 'LOWVOL_SIM']), version: z.string(), kind: z.enum(['beats', 'steps']), stake: z.number().int().min(1).max(100), row: z.number().int().min(0).max(23).optional(), col: z.number().int().min(0).max(35).optional(), direction: z.enum(['up', 'down']).optional(), horizon: z.union([z.literal(120), z.literal(180), z.literal(300)]).optional() });
function accept(raw: unknown): PaperTicket {
  // Acceptance is continuous in live wall time, not quantized to the last board tick.
  if (mode === 'live') now = Date.now();
  const b = betSchema.parse(raw), fingerprint = payloadHash(b), old = ledger.lookup(b.requestId, fingerprint);
  if (old) return old;
  const wallTime = Date.now();
  while (recentAcceptTimes.length && recentAcceptTimes[0] <= wallTime - 1000) recentAcceptTimes.shift();
  if (recentAcceptTimes.length >= 3) throw new Error('频率限制：每秒最多锁定 3 笔示例');
  const state = health(), q = quoteVersions.get(b.version);
  if (!state.assetHealth[b.asset] || state.warmupSeconds || state.engineError) throw new Error('行情尚未就绪，暂停接单');
  if (!q || q.asset !== b.asset || !q.version.startsWith(`${generation}-`) || q.status !== 'ready' || now - q.asOf > 1500 || now < q.asOf) throw new Error('报价已过期或行情已更新，请使用最新报价重试');
  if (mode === 'replay' && now + 300_000 >= replayEnd) throw new Error('本段回放不足以覆盖完整期限，请选择新的片段');
  const ticket: PaperTicket = { id: randomUUID(), quoteVersion: q.version, contractVersion: b.asset === 'LOWVOL_SIM' ? 'synthetic-price-v1' : b.asset === 'XAU_USDT' ? 'gate-gold-futures-v1' : 'gate-spot-trade-v3', modelVersion: libraries[b.asset].modelVersion, sourceId: q.sourceId, mode, replayId: mode === 'replay' ? replayId : undefined, asset: b.asset, kind: b.kind, acceptedAt: now, stake: b.stake, p0: q.price, precision: q.precision, odds: [], status: 'open', payout: 0 };
  if (b.kind === 'beats') {
    if (b.row === undefined || b.col === undefined) throw new Error('缺少价带或时间窗');
    const cell = q.cells[b.row * CONFIG.cols + b.col];
    if (cell.odds === null || q.windows[b.col].start <= now) throw new Error(cell.reason ?? '窗口已经开始');
    Object.assign(ticket, { band: q.bands[b.row], window: q.windows[b.col], convention: q.convention, odds: [cell.odds] });
  } else {
    const step = q.steps.find(s => s.direction === b.direction && s.horizon === b.horizon);
    if (!step?.odds) throw new Error(step?.reason ?? '缺少方向或期限');
    Object.assign(ticket, { direction: step.direction, horizon: step.horizon, boundaries: step.boundaries, odds: step.odds });
  }
  if (ticket.kind === 'steps' && histories[b.asset].at(-1)?.p !== q.price) throw new Error('接单价格已变化，请刷新 Steps 报价后重试');
  const rtp = frozenRtp(libraries[b.asset], input(b.asset), ticket);
  if (rtp > CONFIG.rtp + 1e-10) throw new Error('接单时重估的赔付预算超限，请等待下一版报价');
  ledger.accept(b.requestId, fingerprint, ticket);
  tickets.push(ticket); recentAcceptTimes.push(Date.now()); return ticket;
}
function json(res: ServerResponse, status: number, body: unknown) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); }
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost:4318');
  try {
    if (req.method === 'GET') {
      if (url.pathname === '/health') return json(res, 200, health());
      if (url.pathname === '/audit') return json(res, 200, ledger.audit());
      if (url.pathname === '/snapshot') return json(res, 200, { snapshots, health: health(), tickets: tickets.slice(-30).reverse(), corrections: ledger.corrections() });
      if (url.pathname === '/research') return json(res, 200, study);
      if (url.pathname === '/cases') return json(res, 200, cases);
      if (url.pathname === '/sources') return json(res, 200, { quotes: await sourceQuotes(), note: 'Gate TradFi bid/ask snapshots only; no complete tick sequence, not eligible for Beats/Steps settlement.' });
      return json(res, 404, { error: 'Not found' });
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
    const origin = req.headers.origin;
    if (origin && !['http://127.0.0.1:3000', 'http://localhost:3000', 'http://127.0.0.1:4318'].includes(origin)) return json(res, 403, { error: 'Origin rejected' });
    let body = '';
    for await (const chunk of req) { body += chunk.toString(); if (body.length > 16_384) return json(res, 413, { error: 'Body too large' }); }
    const parsed = JSON.parse(body || '{}');
    if (url.pathname === '/bet') { try { return json(res, 200, { ticket: accept(parsed) }); } catch (error) { rejected++; throw error; } }
    if (url.pathname === '/control') {
      const c = z.object({ mode: z.enum(['replay', 'live']).optional(), caseId: z.string().optional(), playing: z.boolean().optional(), speed: z.union([z.literal(1), z.literal(5), z.literal(30)]).optional(), convention: z.enum(['trade', 'carried']).optional() }).parse(parsed);
      if (c.mode === 'live' && mode !== 'live') startLive();
      else if (c.caseId || c.mode === 'replay') loadReplay(c.caseId ?? replayId);
      if (c.playing !== undefined) playing = c.playing;
      if (c.speed !== undefined) speed = c.speed;
      if (c.playing && mode === 'replay' && now >= replayEnd) loadReplay(replayId);
      if (c.convention && c.convention !== convention) { convention = c.convention; generation++; snapshots = {}; }
      requestPricing(); return json(res, 200, health());
    }
    return json(res, 404, { error: 'Not found' });
  } catch (error) { return json(res, 400, { error: error instanceof Error ? error.message : String(error) }); }
});
const interrupted = tickets.filter(t => t.status === 'open');
if (interrupted.length && interrupted.every(t => t.mode === 'live' && Date.now() - t.acceptedAt < 600_000)) {
  mode = 'live'; now = Date.now(); liveStarted = now;
  for (const asset of MARKET_ASSETS) {
    const since = Math.min(now - 65_000, ...interrupted.filter(t => t.asset === asset).map(t => t.acceptedAt - 65_000));
    try { histories[asset] = reconcileTicks([], ledger.marketTicks(asset, since), []); } catch { histories[asset] = []; }
    // With no durable anchor, refund rather than asserting coverage of a past bet.
    if (!histories[asset].length) for (let i = 0; i < tickets.length; i++) if (tickets[i].asset === asset && tickets[i].status === 'open') tickets[i] = ledger.settle({ ...tickets[i], status: 'void', payout: tickets[i].stake, settledAt: now }, '重启后缺少可验证的成交锚点');
    liveIssues[asset] = '恢复中断前订单，等待成交序号回补';
  }
  liveFeeds.forEach(connectLive);
} else { ledger.recoverOpen(); tickets.splice(0, tickets.length, ...ledger.tickets()); loadReplay(replayId); }
setInterval(() => {
  if (mode === 'live') now = Date.now();
  else if (playing) { now = Math.min(replayEnd, now + speed * 1000); if (now === replayEnd) playing = false; advanceReplay(); }
  const state = health();
  if (mode === 'live') for (const feed of liveFeeds) if (feed.connected && Date.now() - feed.lastMessage > 20_000) feed.socket?.close();
  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];
    if (ticket.status !== 'open') continue;
    const expiry = ticket.kind === 'beats' ? ticket.window!.end : ticket.acceptedAt + ticket.horizon! * 1000;
    if (mode === 'live') {
      if ((recoveryStarted[ticket.asset] && Date.now() - recoveryStarted[ticket.asset]! > 120_000) || now > expiry + 120_000) {
        tickets[i] = ledger.settle({ ...ticket, status: 'void', payout: ticket.stake, settledAt: now }, '两分钟内无法取得完整结算证据，按中断规则退款'); continue;
      }
      if (!settlementCovered(histories[ticket.asset], expiry, now, state.assetHealth[ticket.asset])) continue;
    }
    const next = settleTicket(ticket, histories[ticket.asset], now - (mode === 'live' ? 2000 : 0), true);
    if (next.status !== ticket.status) tickets[i] = ledger.settle(next, '按锁定规则及连续成交序号结算');
  }
  if (mode === 'live') for (const asset of MARKET_ASSETS) {
    if (recoveryStarted[asset] && Date.now() - recoveryStarted[asset]! > 120_000 && !tickets.some(t => t.asset === asset && t.status === 'open') && !recovering.has(asset)) {
      ledger.record('market-recovery-reset', { asset, reason: '恢复期限已到，未结订单已退款，重新建立行情锚点' });
      histories[asset] = []; liveBuffer[asset] = []; recoveryStarted[asset] = Date.now(); liveStarted = Date.now(); invalidateQuotes();
    }
    if (feedFor(asset)?.connected && liveIssues[asset] && !recovering.has(asset)) void recoverAsset(asset);
  }

  for (const asset of assets) { const h = histories[asset]; let i = 0; while (i < h.length - 1 && h[i + 1].t < now - 660_000) i++; if (i) histories[asset] = h.slice(i); }
  requestPricing();
}, 1000);
setInterval(() => { for (const feed of liveFeeds) if (feed.socket?.readyState === WebSocket.OPEN) feed.socket.send(JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: `${feed.market}.ping` })); }, 5000);
server.listen(port, '127.0.0.1', () => console.log(`Pricing service ready: http://127.0.0.1:${port} (durable paper accounts only)`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { refundOpen('服务关闭，退还未结算模拟本金'); stopLive(); worker.terminate(); server.close(); ledger.close(); process.exit(0); });
