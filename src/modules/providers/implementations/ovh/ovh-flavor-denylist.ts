/**
 * OVH's public catalog (our credential-free price source) still advertises
 * flavors that are no longer orderable. The catalog has no "is-orderable" flag,
 * so rather than trusting the feed we maintain this exclusion list by hand:
 * anything matched here is hidden from prices, availability and plans.
 *
 * Match = an exact code or a `prefix*` glob. Seeded conservatively — the entries
 * below were verified absent from every public OVH compute region (Nova) on
 * 2026-07-12. Add a line when a family is confirmed non-orderable; do not add
 * merely quota-gated products (GPU/High-Grade/etc.), which are real offers.
 */
export const OVH_FLAVOR_DENYLIST: readonly string[] = [
  's1-*', // legacy "Sandbox" line (s1-2 / s1-4 / s1-8) — discontinued by OVH, not orderable
];

export function isDeniedOvhFlavor(code: string): boolean {
  return OVH_FLAVOR_DENYLIST.some((pattern) =>
    pattern.endsWith('*') ? code.startsWith(pattern.slice(0, -1)) : code === pattern,
  );
}
