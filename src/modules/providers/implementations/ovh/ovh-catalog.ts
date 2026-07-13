/**
 * OVH Public Cloud catalog → normalized flavors with REAL-TIME prices.
 *
 * OVH exposes its full Public Cloud catalog (specs + hourly/monthly prices +
 * region availability) at a public, unauthenticated endpoint, so this works with
 * zero credentials — it's the real-time pricing source that OpenStack itself
 * cannot provide (Nova has flavors but no prices). Hourly flavors are the
 * `<flavor>.consumption` addons; monthly is the sibling `<flavor>.monthly.postpaid`.
 * Prices are integers in micro-cents (1 EUR = 100_000_000).
 */

import { isDeniedOvhFlavor } from './ovh-flavor-denylist';

const OVH_PRICE_DIVISOR = 100_000_000;
const HOURLY_SUFFIX = '.consumption';
const MONTHLY_SUFFIX = '.monthly.postpaid';

export interface OvhFlavor {
  code: string; // OVH flavor name, e.g. "b2-7"
  name: string;
  category: string; // general-purpose | cpu | ram | discovery | iops | ...
  cores: number;
  ramGb: number;
  diskGb: number;
  storageType: string; // SSD | local | NVMe | ...
  hourly: number | null;
  monthly: number | null;
  regions: string[];
  currency: string;
}

interface OvhPricing {
  price: number;
  intervalUnit?: string;
  capacities?: string[];
}
interface OvhAddon {
  planCode: string;
  product?: string;
  pricings?: OvhPricing[];
  configurations?: { name: string; values?: string[] }[];
  blobs?: {
    commercial?: { name?: string; brickSubtype?: string };
    technical?: {
      cpu?: { cores?: number };
      memory?: { size?: number };
      storage?: { disks?: { capacity?: number; technology?: string }[] };
    };
  };
}
export interface OvhCatalogResponse {
  locale?: { currencyCode?: string };
  addons?: OvhAddon[];
}

const hourlyAddon = /^[a-z0-9]+-\d+\.consumption$/;

function priceOf(byPlan: Map<string, OvhAddon>, planCode: string): number | null {
  const addon = byPlan.get(planCode);
  const raw = addon?.pricings?.[0]?.price;
  return typeof raw === 'number' ? raw / OVH_PRICE_DIVISOR : null;
}

/** Pure transform (no network) so it can be unit-tested against a fixture. */
export function normalizeOvhCatalog(catalog: OvhCatalogResponse): OvhFlavor[] {
  const currency = catalog.locale?.currencyCode ?? 'EUR';
  const addons = catalog.addons ?? [];
  const byPlan = new Map(addons.map((a) => [a.planCode, a]));

  const flavors: OvhFlavor[] = [];
  for (const addon of addons) {
    if (!hourlyAddon.test(addon.planCode)) continue;
    const tech = addon.blobs?.technical;
    if (!tech?.memory?.size || !tech.cpu?.cores) continue;

    const base = addon.planCode.slice(0, -HOURLY_SUFFIX.length);
    if (isDeniedOvhFlavor(base)) continue;
    const disks = tech.storage?.disks ?? [];
    const regions = addon.configurations?.find((c) => c.name === 'region')?.values ?? [];

    flavors.push({
      code: tech['name'] ?? addon.blobs?.commercial?.name ?? base,
      name: addon.blobs?.commercial?.name ?? base,
      category: addon.blobs?.commercial?.brickSubtype ?? 'general-purpose',
      cores: tech.cpu.cores,
      ramGb: tech.memory.size,
      diskGb: disks.reduce((sum, d) => sum + (d.capacity ?? 0), 0),
      storageType: disks[0]?.technology ?? 'local',
      hourly: priceOf(byPlan, base + HOURLY_SUFFIX),
      monthly: priceOf(byPlan, base + MONTHLY_SUFFIX),
      regions,
      currency,
    });
  }
  return flavors.sort((a, b) => (a.hourly ?? Infinity) - (b.hourly ?? Infinity));
}

export type OvhCatalogFetcher = (subsidiary: string) => Promise<OvhCatalogResponse>;

/**
 * Fetches + normalizes the live OVH catalog. The fetcher is injectable so tests
 * and offline paths don't hit the network; the default hits OVH's public API.
 */
export class OvhCatalog {
  constructor(
    private readonly fetcher: OvhCatalogFetcher = OvhCatalog.httpFetcher,
    private readonly subsidiary = 'FR',
  ) {}

  async flavors(): Promise<OvhFlavor[]> {
    return normalizeOvhCatalog(await this.fetcher(this.subsidiary));
  }

  private static async httpFetcher(subsidiary: string): Promise<OvhCatalogResponse> {
    const url = `https://eu.api.ovh.com/v1/order/catalog/public/cloud?ovhSubsidiary=${encodeURIComponent(subsidiary)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OVH catalog fetch failed: HTTP ${res.status}`);
    return (await res.json()) as OvhCatalogResponse;
  }
}
