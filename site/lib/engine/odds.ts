/** Explicit product policy: maximize sum log of four successive payout increments.
 * Coherent TV stress distributions; every constraint is rechecked after cent rounding.
 * This objective is a declared choice, not an empirically optimal user preference.
 */
export const ODDS_POLICY = { id: 'equal-log-increments-v1', budget: .94, minimum: 1.01, increment: .01, cap: 50 } as const;
const dot = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0);
export function worstDistribution(p: number[], radius: number): number[] {
  if (p.length !== 5 || p.some(v => !Number.isFinite(v) || v < 0) || Math.abs(p.reduce((a, b) => a + b, 0) - 1) > 1e-8 || !Number.isFinite(radius) || radius < 0 || radius > 1) throw new Error('Invalid probability distribution or TV radius');
  const q = [...p]; let remaining = Math.min(radius, 1 - q[4]);
  for (let i = 0; i < 4 && remaining > 0; i++) { const moved = Math.min(q[i], remaining); q[i] -= moved; q[4] += moved; remaining -= moved; }
  return q;
}
export function robustExpectation(distributions: number[][], odds: number[], radius: number): number {
  return Math.max(...distributions.map(p => dot(worstDistribution(p, radius).slice(1), odds)));
}
function solve(matrix: number[][], rhs: number[]): number[] | null {
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < 4; col++) {
    let pivot = col;
    for (let i = col + 1; i < 4; i++) if (Math.abs(a[i][col]) > Math.abs(a[pivot][col])) pivot = i;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    if (!Number.isFinite(a[col][col]) || Math.abs(a[col][col]) < 1e-18) return null;
    const scale = a[col][col]; for (let j = col; j <= 4; j++) a[col][j] /= scale;
    for (let i = 0; i < 4; i++) if (i !== col) { const factor = a[i][col]; for (let j = col; j <= 4; j++) a[i][j] -= factor * a[col][j]; }
  }
  return a.map(row => row[4]);
}
export function optimizeOdds(distributions: number[][], radius: number, quality?: { distribution: number[]; minimum: number }): { odds: number[]; robustRtp: number; optimalityGap: number; increments: number[] } | null {
  if (!distributions.length) throw new Error('No probability scenarios');
  const lower = [ODDS_POLICY.minimum, .01, .01, .01];
  const a = distributions.map(p => { const q = worstDistribution(p, radius); return [1, 2, 3, 4].map(i => q.slice(i).reduce((sum, v) => sum + v, 0)); });
  const b: number[] = a.map(() => ODDS_POLICY.budget);
  a.push([1, 1, 1, 1]); b.push(ODDS_POLICY.cap);
  for (let i = 0; i < 4; i++) { a.push([0, 1, 2, 3].map(j => i === j ? -1 : 0)); b.push(-lower[i]); }
  const initialRoom = Math.min(...a.slice(0, -4).map((row, i) => (b[i] - dot(row, lower)) / Math.max(1, row.reduce((sum, v) => sum + v, 0))));
  if (initialRoom <= 1e-10) return null;
  let x = lower.map(v => v + Math.min(.1, initialRoom / 2));
  if (quality) {
    const nominal = worstDistribution(quality.distribution, 0);
    if (!Number.isFinite(quality.minimum) || quality.minimum < 0 || quality.minimum >= ODDS_POLICY.budget) throw new Error('Invalid minimum expected return policy');
    const coefficients = [1, 2, 3, 4].map(k => nominal.slice(k).reduce((s, p) => s + p, 0));
    // Reserve enough return for downward cent rounding. Four variables permit
    // exhaustive LP vertices to construct a strictly feasible barrier start.
    const target = quality.minimum + .01 * (1 - nominal[0]);
    if (dot(coefficients, x) <= target) {
      let best: number[] | null = null, maximum = -Infinity;
      for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) for (let k = j + 1; k < a.length; k++) for (let l = k + 1; l < a.length; l++) {
        const indices = [i, j, k, l], vertex = solve(indices.map(n => a[n]), indices.map(n => b[n]));
        if (vertex && a.every((row, n) => dot(row, vertex) <= b[n] + 1e-10) && dot(coefficients, vertex) > maximum) { maximum = dot(coefficients, vertex); best = vertex; }
      }
      if (!best || maximum <= target + 1e-8) return null;
      const alpha = ((maximum + target) / 2 - dot(coefficients, x)) / (maximum - dot(coefficients, x));
      x = x.map((v, i) => v * (1 - alpha) + best![i] * alpha);
    }
    a.push(coefficients.map(v => -v)); b.push(-target);
  }
  const objective = (v: number[], weight: number) => {
    const slacks = a.map((row, i) => b[i] - dot(row, v));
    if (v.some(d => d <= 0) || slacks.some(s => s <= 0)) return Infinity;
    return -weight * v.reduce((sum, d) => sum + Math.log(d), 0) - slacks.reduce((sum, s) => sum + Math.log(s), 0);
  };
  let converged = false;
  for (let weight = 1; weight <= 1e6; weight *= 10) {
    converged = false;
    for (let iteration = 0; iteration < 80; iteration++) {
      const gradient = x.map(d => -weight / d), hessian = x.map((d, i) => x.map((_, j) => i === j ? weight / (d * d) : 0));
      for (let k = 0; k < a.length; k++) {
        const slack = b[k] - dot(a[k], x);
        for (let i = 0; i < 4; i++) { gradient[i] += a[k][i] / slack; for (let j = 0; j < 4; j++) hessian[i][j] += a[k][i] * a[k][j] / (slack * slack); }
      }
      const direction = solve(hessian, gradient.map(g => -g));
      if (!direction) return null;
      const slope = dot(gradient, direction);
      if (-slope / (2 * weight) < 1e-10) { converged = true; break; }
      let step = 1; const before = objective(x, weight);
      while (step > 1e-14 && objective(x.map((v, i) => v + step * direction[i]), weight) > before + .01 * step * slope) step *= .5;
      if (step <= 1e-14) { converged = -slope / (2 * weight) < 1e-9; break; }
      x = x.map((v, i) => v + step * direction[i]);
    }
    if (!converged) return null;
  }
  let total = 0;
  const odds = x.map(d => { total += d; return Math.floor((total + 1e-10) * 100) / 100; });
  const robustRtp = robustExpectation(distributions, odds, radius);
  if (odds[0] < ODDS_POLICY.minimum || odds[3] > ODDS_POLICY.cap || odds.some((v, i) => !Number.isFinite(v) || (i > 0 && v <= odds[i - 1])) || robustRtp > ODDS_POLICY.budget + 1e-10 || (quality && dot(quality.distribution.slice(1), odds) < quality.minimum - 1e-10)) return null;
  return { odds, robustRtp, optimalityGap: a.length / 1e6, increments: x };
}
