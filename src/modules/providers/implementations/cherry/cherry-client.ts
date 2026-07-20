/**
 * Authenticated Cherry Servers API client (`https://api.cherryservers.com/v1`).
 *
 * The read-only surface lives in `cherry-catalog.ts` (public, no token). This is
 * the write/manage half: deploy, delete, inspect servers and manage SSH keys,
 * all behind a single permanent API token sent as `Authorization: Bearer …`.
 * Dependency-free (fetch + AbortController), mirroring the catalog client.
 *
 * Field shapes follow Cherry's official Go SDK (cherryservers/cherrygo): the
 * create body takes `region`/`plan` as slugs and `ssh_keys` as string IDs;
 * `cycle` selects the billing term and `tags` carries ownership markers.
 */

const API_BASE = 'https://api.cherryservers.com/v1';

export interface CherryDeployRequest {
  plan: string;
  region: string;
  image?: string;
  hostname?: string;
  /** Provider SSH-key IDs (as strings) to inject at first boot. */
  ssh_keys?: string[];
  /** cloud-init user-data (plain text; Cherry accepts it verbatim). */
  user_data?: string;
  /** Ownership / bookkeeping tags, e.g. { 'managed-by': 'vops' }. */
  tags?: Record<string, string>;
  spot_market?: boolean;
  /** Billing term, e.g. `hourly`. Omitted → Cherry's plan default. */
  cycle?: string;
}

/** One address on a server. Cherry types them (`primary-ip`, `private-ip`, …). */
export interface CherryIpAddress {
  address?: string;
  type?: string;
}

/** Loosely typed: only the fields the provider maps are declared; Cherry sends more. */
export interface CherryServer {
  id: number;
  name?: string;
  hostname?: string;
  image?: string;
  /** Default login user Cherry provisions (e.g. `root`). */
  username?: string;
  state?: string;
  status?: string;
  region?: { slug?: string; name?: string; region_iso_2?: string } | string;
  plan?: { slug?: string; name?: string } | string;
  ip_addresses?: CherryIpAddress[];
  tags?: Record<string, string>;
  created_at?: string;
  termination_date?: string;
}

export interface CherrySshKey {
  id: number;
  label?: string;
  key?: string;
  fingerprint?: string;
}

export class CherryClient {
  constructor(
    private readonly token: string,
    private readonly baseUrl: string = API_BASE,
    private readonly timeoutMs: number = 20_000,
  ) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(
          `Cherry API ${method} ${path} → ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`,
        );
      }
      if (response.status === 204) return undefined as T;
      const text = await response.text();
      return (text ? JSON.parse(text) : undefined) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  deployServer(
    projectId: string,
    req: CherryDeployRequest,
  ): Promise<CherryServer> {
    return this.request<CherryServer>(
      'POST',
      `/projects/${projectId}/servers`,
      req,
    );
  }

  getServer(serverId: string): Promise<CherryServer> {
    return this.request<CherryServer>('GET', `/servers/${serverId}`);
  }

  listProjectServers(projectId: string): Promise<CherryServer[]> {
    return this.request<CherryServer[]>('GET', `/projects/${projectId}/servers`);
  }

  async deleteServer(serverId: string): Promise<void> {
    await this.request<void>('DELETE', `/servers/${serverId}`);
  }

  async serverAction(serverId: string, type: string): Promise<void> {
    await this.request<void>('POST', `/servers/${serverId}/actions`, { type });
  }

  listSshKeys(): Promise<CherrySshKey[]> {
    return this.request<CherrySshKey[]>('GET', '/ssh-keys');
  }

  createSshKey(label: string, key: string): Promise<CherrySshKey> {
    return this.request<CherrySshKey>('POST', '/ssh-keys', { label, key });
  }
}
