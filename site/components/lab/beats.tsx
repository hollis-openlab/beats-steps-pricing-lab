'use client';

import { useState } from 'react';
import { ArrowDown, LockKeyhole } from 'lucide-react';
import { CONFIG } from '@/lib/engine/pricing';
import { dateTime, money, pct, useLab } from './provider';
import { Card, EmptyQuote, Heading, PriceChart, Tickets } from './common';
import { ScenarioControls } from './scenarios';
import { assetInfo } from '@/lib/assets';

export function BeatsPage() {
  const { snapshot, asset, state, control, bet } = useLab();
  const [selected, setSelected] = useState({ row: 12, col: 0 }), [stake, setStake] = useState(10);
  const [message, setMessage] = useState(''), [pending, setPending] = useState(false);
  const cell = snapshot?.cells[selected.row * CONFIG.cols + selected.col];
  const band = snapshot?.bands[selected.row], window = snapshot?.windows[selected.col];
  const accept = async () => {
    if (!snapshot) return;
    setPending(true);
    try {
      const ticket = await bet({ asset, version: snapshot.version, kind: 'beats', stake, ...selected });
      setMessage(`已锁定合约 ${ticket.id.slice(0, 8)}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setPending(false); }
  };

  return <>
    <Heading title="Beats" />
    <ScenarioControls />
    <PriceChart />
    <div className="board-layout">
      <Card title="赔率板" action={<div className="board-legend"><span />高概率 <span />低概率</div>}>
        <div className="board-toolbar">
          <label htmlFor="settlement-convention">结算口径</label>
          <select id="settlement-convention" value={state?.health.convention ?? 'carried'} onChange={event => void control({ convention: event.target.value }).catch(error => setMessage(error instanceof Error ? error.message : String(error)))}>
            <option value="carried">末笔价格延续</option><option value="trade">窗口内新成交</option>
          </select>
        </div>
        {snapshot ? <div className="board-scroll"><div className="odds-board" role="group" aria-label="价带与时间窗赔率板">
          <div className="board-time-row"><span className="axis-corner">价格 / {assetInfo[asset].unit} <ArrowDown size={12} /></span>{snapshot.windows.map((_, col) => <span key={col}>+{(col + 1) * 5}秒</span>)}</div>
          {snapshot.bands.toReversed().map((value, reverse) => {
            const row = CONFIG.rows - 1 - reverse;
            return <div className={`board-row ${row === 12 ? 'at-price' : ''}`} key={row}>
              <span className="band-label">{money(value.lower / 10 ** snapshot.precision, snapshot.precision)}{row === 12 && <i>当前价</i>}</span>
              {snapshot.cells.slice(row * CONFIG.cols, (row + 1) * CONFIG.cols).map(quote => <button
                key={quote.col}
                onClick={() => { setSelected({ row, col: quote.col }); setMessage(''); }}
                aria-label={`价带 ${row} 时间窗 ${quote.col}，${quote.odds === null ? '暂停报价' : `${quote.odds.toFixed(2)} 倍`}`}
                aria-pressed={selected.row === row && selected.col === quote.col}
                className={`odds-cell ${selected.row === row && selected.col === quote.col ? 'chosen' : ''} ${quote.odds === null ? 'unavailable' : ''}`}
                style={quote.odds !== null ? { backgroundColor: `hsl(163 ${25 + quote.p * 25}% ${96 - quote.p * 52}%)`, color: quote.p > 0.65 ? '#fff' : '#195e52' } : undefined}
                title={quote.reason ?? `触碰概率 ${pct(quote.p)}`}
              >{quote.odds === null ? '—' : quote.odds.toFixed(2)}</button>)}
            </div>;
          })}
        </div></div> : <EmptyQuote />}
        <div className="board-footnote"><span>赔率含本金</span><span>— 暂停报价</span></div>
      </Card>
      <aside className="quote-inspector"><Card title="合约详情" action={<LockKeyhole size={17} />}>
        {snapshot && cell && band && window ? <>
          <div className="contract-band"><span>触碰价带 / {assetInfo[asset].unit}</span><strong>[{money(band.lower / 10 ** snapshot.precision, snapshot.precision)}, {money(band.upper / 10 ** snapshot.precision, snapshot.precision)})</strong></div>
          <dl className="detail-list">
            <div><dt>未来窗口</dt><dd>+{(selected.col + 1) * 5} — +{(selected.col + 2) * 5} 秒</dd></div>
            <div><dt>开始时间</dt><dd>{dateTime(window.start).split(' ')[1]}</dd></div>
            <div><dt>估计中奖概率</dt><dd>{pct(cell.p, 2)}</dd></div>
            <div><dt>报价采用的保守概率</dt><dd>{pct(cell.upperP, 2)}</dd></div>
            <div><dt>该合约安全余量</dt><dd>{pct(cell.upperP - cell.p, 2)}</dd></div>
          </dl>
          <div className="odds-feature"><span>赔率（含本金）</span><strong>{cell.odds?.toFixed(2) ?? '暂停'}{cell.odds !== null && <small>×</small>}</strong>{cell.reason && <p>{cell.reason}</p>}</div>
          <label className="stake-label">虚拟本金<input type="number" min={1} max={100} step={1} value={stake} onChange={event => setStake(Number(event.target.value))} /></label>
          <button className="primary-button full" onClick={() => void accept()} disabled={!cell.odds || pending || stake < 1 || stake > 100 || !Number.isInteger(stake)}><LockKeyhole size={15} />{pending ? '提交中…' : '锁定模拟合约'}</button>
          <div className="expected-payout">命中赔付 <b>{cell.odds ? money(stake * cell.odds) : '—'}</b></div>
        </> : <p className="muted-text">等待行情…</p>}
        {message && <div role="status" className="inline-message">{message}</div>}
      </Card></aside>
    </div>
    <Tickets />
  </>;
}
