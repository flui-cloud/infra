import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import {
  ICloudProvider,
  CreateServerConfig,
  ServerCreationResult,
  ServerDeletionResult,
} from '../../interfaces/cloud-provider.interface';
import { DeleteServerDto } from '../../../infrastructure/servers/dto/delete-server.dto';
import { ServerResponseDto } from '../../../infrastructure/servers/dto/server-response.dto';
import { InstanceEntity } from '../../../instances/entities/instance.entity';
import { NodeSizeDto } from '../../dto/node-size.dto';
import { CherryCatalog, CherryPlan } from './cherry-catalog';

/**
 * Cherry Servers (Lithuania) — READ-ONLY surface.
 *
 * Prices and stock come from a public, credential-free catalog, so this
 * provider contributes to comparison out of the box. Provisioning is not
 * implemented: those calls fail loudly rather than pretend to work.
 *
 * Cherry is the only integrated provider that publishes a *numeric* stock count
 * per region, so `availability` here carries real inventory rather than the
 * coverage-shaped approximation other catalogs force.
 */
@Injectable()
export class CherryProviderService implements ICloudProvider {
  private readonly logger = new Logger(CherryProviderService.name);
  private readonly catalog: CherryCatalog;

  constructor(catalog?: CherryCatalog) {
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
      // Everything except the shared `vps` line is dedicated silicon.
      cpuType: p.type === 'vps' ? 'shared' : 'dedicated',
      architecture: p.arm ? 'arm' : 'x86',
      deprecated: false,
      bareMetal: p.bareMetal,
      // Cherry exposes no server-level firewall API.
      managedFirewall: false,
      supportsHourlyBilling: p.hourly != null,
      // Cherry quotes one price per plan, not per region — the same figure
      // therefore applies to every region it is offered in.
      prices: codes.map((location) => ({
        location,
        priceHourly: price(p.hourly),
        priceMonthly: price(p.monthly),
      })),
      locations: codes.map((name) => ({ id: 0, name, deprecation: null })),
      // A negative count is the catalog's "no count published" marker; omit
      // those rows so they read as unknown instead of sold out.
      availability: p.regions.flatMap((r) =>
        r.stock < 0
          ? []
          : [{ location: r.code, available: r.stock > 0, deprecated: false }],
      ),
    };
  }

  // ── Provisioning: not implemented ──────────────────────────────────────────

  private unsupported(op: string): never {
    throw new NotImplementedException(
      `Cherry Servers provisioning is not implemented (${op}). This provider is read-only: catalog, pricing and stock.`,
    );
  }

  async listServersAsDto(): Promise<ServerResponseDto[]> {
    this.unsupported('listServersAsDto');
  }

  async getServerDetailsAsDto(): Promise<ServerResponseDto | null> {
    this.unsupported('getServerDetailsAsDto');
  }

  async createServer(_config: CreateServerConfig): Promise<ServerCreationResult> {
    this.unsupported('createServer');
  }

  async deleteServer(_config: DeleteServerDto): Promise<ServerDeletionResult> {
    this.unsupported('deleteServer');
  }

  async getServerStatus(_serverId: string): Promise<string> {
    this.unsupported('getServerStatus');
  }

  async listInstances(_filters?: any): Promise<InstanceEntity[]> {
    this.unsupported('listInstances');
  }

  /**
   * Reachability of the public catalog. No credentials are involved, so this
   * reports whether Cherry is answering, not whether the caller is authorised.
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const plans = await this.catalog.plans();
      return plans.length
        ? { success: true }
        : { success: false, error: 'Cherry catalog returned no plans' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}
