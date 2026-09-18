'use client';
import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { scenarioInfo } from '@/lib/assets';
import { fullDateTime, useLab } from './provider';
import { useStudy } from './study';

export function ScenarioControls() {
  const { asset, state, control } = useLab(), { study } = useStudy();
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  if (state?.health.mode !== 'replay') return null;
  const order = Object.keys(scenarioInfo);
  const cases = study?.replayCases.filter(c => c.asset === asset && scenarioInfo[c.name]).sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name)) ?? [];
  const selected = cases.find(c => c.id === state.health.replayId), info = selected ? scenarioInfo[selected.name] : undefined;
  const change = async (body: Record<string, unknown>) => {
    setPending(true);
    try { await control(body); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setPending(false); }
  };
  return <section className={`scenario-panel ${asset === 'LOWVOL_SIM' ? 'simulation-panel' : ''}`} aria-label="行情场景">
    <div className="scenario-controls">
      <label>场景<select aria-label="行情场景" disabled={pending || !cases.length} value={state.health.replayId} onChange={e => void change({ caseId: e.target.value, playing: true })}>{cases.map(c => <option value={c.id} key={c.id}>{scenarioInfo[c.name].name}</option>)}</select></label>
      <label>速度<select aria-label="播放速度" disabled={pending} value={state.health.speed} onChange={e => void change({ speed: Number(e.target.value) })}><option value={1}>1 倍</option><option value={5}>5 倍</option><option value={30}>30 倍</option></select></label>
      <button className="text-button" disabled={pending} onClick={() => void change({ caseId: state.health.replayId, playing: true })}><RotateCcw size={13} />从头播放</button>
      {asset === 'LOWVOL_SIM' && <span className="simulation-tag">虚拟标的 · 非真实市场数据</span>}
    </div>
    {selected && <p className="replay-range"><b>{selected.synthetic ? '模拟区间' : '历史回放区间'}</b><span><time dateTime={new Date(selected.start).toISOString()}>{fullDateTime(selected.start)}</time> — <time dateTime={new Date(selected.end).toISOString()}>{fullDateTime(selected.end)}</time> UTC</span></p>}
    {asset === 'XAU_USDT' && <p>数据来源：Gate XAU_USDT 黄金永续</p>}
    {info?.description && <p>{info.description}{asset === 'LOWVOL_SIM' && ' 这里的胜率只用于模拟，不代表外汇或贵金属的真实胜率。'}</p>}
    {state.tickets.some(t => t.status === 'open') && <p>切换标的或场景会退还未结算的模拟本金。</p>}
    {error && <p role="status" className="red">{error}</p>}
  </section>;
}
