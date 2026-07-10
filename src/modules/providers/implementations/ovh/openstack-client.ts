import { OpenStackCompute } from './openstack-compute';
import {
  CreateSecurityGroupRuleSpec,
  CreateSubnetSpec,
  NeutronNetwork,
  NeutronPort,
  NeutronSecurityGroup,
  NeutronSecurityGroupRule,
  NeutronSubnet,
  OpenStackNamed,
} from './openstack-client.types';

export * from './openstack-client.types';

/**
 * OpenStack client — the reusable core behind every OpenStack cloud (OVH first).
 * Keystone auth + service-catalog live in the base; Nova/Glance in the compute
 * layer; this class adds the Neutron (network) surface: security groups, ports,
 * private networks and subnets.
 */
export class OpenStackClient extends OpenStackCompute {
  async listNetworks(region: string): Promise<OpenStackNamed[]> {
    const neutron = await this.endpoint('network', region);
    const body = await this.get<{ networks: OpenStackNamed[] }>(`${neutron}/v2.0/networks`);
    return body.networks ?? [];
  }

  /** Map a wanted region to a real network (Neutron) region. */
  async resolveNetworkRegion(want?: string): Promise<string> {
    return this.resolveRegion('network', want);
  }

  // ── Neutron security groups ──

  async listSecurityGroups(region: string): Promise<NeutronSecurityGroup[]> {
    const neutron = await this.endpoint('network', region);
    const body = await this.get<{ security_groups: NeutronSecurityGroup[] }>(
      `${neutron}/v2.0/security-groups`,
    );
    return body.security_groups ?? [];
  }

  async getSecurityGroup(id: string, region: string): Promise<NeutronSecurityGroup | null> {
    const neutron = await this.endpoint('network', region);
    try {
      const body = await this.get<{ security_group: NeutronSecurityGroup }>(
        `${neutron}/v2.0/security-groups/${id}`,
      );
      return body.security_group ?? null;
    } catch (e) {
      if (e instanceof Error && e.message.includes('404')) return null;
      throw e;
    }
  }

  async createSecurityGroup(
    region: string,
    spec: { name: string; description?: string },
  ): Promise<NeutronSecurityGroup> {
    const neutron = await this.endpoint('network', region);
    const body = await this.post<{ security_group: NeutronSecurityGroup }>(
      `${neutron}/v2.0/security-groups`,
      { security_group: { name: spec.name, description: spec.description ?? '' } },
    );
    return body.security_group;
  }

  async deleteSecurityGroup(region: string, id: string): Promise<void> {
    const neutron = await this.endpoint('network', region);
    await this.del(`${neutron}/v2.0/security-groups/${id}`);
  }

  async createSecurityGroupRule(
    region: string,
    securityGroupId: string,
    spec: CreateSecurityGroupRuleSpec,
  ): Promise<NeutronSecurityGroupRule> {
    const neutron = await this.endpoint('network', region);
    const body = await this.post<{ security_group_rule: NeutronSecurityGroupRule }>(
      `${neutron}/v2.0/security-group-rules`,
      {
        security_group_rule: {
          security_group_id: securityGroupId,
          direction: spec.direction,
          ethertype: spec.ethertype ?? 'IPv4',
          ...(spec.protocol ? { protocol: spec.protocol } : {}),
          ...(spec.portRangeMin == null ? {} : { port_range_min: spec.portRangeMin }),
          ...(spec.portRangeMax == null ? {} : { port_range_max: spec.portRangeMax }),
          ...(spec.remoteIpPrefix ? { remote_ip_prefix: spec.remoteIpPrefix } : {}),
          ...(spec.description ? { description: spec.description } : {}),
        },
      },
    );
    return body.security_group_rule;
  }

  async deleteSecurityGroupRule(region: string, ruleId: string): Promise<void> {
    const neutron = await this.endpoint('network', region);
    await this.del(`${neutron}/v2.0/security-group-rules/${ruleId}`);
  }

  /** Replace the tag set on a security group (OpenStack standard-attr tags). */
  async setSecurityGroupTags(region: string, id: string, tags: string[]): Promise<void> {
    const neutron = await this.endpoint('network', region);
    await this.put(`${neutron}/v2.0/security-groups/${id}/tags`, { tags });
  }

  /** Ports in a region; filter to a server's ports when deviceId is given. */
  async listPorts(region: string, deviceId?: string): Promise<NeutronPort[]> {
    const neutron = await this.endpoint('network', region);
    const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
    const body = await this.get<{ ports: NeutronPort[] }>(`${neutron}/v2.0/ports${query}`);
    return body.ports ?? [];
  }

  async setPortSecurityGroups(
    region: string,
    portId: string,
    securityGroups: string[],
  ): Promise<void> {
    const neutron = await this.endpoint('network', region);
    await this.put(`${neutron}/v2.0/ports/${portId}`, {
      port: { security_groups: securityGroups },
    });
  }

  // ── Neutron networks & subnets (private VNets) ──

  async listNetworksFull(region: string): Promise<NeutronNetwork[]> {
    const neutron = await this.endpoint('network', region);
    const body = await this.get<{ networks: NeutronNetwork[] }>(`${neutron}/v2.0/networks`);
    return body.networks ?? [];
  }

  async getNetwork(id: string, region: string): Promise<NeutronNetwork | null> {
    const neutron = await this.endpoint('network', region);
    try {
      const body = await this.get<{ network: NeutronNetwork }>(`${neutron}/v2.0/networks/${id}`);
      return body.network ?? null;
    } catch (e) {
      if (e instanceof Error && e.message.includes('404')) return null;
      throw e;
    }
  }

  async createNetwork(region: string, name: string): Promise<NeutronNetwork> {
    const neutron = await this.endpoint('network', region);
    const body = await this.post<{ network: NeutronNetwork }>(`${neutron}/v2.0/networks`, {
      network: { name },
    });
    return body.network;
  }

  async deleteNetwork(region: string, id: string): Promise<void> {
    const neutron = await this.endpoint('network', region);
    await this.del(`${neutron}/v2.0/networks/${id}`);
  }

  async setNetworkTags(region: string, id: string, tags: string[]): Promise<void> {
    const neutron = await this.endpoint('network', region);
    await this.put(`${neutron}/v2.0/networks/${id}/tags`, { tags });
  }

  async listSubnets(region: string, networkId?: string): Promise<NeutronSubnet[]> {
    const neutron = await this.endpoint('network', region);
    const query = networkId ? `?network_id=${encodeURIComponent(networkId)}` : '';
    const body = await this.get<{ subnets: NeutronSubnet[] }>(`${neutron}/v2.0/subnets${query}`);
    return body.subnets ?? [];
  }

  async createSubnet(region: string, spec: CreateSubnetSpec): Promise<NeutronSubnet> {
    const neutron = await this.endpoint('network', region);
    const body = await this.post<{ subnet: NeutronSubnet }>(`${neutron}/v2.0/subnets`, {
      subnet: {
        network_id: spec.networkId,
        cidr: spec.cidr,
        ip_version: spec.ipVersion ?? 4,
        enable_dhcp: spec.enableDhcp ?? true,
        ...(spec.gatewayIp ? { gateway_ip: spec.gatewayIp } : {}),
        ...(spec.name ? { name: spec.name } : {}),
      },
    });
    return body.subnet;
  }

  async deleteSubnet(region: string, id: string): Promise<void> {
    const neutron = await this.endpoint('network', region);
    await this.del(`${neutron}/v2.0/subnets/${id}`);
  }

  /** Ports belonging to a network (to list the servers attached to a VNet). */
  async listNetworkPorts(region: string, networkId: string): Promise<NeutronPort[]> {
    const neutron = await this.endpoint('network', region);
    const body = await this.get<{ ports: NeutronPort[] }>(
      `${neutron}/v2.0/ports?network_id=${encodeURIComponent(networkId)}`,
    );
    return body.ports ?? [];
  }
}
