<h1 align="center">@flui-cloud/infra</h1>

<p align="center">
  <strong>One interface over many clouds.</strong>
</p>
<p align="center">
  <em>A provider-neutral infrastructure layer — a uniform abstraction over Hetzner, Scaleway, Contabo and OVH (OpenStack).</em>
</p>
<p align="center">
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg"></a>
  <a href="https://www.npmjs.com/package/@flui-cloud/infra"><img alt="npm" src="https://img.shields.io/npm/v/@flui-cloud/infra.svg"></a>
</p>
<p align="center">
  <em>The shared cloud layer of the <a href="https://github.com/flui-cloud">Flui</a> ecosystem.</em>
</p>

`@flui-cloud/infra` is the library that hides the differences between cloud providers behind one set of interfaces. Servers, firewalls, private networks, regions, capabilities and pricing all look the same to a consumer, whether they're backed by Hetzner's API, Scaleway's, Contabo's, or OVH's OpenStack stack — and a new provider is an adapter, not a rewrite.

It is consumed today by **[vops](https://github.com/flui-cloud/vops)**, and is intended as the single source of truth for provider logic across Flui.

## What's inside

- **A uniform provider interface** — `ICloudProvider` for the lifecycle (create/list/get/delete servers, regions, images/plans), with optional capability surfaces for firewalls (`IFirewallProvider`) and networks (`INetworkProvider`) that a provider opts into.
- **Adapters for four providers** — Hetzner, Scaleway, Contabo and OVH, each mapping its native API onto those interfaces.
- **An OpenStack core** — Keystone v3 auth, service-catalog endpoint resolution and Nova/Neutron/Glance clients that sit behind OVH and are reusable for any OpenStack cloud. One credential spans every region.
- **Capabilities & regions metadata** — so a consumer can ask "does this provider do private networks?" or "what regions and plans exist?" without special-casing.
- **Real-time pricing** — the OVH public catalog (no credentials required) is exposed as normalized plans; other providers carry static catalogs.
- **NestJS-native, framework-light** — services are injectable, but NestJS, `class-validator`/`class-transformer`, `rxjs` and `reflect-metadata` are **peer dependencies**, not bundled. The only runtime dependency is `axios`.

## Install

```bash
npm install @flui-cloud/infra
# plus the peer deps your app already has:
#   @nestjs/common @nestjs/config @nestjs/swagger
#   class-transformer class-validator rxjs reflect-metadata
```

## Usage

Everything public is re-exported from the package root (`@flui-cloud/infra`) — import from the barrel, never from deep paths:

```ts
import {
  CloudProvider,
  ProviderFactory,
  OpenStackClient,
} from '@flui-cloud/infra';
```

A consumer wires the factories into its own DI container and asks for a provider by enum:

```ts
const provider = providerFactory.create(CloudProvider.HETZNER, credentials);
const servers = await provider.listServers();
```

For an end-to-end example of constructing the factories manually and layering CLI/UI on top, see how **[vops](https://github.com/flui-cloud/vops)** consumes this package (`vops/src/vops.module.ts`).

## Supported providers

| Provider | Billing | Servers | Firewall | Private network |
| --- | --- | --- | --- | --- |
| Hetzner | hourly | ✓ | native | ✓ |
| Scaleway | hourly | ✓ | native | ✓ |
| Contabo | monthly | guided | — | — |
| OVH (OpenStack) | hourly | ✓ | Neutron SG¹ | Neutron ✓ |

¹ OVH exposes Neutron security groups, but the default project security-group quota is `0` — effectively list-only until raised. Consumers that need portable firewalling can layer a host-level ruleset on top instead of relying on the provider.

## Development

```bash
pnpm install
pnpm build     # tsc && tsc-alias — compile src → dist/ (aliases rewritten to relative)
```

- **Build:** `pnpm build` (`tsc && tsc-alias`). `prepare` runs it automatically, so a `file:`/git install gets a built `dist/`.
- **Public API:** everything a consumer may import must be re-exported from [`src/index.ts`](src/index.ts). The build compiles only that barrel's closure — a symbol that isn't exported isn't shipped.
- **No heavy platform deps.** Entities are decoupled to plain classes; there is no TypeORM, Kubernetes or cache/Redis coupling here. Keep it that way — this layer is about *providers*, not persistence or orchestration.
- TypeScript throughout.

## License

`@flui-cloud/infra` is released under the [Apache License 2.0](LICENSE).

---

<p align="center">
  <em>Built and maintained by <a href="https://gojodigital.com/">Dawit</a>.</em>
</p>
