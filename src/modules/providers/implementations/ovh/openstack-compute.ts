import { OpenStackHttpBase } from './openstack-http';
import {
  CreateServerSpec,
  NovaInterface,
  OpenStackNamed,
  OpenStackServer,
} from './openstack-client.types';

/** Nova (compute) + Glance (images) operations. */
export abstract class OpenStackCompute extends OpenStackHttpBase {
  async listServers(region?: string): Promise<OpenStackServer[]> {
    const nova = await this.endpoint('compute', region);
    const body = await this.get<{ servers: OpenStackServer[] }>(`${nova}/servers/detail`);
    return body.servers ?? [];
  }

  async getServer(id: string, region?: string): Promise<OpenStackServer | null> {
    const nova = await this.endpoint('compute', region);
    try {
      const body = await this.get<{ server: OpenStackServer }>(`${nova}/servers/${id}`);
      return body.server ?? null;
    } catch (e) {
      if (e instanceof Error && e.message.includes('404')) return null;
      throw e;
    }
  }

  /** Map a wanted region (macro like "DE" or exact "DE1") to a real compute region. */
  async resolveComputeRegion(want?: string): Promise<string> {
    return this.resolveRegion('compute', want);
  }

  async listFlavors(region: string): Promise<OpenStackNamed[]> {
    const nova = await this.endpoint('compute', region);
    const body = await this.get<{ flavors: OpenStackNamed[] }>(`${nova}/flavors/detail`);
    return body.flavors ?? [];
  }

  async listImages(region: string): Promise<OpenStackNamed[]> {
    const glance = await this.endpoint('image', region);
    const body = await this.get<{ images: OpenStackNamed[] }>(`${glance}/v2/images?limit=1000`);
    return body.images ?? [];
  }

  async listKeypairs(region: string): Promise<string[]> {
    const nova = await this.endpoint('compute', region);
    const body = await this.get<{ keypairs: { keypair: { name: string } }[] }>(
      `${nova}/os-keypairs`,
    );
    return (body.keypairs ?? []).map((k) => k.keypair.name);
  }

  /** Idempotently upload a public key as a Nova keypair (per-region on OVH). */
  async ensureKeypair(region: string, name: string, publicKey: string): Promise<void> {
    if ((await this.listKeypairs(region)).includes(name)) return;
    const nova = await this.endpoint('compute', region);
    await this.post(`${nova}/os-keypairs`, { keypair: { name, public_key: publicKey } });
  }

  async createServer(region: string, spec: CreateServerSpec): Promise<OpenStackServer> {
    const nova = await this.endpoint('compute', region);
    const body = await this.post<{ server: OpenStackServer }>(`${nova}/servers`, {
      server: {
        name: spec.name,
        flavorRef: spec.flavorRef,
        imageRef: spec.imageRef,
        networks: spec.networks,
        ...(spec.keyName ? { key_name: spec.keyName } : {}),
        ...(spec.userData ? { user_data: spec.userData } : {}),
        ...(spec.metadata ? { metadata: spec.metadata } : {}),
        ...(spec.securityGroups
          ? { security_groups: spec.securityGroups.map((name) => ({ name })) }
          : {}),
      },
    });
    return body.server;
  }

  async deleteServer(region: string, id: string): Promise<void> {
    const nova = await this.endpoint('compute', region);
    await this.del(`${nova}/servers/${id}`);
  }

  // ── Nova interface attachment (join/leave a server to a VNet) ──

  async listServerInterfaces(region: string, serverId: string): Promise<NovaInterface[]> {
    const nova = await this.endpoint('compute', region);
    const body = await this.get<{ interfaceAttachments: NovaInterface[] }>(
      `${nova}/servers/${serverId}/os-interface`,
    );
    return body.interfaceAttachments ?? [];
  }

  async attachServerInterface(
    region: string,
    serverId: string,
    netId: string,
  ): Promise<NovaInterface> {
    const nova = await this.endpoint('compute', region);
    const body = await this.post<{ interfaceAttachment: NovaInterface }>(
      `${nova}/servers/${serverId}/os-interface`,
      { interfaceAttachment: { net_id: netId } },
    );
    return body.interfaceAttachment;
  }

  async detachServerInterface(region: string, serverId: string, portId: string): Promise<void> {
    const nova = await this.endpoint('compute', region);
    await this.del(`${nova}/servers/${serverId}/os-interface/${portId}`);
  }
}
