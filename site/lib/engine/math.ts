export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
export const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
export function quantile(a: number[], q: number): number {
  if (!a.length) return 0;
  const sorted = a.slice().sort((x, y) => x - y);
  const x = clamp(q, 0, 1) * (sorted.length - 1), lo = Math.floor(x);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (x - lo);
}
export function lowerBound(a: ArrayLike<number>, value: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (a[mid] < value) lo = mid + 1; else hi = mid; }
  return lo;
}
export function upperBound(a: ArrayLike<number>, value: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (a[mid] <= value) lo = mid + 1; else hi = mid; }
  return lo;
}
export function normalCdf(x: number): number {
  const a = Math.abs(x), t = 1 / (1 + 0.2316419 * a);
  const s = Math.exp(-a * a / 2) / Math.sqrt(2 * Math.PI) * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - s : s;
}
/** Zero-drift continuous Brownian benchmark. Not actual-trade settlement. */
export function brownianTouch(lo: number, hi: number, start: number, width: number, sigma: number): number {
  if (sigma <= 0) return lo <= 0 && 0 < hi ? 1 : 0;
  // Simpson integration over the N(0, sigma² start) starting position.
  const n = 160, bound = 8, dz = 2 * bound / n;
  let total = 0;
  for (let i = 0; i <= n; i++) {
    const z = -bound + i * dz, x = sigma * Math.sqrt(start) * z;
    const hit = x < lo ? 2 * normalCdf(-(lo - x) / (sigma * Math.sqrt(width))) : x >= hi ? 2 * normalCdf(-(x - hi) / (sigma * Math.sqrt(width))) : 1;
    total += (i === 0 || i === n ? 1 : i % 2 ? 4 : 2) * hit * Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
  }
  return clamp(total * dz / 3, 0, 1);
}
/** All odds are gross payouts, floored in integer hundredths. */
export function floorOdds(x: number): number { return Math.floor((x + 1e-10) * 100) / 100; }
export const dot = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i], 0);
