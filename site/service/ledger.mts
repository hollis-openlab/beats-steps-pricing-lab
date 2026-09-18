import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PaperTicket, Tick, Asset } from '../lib/engine/types.ts';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const cents = (value: number) => { const result = Math.round(value * 100); if (!Number.isFinite(value) || !Number.isSafeInteger(result) || value < 0 || Math.abs(result / 100 - value) > 1e-8) throw new Error('Invalid money amount'); return result; };
export function payloadHash(payload: Record<string, unknown>): string {
  return hash(JSON.stringify(Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'requestId').sort(([a], [b]) => a.localeCompare(b)))));
}
export class PaperLedger {
  private db: DatabaseSync;
  private unlimitedDemo: boolean;
  constructor(file: string, userCapital = 10_000, houseCapital = 10_000, unlimitedDemo = false) {
    this.unlimitedDemo = unlimitedDemo;
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, balance INTEGER NOT NULL CHECK(balance>=0));
      CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, body TEXT NOT NULL, status TEXT NOT NULL, asset TEXT NOT NULL, reserve INTEGER NOT NULL CHECK(reserve>=0));
      CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, ticket_id TEXT NOT NULL REFERENCES tickets(id));
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, previous_hash TEXT NOT NULL, hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS corrections (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES tickets(id), body TEXT NOT NULL, status TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS entries (seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL REFERENCES events(id), account TEXT NOT NULL REFERENCES accounts(id), delta INTEGER NOT NULL);
      CREATE TRIGGER IF NOT EXISTS immutable_events_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'immutable event'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_events_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'immutable event'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_entries_update BEFORE UPDATE ON entries BEGIN SELECT RAISE(ABORT, 'immutable entry'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_entries_delete BEFORE DELETE ON entries BEGIN SELECT RAISE(ABORT, 'immutable entry'); END;`);
    if (!this.db.prepare('SELECT id FROM accounts LIMIT 1').get()) this.transaction(() => {
      this.db.prepare('INSERT INTO accounts VALUES (?,?)').run('user', cents(userCapital));
      this.db.prepare('INSERT INTO accounts VALUES (?,?)').run('house', cents(houseCapital));
      this.event('opening', { user: cents(userCapital), house: cents(houseCapital), paperOnly: true });
    });
  }
  private transaction<T>(run: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try { const result = run(); this.db.exec('COMMIT'); return result; } catch (error) { this.db.exec('ROLLBACK'); throw error; } }
  private event(kind: string, body: unknown): string {
    const previous = this.db.prepare('SELECT hash FROM events ORDER BY seq DESC LIMIT 1').get()?.hash as string ?? '';
    const id = randomUUID(), at = Date.now(), content = JSON.stringify(body), digest = hash(JSON.stringify([previous, id, at, kind, content]));
    this.db.prepare('INSERT INTO events(id,at,kind,body,previous_hash,hash) VALUES (?,?,?,?,?,?)').run(id, at, kind, content, previous, digest);
    return id;
  }
  private transfer(event: string, amount: number, from: string, to: string): void {
    if (!amount) return;
    if ((this.db.prepare('UPDATE accounts SET balance=balance-? WHERE id=? AND balance>=?').run(amount, from, amount)).changes !== 1) throw new Error('模拟账户余额不足');
    this.db.prepare('UPDATE accounts SET balance=balance+? WHERE id=?').run(amount, to);
    for (const [account, delta] of [[from, -amount], [to, amount]] as const) this.db.prepare('INSERT INTO entries(event_id,account,delta) VALUES (?,?,?)').run(event, account, delta);
  }
  lookup(request: string, fingerprint: string): PaperTicket | null {
    const old = this.db.prepare('SELECT fingerprint,ticket_id FROM requests WHERE id=?').get(request);
    if (!old) return null;
    if (old.fingerprint !== fingerprint) throw new Error('同一幂等键不能用于不同的合约请求');
    return JSON.parse(this.db.prepare('SELECT body FROM tickets WHERE id=?').get(old.ticket_id as string)!.body as string);
  }
  accept(request: string, fingerprint: string, ticket: PaperTicket): PaperTicket {
    return this.transaction(() => {
      const old = this.lookup(request, fingerprint); if (old) return old;
      const stake = cents(ticket.stake), reserve = Math.ceil(stake * Math.max(...ticket.odds));
      if (ticket.status !== 'open' || !Number.isSafeInteger(reserve) || reserve < stake) throw new Error('Invalid reserved payout');
      const summary = this.summary();
      const assetReserve = Number(this.db.prepare('SELECT COALESCE(SUM(reserve),0) AS n FROM tickets WHERE asset=?').get(ticket.asset)!.n);
      if (summary.open >= 100) throw new Error('同时待结算的模拟合约最多 100 笔');
      if (this.unlimitedDemo) {
        const funding = { user: Math.max(0, stake - summary.userCents), house: Math.max(0, reserve + summary.reservedCents - summary.houseCents - stake), paperOnly: true };
        if (funding.user || funding.house) {
          this.event('demo-funding', funding);
          for (const account of ['user', 'house'] as const) this.db.prepare('UPDATE accounts SET balance=balance+? WHERE id=?').run(funding[account], account);
        }
      } else if (reserve + summary.reservedCents > summary.houseCents + stake || assetReserve + reserve > (summary.houseCents + stake) * .6) throw new Error('可用模拟资本不足或单标的集中度超限');
      const event = this.event('accepted', { request, fingerprint, ticket, reserveCents: reserve });
      this.transfer(event, stake, 'user', 'house');
      this.db.prepare('INSERT INTO tickets VALUES (?,?,?,?,?)').run(ticket.id, JSON.stringify(ticket), 'open', ticket.asset, reserve);
      this.db.prepare('INSERT INTO requests VALUES (?,?,?)').run(request, fingerprint, ticket.id);
      return ticket;
    });
  }
  settle(next: PaperTicket, reason: string): PaperTicket {
    return this.transaction(() => {
      const found = this.db.prepare('SELECT body,status FROM tickets WHERE id=?').get(next.id);
      if (!found) throw new Error('Unknown ticket');
      const old: PaperTicket = JSON.parse(found.body as string);
      if (old.status !== 'open') return old;
      if (!['won', 'lost', 'void'].includes(next.status)) throw new Error('Invalid settlement status');
      const result = { ...old, status: next.status, payout: next.payout, settledAt: next.settledAt, tier: next.tier, evidence: next.evidence, settlementReason: reason };
      const payout = cents(result.payout);
      this.validateSettlement(old, result);
      if (payout > Math.ceil(cents(old.stake) * Math.max(...old.odds))) throw new Error('Payout exceeds frozen contract');
      const event = this.event('settled', { ticketId: old.id, result, reason });
      this.transfer(event, payout, 'house', 'user');
      this.db.prepare('UPDATE tickets SET body=?,status=?,reserve=0 WHERE id=?').run(JSON.stringify(result), result.status, old.id);
      return JSON.parse(JSON.stringify(result)) as PaperTicket;
    });
  }
  private validateSettlement(old: PaperTicket, result: PaperTicket): void {
    const expected = result.status === 'void' ? old.stake : result.status === 'lost' ? 0 : result.status === 'won' ? Math.floor(old.stake * old.odds[old.kind === 'steps' ? (result.tier ?? 0) - 1 : 0] * 100 + 1e-7) / 100 : NaN;
    if (!Number.isFinite(expected) || cents(result.payout) !== cents(expected) || !Number.isFinite(result.settledAt)) throw new Error('Settlement differs from frozen payout rules');
  }
  proposeCorrection(ticketId: string, result: PaperTicket, reason: string, evidenceHash: string): string {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT body FROM tickets WHERE id=?').get(ticketId);
      if (!row) throw new Error('Unknown ticket');
      const original: PaperTicket = JSON.parse(row.body as string);
      if (original.status === 'open' || !/^[a-f0-9]{64}$/.test(evidenceHash) || reason.trim().length < 8) throw new Error('Correction needs a closed ticket, evidence hash and reason');
      this.validateSettlement(original, result);
      const applied = Number(this.db.prepare("SELECT COALESCE(SUM(json_extract(body,'$.deltaCents')),0) AS n FROM corrections WHERE ticket_id=? AND status='applied'").get(ticketId)!.n);
      const deltaCents = cents(result.payout) - cents(original.payout) - applied;
      if (!deltaCents) throw new Error('No monetary difference');
      const id = randomUUID(), body = { ticketId, original, corrected: { ...original, status: result.status, tier: result.tier, payout: result.payout, evidence: result.evidence, settledAt: result.settledAt }, deltaCents, priorAdjustmentCents: applied, reason, evidenceHash };
      this.event('correction-proposed', { id, ...body });
      this.db.prepare('INSERT INTO corrections VALUES (?,?,?,?)').run(id, ticketId, JSON.stringify(body), 'pending');
      return id;
    });
  }
  applyCorrection(id: string, expectedHead: string, operator: string): void {
    this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM corrections WHERE id=?').get(id);
      if (!row) throw new Error('Unknown correction');
      if (row.status === 'applied') return;
      const head = this.db.prepare('SELECT hash FROM events ORDER BY seq DESC LIMIT 1').get()!.hash;
      if (head !== expectedHead || operator.trim().length < 2) throw new Error('Audit head changed or operator missing; review again');
      const body = JSON.parse(row.body as string), delta = body.deltaCents as number;
      const prior = Number(this.db.prepare("SELECT COALESCE(SUM(json_extract(body,'$.deltaCents')),0) AS n FROM corrections WHERE ticket_id=? AND status='applied'").get(row.ticket_id as string)!.n);
      if (prior !== body.priorAdjustmentCents) throw new Error('Correction superseded; recalculate the difference');
      if (delta > this.summary().availableHouseCents) throw new Error('Correction would consume reserved capital');
      const event = this.event('correction-applied', { correctionId: id, operator, ...body });
      this.transfer(event, Math.abs(delta), delta > 0 ? 'house' : 'user', delta > 0 ? 'user' : 'house');
      this.db.prepare("UPDATE corrections SET status='applied' WHERE id=?").run(id);
    });
  }
  corrections() { return this.db.prepare('SELECT * FROM corrections ORDER BY rowid').all().map(row => ({ id: row.id as string, status: row.status as string, ...JSON.parse(row.body as string) })); }
  backup(file: string) { this.db.prepare('VACUUM INTO ?').run(file); const copy = new PaperLedger(file); try { return copy.audit(); } finally { copy.close(); } }
  record(kind: string, body: unknown): void { this.transaction(() => this.event(kind, body)); }
  importLegacy(tickets: PaperTicket[]): void {
    this.transaction(() => {
      for (const ticket of tickets) {
        if (ticket.status === 'open' || this.db.prepare('SELECT id FROM tickets WHERE id=?').get(ticket.id)) continue;
        const archived = { ...ticket, settlementReason: 'V1 已结算模拟记录迁移；旧版无资金账户，此记录不计入新版账户流水' };
        this.event('legacy-closed-ticket-import', { ticket: archived, affectsBalances: false });
        this.db.prepare('INSERT INTO tickets VALUES (?,?,?,?,0)').run(ticket.id, JSON.stringify(archived), ticket.status, ticket.asset);
      }
    });
  }
  tickets(): PaperTicket[] { return this.db.prepare('SELECT body FROM tickets ORDER BY rowid').all().map(row => JSON.parse(row.body as string)); }
  marketTicks(asset: Asset, since: number): Tick[] {
    const ticks: Tick[] = [];
    for (const row of this.db.prepare("SELECT kind,body FROM events WHERE at>=? AND kind IN ('market-tick','market-recovered') ORDER BY seq").iterate(Math.floor(since))) {
      const body = JSON.parse(row.body as string);
      if (body.asset === asset) for (const tick of row.kind === 'market-tick' ? [body.tick] : body.added) if (tick.t >= since) ticks.push(tick);
    }
    return ticks;
  }
  recoverOpen(): number {
    const open = this.tickets().filter(ticket => ticket.status === 'open');
    for (const ticket of open) this.settle({ ...ticket, status: 'void', payout: ticket.stake, settledAt: Date.now() }, '进程重启后行情覆盖未恢复；按合约中断规则退还本金');
    return open.length;
  }
  summary() {
    const balances = Object.fromEntries(this.db.prepare('SELECT * FROM accounts').all().map(row => [row.id as string, Number(row.balance)]));
    const reservedCents = Number(this.db.prepare('SELECT COALESCE(SUM(reserve),0) AS n FROM tickets').get()!.n);
    return { userCents: balances.user, houseCents: balances.house, reservedCents, availableHouseCents: balances.house - reservedCents, open: Number(this.db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE status='open'").get()!.n), paperOnly: true };
  }
  audit() {
    let previous = '', opening: Record<string, number> = {};
    const projection = new Map<string, { ticket: PaperTicket; reserve: number }>();
    const expectedEntries = new Map<string, number>();
    const correctionProjection = new Map<string, { status: string; body: unknown }>();
    const events = this.db.prepare('SELECT * FROM events ORDER BY seq').all();
    for (const row of events) {
      if (row.previous_hash !== previous || row.hash !== hash(JSON.stringify([previous, row.id, row.at, row.kind, row.body]))) throw new Error('Event hash chain mismatch');
      const body = JSON.parse(row.body as string);
      if (row.kind === 'opening') opening = body;
      if (row.kind === 'demo-funding') {
        if (body.paperOnly !== true || !['user', 'house'].every(account => Number.isSafeInteger(body[account]) && body[account] >= 0)) throw new Error('Invalid demo funding');
        opening.user += body.user; opening.house += body.house;
      }
      if (row.kind === 'accepted') { projection.set(body.ticket.id, { ticket: body.ticket, reserve: body.reserveCents }); expectedEntries.set(row.id as string, -cents(body.ticket.stake)); }
      if (row.kind === 'settled') { projection.set(body.ticketId, { ticket: body.result, reserve: 0 }); expectedEntries.set(row.id as string, cents(body.result.payout)); }
      if (row.kind === 'legacy-closed-ticket-import') projection.set(body.ticket.id, { ticket: body.ticket, reserve: 0 });
      if (row.kind === 'correction-proposed') { const { id, ...content } = body; correctionProjection.set(id, { status: 'pending', body: content }); }
      if (row.kind === 'correction-applied') { const original = correctionProjection.get(body.correctionId); if (!original) throw new Error('Missing correction proposal'); original.status = 'applied'; expectedEntries.set(row.id as string, body.deltaCents); }
      previous = row.hash as string;
    }
    for (const row of this.db.prepare('SELECT event_id,SUM(delta) AS n FROM entries GROUP BY event_id').all()) if (Number(row.n) !== 0) throw new Error('Unbalanced journal');
    for (const row of this.db.prepare('SELECT * FROM accounts').all()) {
      const sum = Number(this.db.prepare('SELECT COALESCE(SUM(delta),0) AS n FROM entries WHERE account=?').get(row.id as string)!.n);
      if (Number(row.balance) !== opening[row.id as string] + sum) throw new Error('Balance projection mismatch');
    }
    const storedTickets = this.db.prepare('SELECT * FROM tickets').all();
    if (storedTickets.length !== projection.size) throw new Error('Ticket projection count mismatch');
    for (const row of storedTickets) { const expected = projection.get(row.id as string); if (!expected || JSON.stringify(expected.ticket) !== row.body || expected.reserve !== row.reserve || expected.ticket.status !== row.status || expected.ticket.asset !== row.asset) throw new Error('Ticket projection mismatch'); }
    const storedCorrections = this.db.prepare('SELECT * FROM corrections').all();
    if (storedCorrections.length !== correctionProjection.size) throw new Error('Correction projection count mismatch');
    for (const row of storedCorrections) { const expected = correctionProjection.get(row.id as string); if (!expected || expected.status !== row.status || JSON.stringify(expected.body) !== row.body) throw new Error('Correction projection mismatch'); }
    for (const row of this.db.prepare("SELECT event_id,SUM(delta) AS delta FROM entries WHERE account='user' GROUP BY event_id").all()) { if ((expectedEntries.get(row.event_id as string) ?? 0) !== row.delta) throw new Error('Journal differs from economic event'); expectedEntries.delete(row.event_id as string); }
    if ([...expectedEntries.values()].some(delta => delta !== 0)) throw new Error('Missing economic journal entries');
    if (this.summary().availableHouseCents < 0) throw new Error('Unfunded reserve');
    return { verified: true, events: events.length, headHash: previous, ...this.summary() };
  }
  close(): void { this.db.close(); }
}
