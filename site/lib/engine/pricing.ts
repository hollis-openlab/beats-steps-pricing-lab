import type { BeatCell, Feature, HistoricalPath, Library, ModelInput, PaperTicket, Snapshot, StepQuote, Tick } from './types.ts';
import { dot, floorOdds, quantile } from './math.ts';
import { hitBand, stepTier } from './settlement.ts';
import { optimizeOdds, robustExpectation, ODDS_POLICY } from './odds.ts';
import { calibratedProbability, scoreKey, mixture, exceedanceDistribution } from './calibration.ts';

export const CONFIG = { rtp: ODDS_POLICY.budget, minOdds: ODDS_POLICY.minimum, maxOdds: ODDS_POLICY.cap, rows: 24, cols: 36, widthMs: 5000, neighbors: 128, minHits: 3, minimumExpectedRtp: .80, horizons: [120, 180, 300] } as const;
export function features(history: Tick[], now: number): Feature {
  const last = history.at(-1);
  if (!last) throw new Error('No past trade available');
  let count = 0, same = 0, variance = 0, prior = history[0].p, first = prior;
  let changedAt = history[0].priceChangedAt ?? history[0].t, censored = history[0].quietCensored ?? true;
  for (const tick of history) {
    if (tick.t > now) throw new Error('Future trade entered model features');
    if (tick.t >= now - 60_000) {
      const r = Math.log(tick.p / prior); variance += r * r; count++; if (tick.p === prior) same++;
    } else first = tick.p;
    if (tick.p !== prior) { changedAt = tick.t; censored = false; }
    if (tick.priceChangedAt !== undefined) { if (tick.priceChangedAt > tick.t) throw new Error('Future price change timestamp'); changedAt = tick.priceChangedAt; censored = tick.quietCensored ?? false; }
    prior = tick.p;
  }
  return { activity: count / 60, volatility: Math.sqrt(variance / 60), age: Math.max(0, (now - last.t) / 1000), momentum: Math.log(last.p / first), quietAge: Math.max(0, (now - changedAt) / 1000), quietCensored: censored, zeroChangeShare: count ? same / count : 1 };
}
export function vector(f: Feature): number[] {
  return [Math.log1p(f.activity), Math.log(Math.max(1e-9, f.volatility)), Math.log1p(f.age), f.momentum, Math.log1p(f.quietAge ?? f.age), f.zeroChangeShare ?? 0];
}
export function uncertaintyRadius(library: Library, product: 'beats' | 'steps', f: Feature, horizon?: number): number {
  const key = product === 'beats' ? 'beats' : `steps:${horizon}`;
  const state = f.quietAge >= 10 ? 'quiet' : 'active';
  return library.uncertainty?.[`${key}:${state}`] ?? library.uncertainty?.[key] ?? library.calibrationBuffer;
}
export function selectPaths(library: Library, f: Feature, count = CONFIG.neighbors): { local: HistoricalPath[]; global: HistoricalPath[]; distance: number; supportDistance: number } {
  const v = vector(f);
  const ranked = library.paths.map((path, index) => {
    const u = vector(path.f);
    return { index, score: u.slice(0, library.featureScale.length).reduce((s, x, i) => s + (i === 3 ? 0.25 : 1) * ((x - v[i]) / library.featureScale[i]) ** 2, 0) };
  }).sort((a, b) => a.score - b.score || a.index - b.index);
  const n = Math.min(count, ranked.length);
  return {
    local: ranked.slice(0, n).map(x => library.paths[x.index]),
    global: Array.from({ length: n }, (_, i) => library.paths[Math.floor(i * library.paths.length / n)]),
    distance: Math.sqrt(ranked[0]?.score ?? Infinity),
    supportDistance: Math.sqrt(ranked[Math.max(0, Math.ceil(n * .9) - 1)]?.score ?? Infinity),
  };
}
type Projection = { dt: number[]; prices: number[]; terminal: number[] };
function project(path: HistoricalPath, p0: number, scale: number): Projection {
  const prices = path.returns.map(r => Math.max(1, Math.round(p0 * Math.exp(r * scale))));
  let k = 0, p = p0;
  const terminal = CONFIG.horizons.map(horizon => {
    while (k < path.dt.length && path.dt[k] <= horizon * 1000) p = prices[k++];
    return p / p0 - 1;
  });
  return { dt: path.dt, prices, terminal };
}
export function makeSnapshot(library: Library, input: ModelInput): Snapshot {
  const start = performance.now();
  const history = input.history.filter(t => t.t <= input.now);
  const last = history.at(-1);
  if (!last) throw new Error('Cannot quote without historical price');
  const f = features(history, input.now), selected = selectPaths(library, f);
  // A causal volatility floor prevents zero-width grids in a quiet market.
  const sigma = Math.max(f.volatility, library.volatilityFloor);
  const tick = library.tickUnits ?? 1;
  const width = Math.max(2 * tick, Math.round(last.p * sigma * Math.sqrt(5) * 0.8 / tick) * tick);
  const origin = Math.round(last.p / tick) * tick - Math.floor(width / (2 * tick)) * tick - CONFIG.rows / 2 * width;
  const bands = Array.from({ length: CONFIG.rows }, (_, row) => ({ lower: origin + row * width, upper: origin + (row + 1) * width }));
  const windows = Array.from({ length: CONFIG.cols }, (_, col) => ({ start: input.now + (col + 1) * CONFIG.widthMs, end: input.now + (col + 2) * CONFIG.widthMs }));
  const components = [selected.local.map(p => project(p, last.p, 1)), selected.global.map(p => project(p, last.p, 1)), selected.local.map(p => project(p, last.p, 1.5))];
  const size = CONFIG.rows * CONFIG.cols;
  const counts = components.map(paths => {
    const hits = new Uint32Array(size), stamp = new Int32Array(size).fill(-1);
    paths.forEach((path, sample) => {
      const touch = (p: number, col: number) => {
        const row = Math.floor((p - origin) / width), cell = row * CONFIG.cols + col;
        if (row >= 0 && row < CONFIG.rows && col >= 0 && col < CONFIG.cols && stamp[cell] !== sample) { hits[cell]++; stamp[cell] = sample; }
      };
      for (let k = 0; k < path.dt.length; k++) {
        const col = Math.floor(path.dt[k] / CONFIG.widthMs) - 1;
        if (col >= CONFIG.cols) break;
        touch(path.prices[k], col);
      }
      if (input.convention === 'carried') {
        let k = 0, price = last.p;
        for (let col = 0; col < CONFIG.cols; col++) {
          while (k < path.dt.length && path.dt[k] <= (col + 1) * CONFIG.widthMs) price = path.prices[k++];
          touch(price, col);
        }
      }
    });
    return hits;
  });
  const n = selected.local.length;
  // Use the carried price AT the lookback boundary. The first trade after it
  // may itself be the jump out of a quiet spell and must not become the baseline.
  let past5 = history[0];
  for (const tick of history) { if (tick.t <= input.now - 5000) past5 = tick; else break; }
  const recentJump = Math.abs(Math.log(last.p / past5.p));
  const reason = n < 64 ? '历史样本不足' : selected.supportDistance > 6 ? '整组历史邻居不足以支持当前状态' : recentJump > library.jumpLimit ? '短时跳跃超过训练阈值，暂停报价' : null;
  const beatsBuffer = uncertaintyRadius(library, 'beats', f);
  const cells: BeatCell[] = [];
  for (let row = 0; row < CONFIG.rows; row++) for (let col = 0; col < CONFIG.cols; col++) {
    const i = row * CONFIG.cols + col, rawP = counts[0][i] / n;
    const model = library.calibration, key = scoreKey('beats', input.convention, (col + 1) * 5);
    const score = model ? mixture(rawP, counts[1][i] / n, model.weights[`beats:${input.convention}`]) : rawP;
    const calibrated = model ? calibratedProbability(model, key, f, score) : null;
    const p = calibrated?.p ?? rawP;
    const upperP = library.modelVersion === 'conditional-event-path-v4' || library.modelVersion === 'conditional-event-path-v5' ? Math.max(calibrated!.upper, counts[0][i] / n, counts[1][i] / n) : calibrated?.upper ?? Math.min(1, Math.max(...counts.map(c => c[i] / n)) + beatsBuffer);
    const proposed = floorOdds(Math.min(CONFIG.maxOdds, CONFIG.rtp / upperP));
    // A nominal return target is not a risk constraint. The V4 80% filter
    // made every longer-horizon carried contract permanently unavailable.
    // V5 prices supported contracts against the unchanged conservative budget.
    const why = reason ?? (model && library.modelVersion !== 'conditional-event-path-v5' && p * proposed < CONFIG.minimumExpectedRtp ? '估计返还率不足 80%，暂停低价值报价' : calibrated && !calibrated.supported ? '该概率区间缺少独立时段校准支持' : score * n < CONFIG.minHits ? '局部样本触碰不足 3 条，拒绝外推尾部赔率' : upperP * CONFIG.minOdds > CONFIG.rtp ? '最低赔率无法满足赔付预算' : null);
    cells.push({ row, col, p, baselineP: counts[1][i] / n, upperP, odds: why ? null : proposed, count: counts[0][i], reason: why, rawP, calibrationGroup: calibrated?.group });
  }
  const steps: StepQuote[] = [];
  for (const direction of ['up', 'down'] as const) for (let hi = 0; hi < CONFIG.horizons.length; hi++) {
    const horizon = CONFIG.horizons[hi], sign = direction === 'up' ? 1 : -1;
    // Each boundary is an integer price displacement / the frozen initial price.
    let previous = 0;
    const levels = library.stepGeometry ? [0, .25, .5, .75] : [.6, .8, .93, .99];
    const boundaries = levels.map(level => {
      // Four equally populated positive-move tiers before legal-tick rounding.
      // This is an explicit equal-frequency geometry objective, not arbitrary
      // rare-tail percentiles; all scenario thresholds remain causal.
      const absoluteReturn = Math.max(...components.map(paths => quantile(library.stepGeometry ? paths.map(p => sign * p.terminal[hi]).filter(r => r > 0) : paths.map(p => Math.abs(p.terminal[hi])), level)));
      const displacement = Math.max(previous + tick, Math.ceil(last.p * absoluteReturn / tick) * tick);
      previous = displacement; return displacement / last.p;
    });
    const distributions = components.map(paths => {
      const ps = [0, 0, 0, 0, 0];
      for (const path of paths) {
        const r = sign * path.terminal[hi];
        let tier = 0;
        // Compare integer deltas to avoid equality lost through division.
        const displacement = Math.round(r * last.p);
        while (tier < 4 && displacement >= Math.round(boundaries[tier] * last.p)) tier++;
        ps[tier]++;
      }
      return ps.map(p => p / n);
    });
    const model = library.calibration;
    const calibrated = model ? [1, 2, 3, 4].map(k => calibratedProbability(model, scoreKey('steps', input.convention, horizon), f, mixture(distributions[0].slice(k).reduce((a, b) => a + b, 0), distributions[1].slice(k).reduce((a, b) => a + b, 0), model.weights.steps))) : null;
    // Jeffreys half-count regularization preserves all five exclusive tiers.
    const probabilities = model ? distributions[0].map((p, k) => (mixture(p, distributions[1][k], model.weights.steps) * n + .5) / (n + 2.5)) : distributions[0];
    const riskProbabilities = calibrated ? exceedanceDistribution(calibrated.map((c, i) => Math.max(c.upper, probabilities.slice(i + 1).reduce((a, b) => a + b, 0), ...(['conditional-event-path-v4', 'conditional-event-path-v5'].includes(library.modelVersion ?? '') ? distributions.slice(0, 2).map(p => p.slice(i + 1).reduce((a, b) => a + b, 0)) : [])))) : undefined;
    const buffer = calibrated ? Math.max(...calibrated.map(c => c.upper - c.p)) : uncertaintyRadius(library, 'steps', f, horizon);
    const solution = calibrated?.some(c => !c.supported) ? null : optimizeOdds(riskProbabilities ? [riskProbabilities] : distributions, riskProbabilities ? 0 : buffer, model ? { distribution: probabilities, minimum: CONFIG.minimumExpectedRtp } : undefined);
    const proposed = solution?.odds ?? [0, 0, 0, 0];
    const why = reason ?? (!solution ? '递增赔率、保守预算与最低估计返还率未能同时满足' : null);
    steps.push({ direction, horizon, boundaries, probabilities, baselineProbabilities: distributions[1], odds: why ? null : proposed, rawRtp: dot(probabilities.slice(1), proposed), robustRtp: solution?.robustRtp ?? 0, reason: why, buffer, policy: ODDS_POLICY.id, rawProbabilities: distributions[0], riskProbabilities });
  }
  const chart: Snapshot['chart'] = [];
  let second = -1;
  for (const t of history) {
    const key = Math.floor(t.t / 1000), point = { t: t.t, price: t.p / 10 ** library.precision };
    if (key === second) chart[chart.length - 1] = point; else { chart.push(point); second = key; }
  }
  return { asset: input.asset, asOf: input.now, sourceId: last.id, price: last.p, precision: library.precision, version: input.version, mode: input.mode, convention: input.convention, bands, windows, cells, steps, feature: f, sigma, volatilityFloor: library.volatilityFloor, width, buffer: library.calibration ? Math.max(...cells.map(c => c.upperP - c.p)) : beatsBuffer, sampleCount: n, distance: selected.distance, supportDistance: selected.supportDistance, computeMs: performance.now() - start, status: reason ? 'paused' : 'ready', reason, chart };
}
/** Evaluate a frozen contract at acceptance using only the latest known past.
 * The board's old absolute band/window and displayed payouts stay unchanged.
 */
export function frozenRtp(library: Library, input: ModelInput, ticket: PaperTicket): number {
  const last = input.history.at(-1);
  if (!last) return Infinity;
  const f = features(input.history, input.now), chosen = selectPaths(library, f);
  if (chosen.local.length < 64 || chosen.supportDistance > 6) return Infinity;
  let preceding = input.history[0];
  for (const tick of input.history) { if (tick.t <= input.now - 5000) preceding = tick; else break; }
  if (Math.abs(Math.log(last.p / preceding.p)) > library.jumpLimit) return Infinity;
  const radius = uncertaintyRadius(library, ticket.kind, f, ticket.horizon);
  const components = [[chosen.local, 1], [chosen.global, 1], [chosen.local, 1.5]] as const;
  const distributions: number[][] = [], hitRates: number[] = [];
  for (const [paths, scale] of components) {
    let hits = 0; const outcomes = [0, 0, 0, 0, 0];
    for (const path of paths) {
      const transformed = project(path, last.p, scale);
      if (ticket.kind === 'beats') {
        const ticks = transformed.dt.map((dt, i) => ({ t: input.now + dt, p: transformed.prices[i], id: String(i) }));
        if (hitBand(ticks, ticket.band!, ticket.window!, ticket.convention!, { t: input.now, p: last.p, id: 'initial' })) hits++;
      } else {
        const i = CONFIG.horizons.indexOf(ticket.horizon as 120 | 180 | 300);
        const terminal = Math.round(last.p * (1 + transformed.terminal[i]));
        outcomes[stepTier(terminal, ticket.p0, ticket.direction!, ticket.boundaries!)]++;
      }
    }
    distributions.push(outcomes.map(v => v / paths.length)); hitRates.push(hits / paths.length);
  }
  const model = library.calibration;
  if (!model) return ticket.kind === 'steps' ? robustExpectation(distributions, ticket.odds, radius) : Math.min(1, Math.max(...hitRates) + radius) * ticket.odds[0];
  if (ticket.kind === 'beats') {
    const score = mixture(hitRates[0], hitRates[1], model.weights[`beats:${ticket.convention}`]);
    const c = calibratedProbability(model, scoreKey('beats', ticket.convention!, (ticket.window!.start - input.now) / 1000), f, score);
    return c.supported && score * chosen.local.length >= CONFIG.minHits && (library.modelVersion === 'conditional-event-path-v5' || c.p * ticket.odds[0] >= CONFIG.minimumExpectedRtp) ? Math.max(c.upper, ...(['conditional-event-path-v4', 'conditional-event-path-v5'].includes(library.modelVersion ?? '') ? hitRates.slice(0, 2) : [])) * ticket.odds[0] : Infinity;
  }
  const cs = [1, 2, 3, 4].map(k => calibratedProbability(model, scoreKey('steps', input.convention, ticket.horizon!), f, mixture(distributions[0].slice(k).reduce((a, b) => a + b, 0), distributions[1].slice(k).reduce((a, b) => a + b, 0), model.weights.steps)));
  const n = chosen.local.length, nominal = distributions[0].map((p, k) => (mixture(p, distributions[1][k], model.weights.steps) * n + .5) / (n + 2.5));
  const risk = exceedanceDistribution(cs.map((c, i) => Math.max(c.upper, nominal.slice(i + 1).reduce((a, b) => a + b, 0), ...(['conditional-event-path-v4', 'conditional-event-path-v5'].includes(library.modelVersion ?? '') ? distributions.slice(0, 2).map(p => p.slice(i + 1).reduce((a, b) => a + b, 0)) : []))));
  return cs.every(c => c.supported) && dot(nominal.slice(1), ticket.odds) >= CONFIG.minimumExpectedRtp - 1e-10 ? dot(risk.slice(1), ticket.odds) : Infinity;
}
