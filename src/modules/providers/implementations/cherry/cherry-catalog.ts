/**
 * Cherry Servers public plan catalog.
 *
 * `GET /v1/plans` is served without credentials and carries, in a single
 * response, everything the read-only surface needs: structured specs, prices
 * already denominated in EUR, and — unusually — a numeric stock count per
 * region. No scraping, no second request, no API key.
 */

export type CherryPlanType =
  | 'baremetal'
  | 'vps'
  | 'vds'
  | 'arm-vds'
  | 'storage-vps'
  | 'premium-vds'
  | 'performance-vds';

/** Billing terms Cherry quotes. Only the two the read surface uses are named. */
export type CherryPriceUnit =
  | 'Hourly'
  | 'Monthly'
  | 'Quarterly'
  | 'Semiannually'
  | 'Annually'
  | 'Spot hourly';

export interface CherryRegion {
  /** Stable code, e.g. `LT-Siauliai`. Preferred over `name`, which is prose. */
  code: string;
  /** Units on hand. 0 means genuinely sold out, not "unknown". */
  stock: number;
}

export interface CherryPlan {
  slug: string;
  title: string;
  type: CherryPlanType;
  bareMetal: boolean;
  /** Total cores across all sockets — the API already sums them. */
  cores: number;
  /** GB. */
  memory: number;
  /** GB, summing every physical disk. */
  disk: number;
  cpuName: string;
  arm: boolean;
  /** EUR. Null when Cherry does not quote that term for the plan. */
  hourly: number | null;
  monthly: number | null;
  regions: CherryRegion[];
}

interface RawPricing {
  unit?: string;
  price?: number;
  currency?: string;
}

interface RawRegion {
  slug?: string;
  name?: string;
  stock_qty?: number;
}

interface RawPlan {
  slug?: string;
  title?: string;
  type?: string;
  specs?: {
    cpus?: { cores?: number; name?: string };
    memory?: { total?: number; unit?: string };
    storage?: Array<{ size?: number; unit?: string; count?: number }>;
  };
  pricing?: RawPricing[];
  available_regions?: RawRegion[];
}

const CATALOG_URL = 'https://api.cherryservers.com/v1/plans';

/**
 * Disk sizes come through in mixed units — 35 of 82 plans quote TB — so the
 * unit has to be read per entry. Treating a bare number as GB turns a 2 TB NVMe
 * into a 2 GB one.
 */
const toGb = (size: number, unit: string | undefined): number =>
  (unit ?? 'GB').toUpperCase() === 'TB' ? size * 1000 : size;

const priceFor = (
  pricing: RawPricing[] | undefined,
  unit: CherryPriceUnit,
): number | null => {
  const hit = (pricing ?? []).find((p) => p.unit === unit);
  // Cherry quotes EUR throughout; anything else would silently corrupt a
  // comparison denominated in euros, so drop it rather than convert blindly.
  if (!hit || hit.currency !== 'EUR') return null;
  return typeof hit.price === 'number' && hit.price > 0 ? hit.price : null;
};

export class CherryCatalog {
  constructor(
    private readonly baseUrl: string = CATALOG_URL,
    private readonly timeoutMs: number = 15_000,
  ) {}

  async plans(): Promise<CherryPlan[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.baseUrl, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Cherry catalog responded ${response.status}`);
      }
      const raw = (await response.json()) as RawPlan[];
      return Array.isArray(raw) ? raw.map((p) => normalize(p)).filter(Boolean) : [];
    } finally {
      clearTimeout(timer);
    }
  }
}

function normalize(raw: RawPlan): CherryPlan | null {
  const slug = raw.slug;
  const specs = raw.specs;
  if (!slug || !specs) return null;

  const cores = specs.cpus?.cores ?? 0;
  const memory = specs.memory?.total ?? 0;
  if (!cores || !memory) return null;

  const disk = (specs.storage ?? []).reduce(
    (sum, d) => sum + toGb(d.size ?? 0, d.unit) * (d.count ?? 1),
    0,
  );

  const type = (raw.type ?? 'vps') as CherryPlanType;
  return {
    slug,
    title: raw.title ?? slug,
    type,
    bareMetal: type === 'baremetal',
    cores,
    memory,
    disk,
    cpuName: specs.cpus?.name ?? '',
    arm: type === 'arm-vds',
    hourly: priceFor(raw.pricing, 'Hourly'),
    monthly: priceFor(raw.pricing, 'Monthly'),
    regions: (raw.available_regions ?? []).flatMap((r) => {
      const code = r.slug ?? r.name;
      // Without a stock count there is no signal — omit the region from the
      // stock view rather than guess. `regions` is the availability source;
      // coverage is derived from the same list, so a missing count still
      // leaves the region visible for pricing.
      if (!code) return [];
      return [{ code, stock: typeof r.stock_qty === 'number' ? r.stock_qty : -1 }];
    }),
  };
}
