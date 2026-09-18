'use client';

import { Clock3 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { PaperTicket } from '@/lib/engine/types';
import { dateTime, money, thresholdPct, useLab } from './provider';
import { LinePlot } from './charts';
import { useStudy } from './study';
import { assetInfo } from '@/lib/assets';

export function Heading({ title, aside }: { title: string; aside?: ReactNode }) {
  return <div className="page-heading"><h1>{title}</h1>{aside}</div>;
}

export function Card({ title, subtitle, children, action, className = '' }: { title: string; subtitle?: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return <section className={`card ${className}`}><div className="card-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>{children}</section>;
}

export function Metric({ label, value }: { label: string; value: ReactNode }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

export function PriceChart() {
  const { snapshot, asset, state } = useLab(), { study } = useStudy();
  const replayCase = state?.health.mode === 'replay' ? study?.replayCases.find(value => value.id === state.health.replayId) : undefined;
  const points = snapshot?.chart.map(point => ({ x: point.t, y: point.price })) ?? [];
  if (snapshot && points.length && points.at(-1)!.x < snapshot.asOf) points.push({ x: snapshot.asOf, y: points.at(-1)!.y });
  const quiet = snapshot && replayCase?.quietStart !== undefined && replayCase.quietEnd !== undefined && snapshot.asOf > replayCase.quietStart ? { start: replayCase.quietStart, end: Math.min(replayCase.quietEnd, snapshot.asOf) } : undefined;
  return <Card title="成交价格" action={snapshot ? <div className="current-price">{money(snapshot.price / 10 ** snapshot.precision, snapshot.precision)}<span>{assetInfo[asset].unit}</span></div> : null}>
    {quiet && <div className="chart-legend"><i aria-hidden="true" />浅黄色：成交价未变时段（已回放部分）</div>}
    <LinePlot points={points} eventAt={replayCase?.eventAt} highlight={quiet} height={150} step digits={snapshot?.precision ?? 2} label={`${asset.split('_')[0]} 成交价格`} />
    <div className="chart-footer"><span>{asset === 'LOWVOL_SIM' ? '低波动模拟 · 非真实市场数据' : replayCase?.synthetic ? '合成压力场景 · 非真实市场数据' : `Gate${asset === 'XAU_USDT' ? ' 黄金永续' : ''} · ${snapshot?.mode === 'live' ? '实时行情' : '历史行情'}`}</span><span>{snapshot ? `${dateTime(snapshot.asOf)} UTC` : '等待行情'}</span></div>
    {snapshot && <div className="chart-footer"><span>距上笔成交 {snapshot.feature.age.toFixed(1)} 秒</span><span>同价持续 {snapshot.feature.quietCensored ? '≥ ' : ''}{snapshot.feature.quietAge.toFixed(1)} 秒</span><span>{snapshot.mode === 'replay' ? '回放数据已载入' : (state?.health.assetHealth?.[asset] ?? state?.health.healthy) ? '行情连接可用' : '行情覆盖待核对'}</span></div>}
    {state?.health.liveIssues?.[asset] && <p role="status" className="notice warning">{state.health.liveIssues[asset]}；接单已暂停，原合约等待完整证据。</p>}
  </Card>;
}

export function EmptyQuote() {
  const { state, connected } = useLab();
  return <div className="empty-state"><Clock3 size={26} /><h3>{connected ? '正在生成报价…' : '等待行情连接…'}</h3>{state?.health.engineError && <p>{state.health.engineError}</p>}{state?.health.liveIssues && <p>{Object.values(state.health.liveIssues).join('；')}</p>}</div>;
}

export function Tickets() {
  const { state } = useLab();
  const tickets = state?.tickets ?? [];
  return <Card title="模拟合约记录" action={<span className="subtle-badge">{tickets.length} 笔</span>}>
    <div className="table-scroll"><table>
      <thead><tr><th>合约</th><th>锁定时间</th><th>赔率（含本金）</th><th>本金</th><th>状态</th><th>原始赔付</th><th>差额更正</th></tr></thead>
      <tbody>{tickets.length ? tickets.map(ticket => <tr key={ticket.id}>
        <td><TicketDetails ticket={ticket} /></td><td>{dateTime(ticket.acceptedAt)}</td>
        <td>{ticket.odds.map(odds => odds.toFixed(2)).join(' / ')}</td><td>{ticket.stake}</td>
        <td><span className={`pill ${ticket.status === 'won' ? 'green' : ticket.status === 'lost' ? 'red' : ''}`}>{({ open: '待结算', won: '命中', lost: '未命中', void: '已退款' })[ticket.status]}</span>{ticket.tier !== undefined && <small>第 {ticket.tier} 档</small>}</td>
        <td>{ticket.status === 'open' ? '—' : money(ticket.payout)}{ticket.evidence && <small title={`成交编号 ${ticket.evidence.id}`}>结算价 {money(ticket.evidence.p / 10 ** ticket.precision, ticket.precision)}</small>}</td>
        <td>{state?.corrections?.filter(c => c.ticketId === ticket.id).map(c => <small key={c.id} title={c.reason}>{c.status === 'applied' ? '已入账更正' : '待审核更正'} {c.deltaCents >= 0 ? '+' : ''}{money(c.deltaCents / 100)}</small>)}</td>
      </tr>) : <tr><td colSpan={7} className="empty-table">暂无合约</td></tr>}</tbody>
    </table></div>
  </Card>;
}

function TicketDetails({ ticket }: { ticket: PaperTicket }) {
  const price = (value: number) => money(value / 10 ** ticket.precision, ticket.precision);
  return <details className="ticket-detail">
    <summary><b>{assetInfo[ticket.asset].name} · {ticket.kind === 'beats' ? 'Beats' : `Steps ${ticket.direction === 'up' ? '看涨' : '看跌'} ${ticket.horizon} 秒`}</b><small>{ticket.id.slice(0, 8)}</small></summary>
    <div><p>合约规则：{ticket.contractVersion ?? '历史版本'}</p><p>模型版本：{ticket.modelVersion ?? '历史版本'}</p><p>报价版本：{ticket.quoteVersion}</p><p>起始价格：{price(ticket.p0)}</p>
      {ticket.kind === 'beats' ? <><p>价带：[{price(ticket.band!.lower)}, {price(ticket.band!.upper)})</p><p>窗口：{dateTime(ticket.window!.start)} — {dateTime(ticket.window!.end)}</p><p>结算口径：{ticket.convention === 'carried' ? '末笔价格延续' : '窗口内新成交'}</p></> : <><p>收益边界（近似）：{ticket.boundaries!.map(thresholdPct).join(' / ')}</p><p>价格门槛：{ticket.boundaries!.map(boundary => price(ticket.p0 + (ticket.direction === 'up' ? 1 : -1) * Math.round(boundary * ticket.p0))).join(' / ')}</p><p>到期时间：{dateTime(ticket.acceptedAt + ticket.horizon! * 1000)}</p></>}
      {ticket.settlementReason && <p>结算说明：{ticket.settlementReason}</p>}
      {ticket.evidence && <><p>结算参考时间：{dateTime(ticket.evidence.t)}</p><p>成交编号：{ticket.evidence.id}</p></>}
    </div>
  </details>;
}
