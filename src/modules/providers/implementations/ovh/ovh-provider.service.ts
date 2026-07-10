import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ICloudProvider,
  CreateServerConfig,
  ServerCreationResult,
  ServerDeletionResult,
} from '../../interfaces/cloud-provider.interface';
import {
  CreateVNetConfig,
  VNetCreationResult,
  VNetDetails,
  VNetDeletionResult,
  AddSubnetConfig,
  AddSubnetResult,
  DeleteSubnetConfig,
  AttachServerToVNetConfig,
  DetachServerFromVNetConfig,
  ServerVNetAttachmentResult,
} from '../../interfaces/network-provider.interface';
import { InstanceEntity } from '../../../instances/entities/instance.entity';
import { DeleteServerDto } from '../../../infrastructure/servers/dto/delete-server.dto';
import { ServerResponseDto } from '../../../infrastructure/servers/dto/server-response.dto';
import { CloudProvider } from '../../enums/cloud-provider.enum';
import { NodeSizeDto } from '../../dto/node-size.dto';
import { OvhCatalog, OvhFlavor } from './ovh-catalog';
import { macroRegionsOf } from './ovh-regions';
import {
  OpenStackClient,
  OpenStackServer,
  NeutronNetwork,
  NeutronSubnet,
} from './openstack-client';
import { buildOvhOpenStackClient } from './ovh-openstack';

/**
 * OVH provider — OpenStack under the hood. This phase implements the READ-ONLY
 * surface (node sizes + real-time prices from OVH's public catalog, no creds).
 * Live server operations require an OpenStack application credential and land in
 * a later phase; they fail loudly rather than pretend to work.
 */
@Injectable()
export class OvhProviderService implements ICloudProvider {
  private readonly logger = new Logger(OvhProviderService.name);
  private readonly catalog: OvhCatalog;

  constructor(private readonly configService: ConfigService) {
    const subsidiary = this.configService.get<string>('OVH_SUBSIDIARY', 'FR');
    this.catalog = new OvhCatalog(undefined, subsidiary);
  }

  async getNodeSizes(): Promise<NodeSizeDto[]> {
    const flavors = await this.catalog.flavors();
    return flavors.map((f) => this.toNodeSize(f));
  }

  private toNodeSize(f: OvhFlavor): NodeSizeDto {
    const regions = macroRegionsOf(f.regions);
    const price = (v: number | null) => {
      const s = v == null ? '0' : String(v);
      return { net: s, gross: s };
    };
    return {
      id: f.code,
      name: f.code,
      description: `${f.cores} vCPU, ${f.ramGb} GB RAM, ${f.diskGb} GB ${f.storageType}`,
      cores: f.cores,
      memory: f.ramGb,
      disk: f.diskGb,
      storageType: 'local',
      cpuType: f.category === 'cpu' ? 'dedicated' : 'shared',
      architecture: 'x86',
      deprecated: false,
      bareMetal: false,
      managedFirewall: true, // OpenStack security groups
      supportsHourlyBilling: f.hourly != null,
      prices: regions.map((location) => ({
        location,
        priceHourly: price(f.hourly),
        priceMonthly: price(f.monthly),
      })),
      locations: [],
      availability: regions.map((location) => ({
        location,
        available: true,
        deprecated: false,
      })),
    };
  }

  // ── Live operations (OpenStack / Keystone + Nova) ──
  private client: OpenStackClient | null | undefined;

  /** Build the OpenStack client from OS_* env once; null when creds are absent. */
  private osClient(): OpenStackClient | null {
    if (this.client !== undefined) return this.client;
    this.client = buildOvhOpenStackClient(this.configService);
    return this.client;
  }

  private requireClient(): OpenStackClient {
    const client = this.osClient();
    if (!client) {
      throw new NotImplementedException(
        'OVH live operations require OpenStack credentials in the environment ' +
          '(OS_AUTH_URL / OS_USERNAME / OS_PASSWORD / OS_PROJECT_ID / OS_REGION_NAME).',
      );
    }
    return client;
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    const client = this.osClient();
    if (!client) {
      return {
        success: false,
        error:
          'OVH OpenStack credentials not configured — read-only catalog/pricing works without them.',
      };
    }
    return client.testConnection();
  }

  /** Servers across every region this credential can reach (one token, all regions). */
  async listServersAsDto(): Promise<ServerResponseDto[]> {
    const client = this.requireClient();
    const regions = await client.regions('compute');
    const perRegion = await Promise.all(
      regions.map(async (region) => {
        try {
          const servers = await client.listServers(region);
          return servers.map((s) => this.toServerDto(s, region));
        } catch (e) {
          this.logger.warn(`OVH listServers(${region}) failed: ${String(e)}`);
          return [];
        }
      }),
    );
    return perRegion.flat();
  }

  async getServerDetailsAsDto(serverId: string): Promise<ServerResponseDto | null> {
    const client = this.requireClient();
    for (const region of await client.regions('compute')) {
      const server = await client.getServer(serverId, region).catch(() => null);
      if (server) return this.toServerDto(server, region);
    }
    return null;
  }

  async getServerStatus(serverId: string): Promise<string> {
    const dto = await this.getServerDetailsAsDto(serverId);
    if (!dto) throw new NotImplementedException(`OVH server ${serverId} not found.`);
    return dto.status;
  }

  private toServerDto(s: OpenStackServer, region: string): ServerResponseDto {
    const { publicIp, privateIp } = OvhProviderService.extractIps(s);
    return {
      id: s.id,
      name: s.name,
      provider: CloudProvider.OVH,
      provider_resource_id: s.id,
      server_type: s.flavor?.original_name ?? s.flavor?.id ?? 'unknown',
      location: region,
      status: s.status,
      public_ip: publicIp,
      private_ip: privateIp,
      created_at: s.created ? new Date(s.created) : new Date(0),
      updated_at: s.updated ? new Date(s.updated) : new Date(0),
    };
  }

  private static extractIps(s: OpenStackServer): { publicIp?: string; privateIp?: string } {
    let publicIp: string | undefined;
    let privateIp: string | undefined;
    const isPrivate = (ip: string) =>
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
    for (const list of Object.values(s.addresses ?? {})) {
      for (const a of list) {
        if (a.version !== 4) continue;
        if (isPrivate(a.addr)) privateIp ??= a.addr;
        else publicIp ??= a.addr;
      }
    }
    return { publicIp, privateIp };
  }

  async listInstances(): Promise<InstanceEntity[]> {
    return [];
  }

  async createServer(config: CreateServerConfig): Promise<ServerCreationResult> {
    const client = this.requireClient();
    const region = await client.resolveComputeRegion(config.location);
    this.logger.log(`Creating OVH server ${config.name} in ${region} via Nova`);

    const flavorName = config.server_type ?? 's1-2';
    const imageName = config.image ?? 'Ubuntu 24.04';
    const [flavors, images, networks] = await Promise.all([
      client.listFlavors(region),
      client.listImages(region),
      client.listNetworks(region),
    ]);

    const flavor = flavors.find((f) => f.name === flavorName);
    if (!flavor) throw new Error(`OVH flavor '${flavorName}' not available in ${region}.`);
    const image = OvhProviderService.matchImage(images, imageName);
    if (!image) throw new Error(`OVH image matching '${imageName}' not found in ${region}.`);

    // A public IP on OVH comes from attaching the public "Ext-Net" network.
    const networkIds =
      config.networks && config.networks.length > 0
        ? config.networks
        : [OvhProviderService.publicNetworkId(networks, region)];

    const server = await client.createServer(region, {
      name: config.name,
      flavorRef: flavor.id,
      imageRef: image.id,
      networks: networkIds.map((uuid) => ({ uuid })),
      keyName: config.ssh_keys?.[0],
      userData: config.user_data
        ? Buffer.from(config.user_data).toString('base64')
        : undefined,
      metadata: config.labels?.length
        ? Object.fromEntries(config.labels.map((l) => [l.key, l.value]))
        : undefined,
    });

    const { publicIp, privateIp } = OvhProviderService.extractIps(server);
    return {
      serverId: server.id,
      ipAddress: publicIp,
      privateIp,
      status: server.status,
    };
  }

  async deleteServer(config: DeleteServerDto): Promise<ServerDeletionResult> {
    const client = this.requireClient();
    for (const region of await client.regions('compute')) {
      const server = await client.getServer(config.server_id, region).catch(() => null);
      if (!server) continue;
      if (!config.force && server.status === 'ACTIVE') {
        throw new Error('Server is running. Use force=true to delete running servers.');
      }
      await client.deleteServer(region, config.server_id);
      return { message: `OVH server ${config.server_id} deletion initiated in ${region}` };
    }
    throw new Error(`OVH server ${config.server_id} not found in any region.`);
  }

  private static matchImage(
    images: { id: string; name: string }[],
    want: string,
  ): { id: string; name: string } | undefined {
    const exact = images.find((i) => i.name.toLowerCase() === want.toLowerCase());
    if (exact) return exact;
    const words = want.toLowerCase().split(/\s+/);
    return images.find((i) => words.every((w) => i.name.toLowerCase().includes(w)));
  }

  private static publicNetworkId(networks: { id: string; name: string }[], region: string): string {
    const ext = networks.find((n) => n.name === 'Ext-Net');
    if (!ext) throw new Error(`No public 'Ext-Net' network found in ${region}.`);
    return ext.id;
  }

  // ── Private networks (VNets) via Neutron ──

  async createVNet(config: CreateVNetConfig): Promise<VNetCreationResult> {
    const client = this.requireClient();
    const region = await client.resolveNetworkRegion();
    const net = await client.createNetwork(region, config.name);
    this.logger.log(`Created OVH network ${config.name} (${net.id}) in ${region}`);

    const tags = (config.labels ?? []).map((l) => `${l.key}=${l.value}`);
    if (tags.length) {
      await client
        .setNetworkTags(region, net.id, tags)
        .catch((e) => this.logger.warn(`Tagging network ${net.id} failed: ${String(e)}`));
    }

    const subnetSpecs = config.subnets?.length
      ? config.subnets.map((s) => ({ cidr: s.ipRange, gatewayIp: s.gateway }))
      : [{ cidr: config.ipRange, gatewayIp: undefined }];
    const created: NeutronSubnet[] = [];
    for (const s of subnetSpecs) {
      created.push(
        await client.createSubnet(region, {
          networkId: net.id,
          cidr: s.cidr,
          gatewayIp: s.gatewayIp,
          name: config.name,
        }),
      );
    }

    return {
      vnetId: packRegionId(region, net.id),
      ipRange: config.ipRange,
      subnets: created.map((sn) => ({
        id: sn.id,
        ipRange: sn.cidr,
        networkZone: region,
        gateway: sn.gateway_ip ?? undefined,
      })),
    };
  }

  async listVNets(): Promise<VNetDetails[]> {
    const client = this.requireClient();
    const regions = await client.regions('network');
    const perRegion = await Promise.all(
      regions.map(async (region) => {
        try {
          const [networks, subnets] = await Promise.all([
            client.listNetworksFull(region),
            client.listSubnets(region),
          ]);
          return networks
            .filter((n) => !n.shared && !n['router:external'])
            .map((n) => OvhProviderService.toVNetDetails(region, n, subnets, []));
        } catch (e) {
          this.logger.warn(`OVH listVNets(${region}) failed: ${String(e)}`);
          return [];
        }
      }),
    );
    return perRegion.flat();
  }

  async getVNet(vnetId: string): Promise<VNetDetails | null> {
    const client = this.requireClient();
    const { region, id } = parseRegionId(vnetId);
    if (!region) return null;
    const net = await client.getNetwork(id, region);
    if (!net) return null;
    const [subnets, ports] = await Promise.all([
      client.listSubnets(region, id),
      client.listNetworkPorts(region, id).catch(() => []),
    ]);
    return OvhProviderService.toVNetDetails(region, net, subnets, ports);
  }

  async deleteVNet(vnetId: string): Promise<VNetDeletionResult> {
    const client = this.requireClient();
    const { region, id } = parseRegionId(vnetId);
    if (!region) throw new Error(`OVH network ${vnetId} not found.`);
    await client.deleteNetwork(region, id);
    return { message: `OVH network ${id} deleted in ${region}` };
  }

  async addSubnet(config: AddSubnetConfig): Promise<AddSubnetResult> {
    const client = this.requireClient();
    const { region, id } = parseRegionId(config.vnetId);
    if (!region) throw new Error(`OVH network ${config.vnetId} not found.`);
    if (!config.ipRange) {
      throw new Error('OVH requires an explicit subnet CIDR (ipRange) — no auto-assignment.');
    }
    const subnet = await client.createSubnet(region, {
      networkId: id,
      cidr: config.ipRange,
    });
    return {
      subnetId: subnet.id,
      ipRange: subnet.cidr,
      networkZone: region,
      gateway: subnet.gateway_ip ?? undefined,
    };
  }

  async deleteSubnet(config: DeleteSubnetConfig): Promise<{ actionId?: number }> {
    const client = this.requireClient();
    const { region, id } = parseRegionId(config.vnetId);
    if (!region) throw new Error(`OVH network ${config.vnetId} not found.`);
    const subnets = await client.listSubnets(region, id);
    const target = subnets.find((s) => s.cidr === config.ipRange);
    if (!target) throw new Error(`No subnet ${config.ipRange} on network ${config.vnetId}.`);
    await client.deleteSubnet(region, target.id);
    return {};
  }

  async attachServerToVNet(
    config: AttachServerToVNetConfig,
  ): Promise<ServerVNetAttachmentResult> {
    const client = this.requireClient();
    const { region, id } = parseRegionId(config.vnetId);
    if (!region) throw new Error(`OVH network ${config.vnetId} not found.`);
    const iface = await client.attachServerInterface(region, config.serverId, id);
    return {
      assignedIp: iface.fixed_ips?.[0]?.ip_address,
      message: `Attached server ${config.serverId} to network ${id} in ${region}`,
    };
  }

  async detachServerFromVNet(
    config: DetachServerFromVNetConfig,
  ): Promise<{ actionId?: number }> {
    const client = this.requireClient();
    const { region, id } = parseRegionId(config.vnetId);
    if (!region) throw new Error(`OVH network ${config.vnetId} not found.`);
    const ifaces = await client.listServerInterfaces(region, config.serverId);
    const match = ifaces.find((i) => i.net_id === id);
    if (!match) throw new Error(`Server ${config.serverId} is not attached to ${config.vnetId}.`);
    await client.detachServerInterface(region, config.serverId, match.port_id);
    return {};
  }

  private static toVNetDetails(
    region: string,
    net: NeutronNetwork,
    subnets: NeutronSubnet[],
    ports: { device_id?: string; network_id?: string }[],
  ): VNetDetails {
    const mine = subnets.filter((s) => net.subnets.includes(s.id));
    const attached = [
      ...new Set(
        ports.flatMap((p) =>
          p.network_id === net.id && p.device_id ? [p.device_id] : [],
        ),
      ),
    ];
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
      attachedServerIds: attached,
      labels: tagsToLabels(net.tags),
    };
  }
}

function packRegionId(region: string, id: string): string {
  return `${region}/${id}`;
}

function parseRegionId(value: string): { region?: string; id: string } {
  const i = value.indexOf('/');
  if (i < 0) return { id: value };
  return { region: value.slice(0, i), id: value.slice(i + 1) };
}

function tagsToLabels(tags?: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of tags ?? []) {
    const i = t.indexOf('=');
    if (i > 0) out[t.slice(0, i)] = t.slice(i + 1);
  }
  return out;
}
