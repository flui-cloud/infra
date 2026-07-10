/**
 * OVH Public Cloud macro-regions (city level). The catalog exposes datacenter
 * codes (GRA1/GRA3/GRA7…); we collapse them to the city they sit in so the map
 * shows one pin per location and prices dedupe cleanly. `toMacroRegion` strips
 * the trailing datacenter index (GRA7 → GRA).
 */
export interface OvhRegion {
  code: string; // macro code, e.g. "GRA"
  city: string;
  country: string;
  cc: string;
  lat: number;
  lng: number;
}

export const OVH_REGIONS: OvhRegion[] = [
  { code: 'GRA', city: 'Gravelines', country: 'France', cc: 'FR', lat: 50.9871, lng: 2.1255 },
  { code: 'SBG', city: 'Strasbourg', country: 'France', cc: 'FR', lat: 48.5734, lng: 7.7521 },
  { code: 'DE', city: 'Frankfurt', country: 'Germany', cc: 'DE', lat: 50.1109, lng: 8.6821 },
  { code: 'UK', city: 'London', country: 'United Kingdom', cc: 'GB', lat: 51.5074, lng: -0.1278 },
  { code: 'WAW', city: 'Warsaw', country: 'Poland', cc: 'PL', lat: 52.2297, lng: 21.0122 },
  { code: 'BHS', city: 'Beauharnois', country: 'Canada', cc: 'CA', lat: 45.3151, lng: -73.8779 },
  { code: 'SGP', city: 'Singapore', country: 'Singapore', cc: 'SG', lat: 1.3521, lng: 103.8198 },
  { code: 'SYD', city: 'Sydney', country: 'Australia', cc: 'AU', lat: -33.8688, lng: 151.2093 },
];

export const OVH_MACRO_CODES: string[] = OVH_REGIONS.map((r) => r.code);

export function toMacroRegion(dcCode: string): string {
  const m = /^([A-Za-z]+)\d+$/.exec(dcCode);
  return (m ? m[1] : dcCode).toUpperCase();
}

/** Collapse a flavor's datacenter list to unique macro-regions (fallback: all). */
export function macroRegionsOf(dcCodes: string[]): string[] {
  if (!dcCodes.length) return [...OVH_MACRO_CODES];
  const set = new Set(dcCodes.map(toMacroRegion).filter((c) => OVH_MACRO_CODES.includes(c)));
  return set.size ? [...set] : [...OVH_MACRO_CODES];
}
