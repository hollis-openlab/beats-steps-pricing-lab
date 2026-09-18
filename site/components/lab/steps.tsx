'use client';

import { useState } from 'react';
import { ArrowDownRight, ArrowUpRight, LockKeyhole } from 'lucide-react';
import type { Direction } from '@/lib/engine/types';
import { money, pct, thresholdPct, useLab } from './provider';
import { Card, EmptyQuote, Heading, Metric, PriceChart, Tickets } from './common';
import { ScenarioControls } from './scenarios';

const tierColors = ['#dce4e7', '#b5ded3', '#77bea9', '#388e7a', '#165c50'];

export function StepsPage() {
  const { snapshot, asset, bet } = useLab();
  const [direction, setDirection] = useState<Direction>('up'), [horizon, setHorizon] = useState(120);
  const [stake, setStake] = useState(10), [pending, setPending] = useState(false), [message, setMessage] = useState('');
  const quote = snapshot?.steps.find(value => value.direction === direction && value.horizon === horizon);
  const margin = quote?.riskProbabilities ? Math.max(...[1, 2, 3, 4].map(k => quote.riskProbabilities!.slice(k).reduce((a, b) => a + b, 0) - quote.probabilities.slice(k).reduce((a, b) => a + b, 0))) : quote?.buffer ?? 0;
  const accept = async () => {
    if (!snapshot) return;
    setPending(true);
    try {
      const ticket = await bet({ asset, version: snapshot.version, kind: 'steps', stake, direction, horizon });
      setMessage(`已锁定合约 ${ticket.id.slice(0, 8)}，${horizon} 秒后结算`);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setPending(false); }
  };

  return <>
    <Heading title="Steps" />
    <ScenarioControls />
    <div className="steps-controls card">
      <div><span className="control-label" id="direction-label">方向</span><div className="segmented" role="group" aria-labelledby="direction-label">{(['up', 'down'] as Direction[]).map(value => <button key={value} className={direction === value ? 'selected' : ''} aria-pressed={direction === value} onClick={() => { setDirection(value); setMessage(''); }}>
        {value === 'up' ? <ArrowUpRight size={17} /> : <ArrowDownRight size={17} />}{value === 'up' ? '看涨' : '看跌'}
      </button>)}</div></div>
      <div><span className="control-label" id="horizon-label">期限</span><div className="segmented" role="group" aria-labelledby="horizon-label">{[120, 180, 300].map(value => <button key={value} className={horizon === value ? 'selected' : ''} aria-pressed={horizon === value} onClick={() => { setHorizon(value); setMessage(''); }}>{value} 秒</button>)}</div></div>
    </div>
    <PriceChart />
    {quote && snapshot ? <>
      <div className="section-label"><span>{direction === 'up' ? '到期涨幅' : '到期跌幅'}</span><span>赔率含本金</span></div>
      <div className="tier-cards">{quote.boundaries.map((boundary, index) => <div className={`tier-card tier-${index}`} key={index}>
        <div className="tier-top">第 {index + 1} 档</div>
        <h2>{index === 3 ? `≥ ${thresholdPct(boundary)}` : `[${thresholdPct(boundary)}, ${thresholdPct(quote.boundaries[index + 1])})`}</h2>
        <div className="tier-prob"><span>{direction === 'up' ? '价格 ≥' : '价格 ≤'}</span><b>{money((snapshot.price + (direction === 'up' ? 1 : -1) * Math.round(boundary * snapshot.price)) / 10 ** snapshot.precision, snapshot.precision)}</b></div>
        <div className="tier-odds">{quote.odds?.[index].toFixed(2) ?? '—'}<small>×</small></div>
        <div className="tier-prob"><span>概率</span><b>{pct(quote.probabilities[index + 1], 2)}</b></div>
        <div className="tier-prob"><span>命中赔付</span><b>{quote.odds ? money(stake * quote.odds[index]) : '—'}</b></div>
      </div>)}</div>
      <div className="two-columns">
        <Card title="到期概率">
          <div className="probability-stack">{quote.probabilities.map((probability, index) => <div key={index} style={{ flex: Math.max(probability, .002), background: tierColors[index] }} title={`${index === 0 ? '未达标' : `第 ${index} 档`} ${pct(probability)}`}>{probability > .1 && pct(probability, 0)}</div>)}</div>
          <div className="distribution-rows">{quote.probabilities.map((probability, index) => <div key={index}><span><i style={{ background: tierColors[index] }} />{index === 0 ? '未达标（0 倍）' : `第 ${index} 档`}</span><b>{pct(probability, 2)}</b></div>)}</div>
        </Card>
        <Card title="模拟合约">
          <div className="metric-grid two compact"><Metric label="预期赔付率" value={pct(quote.rawRtp, 2)} /><Metric label="保守赔付率" value={pct(quote.robustRtp, 2)} /></div>
          <p className="action-note">门槛按同方向历史变动样本分档，以价格门槛为准；价格不变属于未达标。{asset === 'LOWVOL_SIM' ? '虚拟标的仅用于静市测试，概率和安全余量未经真实市场校准。' : `保守赔付率已计入最高 ${pct(margin, 2)} 的安全余量。`}</p>
          <label className="stake-label">虚拟本金<input type="number" min={1} max={100} step={1} value={stake} onChange={event => setStake(Number(event.target.value))} /></label>
          <button className="primary-button full" disabled={!quote.odds || pending || stake < 1 || stake > 100 || !Number.isInteger(stake)} onClick={() => void accept()}><LockKeyhole size={16} />{pending ? '提交中…' : `锁定模拟合约 · ${direction === 'up' ? '看涨' : '看跌'} ${horizon} 秒`}</button>
          {quote.reason && <p className="inline-message">{quote.reason}</p>}{message && <p role="status" className="inline-message">{message}</p>}
        </Card>
      </div>
    </> : <EmptyQuote />}
    <Tickets />
  </>;
}
