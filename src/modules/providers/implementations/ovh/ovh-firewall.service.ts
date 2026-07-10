import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateFirewallConfig,
  FirewallCreationResult,
  FirewallDetails,
  FirewallFilters,
  FirewallRule,
  IFirewallProvider,
} from '../../interfaces/firewall-provider.interface';
import {
  CreateSecurityGroupRuleSpec,
  NeutronPort,
  NeutronSecurityGroup,
  NeutronSecurityGroupRule,
  OpenStackClient,
} from './openstack-client';
import { buildOvhOpenStackClient } from './ovh-openstack';

/**
 * OVH firewall = OpenStack Neutron security groups. Region-scoped in Neutron, so
 * the firewall id is a composite `<region>/<sgId>`; every method resolves the
 * region from it (falling back to a catalog scan for bare ids). Flui labels ride
 * on Neutron resource tags as `key=value`, which is what lets the ownership guard
 * recognise a vops-created firewall on read-back.
 */
@Injectable()
export class OvhFirewallService implements IFirewallProvider {
  private readonly logger = new Logger(OvhFirewallService.name);
  private client: OpenStackClient | null | undefined;

  constructor(private readonly configService: ConfigService) {}

  private osClient(): OpenStackClient {
    if (this.client === undefined) {
      this.client = buildOvhOpenStackClient(this.configService);
    }
    if (!this.client) {
      throw new NotImplementedException(
        'OVH firewall operations require OpenStack credentials in the environment ' +
          '(OS_AUTH_URL / OS_USERNAME / OS_PASSWORD / OS_PROJECT_ID / OS_REGION_NAME).',
      );
    }
    return this.client;
  }

  async createFirewall(config: CreateFirewallConfig): Promise<FirewallCreationResult> {
    const client = this.osClient();
    const region = await client.resolveNetworkRegion();
    const sg = await client.createSecurityGroup(region, { name: config.name }).catch((e) => {
      if (String(e).includes('OverQuota') || String(e).includes('security_group')) {
        throw new Error(
          `OVH refused the security group (quota). OVH ships every project with a ` +
            `security_group quota of 0 — only the built-in 'default' group exists. ` +
            `Request a security-group quota increase from OVH support to manage firewalls via OpenStack.`,
        );
      }
      throw e;
    });
    this.logger.log(`Created OVH security group ${config.name} (${sg.id}) in ${region}`);

    const tags = config.labels.map((l) => `${l.key}=${l.value}`);
    if (tags.length) {
      await client
        .setSecurityGroupTags(region, sg.id, tags)
        .catch((e) => this.logger.warn(`Tagging SG ${sg.id} failed: ${String(e)}`));
    }
    for (const rule of config.rules) {
      for (const spec of toNeutronSpecs(rule)) {
        await client.createSecurityGroupRule(region, sg.id, spec);
      }
    }

    const firewallId = packId(region, sg.id);
    let appliedToServerIds: string[] | undefined;
    if (config.applyToServerIds?.length) {
      await this.applyToServers(firewallId, config.applyToServerIds);
      appliedToServerIds = config.applyToServerIds;
    }
    return { firewallId, appliedToServerIds };
  }

  async getFirewall(firewallId: string): Promise<FirewallDetails | null> {
    const client = this.osClient();
    const { region, id } = await this.locate(firewallId);
    if (!region) return null;
    const sg = await client.getSecurityGroup(id, region);
    if (!sg) return null;
    const ports = await client.listPorts(region).catch(() => [] as NeutronPort[]);
    return this.toDetails(region, sg, ports);
  }

  async listFirewalls(filters?: FirewallFilters): Promise<FirewallDetails[]> {
    const client = this.osClient();
    const regions = await client.regions('network');
    const perRegion = await Promise.all(
      regions.map(async (region) => {
        try {
          const [groups, ports] = await Promise.all([
            client.listSecurityGroups(region),
            client.listPorts(region).catch(() => [] as NeutronPort[]),
          ]);
          return groups.map((sg) => this.toDetails(region, sg, ports));
        } catch (e) {
          this.logger.warn(`OVH listSecurityGroups(${region}) failed: ${String(e)}`);
          return [];
        }
      }),
    );
    const all = perRegion.flat();
    if (filters?.name) return all.filter((f) => f.name === filters.name);
    return all;
  }

  async updateFirewallRules(firewallId: string, rules: FirewallRule[]): Promise<void> {
    const client = this.osClient();
    const { region, id } = await this.locate(firewallId);
    if (!region) throw new Error(`OVH firewall ${firewallId} not found.`);
    const sg = await client.getSecurityGroup(id, region);
    if (!sg) throw new Error(`OVH firewall ${firewallId} not found.`);

    for (const r of sg.security_group_rules) {
      await client.deleteSecurityGroupRule(region, r.id);
    }
    for (const rule of rules) {
      for (const spec of toNeutronSpecs(rule)) {
        await client.createSecurityGroupRule(region, id, spec);
      }
    }
    // Neutron blocks all egress once its default allow rules are gone; keep the
    // common "outbound open" expectation unless the caller set egress rules.
    if (!rules.some((r) => r.direction === 'out')) {
      await client.createSecurityGroupRule(region, id, allowAllEgress('IPv4'));
      await client.createSecurityGroupRule(region, id, allowAllEgress('IPv6'));
    }
  }

  async deleteFirewall(firewallId: string): Promise<void> {
    const client = this.osClient();
    const { region, id } = await this.locate(firewallId);
    if (!region) return;
    await client.deleteSecurityGroup(region, id);
  }

  async applyToServers(firewallId: string, serverIds: string[]): Promise<void> {
    const client = this.osClient();
    const { region, id } = await this.locate(firewallId);
    if (!region) throw new Error(`OVH firewall ${firewallId} not found.`);
    for (const serverId of serverIds) {
      const ports = await client.listPorts(region, serverId);
      for (const port of ports) {
        const sgs = new Set(port.security_groups ?? []);
        sgs.add(id);
        await client.setPortSecurityGroups(region, port.id, [...sgs]);
      }
    }
  }

  async removeFromServers(firewallId: string, serverIds: string[]): Promise<void> {
    const client = this.osClient();
    const { region, id } = await this.locate(firewallId);
    if (!region) throw new Error(`OVH firewall ${firewallId} not found.`);
    for (const serverId of serverIds) {
      const ports = await client.listPorts(region, serverId);
      for (const port of ports) {
        const sgs = new Set(port.security_groups ?? []);
        sgs.delete(id);
        await client.setPortSecurityGroups(region, port.id, [...sgs]);
      }
    }
  }

  /** Resolve the region for a firewall id, scanning the catalog for bare ids. */
  private async locate(firewallId: string): Promise<{ region?: string; id: string }> {
    const parsed = parseId(firewallId);
    if (parsed.region) return parsed;
    const client = this.osClient();
    for (const region of await client.regions('network')) {
      const sg = await client.getSecurityGroup(parsed.id, region).catch(() => null);
      if (sg) return { region, id: parsed.id };
    }
    return { id: parsed.id };
  }

  private toDetails(
    region: string,
    sg: NeutronSecurityGroup,
    ports: NeutronPort[],
  ): FirewallDetails {
    const serverIds = [
      ...new Set(
        ports
          .filter((p) => p.device_id && (p.security_groups ?? []).includes(sg.id))
          .map((p) => p.device_id),
      ),
    ];
    return {
      id: packId(region, sg.id),
      name: sg.name,
      rules: (sg.security_group_rules ?? [])
        .map(toFluiRule)
        .filter((r): r is FirewallRule => r !== null),
      labels: tagsToLabels(sg.tags),
      appliedTo: serverIds.map((serverId) => ({ serverId })),
    };
  }
}

function packId(region: string, id: string): string {
  return `${region}/${id}`;
}

function parseId(firewallId: string): { region?: string; id: string } {
  const i = firewallId.indexOf('/');
  if (i < 0) return { id: firewallId };
  return { region: firewallId.slice(0, i), id: firewallId.slice(i + 1) };
}

function tagsToLabels(tags?: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of tags ?? []) {
    const i = t.indexOf('=');
    if (i > 0) out[t.slice(0, i)] = t.slice(i + 1);
  }
  return out;
}

export function parsePortRange(port?: string): { min: number | null; max: number | null } {
  if (!port) return { min: null, max: null };
  const m = /^(\d+)(?:-(\d+))?$/.exec(port.trim());
  if (!m) return { min: null, max: null };
  const min = Number(m[1]);
  return { min, max: m[2] ? Number(m[2]) : min };
}

function formatPortRange(min: number | null, max: number | null): string | undefined {
  if (min == null && max == null) return undefined;
  if (min === max) return String(min);
  return `${min}-${max}`;
}

function allowAllEgress(ethertype: 'IPv4' | 'IPv6'): CreateSecurityGroupRuleSpec {
  return {
    direction: 'egress',
    ethertype,
    remoteIpPrefix: ethertype === 'IPv6' ? '::/0' : '0.0.0.0/0',
  };
}

export function toNeutronSpecs(rule: FirewallRule): CreateSecurityGroupRuleSpec[] {
  const direction = rule.direction === 'in' ? 'ingress' : 'egress';
  const cidrs = (rule.direction === 'in' ? rule.sourceIps : rule.destinationIps) ?? [];
  const list = cidrs.length ? cidrs : ['0.0.0.0/0'];
  const { min, max } = parsePortRange(rule.port);
  const icmp = rule.protocol === 'icmp';
  return list.map((cidr) => ({
    direction,
    ethertype: cidr.includes(':') ? 'IPv6' : 'IPv4',
    protocol: rule.protocol,
    portRangeMin: icmp ? null : min,
    portRangeMax: icmp ? null : max,
    remoteIpPrefix: cidr,
    description: rule.description,
  }));
}

export function toFluiRule(r: NeutronSecurityGroupRule): FirewallRule | null {
  if (r.protocol !== 'tcp' && r.protocol !== 'udp' && r.protocol !== 'icmp') return null;
  const direction = r.direction === 'ingress' ? 'in' : 'out';
  const port = formatPortRange(r.port_range_min, r.port_range_max);
  const cidr = r.remote_ip_prefix ?? (r.ethertype === 'IPv6' ? '::/0' : '0.0.0.0/0');
  return {
    id: r.id,
    description: r.description ?? '',
    direction,
    protocol: r.protocol,
    ...(port ? { port } : {}),
    ...(direction === 'in' ? { sourceIps: [cidr] } : { destinationIps: [cidr] }),
  };
}
