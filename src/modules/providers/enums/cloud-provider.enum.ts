export enum CloudProvider {
  CONTABO = 'contabo',
  HETZNER = 'hetzner',
  SCALEWAY = 'scaleway',
  /** OpenStack-based clouds (OVH first). Compute/network via OpenStack; real-time pricing via each cloud's native catalog. vops-only for now. */
  OVH = 'ovh',
  /** Bring-your-own-server: install onto an operator-provisioned host over SSH; no provisioning API (node/firewall/networking are SSH/iptables-driven). */
  BYOS = 'byos',
}
