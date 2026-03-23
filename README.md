# vers-fleets

Provisioning and image management for reef fleets on Vers infrastructure.

Three commands:

- **`provision`** — Spawn a root reef VM from pre-built commits (fast onboarding)
- **`build-root`** — Build a root reef image and commit it (no secrets baked in)
- **`build-golden`** — Build a golden agent image and commit it (no secrets baked in)

## Quickstart

Provision a reef fleet from public pre-built images:

```bash
bun src/cli.js provision \
  --root-commit 5d9c6176-2e9e-4b38-8fc2-f7e0fb3507ce \
  --golden-commit d2fedfa3-a835-4745-9b50-0e94d347d26b \
  --email you@example.com
```

Or with `VERS_API_KEY` already set in your environment:

```bash
bun src/cli.js provision \
  --root-commit 5d9c6176-2e9e-4b38-8fc2-f7e0fb3507ce \
  --golden-commit d2fedfa3-a835-4745-9b50-0e94d347d26b
```

### Public images

| Image | Commit ID | Description |
|-------|-----------|-------------|
| Root reef | `5d9c6176-2e9e-4b38-8fc2-f7e0fb3507ce` | Root orchestrator — reef server with all services |
| Golden agent | `d2fedfa3-a835-4745-9b50-0e94d347d26b` | Agent VM runtime — punkin + pi-vers + reef extensions |

These images contain no secrets and are safe for anyone with a Vers account to use.

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
# From GitHub main (default)
bun src/cli.js build-root --private

# From local development directories
bun src/cli.js build-root --private --reef-path ../reef --pi-vers-path ../pi-vers

# From specific branches
bun src/cli.js build-root --private --reef-ref feature/my-branch --pi-vers-ref main
```

Required flags:
- `--public` or `--private`

### `build-golden`

Build a golden agent image for child VMs (lieutenants, swarm workers, all agent types). No secrets or instance-specific URLs are baked in.

```bash
# From GitHub main (default)
bun src/cli.js build-golden --private

# From local development directories
bun src/cli.js build-golden --private --reef-path ../reef --pi-vers-path ../pi-vers

# From specific branches
bun src/cli.js build-golden --private --reef-ref feature/my-branch --pi-vers-ref main
```

Required flags:
- `--public` or `--private`

## Source flags

By default, repos are cloned from GitHub (reef and pi-vers from `main`, punkin from `carter/punkin/v1_rc5`). Override with:

| Flag | Description | Default |
|------|-------------|---------|
| `--reef-path <path>` | Local reef directory (uploads working tree) | Clone from GitHub |
| `--pi-vers-path <path>` | Local pi-vers directory (uploads working tree) | Clone from GitHub |
| `--reef-ref <branch\|tag>` | Branch or tag for reef from GitHub | `main` |
| `--pi-vers-ref <branch\|tag>` | Branch or tag for pi-vers from GitHub | `main` |
| `--punkin-ref <branch\|tag>` | Branch or tag for punkin-pi from GitHub | `carter/punkin/v1_rc5` |

Local paths take priority over refs — if both are specified, the local path is used.

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
- **punkin-pi** — `https://github.com/hdresearch/punkin-pi.git` `carter/punkin/v1_rc5`

### Topology

Root reef VM:
- Runs the reef HTTP server with all services (lieutenant, swarm, commits, registry, vm-tree, etc.)
- Owns the SQLite-backed lineage/registry authority
- Spawns all child VMs from the golden commit

Child agent VMs (from golden commit):
- Run punkin in RPC mode (no reef server)
- Point back to root reef via `VERS_INFRA_URL`
- Inherit `VERS_API_KEY` and `VERS_GOLDEN_COMMIT_ID` so they can spawn their own sub-agents

### Golden image bootstrap

The golden image build script lives in `src/boot.js` (`buildGoldenImageScript`). If you change reef's service structure, extension setup, or punkin integration, update this script to match. The root and golden build scripts share the same source resolution system (git clone or local upload) but differ in directory layout and runtime profile.

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
