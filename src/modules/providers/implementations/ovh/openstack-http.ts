import { CatalogEntry, OpenStackConfig, TokenState } from './openstack-client.types';

/**
 * Keystone v3 + service-catalog core. Authenticates once, caches the token until
 * it expires, and resolves each service's endpoint per region from the catalog
 * the token carries — that is what makes one credential span all regions. The
 * Nova/Neutron/Glance method layers extend this base.
 */
const TOKEN_MARGIN_MS = 60_000;

export abstract class OpenStackHttpBase {
  private state: TokenState | null = null;

  constructor(protected readonly config: OpenStackConfig) {}

  /** Regions this credential can reach for a given service (default: compute). */
  async regions(serviceType = 'compute'): Promise<string[]> {
    const { catalog } = await this.auth();
    const entry = catalog.find((e) => e.type === serviceType);
    const regions = (entry?.endpoints ?? [])
      .filter((e) => e.interface === 'public')
      .map((e) => e.region_id ?? e.region ?? '')
      .filter(Boolean);
    return [...new Set(regions)];
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const { catalog } = await this.auth();
      const compute = catalog.filter((e) => e.type === 'compute').length;
      if (!compute) {
        return { success: false, error: 'Authenticated but no compute (Nova) endpoint in catalog.' };
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Resolve a service endpoint URL for a region (falls back to default region). */
  async endpoint(serviceType: string, region?: string): Promise<string> {
    const { catalog } = await this.auth();
    const entry = catalog.find((e) => e.type === serviceType);
    if (!entry) throw new Error(`No '${serviceType}' service in OpenStack catalog.`);
    const publics = entry.endpoints.filter((e) => e.interface === 'public');
    const want = region ?? this.config.defaultRegion;
    const match = want
      ? publics.find((e) => (e.region_id ?? e.region) === want)
      : publics[0];
    const chosen = match ?? publics[0];
    if (!chosen) {
      const where = want ? ` in ${want}` : '';
      throw new Error(`No public endpoint for '${serviceType}'${where}.`);
    }
    return chosen.url.replace(/\/$/, '');
  }

  /** Map a wanted region (macro like "DE" or exact "DE1") to a real region of a service. */
  protected async resolveRegion(serviceType: string, want?: string): Promise<string> {
    const regions = await this.regions(serviceType);
    if (!regions.length) throw new Error(`No ${serviceType} regions available for this credential.`);
    const macro = (r: string) => r.toUpperCase().replace(/-[a-z]$/i, '').replace(/\d+$/, '');
    const target = want ?? this.config.defaultRegion;
    if (!target) return regions[0];
    return (
      regions.find((r) => r.toUpperCase() === target.toUpperCase()) ??
      regions.find((r) => macro(r) === macro(target)) ??
      regions[0]
    );
  }

  private async auth(): Promise<TokenState> {
    if (this.state && this.state.expiresAt - TOKEN_MARGIN_MS > Date.now()) {
      return this.state;
    }
    const res = await fetch(`${this.config.authUrl.replace(/\/$/, '')}/auth/tokens`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        auth: {
          identity: {
            methods: ['password'],
            password: {
              user: {
                name: this.config.username,
                domain: { name: this.config.userDomain },
                password: this.config.password,
              },
            },
          },
          scope: {
            project: {
              id: this.config.projectId,
              domain: { name: this.config.projectDomain },
            },
          },
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Keystone auth failed: HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    const token = res.headers.get('x-subject-token');
    if (!token) throw new Error('Keystone auth returned no X-Subject-Token.');
    const data = (await res.json()) as {
      token: { catalog: CatalogEntry[]; expires_at: string };
    };
    this.state = {
      token,
      catalog: data.token.catalog ?? [],
      expiresAt: new Date(data.token.expires_at).getTime(),
    };
    return this.state;
  }

  protected async get<T>(url: string): Promise<T> {
    const { token } = await this.auth();
    const res = await fetch(url, { headers: { 'x-auth-token': token, accept: 'application/json' } });
    return this.parse<T>(res, 'GET', url);
  }

  protected async post<T>(url: string, body: unknown): Promise<T> {
    const { token } = await this.auth();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'x-auth-token': token, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
    return this.parse<T>(res, 'POST', url);
  }

  protected async put<T>(url: string, body: unknown): Promise<T> {
    const { token } = await this.auth();
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'x-auth-token': token, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
    return this.parse<T>(res, 'PUT', url);
  }

  protected async del(url: string): Promise<void> {
    const { token } = await this.auth();
    const res = await fetch(url, { method: 'DELETE', headers: { 'x-auth-token': token } });
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => '');
      throw new Error(`OpenStack DELETE ${url} → HTTP ${res.status} ${text.slice(0, 200)}`);
    }
  }

  private async parse<T>(res: Response, method: string, url: string): Promise<T> {
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OpenStack ${method} ${url} → HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  }
}
