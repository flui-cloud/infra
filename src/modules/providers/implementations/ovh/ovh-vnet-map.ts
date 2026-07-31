import { VNetDetails } from '../../interfaces/network-provider.interface';
import { NeutronNetwork, NeutronPort, NeutronSubnet } from './openstack-client';

export function packRegionId(region: string, id: string): string {
  return `${region}/${id}`;
}

export function parseRegionId(value: string): { region?: string; id: string } {
  const i = value.indexOf('/');
  if (i < 0) return { id: value };
  return { region: value.slice(0, i), id: value.slice(i + 1) };
}

export function tagsToLabels(tags?: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of tags ?? []) {
    const i = t.indexOf('=');
    if (i > 0) out[t.slice(0, i)] = t.slice(i + 1);
  }
  return out;
}

/**
 * Only Nova instance ports carry a server id in `device_id`. Neutron's own ports
 * (`network:dhcp`, `network:router_interface`, …) put an agent/router id there, and
 * an unowned port (empty `device_owner`) is nobody's server. Nova stamps
 * `compute:nova` or `compute:<availability-zone>`, so the prefix is the test.
 */
export function isInstancePort(port: Pick<NeutronPort, 'device_id' | 'device_owner'>): boolean {
  return Boolean(port.device_id) && Boolean(port.device_owner?.startsWith('compute:'));
}

/** Server ids attached to a network, from its Neutron ports. Deduped, order preserved. */
export function attachedServerIdsOf(
  networkId: string,
  ports: Pick<NeutronPort, 'device_id' | 'device_owner' | 'network_id'>[],
): string[] {
  return [
    ...new Set(
      ports.flatMap((p) => (p.network_id === networkId && isInstancePort(p) ? [p.device_id] : [])),
    ),
  ];
}

export function toVNetDetails(
  region: string,
  net: NeutronNetwork,
  subnets: NeutronSubnet[],
  ports: Pick<NeutronPort, 'device_id' | 'device_owner' | 'network_id'>[],
): VNetDetails {
  const mine = subnets.filter((s) => net.subnets.includes(s.id));
  return {
    id: packRegionId(region, net.id),
    name: net.name,
    ipRange: mine[0]?.cidr ?? '',
    subnets: mine.map((s) => ({
      id: s.id,
      ipRange: s.cidr,
      networkZone: region,
      gateway: s.gateway_ip ?? undefined,
    })),
    routes: [],
    attachedServerIds: attachedServerIdsOf(net.id, ports),
    labels: tagsToLabels(net.tags),
  };
}
