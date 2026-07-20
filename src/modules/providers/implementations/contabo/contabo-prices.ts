// Contabo pricing snapshot (EUR). Monthly-term (1-month) prices; annual12 is the
// longer-term price (~20% less: 12-month for VPS, 24-month for VDS). No setup fee.
// Covers the shared VPS line and the dedicated-vCPU VDS line ("Max Performance").
// Refresh: node scripts/update-contabo-prices.mjs

export interface ContaboPlanPrice {
  /** Real price when billed one month at a time (EUR/mo). */
  monthly: number;
  /** Per-month price on the longest advertised term (~20% less), or null if unknown. */
  annual12: number | null;
}

export const CONTABO_PRICES_FETCHED_AT = '2026-07-20';
export const CONTABO_PRICE_CURRENCY = 'EUR';

export const CONTABO_PRICES: Record<string, ContaboPlanPrice> = {
  'Cloud VPS 4': { monthly: 5.5, annual12: 4.4 },
  'Cloud VPS 6': { monthly: 7.5, annual12: 6 },
  'Cloud VPS 8': { monthly: 14, annual12: 11.2 },
  'Cloud VPS 12': { monthly: 25, annual12: 20 },
  'Cloud VPS 16': { monthly: 37, annual12: 29.6 },
  'Cloud VPS 18': { monthly: 49, annual12: 39.2 },
  'Cloud VDS S': { monthly: 39, annual12: 31.2 },
  'Cloud VDS M': { monthly: 49, annual12: 39.2 },
  'Cloud VDS L': { monthly: 69, annual12: 55.2 },
  'Cloud VDS XL': { monthly: 94, annual12: 75.2 },
  'Cloud VDS XXL': { monthly: 139, annual12: 111.2 },
};
