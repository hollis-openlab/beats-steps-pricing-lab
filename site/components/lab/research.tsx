'use client';

import { Download } from 'lucide-react';
import { Card, Metric } from './common';
import { money, pct, useLab } from './provider';
import { assetInfo, type MarketAsset } from '@/lib/assets';

type Score = { brier: number; baselineBrier: number; quoteAvailability: number; violations: number };
type Result = { convention: string; snapshots: number; beats: Score; steps: Score; strategies: { name: string; rtp: number | null; quoted: number }[] };
export type ResearchReport = {
  modelVersion: string; period: number[]; independent: boolean;
  assets: Record<MarketAsset, { source: { name: string; start: number; end: number; trades: number; quietSeconds: number }; results: Result[] }>;
};
const day = (at: number) => new Date(at).toISOString().slice(0, 10);

export function DataValidation({ report }: { report: ResearchReport }) {
  const { asset } = useLab();
  const data = report.assets[asset === 'LOWVOL_SIM' ? 'XAU_USDT' : asset];
  const result = data.results.find(r => r.convention === 'carried')!;
  const comparisons = [{ name: 'Beats', ...result.beats }, { name: 'Steps', ...result.steps }];
  const returns = [
    { label: '随机选择', value: result.strategies.find(s => s.name === 'uniformQuoted')?.rtp },
    { label: '按基线预期收益挑单', value: result.strategies.find(s => s.name === 'maximumBaseline')?.rtp },
  ];
  const returnScale = Math.max(1, ...returns.map(r => r.value ?? 0));
  return <details className="data-validation" id="data-validation">
    <summary>数据验证</summary>
    <div className="data-validation-content">
    <div className="data-validation-toolbar">
      <p>{assetInfo[asset].name} · 历史诊断区间：{day(report.period[0])} 00:00 — {day(report.period[1])} 00:00 UTC · 末笔价格延续</p>
      <a className="secondary-button" href="/docs/正式提交答案.md" download><Download size={14} />正式答案</a>
    </div>
    <Card title="数据覆盖" subtitle={`${data.source.name} · ${day(data.source.start)} 至 ${day(data.source.end)} UTC`}>
      <div className="metric-grid compact evidence-metrics">
        <Metric label="真实历史成交" value={`${money(data.source.trades / 10000, 1)} 万笔`} />
        <Metric label="最长完整同价时段" value={`${money(data.source.quietSeconds, 1)} 秒`} />
        <Metric label="历史诊断时点" value={money(result.snapshots, 0)} />
      </div>
    </Card>
    <Card title="预测误差" subtitle="Brier 评分越低越好；灰色为同一合约的整体历史基线，绿色为当前模型。">
      <div className="score-comparisons">{comparisons.map(c => <div className="score-comparison" key={c.name}>
        <div><b>{c.name}</b><span>误差{c.brier <= c.baselineBrier ? '降低' : '增加'} {pct(Math.abs(c.baselineBrier - c.brier) / c.baselineBrier, 2)}</span></div>
        <div className="comparison-row"><span>历史基线</span><div className="comparison-track"><i style={{ width: `${c.baselineBrier / Math.max(c.baselineBrier, c.brier) * 100}%` }} /></div><small>{c.baselineBrier.toFixed(5)}</small></div>
        <div className="comparison-row current"><span>当前模型</span><div className="comparison-track"><i style={{ width: `${c.brier / Math.max(c.baselineBrier, c.brier) * 100}%` }} /></div><small>{c.brier.toFixed(5)}</small></div>
      </div>)}</div>
    </Card>
    <Card title="历史赔付" subtitle="等额投入；每分钟从可报价的 Beats 与 Steps 中选一份合约。">
      <div className="return-comparisons">{returns.map(r => <div className="return-comparison" key={r.label}>
        <div><b>{r.label}</b><span>每投入 100，平均返还 <strong>{r.value == null ? '无记录' : money(r.value * 100)}</strong></span></div>
        <div className="return-track" role="img" aria-label={`${r.label}：每投入 100，平均返还 ${r.value == null ? '无记录' : money(r.value * 100)}`}><i style={{ width: `${(r.value ?? 0) / returnScale * 100}%` }} /></div>
      </div>)}</div>
      <p className="evidence-note">按历史成交直接结算，未计网络延迟。这是已观察历史上的诊断，不能证明未来收益；94% 是模型预算。</p>
    </Card>
    <details className="research-details"><summary>报价覆盖与完整结果</summary>
      <div className="table-scroll"><table><thead><tr><th>产品 / 口径</th><th>可报价比例</th><th>模型预算超限</th></tr></thead><tbody>
        {data.results.map(r => <tr key={r.convention}><td>Beats · {r.convention === 'carried' ? '末笔价格延续' : '窗口内新成交'}</td><td>{pct(r.beats.quoteAvailability)}</td><td>{r.beats.violations}</td></tr>)}
        <tr><td>Steps</td><td>{pct(result.steps.quoteAvailability)}</td><td>{result.steps.violations}</td></tr>
      </tbody></table></div>
      <a href="/data/v5-diagnostic.json" download className="text-button">下载三标的、两种口径的完整结果</a>
    </details>
    </div>
  </details>;
}
