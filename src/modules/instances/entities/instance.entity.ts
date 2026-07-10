import { InstanceType } from './instance-type.enum';
import { InstanceStatus } from './instance-status.enum';
import { InstanceOwnership } from './instance-ownership.enum';
import { CloudProvider } from '../../providers/enums/cloud-provider.enum';

/**
 * Plain data shape for a cloud instance — provider-neutral.
 *
 * In flui-infra this is a decorator-free POJO (no TypeORM): the shared provider
 * layer only ever builds/returns it as data. Persistence is a concern of the
 * consuming platform (flui-core maps this to its own ORM entity).
 */
export class InstanceEntity {
  id!: string;
  userId!: string;
  name!: string;
  displayName?: string;
  type!: InstanceType;
  provider!: CloudProvider;
  providerId!: string;
  status: InstanceStatus = InstanceStatus.UNKNOWN;
  dataCenter!: string;
  region!: string;
  regionName?: string;
  cpuCores!: number;
  ramMb!: number;
  diskMb!: number;
  osType?: string;
  ipConfig?: {
    v4?: { ip: string; gateway: string; netmaskCidr: number };
    v6?: { ip: string; gateway: string; netmaskCidr: number };
  };
  macAddress?: string;
  productType?: string;
  productName?: string;
  defaultUser?: string;
  additionalIps?: string[];
  metadata: Record<string, any> = {};

  /**
   * Computed at list time, not persisted: which installation this machine
   * belongs to relative to the one answering the request.
   */
  ownership?: InstanceOwnership;

  createdAt!: Date;
  updatedAt!: Date;
  cancelDate?: Date;
}
