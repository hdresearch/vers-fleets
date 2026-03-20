# Vers-Fleets Onboarding

If you are directing a coding agent, tell it to use this repo as the entry point for provisioning a root Vers fleet from public sources only.

Use:

- `reef` from GitHub `main`
- `pi-vers` from GitHub `main`
- `punkin-pi` pinned to `https://github.com/hdresearch/punkin-pi/releases/tag/v1rc3`

Do not assume sibling local repos exist. Do not use `../reef`, `../pi-vers`, or `../punkin-pi`.

## Agent Instructions

1. Clone the repo and install dependencies:

```bash
git clone https://github.com/hdresearch/vers-fleets.git
cd vers-fleets
npm install
```

2. Choose one auth path:

Shell auth:

```bash
node src/cli.js provision --out-dir out/live --email you@example.com --force-shell-auth
```

Vers API key:

```bash
export VERS_API_KEY=your_vers_api_key
node src/cli.js provision --out-dir out/live
```

3. Expect this repo to:

- create a fresh root Reef infra VM
- bootstrap that root VM from public `main` branches of `reef` and `pi-vers`
- pin `punkin-pi` to `v1rc3`
- write `out/live/deployment.json` with the root VM id, root Reef URL, and auth token

4. Do not create child lieutenants or worker VMs here.

- `vers-fleets` bootstraps only the root Reef VM
- child VMs are created later by Reef runtime flows
- those child VMs come from Reef golden-image flows

## Quickstart

```bash
git clone https://github.com/hdresearch/vers-fleets.git
cd vers-fleets
npm install
node src/cli.js provision --out-dir out/live --email you@example.com --force-shell-auth
```

Or:

```bash
git clone https://github.com/hdresearch/vers-fleets.git
cd vers-fleets
npm install
export VERS_API_KEY=your_vers_api_key
node src/cli.js provision --out-dir out/live
```

The deployment manifest will be written to:

```bash
out/live/deployment.json
```

## Repo Overview

Unified bootstrap for `reef + pi-vers + punkin-pi`.

Architecture split:

- `pi-vers` remains the Vers substrate: shell-auth, VM API, SSH transport, and related infra interaction specs
- `reef` owns registry, lieutenants, lineage, and module/service distribution
- `punkin-pi` is the harness/plugin carried on the root, lieutenant, and swarm VMs

Pinned harness release for V1:

- `punkin-pi` tag: `v1rc3`
- source: `https://github.com/hdresearch/punkin-pi/releases/tag/v1rc3`

## V1 Topology

V1 does **not** use Vers snapshots during bootstrap. It creates a fresh root VM and records lineage in the root reef authority. Child lieutenants and worker VMs are created later from Reef runtime flows.

Topology:

1. Root `infra_vm`
   - runs `reef`
   - runs `punkin`
   - owns the SQLite-backed lineage/registry authority
2. Lieutenant and worker VMs are created later from the root Reef runtime
   - they are not bootstrapped by `vers-fleets`
   - they use `punkin` as the harness
   - they point back to the root Reef instead of running their own Reef node

All lineage and VM DNA writes go back to the root reef through reef modules.

VM DNA fields:

- `vm_id`
- `name`
- `parent_vm_id` nullable
- `category`
- `reef_config`
  - `services`
  - `capabilities`

This is intentionally flexible so child VMs can become parents later.

## What Exists

This repo now does both:

- `bundle`: generate the root topology and root bootstrap script
- `provision`: run Vers shell-auth if needed, create a fresh root VM, clone public `reef` and `pi-vers` from `main`, clone public `punkin-pi` at `v1rc3`, bootstrap root Reef, and register lineage in the root reef

Default source strategy:

- `reef`: public GitHub `main`
- `pi-vers`: public GitHub `main`
- `punkin-pi`: public git source pinned to tag `v1rc3`

The provisioning path in this repo now calls into `pi-vers` for shell-auth and Vers VM transport instead of carrying a separate duplicate implementation.

## Usage

```bash
node src/cli.js bundle --out-dir out
```

Outputs:

- `out/topology.json`
- `out/root.sh`

```bash
node src/cli.js provision --out-dir out --email you@example.com --force-shell-auth
```

Provision writes `out/deployment.json` with the created VM IDs and public URLs.

## Development

```bash
npm test
node src/cli.js bundle --out-dir out
```

## Design Notes

- Bootstrap semantics are `fresh_vms_only`
- `snapshotsInBootstrap` is always `false`
- root reef is the only SQLite authority in the topology
- child VMs use `punkin` as the harness
- child/root bootstrap pins `punkin-pi` to `v1rc3` by default
- reef service selection remains expressible via VM DNA
- runtime child VMs are created later from Reef golden-image flows, not from this repo
