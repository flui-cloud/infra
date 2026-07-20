import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ICloudProvider,
  CreateServerConfig,
  ServerCreationResult,
  ServerDeletionResult,
  SshKeyInfo,
  SSHKeyCreationResult,
} from '../../interfaces/cloud-provider.interface';
import { DeleteServerDto } from '../../../infrastructure/servers/dto/delete-server.dto';
import { ServerResponseDto } from '../../../infrastructure/servers/dto/server-response.dto';
import { SSHKeyDto } from '../../../access/dto/ssh-key.dto';
import { InstanceEntity } from '../../../instances/entities/instance.entity';
import { CloudProvider } from '../../enums/cloud-provider.enum';
import { NodeSizeDto } from '../../dto/node-size.dto';
import { CherryCatalog, CherryPlan } from './cherry-catalog';
import { CherryClient, CherryDeployRequest, CherrySshKey } from './cherry-client';
import {
  toServerResponseDto,
  toInstanceEntity,
  rawStatus,
  publicIp,
} from './cherry-mappers';

/**
 * Cherry Servers (Lithuania).
 *
 * Two halves share this service. The **catalog** half (prices, per-region stock)
 * comes from a public, credential-free endpoint, so comparison works with no
 * token. The **provisioning** half (deploy/delete/manage) needs a single API
 * token (`CHERRY_API_KEY`) and a target project (`CHERRY_PROJECT_ID`), read from
 * config the same way OVH reads its `OS_*` variables.
 */
@Injectable()
export class CherryProviderService implements ICloudProvider {
  private readonly logger = new Logger(CherryProviderService.name);
  private readonly catalog: CherryCatalog;

  constructor(
    @Optional() private readonly configService?: ConfigService,
    @Optional() catalog?: CherryCatalog,
    @Optional() private readonly injectedClient?: CherryClient,
  ) {
    this.catalog = catalog ?? new CherryCatalog();
  }

  async getNodeSizes(): Promise<NodeSizeDto[]> {
    try {
      const plans = await this.catalog.plans();
      return plans.map((p) => this.toNodeSize(p));
    } catch (error) {
      this.logger.error(`Failed to fetch Cherry catalog: ${error.message}`);
      throw new Error('Failed to fetch node sizes');
    }
  }

  async listServersAsDto(): Promise<ServerResponseDto[]> {
    const servers = await this.api().listProjectServers(this.projectId());
    return servers.map(toServerResponseDto);
  }

  async getServerDetailsAsDto(serverId: string): Promise<ServerResponseDto | null> {
    try {
      return toServerResponseDto(await this.api().getServer(serverId));
    } catch (error) {
      this.logger.warn(`Cherry getServer(${serverId}) failed: ${error.message}`);
      return null;
    }
  }

  async createServer(config: CreateServerConfig): Promise<ServerCreationResult> {
    const image = config.image || this.configService?.get<string>('CHERRY_IMAGE');
    if (!image) {
      throw new Error(
        'Cherry requires an image slug (per-plan): pass --image or set CHERRY_IMAGE.',
      );
    }
    const request: CherryDeployRequest = {
      plan: config.server_type ?? '',
      region: config.location ?? '',
      image,
      hostname: config.name,
      // vops provisions hourly-billed plans only.
      cycle: 'hourly',
      ...(config.ssh_keys?.length ? { ssh_keys: config.ssh_keys } : {}),
      ...(config.user_data ? { user_data: config.user_data } : {}),
      ...(config.labels?.length
        ? { tags: Object.fromEntries(config.labels.map((l) => [l.key, l.value])) }
        : {}),
    };
    const server = await this.api().deployServer(this.projectId(), request);
    return {
      serverId: String(server.id),
      ipAddress: publicIp(server),
      status: rawStatus(server),
    };
  }

  async deleteServer(config: DeleteServerDto): Promise<ServerDeletionResult> {
    await this.api().deleteServer(config.server_id);
    return { message: `Cherry server ${config.server_id} deletion requested` };
  }

  async getServerStatus(serverId: string): Promise<string> {
    return rawStatus(await this.api().getServer(serverId));
  }

  async listInstances(): Promise<InstanceEntity[]> {
    const servers = await this.api().listProjectServers(this.projectId());
    return servers.map(toInstanceEntity);
  }

  async listSSHKeys(): Promise<SSHKeyDto[]> {
    const keys = await this.api().listSshKeys();
    return keys.map((k) => this.toSshKeyDto(k));
  }

  async createSSHKey(
    name: string,
    publicKey: string,
  ): Promise<SSHKeyCreationResult> {
    const created = await this.api().createSshKey(name, publicKey);
    return { id: String(created.id), fingerprint: created.fingerprint };
  }

  /**
   * Map Flui keys → Cherry key IDs, creating any that are missing. Cherry keys
   * are account-global (not per-project), so a single list resolves everything.
   */
  async resolveSSHKeys(keys: SshKeyInfo[]): Promise<string[]> {
    const client = this.api();
    let existing: CherrySshKey[] | null = null;
    const ids: string[] = [];
    for (const key of keys) {
      if (key.existingProviderId) {
        ids.push(key.existingProviderId);
        continue;
      }
      existing ??= await client.listSshKeys();
      const match = existing.find((k) => k.fingerprint === key.fingerprint);
      if (match) {
        ids.push(String(match.id));
        continue;
      }
      const created = await client.createSshKey(key.name, key.publicKey);
      existing.push(created);
      ids.push(String(created.id));
    }
    return ids;
  }

  /**
   * With a token, prove it works against an authenticated endpoint; without one,
   * report whether the public catalog is reachable (comparison still works).
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    const token = this.configService?.get<string>('CHERRY_API_KEY');
    if (!token) {
      try {
        const plans = await this.catalog.plans();
        return plans.length
          ? { success: true }
          : { success: false, error: 'Cherry catalog returned no plans' };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
    try {
      await this.api().listSshKeys();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private api(): CherryClient {
    if (this.injectedClient) return this.injectedClient;
    const token = this.configService?.get<string>('CHERRY_API_KEY');
    if (!token) {
      throw new Error('Cherry provisioning needs CHERRY_API_KEY (a Cherry API token).');
    }
    return new CherryClient(token);
  }

  private projectId(): string {
    const id = this.configService?.get<string>('CHERRY_PROJECT_ID');
    if (!id) {
      throw new Error('Cherry provisioning needs CHERRY_PROJECT_ID (target project).');
    }
    return id;
  }

  private toSshKeyDto(k: CherrySshKey): SSHKeyDto {
    return {
      id: String(k.id),
      name: k.label ?? '',
      publicKey: k.key ?? '',
      fingerprint: k.fingerprint ?? '',
      type: (k.key ?? '').split(' ')[0] || 'unknown',
      createdAt: new Date(0),
      source: CloudProvider.CHERRY,
      syncedFromProvider: true,
      isActive: true,
      autoGenerated: false,
    };
  }

  private describe(p: CherryPlan): string {
    const base = `${p.cores} cores, ${p.memory} GB RAM, ${p.disk} GB`;
    return p.cpuName ? `${base} — ${p.cpuName}` : base;
  }

  private toNodeSize(p: CherryPlan): NodeSizeDto {
    const price = (v: number | null) => {
      const s = v == null ? '0' : String(v);
      return { net: s, gross: s };
    };
    const codes = p.regions.map((r) => r.code);

    return {
      id: p.slug,
      name: p.slug,
      description: this.describe(p),
      cores: p.cores,
      memory: p.memory,
      disk: p.disk,
      storageType: 'local',
      cpuType: p.type === 'vps' || p.type === 'storage-vps' ? 'shared' : 'dedicated',
      architecture: p.arm ? 'arm' : 'x86',
      deprecated: false,
      bareMetal: p.bareMetal,
      managedFirewall: false,
      supportsHourlyBilling: p.hourly != null,
      prices: codes.map((location) => ({
        location,
        priceHourly: price(p.hourly),
        priceMonthly: price(p.monthly),
      })),
      locations: codes.map((name) => ({ id: 0, name, deprecation: null })),
      availability: p.regions.flatMap((r) =>
        r.stock < 0
          ? []
          : [{ location: r.code, available: r.stock > 0, deprecated: false }],
      ),
    };
  }
}
