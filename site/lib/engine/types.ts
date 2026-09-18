export type Asset = 'BTC_USDT' | 'ETH_USDT' | 'XAU_USDT' | 'LOWVOL_SIM';
export type Direction = 'up' | 'down';
export type Convention = 'trade' | 'carried';
export type Tick = { t: number; p: number; id: string; sourceTime?: string; sequence?: string; receivedAt?: number; amount?: string; side?: 'buy' | 'sell'; priceChangedAt?: number; quietCensored?: boolean };
export type Feature = { activity: number; volatility: number; age: number; momentum: number; quietAge: number; quietCensored: boolean; zeroChangeShare: number };
export type HistoricalPath = { at: number; f: Feature; dt: number[]; returns: number[] };
export type CalibrationBin = { end: number; p: number; upper: number; anchors: number; hours: number; rows: number };
export type CalibrationCurve = { bins: CalibrationBin[]; fallback?: string };
export type CalibrationModel = { version: string; weights: Record<string, number>; curves: Record<string, CalibrationCurve>; fittedUntil: number; riskUntil: number };
export type Library = {
  asset: Asset; precision: number; tickUnits?: number; paths: HistoricalPath[];
  featureScale: number[]; volatilityFloor: number; jumpLimit: number;
  calibrationBuffer: number; trainedUntil: number; calibratedUntil: number;
  modelVersion?: string; uncertainty?: Record<string, number>;
  calibration?: CalibrationModel;
  stepGeometry?: 'positive-quartiles-v3';
};
export type Band = { lower: number; upper: number };
export type Window = { start: number; end: number };
export type BeatCell = {
  row: number; col: number; p: number; baselineP: number; upperP: number; odds: number | null;
  count: number; reason: string | null; rawP?: number; calibrationGroup?: string;
};
export type StepQuote = {
  direction: Direction; horizon: number; boundaries: number[]; probabilities: number[]; baselineProbabilities: number[];
  odds: number[] | null; rawRtp: number; robustRtp: number; reason: string | null; buffer: number; policy: string;
  rawProbabilities?: number[]; riskProbabilities?: number[];
};
export type Snapshot = {
  asset: Asset; asOf: number; sourceId: string; price: number; precision: number;
  version: string; mode: 'replay' | 'live'; convention: Convention;
  bands: Band[]; windows: Window[]; cells: BeatCell[]; steps: StepQuote[];
  feature: Feature; sigma: number; volatilityFloor: number; width: number; buffer: number;
  sampleCount: number; distance: number; supportDistance: number; computeMs: number;
  status: 'ready' | 'paused'; reason: string | null;
  chart: { t: number; price: number }[];
};
export type ModelInput = {
  asset: Asset; now: number; history: Tick[]; convention: Convention;
  mode: 'replay' | 'live'; version: string;
};
export type PaperTicket = {
  id: string; quoteVersion: string; asset: Asset; kind: 'beats' | 'steps';
  acceptedAt: number; stake: number; p0: number; precision: number;
  band?: Band; window?: Window; convention?: Convention;
  direction?: Direction; horizon?: number; boundaries?: number[];
  odds: number[]; status: 'open' | 'won' | 'lost' | 'void'; payout: number;
  settledAt?: number; evidence?: { t: number; p: number; id: string }; tier?: number;
  contractVersion?: string; modelVersion?: string; sourceId?: string; mode?: 'live' | 'replay'; replayId?: string; settlementReason?: string;
};
