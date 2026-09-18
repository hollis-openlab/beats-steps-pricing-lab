import type { Band, Convention, Direction, PaperTicket, Tick, Window } from './types.ts';
export function hitBand(ticks: Tick[], band: Band, window: Window, convention: Convention, initial?: Tick): Tick | undefined {
  const inside = (p: number) => p >= band.lower && p < band.upper;
  if (convention === 'carried') {
    let carried = initial;
    for (const tick of ticks) { if (tick.t <= window.start) carried = tick; else break; }
    if (carried && inside(carried.p)) return { ...carried, t: window.start };
  }
  return ticks.find(t => t.t >= window.start && t.t < window.end && inside(t.p));
}
export function stepTier(price: number, p0: number, direction: Direction, boundaries: number[]): number {
  const displacement = (direction === 'up' ? 1 : -1) * (price - p0);
  let tier = 0;
  while (tier < 4 && displacement >= Math.round(boundaries[tier] * p0)) tier++;
  return tier;
}
export function settleTicket(ticket: PaperTicket, ticks: Tick[], now: number, complete = true): PaperTicket {
  if (ticket.status !== 'open') return ticket;
  const expiry = ticket.kind === 'beats' ? ticket.window!.end : ticket.acceptedAt + ticket.horizon! * 1000;
  if (now < expiry) return ticket;
  if (!complete) return { ...ticket, status: 'void', payout: ticket.stake, settledAt: now };
  if (ticket.kind === 'beats') {
    const evidence = hitBand(ticks, ticket.band!, ticket.window!, ticket.convention!, { t: ticket.acceptedAt, p: ticket.p0, id: 'locked-initial' });
    return { ...ticket, status: evidence ? 'won' : 'lost', payout: evidence ? Math.floor(ticket.stake * ticket.odds[0] * 100 + 1e-7) / 100 : 0, evidence, settledAt: now };
  }
  let terminal: Tick = { t: ticket.acceptedAt, p: ticket.p0, id: 'locked-initial' };
  for (const tick of ticks) { if (tick.t <= expiry) terminal = tick; else break; }
  const tier = stepTier(terminal.p, ticket.p0, ticket.direction!, ticket.boundaries!);
  return { ...ticket, status: tier > 0 ? 'won' : 'lost', payout: tier ? Math.floor(ticket.stake * ticket.odds[tier - 1] * 100 + 1e-7) / 100 : 0, evidence: terminal, tier, settledAt: now };
}
