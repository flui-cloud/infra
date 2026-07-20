import * as fs from 'node:fs';
import * as path from 'node:path';
import { Injectable, Optional } from '@nestjs/common';
import {
  IProviderCapabilitiesService,
  InstanceTypeInfo,
  ProviderInfo,
} from '../../interfaces/provider-capabilities.interface';
import { ProviderRegion } from '../../../management/entities/provider-region.entity';
import { CloudProvider } from '../../enums/cloud-provider.enum';
import { ProviderCapabilities } from '../../../management/entities/provider-capabilities.entity';
import {
  ProviderCredentials,
  CredentialType,
} from '../../../management/entities/credentials.entity';
import { ValidationResultDto } from '../../../management/dto/validation-result.dto';
import { getRegionCoordinates } from '../../data/region-coordinates';
import { CherryCatalog } from './cherry-catalog';
import { CherryClient } from './cherry-client';

interface CherryRegionMeta {
  displayName: string;
  location: string;
  country: string;
  flagEmoji: string;
}

/** Human metadata for Cherry's region slugs (the codes the catalog returns). */
const REGION_META: Record<string, CherryRegionMeta> = {
  'LT-Siauliai': { displayName: 'Šiauliai, Lithuania', location: 'Šiauliai, Lithuania', country: 'Lithuania', flagEmoji: '🇱🇹' },
  'NL-Amsterdam': { displayName: 'Amsterdam, Netherlands', location: 'Amsterdam, Netherlands', country: 'Netherlands', flagEmoji: '🇳🇱' },
  'DE-Frankfurt': { displayName: 'Frankfurt, Germany', location: 'Frankfurt, Germany', country: 'Germany', flagEmoji: '🇩🇪' },
  'SE-Stockholm': { displayName: 'Stockholm, Sweden', location: 'Stockholm, Sweden', country: 'Sweden', flagEmoji: '🇸🇪' },
  'US-Chicago': { displayName: 'Chicago, USA', location: 'Chicago, USA', country: 'United States', flagEmoji: '🇺🇸' },
  'SG-Singapore': { displayName: 'Singapore', location: 'Singapore', country: 'Singapore', flagEmoji: '🇸🇬' },
  'JP-Tokyo': { displayName: 'Tokyo, Japan', location: 'Tokyo, Japan', country: 'Japan', flagEmoji: '🇯🇵' },
};

/**
 * Cherry Servers capabilities. Regions and instance types come from the same
 * public catalog the read surface uses; provisioning is a first-class capability
 * (`nodeProvisioning: true`) authenticated by a single API token plus a target
 * project. Cherry has no per-server firewall API, so the host-level nftables
 * backend is the one on offer — the same stance as Contabo/OVH.
 */
@Injectable()
export class CherryCapabilitiesService implements IProviderCapabilitiesService {
  private readonly catalog: CherryCatalog;

  constructor(@Optional() catalog?: CherryCatalog) {
    this.catalog = catalog ?? new CherryCatalog();
  }

  async getAvailableRegions(): Promise<ProviderRegion[]> {
    const plans = await this.catalog.plans();
    const codes = new Set(plans.flatMap((p) => p.regions.map((r) => r.code)));
    return Array.from(codes).map((code) => {
      const meta = REGION_META[code];
      const coords = getRegionCoordinates(CloudProvider.CHERRY, code);
      return {
        id: code,
        name: code,
        displayName: meta?.displayName ?? code,
        location: meta?.location ?? code,
        available: true,
        flagEmoji: meta?.flagEmoji,
        country: meta?.country,
        latitude: coords?.latitude,
        longitude: coords?.longitude,
      };
    });
  }

  async getSupportedInstanceTypes(): Promise<InstanceTypeInfo[]> {
    const plans = await this.catalog.plans();
    return plans.map((p) => ({
      id: p.slug,
      name: p.slug,
      description: p.cpuName
        ? `${p.cores} cores, ${p.memory} GB RAM, ${p.disk} GB — ${p.cpuName}`
        : `${p.cores} cores, ${p.memory} GB RAM, ${p.disk} GB`,
      cpu: p.cores,
      memory: p.memory * 1024,
      disk: p.disk * 1024,
      bandwidth: 0,
      pricing: {
        hourly: p.hourly ?? 0,
        monthly: p.monthly ?? 0,
        currency: 'EUR',
      },
      available: true,
    }));
  }

  async getProviderInfo(): Promise<ProviderInfo> {
    return {
      id: CloudProvider.CHERRY,
      name: 'cherry',
      displayName: 'Cherry Servers',
      description:
        'Lithuanian cloud with EUR pricing, per-region stock and bare-metal',
      logoUrl: '/api/v1/management/providers/cherry/logo',
      websiteUrl: 'https://www.cherryservers.com/',
      documentationUrl: 'https://api.cherryservers.com/doc/',
      supportUrl: 'https://www.cherryservers.com/support',
      accessKeyDocumentationUrl:
        'https://docs.cherryservers.com/knowledge/cherry-servers-api',
      pricingUrl: 'https://www.cherryservers.com/pricing',
      credentialFields: {
        type: CredentialType.API_KEY,
        supportsExpiry: false,
        fields: [
          {
            key: 'apiKey',
            label: 'API Token',
            providerLabel: 'API key',
            hint: 'Cherry Servers Client Portal → API keys → Create API key',
            secret: true,
            required: true,
          },
          {
            key: 'projectId',
            label: 'Project ID',
            providerLabel: 'Project ID',
            hint: 'Cherry Client Portal → your project → the numeric ID in the URL',
            secret: false,
            required: true,
          },
        ],
      },
    };
  }

  async validateCredentials(
    credentials: ProviderCredentials,
  ): Promise<ValidationResultDto> {
    if (credentials.type !== CredentialType.API_KEY || !credentials.apiKey) {
      return { success: false, message: 'An API token is required for Cherry' };
    }
    try {
      await new CherryClient(credentials.apiKey).listSshKeys();
      return { success: true, message: 'API token is valid' };
    } catch (error) {
      const status = /→ 401/.test(error.message) ? 'Invalid API token' : null;
      return { success: false, message: status ?? `Validation failed: ${error.message}` };
    }
  }

  private static readonly LOGO_PATH = path.resolve(
    process.cwd(),
    'dist/modules/providers/implementations/cherry/assets/logo.svg',
  );

  getLogo(): Buffer {
    return fs.readFileSync(CherryCapabilitiesService.LOGO_PATH);
  }

  getLogoContentType(): string {
    return 'image/svg+xml';
  }

  getStaticCapabilities(): ProviderCapabilities {
    return {
      supportedInstanceTypes: [],
      supportedRegions: [],
      credentialType: 'api_key',
      features: {
        autoScaling: false,
        loadBalancers: false,
        privateNetworking: false,
        snapshots: false,
        backups: false,
        dnsZones: false,
        nodeProvisioning: true,
      },
      pricing: {
        currency: 'EUR',
        billingCycle: 'hourly',
        minimumCost: 0,
      },
      firewall: {
        backend: 'host-nftables',
        managedEdge: false,
        supportsSshAllowlist: false,
      },
      vnetTopology: null,
      vnetRequired: false,
      crossClusterAllowed: false,
    };
  }

  async getCapabilities(): Promise<ProviderCapabilities> {
    const [regions, instanceTypes] = await Promise.all([
      this.getAvailableRegions(),
      this.getSupportedInstanceTypes(),
    ]);
    return {
      ...this.getStaticCapabilities(),
      supportedInstanceTypes: instanceTypes.map((type) => type.id),
      supportedRegions: regions,
    };
  }
}
