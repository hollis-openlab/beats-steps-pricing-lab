/** Local operator actions. No unauthenticated HTTP money-adjustment endpoint. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { PaperLedger } from './ledger.mts';
import { reconcileTicks, settlementCovered } from './recovery.mts';
import { settleTicket } from '../lib/engine/settlement.ts';
import type { Tick } from '../lib/engine/types.ts';
const ledger = new PaperLedger(process.env.PAPER_LEDGER_PATH ?? fileURLToPath(new URL('../../.run/paper-ledger.sqlite', import.meta.url)));
const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'audit') console.log(JSON.stringify(ledger.audit(), null, 2));
  else if (command === 'backup' && args[0]) console.log(JSON.stringify({ file: resolve(args[0]), audit: ledger.backup(resolve(args[0])) }, null, 2));
  else if (command === 'corrections') console.log(JSON.stringify({ audit: ledger.audit(), corrections: ledger.corrections() }, null, 2));
  else if (command === 'propose' && args.length >= 3) {
    const ticket = ledger.tickets().find(t => t.id === args[0]);
    if (!ticket) throw new Error('Unknown ticket');
    const raw = readFileSync(resolve(args[1])), ticks = reconcileTicks([], JSON.parse(raw.toString()) as Tick[], []);
    const expiry = ticket.kind === 'beats' ? ticket.window!.end : ticket.acceptedAt + ticket.horizon! * 1000;
    if (ticks[0]?.t > ticket.acceptedAt || !settlementCovered(ticks, expiry, Date.now(), true)) throw new Error('Evidence does not span the locked contract');
    const result = settleTicket({ ...ticket, status: 'open' }, ticks, Date.now(), true);
    const id = ledger.proposeCorrection(ticket.id, result, args.slice(2).join(' '), createHash('sha256').update(raw).digest('hex'));
    console.log(JSON.stringify({ proposed: id, audit: ledger.audit(), corrections: ledger.corrections() }, null, 2));
  } else if (command === 'apply' && args.length === 3) {
    ledger.applyCorrection(args[0], args[1], args[2]); console.log(JSON.stringify(ledger.audit(), null, 2));
  } else throw new Error('Usage: ops.mts audit | backup <new-file> | corrections | propose <ticket-id> <verified-ticks.json> <reason> | apply <correction-id> <reviewed-head-hash> <operator>');
} finally { ledger.close(); }
