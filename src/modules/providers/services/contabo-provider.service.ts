import {
  Injectable,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  NotImplementedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ICloudProvider,
  CreateServerConfig,
  ServerCreationResult,
  ServerDeletionResult,
  Label,
  SSHKeyCreationResult,
  SSHKeyDetails,
} from '../interfaces/cloud-provider.interface';
import { InstanceEntity } from '../../instances/entities/instance.entity';
import { InstanceStatus } from '../../instances/entities/instance-status.enum';
import { InstanceType } from '../../instances/entities/instance-type.enum';
import { CloudProvider } from '../enums/cloud-provider.enum';
import {
  Configuration,
  InstancesApi,
  SecretsApi,
  ListInstancesResponseData,
  InstanceResponse,
  CreateInstanceRequest,
  CreateSecretRequest,
  SecretResponse,
} from 'src/modules/providers/implementations/contabo/generated';
import { randomUUID } from 'node:crypto';
import { ICredentialProvider } from '../interfaces/credential-provider.interface';
import { DeleteServerDto } from 'src/modules/infrastructure/servers/dto/delete-server.dto';
import { ServerResponseDto } from 'src/modules/infrastructure/servers/dto/server-response.dto';
import { SSHKeyDto } from 'src/modules/access/dto/ssh-key.dto';
import { NodeSizeDto } from '../dto/node-size.dto';
import { PricingDto, PricingQueryDto } from '../dto/pricing.dto';
import { LabelService } from '../../common/services/label.service';

@Injectable()
export class ContaboProviderService implements ICloudProvider {
  private readonly logger = new Logger(ContaboProviderService.name);
  private readonly apiUrl: string;
  private readonly FLUI_PREFIX = 'flui-';

  constructor(
    private readonly configService: ConfigService,
    @Inject('ICredentialProvider')
    private readonly credentialProvider: ICredentialProvider,
    private readonly labelService: LabelService,
  ) {
    this.apiUrl = this.configService.get<string>(
      'CONTABO_API_URL',
      'https://api.contabo.com',
    );
  }

  /** Build an authenticated Contabo client configuration (OAuth2 bearer). */
  private async apiConfig(): Promise<Configuration> {
    const token = await this.credentialProvider.getActiveBearerToken(
      CloudProvider.CONTABO,
    );
    if (!token?.access_token) {
      throw new HttpException(
        'No active token found for Contabo',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return new Configuration({
      basePath: this.apiUrl,
      accessToken: token.access_token,
    });
  }

  private toServerDto(
    i: ListInstancesResponseData | InstanceResponse,
  ): ServerResponseDto {
    const ip = i.ipConfig?.v4?.ip;
    return {
      id: String(i.instanceId),
      name: i.displayName || i.name,
      provider: CloudProvider.CONTABO,
      provider_resource_id: String(i.instanceId),
      server_type:
        this.planNameForSpecs(i.cpuCores, i.ramMb) ||
        i.productId ||
        i.productName ||
        'vps',
      location: i.region,
      status: String(i.status).toLowerCase(),
      public_ip: ip || undefined,
      created_at: i.createdDate ? new Date(i.createdDate) : new Date(),
      updated_at: new Date(),
    };
  }

  /**
   * Contabo reports a running instance's product as a rolling code (e.g. "V95")
   * that doesn't match the catalogue plan names. Resolve the plan by its specs
   * (cores + RAM) so callers can price the instance; fall back to the raw code.
   */
  private planNameForSpecs(cores?: number, ramMb?: number): string | undefined {
    if (!cores || !ramMb) return undefined;
    const gb = ramMb / 1024;
    const plan = ContaboProviderService.CATALOG.find(
      (p) => p.cores === cores && Math.abs(p.memoryGb - gb) <= 1,
    );
    return plan?.name;
  }

  async listServersAsDto(): Promise<ServerResponseDto[]> {
    const api = new InstancesApi(await this.apiConfig());
    const res = await api.retrieveInstancesList(randomUUID());
    return res.data.data.map((i) => this.toServerDto(i));
  }

  async getServerDetailsAsDto(
    serverId: string,
  ): Promise<ServerResponseDto | null> {
    const api = new InstancesApi(await this.apiConfig());
    const res = await api.retrieveInstance(randomUUID(), Number(serverId));
    const instance = res.data.data?.[0];
    return instance ? this.toServerDto(instance) : null;
  }

  async createServer(config: CreateServerConfig): Promise<ServerCreationResult> {
    const api = new InstancesApi(await this.apiConfig());
    const request: CreateInstanceRequest = {
      period: 1,
      imageId: config.image,
      productId: config.server_type,
      region: config.location as CreateInstanceRequest['region'],
      displayName: config.name,
      sshKeys: (config.ssh_keys ?? [])
        .map(Number)
        .filter((n) => Number.isFinite(n)),
      userData: config.user_data,
    };
    const res = await api.createInstance(randomUUID(), request);
    const created = res.data.data?.[0];
    return {
      serverId: String(created?.instanceId ?? ''),
      status: 'provisioning',
    };
  }

  async deleteServer(config: DeleteServerDto): Promise<ServerDeletionResult> {
    const api = new InstancesApi(await this.apiConfig());
    await api.cancelInstance(randomUUID(), Number(config.server_id), {});
    return { message: `Contabo instance ${config.server_id} cancellation requested` };
  }

  async getServerStatus(serverId: string): Promise<string> {
    const server = await this.getServerDetailsAsDto(serverId);
    return server?.status ?? 'unknown';
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const api = new InstancesApi(await this.apiConfig());
      await api.retrieveInstancesList(randomUUID(), undefined, 1, 1);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async powerOnServer(serverId: string): Promise<void> {
    throw new NotImplementedException(
      'Contabo provider: powerOnServer not yet implemented',
    );
  }

  async powerOffServer(serverId: string): Promise<void> {
    throw new NotImplementedException(
      'Contabo provider: powerOffServer not yet implemented',
    );
  }

  async changeServerType(): Promise<{ actionId?: number }> {
    throw new NotImplementedException(
      'Contabo provider: changeServerType is not supported. Contabo requires re-provisioning the VPS to change its plan.',
    );
  }

  async expandVolume(): Promise<{ actionId?: number }> {
    throw new NotImplementedException(
      'Contabo provider: expandVolume is not supported.',
    );
  }

  async listInstances(
    filters?: Record<string, unknown>,
  ): Promise<InstanceEntity[]> {
    try {
      const activeToken = await this.credentialProvider.getActiveBearerToken(
        CloudProvider.CONTABO,
      );

      if (!activeToken) {
        throw new HttpException(
          'No active token found for Contabo',
          HttpStatus.UNAUTHORIZED,
        );
      }

      const configuration = new Configuration({
        basePath: 'https://api.contabo.com',
        accessToken: activeToken.access_token,
      });

      const instancesApi = new InstancesApi(configuration);
      const requestId = randomUUID();
      const instanceList = await instancesApi.retrieveInstancesList(requestId);

      return instanceList.data.data.map((instance) =>
        this.mapContaboInstanceToEntity(instance),
      );
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to list instances',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private mapContaboInstanceToEntity(
    contaboInstance: ListInstancesResponseData,
  ): InstanceEntity {
    const instance = new InstanceEntity();
    instance.providerId = String(contaboInstance.instanceId);
    instance.name = contaboInstance.name;
    instance.displayName = contaboInstance.displayName || '';
    instance.type = InstanceType.VPS;
    instance.provider = CloudProvider.CONTABO;
    instance.status = this.mapContaboStatus(contaboInstance.status);
    instance.dataCenter = contaboInstance.dataCenter;
    instance.region = contaboInstance.region;
    instance.regionName = contaboInstance.regionName;
    instance.cpuCores = contaboInstance.cpuCores;
    instance.ramMb = contaboInstance.ramMb;
    instance.diskMb = contaboInstance.diskMb;
    instance.osType = contaboInstance.osType;
    instance.ipConfig = contaboInstance.ipConfig;
    instance.macAddress = contaboInstance.macAddress;
    instance.productType = contaboInstance.productType;
    instance.productName = contaboInstance.productName;
    instance.defaultUser = contaboInstance.defaultUser || '';
    instance.additionalIps =
      contaboInstance.additionalIps?.map((ip) => ip.v4.ip || '') || [];

    if (contaboInstance.createdDate) {
      instance.createdAt = new Date(contaboInstance.createdDate);
    }
    if (contaboInstance.cancelDate) {
      instance.cancelDate = new Date(contaboInstance.cancelDate);
    }

    instance.metadata = {
      vHostId: contaboInstance.vHostId,
      vHostName: contaboInstance.vHostName,
      vHostNumber: contaboInstance.vHostNumber,
      tenantId: contaboInstance.tenantId,
      imageId: contaboInstance.imageId,
      productId: contaboInstance.productId,
      errorMessage: contaboInstance.errorMessage,
      sshKeys: contaboInstance.sshKeys,
    };

    return instance;
  }

  private mapContaboStatus(status: string): InstanceStatus {
    switch (status?.toLowerCase()) {
      case 'running':
        return InstanceStatus.RUNNING;
      case 'stopped':
        return InstanceStatus.STOPPED;
      case 'starting':
        return InstanceStatus.STARTING;
      case 'stopping':
        return InstanceStatus.STOPPING;
      case 'provisioning':
        return InstanceStatus.PROVISIONING;
      case 'error':
        return InstanceStatus.ERROR;
      default:
        return InstanceStatus.UNKNOWN;
    }
  }

  async listSSHKeys(): Promise<SSHKeyDto[]> {
    const api = new SecretsApi(await this.apiConfig());
    const res = await api.retrieveSecretList(
      randomUUID(), undefined, undefined, undefined, undefined, undefined, 'ssh',
    );
    return res.data.data.map((s) => this.toSSHKeyDto(s));
  }

  private toSSHKeyDto(s: SecretResponse): SSHKeyDto {
    return {
      id: String(s.secretId),
      name: s.name,
      publicKey: s.value,
      fingerprint: '',
      type: 'ssh',
      createdAt: s.createdAt ? new Date(s.createdAt) : new Date(),
      isActive: true,
      autoGenerated: false,
    };
  }

  // Contabo API region enum (global footprint) — see generated client.
  private static readonly REGIONS = [
    'EU', 'UK', 'US-central', 'US-east', 'US-west', 'SIN', 'IND', 'JPN', 'AUS',
  ];
  // Contabo bills monthly only (no hourly). Prices are indicative list prices.
  private static readonly CATALOG = [
    { id: 'CLOUD-VPS-10', name: 'Cloud VPS 10', cores: 4, memoryGb: 8, diskGb: 75, monthly: 4.5 },
    { id: 'CLOUD-VPS-20', name: 'Cloud VPS 20', cores: 6, memoryGb: 12, diskGb: 100, monthly: 7 },
    { id: 'CLOUD-VPS-30', name: 'Cloud VPS 30', cores: 8, memoryGb: 24, diskGb: 200, monthly: 14 },
    { id: 'CLOUD-VPS-40', name: 'Cloud VPS 40', cores: 12, memoryGb: 48, diskGb: 250, monthly: 25 },
    { id: 'CLOUD-VPS-50', name: 'Cloud VPS 50', cores: 16, memoryGb: 64, diskGb: 300, monthly: 37 },
    { id: 'CLOUD-VPS-60', name: 'Cloud VPS 60', cores: 18, memoryGb: 96, diskGb: 350, monthly: 49 },
  ];

  async getNodeSizes(): Promise<NodeSizeDto[]> {
    return ContaboProviderService.CATALOG.map((p) => ({
      id: p.id,
      name: p.name,
      description: `${p.cores} vCPU, ${p.memoryGb} GB RAM, ${p.diskGb} GB NVMe`,
      cores: p.cores,
      memory: p.memoryGb,
      disk: p.diskGb,
      storageType: 'local' as const,
      cpuType: 'shared' as const,
      architecture: 'x86' as const,
      deprecated: false,
      bareMetal: false,
      managedFirewall: false,
      supportsHourlyBilling: false,
      prices: ContaboProviderService.REGIONS.map((location) => ({
        location,
        priceHourly: { net: '0', gross: '0' },
        priceMonthly: { net: String(p.monthly), gross: String(p.monthly) },
      })),
      locations: [],
      availability: ContaboProviderService.REGIONS.map((location) => ({
        location,
        available: true,
        deprecated: false,
      })),
    }));
  }

  async getPricing(query: PricingQueryDto): Promise<PricingDto> {
    throw new NotImplementedException(
      'Contabo provider: getPricing not yet implemented',
    );
  }

  private generateSyntheticLabels(serverName: string): Label[] {
    if (!serverName.startsWith(this.FLUI_PREFIX)) {
      return [];
    }

    const parts = serverName.split('-');
    const labels: Label[] = [{ key: 'managed-by', value: 'flui-cloud' }];

    if (parts.length > 2 && parts[1] === 'cluster') {
      labels.push({ key: 'flui-resource-type', value: 'cluster-node' });
      if (parts.length > 4) {
        const clusterName = parts[3];
        const nodeType = parts[4];
        labels.push({ key: 'flui-cluster-name', value: clusterName });
        if (nodeType === 'master' || nodeType === 'worker') {
          labels.push({ key: 'flui-node-type', value: nodeType });
        }
      }
    } else {
      labels.push({ key: 'flui-resource-type', value: 'server' });
    }

    return labels;
  }

  private isFluiManagedByName(serverName: string): boolean {
    return serverName.startsWith(this.FLUI_PREFIX);
  }

  async createSSHKey(
    name: string,
    publicKey: string,
  ): Promise<SSHKeyCreationResult> {
    const api = new SecretsApi(await this.apiConfig());
    const request: CreateSecretRequest = {
      name,
      value: publicKey,
      type: 'ssh',
    };
    const res = await api.createSecret(randomUUID(), request);
    const created = res.data.data?.[0];
    return { id: String(created?.secretId ?? '') };
  }

  async deleteSSHKey(providerKeyId: string): Promise<void> {
    const api = new SecretsApi(await this.apiConfig());
    await api.deleteSecret(randomUUID(), Number(providerKeyId));
  }

  async getSSHKey(providerKeyId: string): Promise<SSHKeyDetails> {
    const api = new SecretsApi(await this.apiConfig());
    const res = await api.retrieveSecret(randomUUID(), Number(providerKeyId));
    const secret = res.data.data?.[0];
    return {
      id: String(secret?.secretId ?? providerKeyId),
      name: secret?.name ?? '',
      publicKey: secret?.value ?? '',
      fingerprint: '',
    };
  }

  async updateServerLabels(
    serverId: string,
    labels: Record<string, string>,
  ): Promise<void> {
    this.logger.warn(
      `Contabo provider: label updates not supported. Server ${serverId} labels cannot be updated via API.`,
    );
  }
}
