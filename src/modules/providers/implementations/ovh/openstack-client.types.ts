/** Shared OpenStack types (Keystone catalog, Nova, Neutron, Glance). */

export interface OpenStackConfig {
  authUrl: string;
  username: string;
  password: string;
  userDomain: string;
  projectId: string;
  projectDomain: string;
  defaultRegion?: string;
}

export interface CatalogEndpoint {
  interface: string;
  region?: string;
  region_id?: string;
  url: string;
}

export interface CatalogEntry {
  type: string;
  name?: string;
  endpoints: CatalogEndpoint[];
}

export interface TokenState {
  token: string;
  catalog: CatalogEntry[];
  expiresAt: number;
}

export interface OpenStackServer {
  id: string;
  name: string;
  status: string;
  created?: string;
  updated?: string;
  flavor?: { id?: string; original_name?: string };
  addresses?: Record<
    string,
    { addr: string; version: number; 'OS-EXT-IPS:type'?: string }[]
  >;
}

export interface OpenStackNamed {
  id: string;
  name: string;
}

export interface CreateServerSpec {
  name: string;
  flavorRef: string;
  imageRef: string;
  networks: { uuid: string }[];
  keyName?: string;
  userData?: string; // base64
  metadata?: Record<string, string>;
  securityGroups?: string[];
}

export interface NovaInterface {
  port_id: string;
  net_id: string;
  fixed_ips?: { ip_address: string; subnet_id: string }[];
}

// ── Neutron (network service) ──
export interface NeutronSecurityGroupRule {
  id: string;
  direction: 'ingress' | 'egress';
  ethertype: 'IPv4' | 'IPv6';
  protocol: string | null;
  port_range_min: number | null;
  port_range_max: number | null;
  remote_ip_prefix: string | null;
  security_group_id: string;
  description?: string | null;
}

export interface NeutronSecurityGroup {
  id: string;
  name: string;
  description: string;
  security_group_rules: NeutronSecurityGroupRule[];
  tags?: string[];
}

export interface NeutronPort {
  id: string;
  device_id: string;
  network_id?: string;
  security_groups: string[];
}

export interface NeutronNetwork {
  id: string;
  name: string;
  subnets: string[];
  tags?: string[];
  shared?: boolean;
  'router:external'?: boolean;
}

export interface NeutronSubnet {
  id: string;
  name: string;
  network_id: string;
  cidr: string;
  gateway_ip: string | null;
  ip_version: number;
  enable_dhcp: boolean;
}

export interface CreateSubnetSpec {
  networkId: string;
  cidr: string;
  gatewayIp?: string;
  ipVersion?: number;
  enableDhcp?: boolean;
  name?: string;
}

export interface CreateSecurityGroupRuleSpec {
  direction: 'ingress' | 'egress';
  ethertype?: 'IPv4' | 'IPv6';
  protocol?: string;
  portRangeMin?: number | null;
  portRangeMax?: number | null;
  remoteIpPrefix?: string;
  description?: string;
}
