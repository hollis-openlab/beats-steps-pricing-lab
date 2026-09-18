'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Asset, PaperTicket, Snapshot } from '@/lib/engine/types';
import { ASSETS, defaultCase } from '@/lib/assets';

export type Health = { mode: 'replay' | 'live'; convention: 'trade' | 'carried'; now: number; speed: number; playing: boolean; replayId: string; replayEnd: number; liveConnected: boolean; liveAgeMs: number; warmupSeconds: number; healthy: boolean; assetHealth?: Partial<Record<Asset, boolean>>; engineError: string | null; workerReady: boolean; rejected: number; openLiability: number; ledger?: { userCents: number; houseCents: number; reservedCents: number; availableHouseCents: number }; recoveryCounts?: { attempted: number; completed: number; failed: number; recoveredTrades: number }; pendingCorrections?: number; liveIssues?: Partial<Record<Asset, string>> };
type State = { snapshots: Partial<Record<Asset, Snapshot>>; health: Health; tickets: PaperTicket[]; corrections?: { id: string; ticketId: string; status: string; deltaCents: number; reason: string }[] };
type LabContextValue = { asset: Asset; setAsset: (a: Asset) => Promise<void>; snapshot?: Snapshot; state?: State; connected: boolean; error: string | null; control: (c: Record<string, unknown>) => Promise<void>; bet: (body: Record<string, unknown>) => Promise<PaperTicket>; refresh: () => Promise<void> };
const Context = createContext<LabContextValue | null>(null);
export function LabProvider({ children }: { children: ReactNode }) {
  const [asset, changeAsset] = useState<Asset>('BTC_USDT');
  const [state, setState] = useState<State>();
  const [connected, setConnected] = useState(false), [error, setError] = useState<string | null>(null);
  const fetching = useRef(false);
  const refresh = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const response = await fetch('/api/lab/snapshot', { signal: AbortSignal.timeout(4000), cache: 'no-store' });
      if (!response.ok) throw new Error('定价服务未连接');
      const body = await response.json(); setState(body); setConnected(true); setError(null);
    } catch { setConnected(false); setError('定价服务未连接，正在重试…'); }
    finally { fetching.current = false; }
  }, []);
  useEffect(() => { const initial = setTimeout(() => void refresh(), 0); const timer = setInterval(() => void refresh(), 1000); return () => { clearTimeout(initial); clearInterval(timer); }; }, [refresh]);
  const activeAsset = state?.health.mode === 'replay' ? ASSETS.find(a => state.health.replayId.startsWith(`${a}-`)) ?? asset : asset === 'LOWVOL_SIM' ? 'BTC_USDT' : asset;
  const control = useCallback(async (c: Record<string, unknown>) => {
    const response = await fetch('/api/lab/control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(c) });
    const body = await response.json(); if (!response.ok) throw new Error(body.error);
    if (c.mode === 'live') changeAsset(activeAsset === 'LOWVOL_SIM' ? 'BTC_USDT' : activeAsset);
    await refresh();
  }, [refresh, activeAsset]);
  const setAsset = async (a: Asset) => {
    if (a === activeAsset) return;
    if (a === 'LOWVOL_SIM' || state?.health.mode === 'replay') {
      const scenario = state?.health.replayId.slice(activeAsset.length + 1);
      const caseId = a !== 'LOWVOL_SIM' && scenario && ['ordinary', 'quiet', 'jump'].includes(scenario) ? `${a}-${scenario}` : defaultCase(a);
      await control({ mode: 'replay', caseId, playing: true, speed: 1 });
    }
    changeAsset(a);
  };
  const bet = async (body: Record<string, unknown>) => {
    // A transport retry, including after reload, reuses the exact request.
    const key = 'paper-bet-pending-v1';
    const saved = sessionStorage.getItem(key);
    const payload = saved ? JSON.parse(saved) : { ...body, requestId: crypto.randomUUID() };
    sessionStorage.setItem(key, JSON.stringify(payload));
    for (let attempt = 0; attempt < 2; attempt++) {
      let response: Response;
      try { response = await fetch('/api/lab/bet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(5000) }); }
      catch { if (attempt === 0) continue; throw new Error('提交结果尚未确认；再次点击将核对原请求，请先查看合约记录。'); }
      if (response.status >= 500) { if (attempt === 0) continue; throw new Error('服务暂时不可用；原请求已保留，恢复后点击重试。'); }
      const result = await response.json(); sessionStorage.removeItem(key);
      if (!response.ok) throw new Error(result.error); await refresh(); return result.ticket;
    }
    throw new Error('提交结果尚未确认');
  };
  return <Context.Provider value={{ asset: activeAsset, setAsset, state, snapshot: state?.snapshots[activeAsset], connected, error, control, bet, refresh }}>{children}</Context.Provider>;
}
export function useLab() { const value = useContext(Context); if (!value) throw new Error('Missing LabProvider'); return value; }
export const money = (n: number, digits = 2) => n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const pct = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`;
// Keep a positive legal-tick threshold visibly positive, even below 0.001%.
export const thresholdPct = (n: number) => n > 0 && n * 100 < .001 ? `${(n * 100).toPrecision(2)}%` : pct(n, 3);
export const dateTime = (n: number, seconds = true) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'UTC', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hour12: false }).format(n);
export const fullDateTime = (n: number) => new Date(n).toISOString().slice(0, 19).replace('T', ' ');
