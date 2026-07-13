// Contabo VPS pricing snapshot (EUR). Monthly-term (1-month) prices; annual12
// is the 12-month-term price (~20% less). Contabo VPS plans have no setup fee.

export interface ContaboPlanPrice {
  /** Real price when billed one month at a time (EUR/mo). */
  monthly: number;
  /** Per-month price on a 12-month term (~20% less), or null if unknown. */
  annual12: number | null;
}

export const CONTABO_PRICES_FETCHED_AT = '2026-07-12';
export const CONTABO_PRICE_CURRENCY = 'EUR';

export const CONTABO_PRICES: Record<string, ContaboPlanPrice> = {
  'Cloud VPS 10': { monthly: 5.5, annual12: 4.4 },
  'Cloud VPS 20': { monthly: 7.5, annual12: 6 },
  'Cloud VPS 30': { monthly: 14, annual12: 11.2 },
  'Cloud VPS 40': { monthly: 25, annual12: 20 },
  'Cloud VPS 50': { monthly: 37, annual12: 29.6 },
  'Cloud VPS 60': { monthly: 49, annual12: 39.2 },
};
