/**
 * Pure mappers from Cherry's API shapes to Flui's provider-neutral DTOs.
 * No I/O, no clock: everything is derived from the input so it unit-tests cleanly.
 */
import { CloudProvider } from '../../enums/cloud-provider.enum';
import {
  LabelDto,
  ServerResponseDto,
} from '../../../infrastructure/servers/dto/server-response.dto';
import { InstanceEntity } from '../../../instances/entities/instance.entity';
import { InstanceType } from '../../../instances/entities/instance-type.enum';
import { InstanceStatus } from '../../../instances/entities/instance-status.enum';
import { CherryServer, CherryIpAddress } from './cherry-client';

export const regionSlug = (region: CherryServer['region']): string => {
  if (region == null) return '';
  if (typeof region === 'string') return region;
  return region.slug ?? region.name ?? '';
};

export const planSlug = (plan: CherryServer['plan']): string => {
  if (plan == null) return '';
  if (typeof plan === 'string') return plan;
  return plan.slug ?? plan.name ?? '';
};

const isPrivate = (type: string | undefined): boolean =>
  /priv/i.test(type ?? '');

const firstAddress = (
  ips: CherryIpAddress[] | undefined,
  want: 'public' | 'private',
): string | undefined => {
  const match = (ips ?? []).find(
    (ip) => ip.address && isPrivate(ip.type) === (want === 'private'),
  );
  return match?.address;
};

export const publicIp = (s: CherryServer): string | undefined =>
  firstAddress(s.ip_addresses, 'public');

export const privateIp = (s: CherryServer): string | undefined =>
  firstAddress(s.ip_addresses, 'private');

export const toLabelDtos = (
  tags: Record<string, string> | undefined,
): LabelDto[] =>
  Object.entries(tags ?? {}).map(([key, value]) => ({ key, value }));

/** vops names its servers via the Cherry hostname; fall back so it's never blank. */
export const serverName = (s: CherryServer): string =>
  s.hostname ?? s.name ?? String(s.id);

export const rawStatus = (s: CherryServer): string =>
  s.status ?? s.state ?? 'unknown';

const STATUS_MAP: Record<string, InstanceStatus> = {
  active: InstanceStatus.RUNNING,
  running: InstanceStatus.RUNNING,
  deploying: InstanceStatus.PROVISIONING,
  pending: InstanceStatus.PROVISIONING,
  provisioning: InstanceStatus.PROVISIONING,
  stopped: InstanceStatus.STOPPED,
  terminating: InstanceStatus.DELETING,
};

export const mapInstanceStatus = (s: CherryServer): InstanceStatus =>
  STATUS_MAP[rawStatus(s).toLowerCase()] ?? InstanceStatus.UNKNOWN;

export const toServerResponseDto = (s: CherryServer): ServerResponseDto => {
  const created = s.created_at ? new Date(s.created_at) : new Date(0);
  return {
    id: String(s.id),
    name: serverName(s),
    provider: CloudProvider.CHERRY,
    provider_resource_id: String(s.id),
    server_type: planSlug(s.plan),
    location: regionSlug(s.region),
    status: rawStatus(s),
    public_ip: publicIp(s),
    private_ip: privateIp(s),
    created_at: created,
    updated_at: created,
    labels: toLabelDtos(s.tags),
  };
};

/**
 * Minimal instance view. Cherry's server payload carries no CPU/RAM/disk (those
 * live on the plan), so specs stay 0 — vops reads servers via `listServersAsDto`,
 * not this path, so a light mapping is enough to honour the interface.
 */
export const toInstanceEntity = (s: CherryServer): InstanceEntity => {
  const region = regionSlug(s.region);
  const entity = new InstanceEntity();
  entity.id = String(s.id);
  entity.userId = '';
  entity.name = serverName(s);
  entity.type = InstanceType.VPS;
  entity.provider = CloudProvider.CHERRY;
  entity.providerId = String(s.id);
  entity.status = mapInstanceStatus(s);
  entity.dataCenter = region;
  entity.region = region;
  entity.cpuCores = 0;
  entity.ramMb = 0;
  entity.diskMb = 0;
  entity.defaultUser = s.username;
  entity.metadata = { tags: s.tags ?? {} };
  const created = s.created_at ? new Date(s.created_at) : new Date(0);
  entity.createdAt = created;
  entity.updatedAt = created;
  const v4 = publicIp(s);
  if (v4) entity.ipConfig = { v4: { ip: v4, gateway: '', netmaskCidr: 32 } };
  return entity;
};
