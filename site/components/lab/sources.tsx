'use client';
import { useEffect, useState } from 'react';
import { Card } from './common';
import { dateTime } from './provider';
type Quote = { symbol: string; bid?: string; ask?: string; marketStatus?: string; receivedAt: number; error?: string };
export function SourceEvidence() {
  const [quotes, setQuotes] = useState<Quote[]>(), [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/lab/sources', { signal: controller.signal }).then(r => { if (!r.ok) throw new Error('Source unavailable'); return r.json(); }).then(r => setQuotes(r.quotes)).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, []);
  return <Card title="外汇与贵金属数据接入核验" subtitle="Gate TradFi 公共报价快照；与 BTC / ETH 成交流分开显示">
    <div className="table-scroll"><table><thead><tr><th>标的</th><th>买价 / 卖价</th><th>市场状态</th><th>获取时间 UTC</th></tr></thead><tbody>
      {quotes?.map(q => <tr key={q.symbol}><td>{q.symbol}</td><td>{q.error ? '暂时不可用' : `${q.bid} / ${q.ask}`}</td><td>{q.marketStatus === 'open' ? '开市' : q.marketStatus ?? '—'}</td><td>{dateTime(q.receivedAt)}</td></tr>)}
      {!quotes && <tr><td colSpan={4}>{error ? '行情源暂时不可用' : '正在核验公共行情…'}</td></tr>}
    </tbody></table></div>
    <p className="action-note">这些是买卖报价快照，不能证明两个快照之间从未变价，因此不参与 5 秒触碰结算。完整逐笔数据接入保留 MT5 导出与校验入口；当前没有把外汇报价当成成交价，也没有给它套用加密货币模型。</p>
    <p className="source-line"><a href="https://www.gate.com/docs/developers/apiv4/en/cfd/" target="_blank" rel="noreferrer">Gate TradFi 官方接口</a> · <a href="https://www.mql5.com/en/docs/series/copyticksrange" target="_blank" rel="noreferrer">MT5 历史逐笔接口</a></p>
  </Card>;
}
