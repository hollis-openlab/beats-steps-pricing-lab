'use client';
import { useEffect, useState } from 'react';
import type { Asset } from '@/lib/engine/types';
export type Strategy = { name: string; attempted: number; accepted: number; rejectionRate: number | null; rtp: number | null; rtpInterval: number[] | null; housePnl: number; maxDrawdown: number; curve: { t: number; pnl: number }[] };
export type AssetStudy = {
  precision: number; trainingPaths: number; calibrationForecasts: number; testForecasts: number;
  statistics: { trades: number; start: number; end: number; zeroMarkRate: number; unchangedSecondRate: number; noTradeSecondRate: number; gapSeconds: { p50: number; p95: number; p99: number; max: number }; daily: { date: string; count: number }[]; returnsHistogram: { label: string; count: number }[]; quietMax: number; quietAt: number; quietStart: number; trulyUnchangedSecondRate: number; roundTripSeconds: number; quietCounts: { atLeast60: number; atLeast120: number; atLeast300: number }; jump: number; jumpAt: number };
  safety: { buffer: number; beats: number; steps: number };
  metrics: { model: string; beats: { brier: number; logLoss: number; count: number }; steps: { brier: number; logLoss: number; count: number } }[];
  calibration: { label: string; predicted: number; observed: number; count: number; lower: number; upper: number }[];
  stepsCalibration: { tier: number; predicted: number; observed: number }[];
  strategies: Strategy[]; quoteAvailability: number;
};
export type Study = {
  currentValidation?: { results: { asset: Asset; convention: string; snapshots: number; beats: { brier: number; baselineBrier: number; quoteAvailability: number; violations: number; qualityViolations: number }; steps: { brier: number; baselineBrier: number; quoteAvailability: number; violations: number; qualityViolations: number }; strategies: { name: string; rtp: number | null; quoted: number }[] }[] };
  currentCalibration?: { centerFit: number[]; riskFit: number[]; assets: Record<Asset, { weights: Record<string, number>; curves: number }> };
  currentFrozen?: Study['currentValidation'];
  currentBenchmark?: { trials: number; p50Ms: number; p95Ms: number; maxMs: number; runtime: string; cpu: string };
  freshValidation?: { results: { asset: Asset; snapshots: number; beats: { count: number; brier: number; baselineBrier: number; quoted: number; violations: number }; steps: { count: number; brier: number; baselineBrier: number; violations: number }; strategies: { name: string; rtp: number | null }[] }[] };
  generatedAt: string; dataset: { start: number; trainEnd: number; calibrationEnd: number; testStart: number; end: number }; assets: Record<Asset, AssetStudy>;
  benchmark: { runtime: string; cpu: string; trials: number; p50Ms: number; p95Ms: number; maxMs: number; cellsPerAsset: number; stepsPerAsset: number };
  replayCases: { id: string; asset: Asset; name: string; start: number; end: number; eventAt: number; count: number; selectedAfterObservation: boolean; synthetic?: boolean; quietStart?: number; quietEnd?: number }[];
};
let cached: Study | undefined, pending: Promise<Study> | undefined;
export function useStudy() {
  const [study, setStudy] = useState<Study | undefined>(cached), [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!pending) pending = fetch('/data/study.json').then(r => { if (!r.ok) throw new Error('Study unavailable'); return r.json() as Promise<Study>; }).then(s => { cached = s; return s; });
    pending.then(s => { if (alive) setStudy(s); }).catch(() => { pending = undefined; if (alive) setError(true); });
    return () => { alive = false; };
  }, []);
  return { study, error };
}
export const strategyNames: Record<string, string> = { uniform: '均匀选择', quiet: '静市择时', momentum: '顺势择时', alternative: '替代模型挑单' };
export const modelNames: Record<string, string> = { p: '条件历史路径', base: '无条件历史路径', brownian: '连续布朗基准' };
