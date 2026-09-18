import type { Asset } from './engine/types';

export type MarketAsset = 'BTC_USDT' | 'ETH_USDT' | 'XAU_USDT';
export const ASSETS: Asset[] = ['BTC_USDT', 'ETH_USDT', 'XAU_USDT', 'LOWVOL_SIM'];
export const PRODUCT_ASSETS: Asset[] = ['BTC_USDT', 'ETH_USDT', 'XAU_USDT'];
export const MARKET_ASSETS: MarketAsset[] = ['BTC_USDT', 'ETH_USDT', 'XAU_USDT'];
export const REPLAY_DURATION_MS = 15 * 60_000;
export const assetInfo = {
  BTC_USDT: { name: 'BTC', symbol: '₿', unit: 'USDT', className: 'btc' },
  ETH_USDT: { name: 'ETH', symbol: 'Ξ', unit: 'USDT', className: 'eth' },
  XAU_USDT: { name: '黄金', symbol: 'Au', unit: 'USDT', className: 'btc' },
  LOWVOL_SIM: { name: '低波动模拟', symbol: '≈', unit: '点', className: 'quiet' },
} satisfies Record<Asset, { name: string; symbol: string; unit: string; className: string }>;

export const scenarioInfo: Record<string, { name: string; description: string }> = {
  ordinary: { name: '常态行情', description: '' },
  quiet: { name: '静市行情', description: '' },
  jump: { name: '跳跃行情', description: '真实成交中的突变片段，观察报价何时暂停和恢复。' },
  'lowvol': { name: '小幅波动', description: '虚拟标的，多数时间价格保持不动，偶尔移动几个最小价位。' },
  'flat': { name: '长时间不动', description: '已连续横盘近两小时。价格不动不等于行情断线，也不代表每个格子都能报价。' },
  'shock': { name: '静市后跳变', description: '从跳变前 20 秒开始，观察价格突然跳过价带，以及系统暂停报价的过程。' },
};
export const defaultCase = (asset: Asset) => `${asset}-${asset === 'LOWVOL_SIM' ? 'lowvol' : 'ordinary'}`;
