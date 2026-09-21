/**
 * Where on the planet a region sits, coarse enough to choose with.
 *
 * Derived from the country, never declared per provider. A provider's footprint
 * changes when it opens a site; the continent a country sits on does not, and
 * declaring it three times would give three answers that drift apart. It is also
 * the honest shape: locality is a requirement about a place, not about a vendor.
 *
 * This file exists identically in flui-core and flui-infra. It belongs in
 * flui-infra alone — nothing here is specific to Flui — and moves there once
 * that package is published again; until then both copies change together.
 */
export type MacroRegion =
  | 'europe'
  | 'north-america'
  | 'south-america'
  | 'asia'
  | 'oceania'
  | 'africa';

export const MACRO_REGIONS: readonly MacroRegion[] = [
  'europe',
  'north-america',
  'south-america',
  'asia',
  'oceania',
  'africa',
];

export const MACRO_REGION_LABELS: Record<MacroRegion, string> = {
  europe: 'Europe',
  'north-america': 'North America',
  'south-america': 'South America',
  asia: 'Asia',
  oceania: 'Oceania',
  africa: 'Africa',
};

/**
 * ISO 3166-1 alpha-2 by macro-region.
 *
 * Deliberately not every country on earth: it covers the ones that host cloud
 * capacity, and anything else resolves to null rather than to a guess. A region
 * whose country is unknown is shown as unplaced, which is visible; filing it
 * under the wrong continent would not be.
 */
const COUNTRIES: Record<MacroRegion, readonly string[]> = {
  europe: [
    'AL', 'AD', 'AT', 'BY', 'BE', 'BA', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE',
    'FI', 'FR', 'DE', 'GI', 'GR', 'HU', 'IS', 'IE', 'IM', 'IT', 'XK', 'LV',
    'LI', 'LT', 'LU', 'MT', 'MD', 'MC', 'ME', 'NL', 'MK', 'NO', 'PL', 'PT',
    'RO', 'RU', 'SM', 'RS', 'SK', 'SI', 'ES', 'SE', 'CH', 'UA', 'GB', 'VA',
  ],
  'north-america': [
    'CA', 'US', 'MX', 'GT', 'BZ', 'SV', 'HN', 'NI', 'CR', 'PA', 'CU', 'DO',
    'HT', 'JM', 'PR', 'TT', 'BS', 'BB',
  ],
  'south-america': [
    'AR', 'BO', 'BR', 'CL', 'CO', 'EC', 'GY', 'PY', 'PE', 'SR', 'UY', 'VE',
  ],
  asia: [
    'AF', 'AM', 'AZ', 'BH', 'BD', 'BT', 'BN', 'KH', 'CN', 'GE', 'HK', 'IN',
    'ID', 'IR', 'IQ', 'IL', 'JP', 'JO', 'KZ', 'KW', 'KG', 'LA', 'LB', 'MO',
    'MY', 'MV', 'MN', 'MM', 'NP', 'KP', 'OM', 'PK', 'PS', 'PH', 'QA', 'SA',
    'SG', 'KR', 'LK', 'SY', 'TW', 'TJ', 'TH', 'TL', 'TR', 'TM', 'AE', 'UZ',
    'VN', 'YE',
  ],
  oceania: ['AU', 'FJ', 'NZ', 'PG', 'NC', 'PF', 'SB', 'VU', 'WS', 'TO', 'GU'],
  africa: [
    'DZ', 'AO', 'BJ', 'BW', 'BF', 'BI', 'CM', 'CV', 'CF', 'TD', 'KM', 'CD',
    'CG', 'CI', 'DJ', 'EG', 'GQ', 'ER', 'SZ', 'ET', 'GA', 'GM', 'GH', 'GN',
    'GW', 'KE', 'LS', 'LR', 'LY', 'MG', 'MW', 'ML', 'MR', 'MU', 'MA', 'MZ',
    'NA', 'NE', 'NG', 'RW', 'SN', 'SC', 'SL', 'SO', 'ZA', 'SS', 'SD', 'TZ',
    'TG', 'TN', 'UG', 'ZM', 'ZW',
  ],
};

const BY_COUNTRY = new Map<string, MacroRegion>(
  MACRO_REGIONS.flatMap((macro) =>
    COUNTRIES[macro].map((cc) => [cc, macro] as [string, MacroRegion]),
  ),
);

/** @param countryCode ISO 3166-1 alpha-2, in any case. Null when unrecognised. */
export function macroRegionOf(
  countryCode: string | undefined | null,
): MacroRegion | null {
  if (!countryCode) return null;
  return BY_COUNTRY.get(countryCode.trim().toUpperCase()) ?? null;
}

export function isMacroRegion(value: unknown): value is MacroRegion {
  return (
    typeof value === 'string' && MACRO_REGIONS.includes(value as MacroRegion)
  );
}
