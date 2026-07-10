/**
 * @flui-cloud/infra — the shared, provider-neutral cloud infrastructure layer:
 * a uniform abstraction over cloud providers (Hetzner, Scaleway, Contabo, OVH)
 * plus the OpenStack core behind OVH. Consumed by vops today; the intended
 * single source of truth for provider logic across the Flui ecosystem.
 */

// Enums & core interfaces
export * from './modules/providers/enums/cloud-provider.enum';
export * from './modules/providers/interfaces/cloud-provider.interface';
export * from './modules/providers/interfaces/credential-provider.interface';
export * from './modules/providers/interfaces/firewall-provider.interface';
export * from './modules/providers/interfaces/network-provider.interface';

// DTOs / entities
export * from './modules/providers/dto/node-size.dto';
export * from './modules/access/dto/bearer-token.dto';
export * from './modules/management/entities/provider-capabilities.entity';

// Factories & module
export * from './modules/providers/core/factories/provider.factory';
export * from './modules/providers/core/factories/capabilities-provider.factory';
export * from './modules/providers/core/factories/firewall-provider.factory';
export * from './modules/providers/provider-core.module';

// Provider implementations — Hetzner
export * from './modules/providers/services/hetzner-provider.service';
export * from './modules/providers/services/hetzner-firewall.service';
export * from './modules/providers/implementations/hetzner/hetzner-capabilities.service';

// Scaleway
export * from './modules/providers/implementations/scaleway/scaleway-provider.service';
export * from './modules/providers/implementations/scaleway/scaleway-firewall.service';
export * from './modules/providers/implementations/scaleway/scaleway-capabilities.service';
export * from './modules/providers/implementations/scaleway/scaleway-instances.adapter';
export * from './modules/providers/implementations/scaleway/scaleway-baremetal.adapter';
export * from './modules/providers/implementations/scaleway/scaleway-vpc.adapter';
export * from './modules/providers/implementations/scaleway/scaleway-iam.adapter';

// Contabo
export * from './modules/providers/services/contabo-provider.service';
export * from './modules/providers/implementations/contabo/contabo-capabilities.service';

// OVH (OpenStack)
export * from './modules/providers/implementations/ovh/ovh-provider.service';
export * from './modules/providers/implementations/ovh/ovh-firewall.service';
export * from './modules/providers/implementations/ovh/ovh-capabilities.service';
export * from './modules/providers/implementations/ovh/ovh-catalog';
export * from './modules/providers/implementations/ovh/ovh-regions';
export * from './modules/providers/implementations/ovh/openstack-client';
