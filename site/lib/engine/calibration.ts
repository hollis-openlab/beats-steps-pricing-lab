import type { CalibrationCurve, CalibrationModel, Feature } from './types.ts';

export const scoreKey = (product: 'beats' | 'steps', convention: string, horizon: number) =>
  product === 'beats' ? `beats:${convention}:${Math.min(2, Math.floor(Math.max(0, horizon - 5) / 60))}` : `steps:${horizon}`;

export function curveAt(curve: CalibrationCurve | undefined, score: number): { p: number; upper: number; supported: boolean } {
  if (!curve?.bins.length || !Number.isFinite(score)) return { p: Math.max(0, Math.min(1, score || 0)), upper: 1, supported: false };
  const bin = curve.bins.find(b => score <= b.end) ?? curve.bins.at(-1)!;
  return { p: bin.p, upper: bin.upper, supported: bin.anchors >= 32 && bin.hours >= 8 };
}

export function calibratedProbability(model: CalibrationModel, key: string, f: Feature, score: number) {
  const conditional = `${key}:${f.quietAge >= 10 ? 'quiet' : 'active'}`;
  const name = model.curves[conditional] ? conditional : key;
  return { ...curveAt(model.curves[name], score), group: name };
}

/** Ordered exceedance bounds define a coherent distribution, maximizing every
 * increasing payout simultaneously. This does not assume independent tiers. */
export function exceedanceDistribution(probabilities: number[]): number[] {
  const q = probabilities.map(p => Math.max(0, Math.min(1, p)));
  // Raise earlier bounds rather than reducing any individual upper bound.
  for (let i = q.length - 2; i >= 0; i--) q[i] = Math.max(q[i], q[i + 1]);
  return [1 - q[0], ...q.slice(0, -1).map((p, i) => p - q[i + 1]), q.at(-1)!];
}

export const mixture = (local: number, global: number, weight: number) => weight * local + (1 - weight) * global;
