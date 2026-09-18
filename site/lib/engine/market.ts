/** Parse decimal prices to legal integer ticks without binary rounding. */
export function priceUnits(value: string, precision: number): number {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error('Invalid decimal price');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.slice(precision).replaceAll('0', '')) throw new Error('Price is off tick');
  const units = Number(whole) * 10 ** precision + Number(fraction.slice(0, precision).padEnd(precision, '0'));
  if (!Number.isSafeInteger(units) || units <= 0) throw new Error('Price exceeds safe tick representation');
  return units;
}
/** Keep the original timestamp alongside this millisecond working coordinate.
 * Preserve which side of an integer-ms boundary a fractional event belongs to.
 */
export function eventTimeNs(value: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(value)) throw new Error('Invalid trade timestamp');
  const [ms, fraction = ''] = value.split('.');
  const result = BigInt(ms) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  if (result <= 0n) throw new Error('Invalid trade timestamp');
  return result;
}
export function eventTime(value: string): number {
  eventTimeNs(value);
  const [ms, fraction = ''] = value.split('.');
  const base = Number(ms), part = Number(`0.${fraction || '0'}`);
  if (!Number.isSafeInteger(base) || base <= 0) throw new Error('Invalid trade timestamp');
  const ulp = 2 ** (Math.floor(Math.log2(base)) - 52);
  if (ulp >= 1) throw new Error('Timestamp exceeds working clock precision');
  return part === 0 ? base : Math.min(base + 1 - ulp, Math.max(base + ulp, base + part));
}
