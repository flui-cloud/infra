import { ConfigService } from '@nestjs/config';
import { OpenStackClient } from './openstack-client';

/**
 * Build the shared OpenStack client from OS_* env. Returns null when the core
 * credentials are absent (read-only catalog/pricing still works without them).
 * One place so provider, firewall and network services agree on the same auth.
 */
export function buildOvhOpenStackClient(c: ConfigService): OpenStackClient | null {
  const username = c.get<string>('OS_USERNAME');
  const password = c.get<string>('OS_PASSWORD');
  const projectId = c.get<string>('OS_PROJECT_ID');
  if (!username || !password || !projectId) return null;
  return new OpenStackClient({
    authUrl: c.get<string>('OS_AUTH_URL', 'https://auth.cloud.ovh.net/v3'),
    username,
    password,
    userDomain: c.get<string>('OS_USER_DOMAIN_NAME', 'Default'),
    projectId,
    projectDomain: c.get<string>('OS_PROJECT_DOMAIN_NAME', 'Default'),
    defaultRegion: c.get<string>('OS_REGION_NAME'),
  });
}
