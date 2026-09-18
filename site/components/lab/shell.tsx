'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, Grid2X2, Layers3, Pause, Play, Radio } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useLab, dateTime } from './provider';
import { PRODUCT_ASSETS, assetInfo, defaultCase } from '@/lib/assets';
import type { Asset } from '@/lib/engine/types';

const navigation = [
  { href: '/beats', title: 'Beats', icon: Grid2X2 },
  { href: '/steps', title: 'Steps', icon: Layers3 },
];

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname(), lab = useLab(), [message, setMessage] = useState(''), [switching, setSwitching] = useState(false);
  const simulated = lab.asset === 'LOWVOL_SIM';
  const control = async (body: Record<string, unknown>) => {
    try { await lab.control(body); setMessage(''); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  const selectAsset = async (asset: Asset) => {
    setSwitching(true);
    try { await lab.setAsset(asset); setMessage(''); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setSwitching(false); }
  };
  return <div className="app-shell">
    <aside className="sidebar">
      <Link href="/beats" className="brand"><span className="brand-symbol"><Activity size={22} /></span>赔率工作台</Link>
      <nav aria-label="主导航">{navigation.map(item => <Link href={item.href} className={`nav-item ${pathname === item.href ? 'active' : ''}`} aria-current={pathname === item.href ? 'page' : undefined} key={item.href}><item.icon size={18} /><span>{item.title}</span></Link>)}</nav>
    </aside>
    <div className="workspace">
      <main id="main-content">
        <div className="global-controls">
          <div className="asset-tabs" role="group" aria-label="标的">{PRODUCT_ASSETS.map(asset => <button key={asset} onClick={() => void selectAsset(asset)} disabled={switching} className={lab.asset === asset ? 'selected' : ''} aria-pressed={lab.asset === asset}>
            <span className={`coin ${assetInfo[asset].className}`}>{assetInfo[asset].symbol}</span>{assetInfo[asset].name}{asset !== 'LOWVOL_SIM' && <span className="quote-currency">/ USDT</span>}
          </button>)}</div>
          <div className="mode-controls">
            <span className={`connection-dot ${lab.connected ? 'connected' : ''}`} role="status" aria-label={lab.connected ? '服务已连接' : '服务未连接'} />
            {simulated ? <span className="subtle-badge">合成行情</span> : <select aria-label="行情模式" value={lab.state?.health.mode ?? 'replay'} onChange={event => void control({ mode: event.target.value, ...(event.target.value === 'replay' ? { caseId: defaultCase(lab.asset) } : {}) })}><option value="replay">历史回放</option><option value="live">实时行情</option></select>}
            {lab.state?.health.mode === 'replay' ? <button className="icon-button" aria-label={lab.state.health.playing ? '暂停回放' : '继续回放'} onClick={() => void control({ playing: !lab.state?.health.playing })}>{lab.state.health.playing ? <Pause size={15} /> : <Play size={15} />}</button> : <Radio size={16} className="green" />}
            <span className="clock">{lab.state ? `${dateTime(lab.state.health.now)} UTC` : '等待行情'}</span>
          </div>
        </div>
        {(lab.error || message) && <div role="status" className="notice warning">{message || lab.error}</div>}
        {Boolean(lab.state?.health.warmupSeconds) && <div role="status" className="notice">行情预热中，剩余 {lab.state?.health.warmupSeconds} 秒。</div>}
        {lab.state?.health.mode === 'live' && !(lab.state.health.assetHealth?.[lab.asset] ?? lab.state.health.healthy) && !lab.state.health.warmupSeconds && <div role="status" className="notice warning">行情未就绪，暂停接单。</div>}
        {children}
      </main>
      <footer><span>模拟交易</span><span>UTC 时间</span></footer>
    </div>
  </div>;
}
