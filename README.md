# vers-fleets

Provisioning and image management for reef fleets on Vers infrastructure.

Three commands:

- **`provision`** — Spawn a root reef VM from pre-built commits (fast onboarding)
- **`build-root`** — Build a root reef image and commit it (no secrets baked in)
- **`build-golden`** — Build a golden agent image and commit it (no secrets baked in)

## Quickstart

Standard user onboarding from public commits:

```bash
# With VERS_API_KEY in your environment (e.g. .zshrc)
bun src/cli.js provision --root-commit <root-id> --golden-commit <golden-id>

# Or with shell-auth
bun src/cli.js provision --root-commit <root-id> --golden-commit <golden-id> --email you@example.com
```

## Auth

All commands require authentication via one of:

1. `VERS_API_KEY` environment variable (e.g. set in `.zshrc`)
2. `--email` flag for interactive shell-auth

Users returning to an existing reef or managing commits should use their saved `VERS_API_KEY`.

## Commands

### `provision`

Spawn a root reef VM from pre-built commits and configure it with your keys.

```bash
bun src/cli.js provision --root-commit <id> --golden-commit <id> [--email you@example.com]
```

Required flags:
- `--root-commit <id>` — Commit ID of the root reef image
- `--golden-commit <id>` — Commit ID of the golden agent image

What happens:
1. Authenticates (env key or shell-auth)
2. Exchanges `VERS_API_KEY` for an `LLM_PROXY_KEY` via `tokens.vers.sh`
3. Restores a VM from the root commit
4. Injects secrets (`VERS_API_KEY`, `LLM_PROXY_KEY`, `VERS_AUTH_TOKEN`, `VERS_GOLDEN_COMMIT_ID`) into `/opt/reef/.env`
5. Starts reef, waits for health check
6. Registers the root in reef's vm-tree and registry
7. Writes `deployment.json` with VM ID, URL, and auth

The root reef will use the golden commit to spawn all agent VMs (lieutenants, swarm workers, single agents).

### `build-root`

Build a root reef image and commit it. No secrets are baked in — the image contains reef, pi-vers, punkin-pi, and all dependencies pre-built.

```bash
# Private build — keep VM alive for testing
bun src/cli.js build-root --private [--email you@example.com]

# Public build — publish immediately, delete builder VM
bun src/cli.js build-root --public [--email you@example.com]
```

Required flags:
- `--public` or `--private`

What happens:
1. Creates a fresh VM from the Vers base image
2. Installs system deps (node 22, bun)
3. Clones reef, pi-vers, punkin-pi from GitHub `main`
4. Builds all packages, cross-links punkin, installs CLI
5. Commits the VM as a snapshot (no secrets on disk)
6. `--public`: PATCHes the commit to `is_public: true`, deletes builder VM
7. `--private`: Keeps builder VM alive, returns VM ID for SSH testing

### `build-golden`

Build a golden agent image for child VMs (lieutenants, swarm workers, all agent types). No secrets or instance-specific URLs are baked in.

```bash
# Private build
bun src/cli.js build-golden --private --reef-path ./reef --pi-vers-path ./pi-vers

# Public build
bun src/cli.js build-golden --public --reef-path ./reef --pi-vers-path ./pi-vers
```

Required flags:
- `--public` or `--private`
- `--reef-path <path>` — Local reef directory to upload
- `--pi-vers-path <path>` — Local pi-vers directory to upload

What happens:
1. Creates a fresh VM
2. Uploads reef and pi-vers sources
3. Clones punkin-pi from GitHub `main`, builds everything
4. Sets up agent runtime (punkin CLI, service symlinks, profile.d env hooks)
5. Commits the VM (secret-free snapshot)
6. `--public`/`--private` behavior same as `build-root`

## Architecture

### Two images, two commits

| Image | Built by | Used for | Contains |
|-------|----------|----------|----------|
| Root commit | `build-root` | Root reef VM (orchestrator) | reef server + all services + pi-vers + punkin |
| Golden commit | `build-golden` | All agent VMs (lieutenants, swarm, single agents) | Agent runtime + punkin CLI + reef extensions |

Both are Vers **commits** (VM snapshots), not base images. They're made public via `PATCH /api/v1/commits/{id}` with `{"is_public": true}`.

### Secret injection (post-spawn, never baked in)

Secrets are injected at spawn time, not build time. Both images are safe to make public.

| Secret | Where injected | Cascades to children? |
|--------|---------------|----------------------|
| `VERS_API_KEY` | `/opt/reef/.env` (root), `reef-agent.sh` (children) | Yes |
| `LLM_PROXY_KEY` | `/opt/reef/.env` (root), `reef-agent.sh` (children) | Yes |
| `VERS_AUTH_TOKEN` | `/opt/reef/.env` (root), SSH env (children) | Yes |
| `VERS_INFRA_URL` | `/opt/reef/.env` (root), `reef-agent.sh` (children) | Yes |
| `VERS_GOLDEN_COMMIT_ID` | `/opt/reef/.env` (root), `reef-agent.sh` (children) | Yes |

### Source repos

- **reef** — `https://github.com/hdresearch/reef.git` `main`
- **pi-vers** — `https://github.com/hdresearch/pi-vers.git` `main`
- **punkin-pi** — `https://github.com/hdresearch/punkin-pi.git` `main`

### Topology

Root reef VM:
- Runs the reef HTTP server with all services (lieutenant, commits, registry, vm-tree, etc.)
- Owns the SQLite-backed lineage/registry authority
- Spawns all child VMs from the golden commit

Child agent VMs (from golden commit):
- Run punkin in RPC mode (no reef server)
- Point back to root reef via `VERS_INFRA_URL`
- Inherit `VERS_API_KEY` and `VERS_GOLDEN_COMMIT_ID` so they can spawn their own sub-agents

## Vers Platform API

Commits are managed via the Vers orchestrator API at `https://api.vers.sh/api/v1`:

- `GET /commits` — List your own commits
- `GET /commits/public` — List all public commits
- `PATCH /commits/{id}` — Toggle `is_public` (owner only)
- `POST /vm/from_commit` — Restore a VM from a commit (public or owned)
- `POST /vm/{id}/commit` — Snapshot a VM into a commit

## Development

```bash
npm install
npm test
```

## Optional flags

| Flag | Commands | Default | Description |
|------|----------|---------|-------------|
| `--out-dir <dir>` | all | `out` | Output directory for manifests |
| `--root-name <name>` | provision, build-root | `root-reef` | Name for the root VM |
| `--force-shell-auth` | all | `false` | Force browser-based shell auth even if VERS_API_KEY is set |
