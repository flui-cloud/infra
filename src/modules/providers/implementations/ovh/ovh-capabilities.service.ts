import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { OvhCatalog } from './ovh-catalog';
import { OVH_REGIONS } from './ovh-regions';

const OVH_LOGO = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#000e9c"/><text x="16" y="21" font-family="Arial" font-size="11" font-weight="bold" fill="#fff" text-anchor="middle">OVH</text></svg>',
);

@Injectable()
export class OvhCapabilitiesService implements IProviderCapabilitiesService {
  private readonly catalog: OvhCatalog;

  constructor(private readonly configService: ConfigService) {
    this.catalog = new OvhCatalog(undefined, this.configService.get('OVH_SUBSIDIARY', 'FR'));
  }

  async getAvailableRegions(): Promise<ProviderRegion[]> {
    return OVH_REGIONS.map((r) => ({
      id: r.code,
      name: r.city,
      displayName: `${r.city}, ${r.country}`,
      location: `${r.city}, ${r.country}`,
      available: true,
      country: r.country,
      latitude: r.lat,
      longitude: r.lng,
    }));
  }

  async getSupportedInstanceTypes(): Promise<InstanceTypeInfo[]> {
    const flavors = await this.catalog.flavors();
    return flavors.map((f) => ({
      id: f.code,
      name: f.code,
      description: `${f.cores} vCPU, ${f.ramGb} GB RAM, ${f.diskGb} GB ${f.storageType}`,
      cpu: f.cores,
      memory: f.ramGb * 1024,
      disk: f.diskGb,
      bandwidth: 0,
      pricing: { hourly: f.hourly ?? 0, monthly: f.monthly ?? 0, currency: f.currency },
      available: true,
    }));
  }

  async getProviderInfo(): Promise<ProviderInfo> {
    return {
      id: CloudProvider.OVH,
      name: 'ovh',
      displayName: 'OVHcloud',
      description: 'OpenStack-based European public cloud with real-time hourly pricing',
      logoUrl: '/api/v1/management/providers/ovh/logo',
      websiteUrl: 'https://www.ovhcloud.com/en/public-cloud/',
      documentationUrl: 'https://help.ovhcloud.com/csm/en-public-cloud-compute',
      supportUrl: 'https://help.ovhcloud.com/',
      pricingUrl: 'https://www.ovhcloud.com/en/public-cloud/prices/',
      credentialFields: {
        // OpenStack application credential. authUrl is fixed for OVH and region
        // defaults via OS_REGION_NAME, so only the id/secret pair is collected.
        type: CredentialType.USER_PASSWORD,
        supportsExpiry: false,
        fields: [
          { key: 'clientId', label: 'App Credential ID', providerLabel: 'OS_APPLICATION_CREDENTIAL_ID', hint: 'Horizon → Identity → Application Credentials', secret: false, required: true },
          { key: 'clientSecret', label: 'App Credential Secret', providerLabel: 'OS_APPLICATION_CREDENTIAL_SECRET', hint: 'Shown once at creation', secret: true, required: true },
        ],
      },
    };
  }

  async validateCredentials(
    _credentials: ProviderCredentials,
  ): Promise<ValidationResultDto> {
    return {
      success: false,
      message:
        'OVH live validation not yet implemented — read-only catalog/pricing works without credentials.',
    };
  }

  getLogo(): Buffer {
    return OVH_LOGO;
  }

  getLogoContentType(): string {
    return 'image/svg+xml';
  }

  getStaticCapabilities(): ProviderCapabilities {
    return {
      supportedInstanceTypes: [],
      supportedRegions: [],
      credentialType: 'bearer_token',
      features: {
        autoScaling: false,
        loadBalancers: false,
        privateNetworking: true,
        snapshots: true,
        backups: false,
        dnsZones: false,
        nodeProvisioning: false,
      },
      pricing: {
        currency: 'EUR',
        billingCycle: 'hourly',
        minimumCost: 3.29, // s1-2: 1 vCPU, 2 GB @ ~€3.29/mo
      },
      firewall: {
        backend: 'managed-api', // OpenStack Neutron security groups
        managedEdge: false,
        supportsSshAllowlist: true,
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
      supportedInstanceTypes: instanceTypes.map((t) => t.id),
      supportedRegions: regions,
    };
  }
}
