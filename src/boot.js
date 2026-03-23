import { DEFAULT_PUNKIN_RELEASE_TAG, buildTopology } from "./topology.js";

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function formatEnvBlock(entries) {
  return Object.entries(entries)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function remotePublicUrl(vmId) {
  return `https://${vmId}.vm.vers.sh:3000`;
}

export function buildRuntimeEnv(vm, topology, options = {}) {
  const rootUrl = options.rootUrl || remotePublicUrl(topology.root.vmId);
  const env = {
    PORT: "3000",
    VERS_VM_ID: vm.vmId,
    VERS_AGENT_NAME: vm.name,
    VERS_AGENT_ROLE: vm.category,
    VERS_API_KEY:
      options.versApiKey && String(options.versApiKey).trim()
        ? shellQuote(options.versApiKey)
        : `\${${topology.env.versApiKeyEnv}:-}`,
    VERS_AUTH_TOKEN:
      options.versAuthToken && String(options.versAuthToken).trim()
        ? shellQuote(options.versAuthToken)
        : `\${${topology.env.versAuthTokenEnv}:-}`,
    VERS_INFRA_URL: shellQuote(rootUrl),
    LLM_PROXY_KEY:
      options.llmProxyKey && String(options.llmProxyKey).trim()
        ? shellQuote(options.llmProxyKey)
        : process.env.LLM_PROXY_KEY
          ? shellQuote(process.env.LLM_PROXY_KEY)
          : "",
    // Punkin-pi's AI package requires ANTHROPIC_API_KEY at startup before
    // the vers provider is selected via set_model. Alias it to LLM_PROXY_KEY
    // so the Anthropic SDK initializes with the vers proxy key.
    ANTHROPIC_API_KEY:
      options.llmProxyKey && String(options.llmProxyKey).trim()
        ? shellQuote(options.llmProxyKey)
        : process.env.LLM_PROXY_KEY
          ? shellQuote(process.env.LLM_PROXY_KEY)
          : "",
    REEF_ROLE: vm.runtime.reefRole,
    REEF_CATEGORY: vm.category,
    REEF_PARENT_VM_ID: vm.parentVmId || "",
    REEF_ROOT_VM_ID: topology.root.vmId,
    REEF_SQLITE_AUTHORITY: vm.runtime.hasSqliteAuthority ? "true" : "false",
    REEF_SERVICES: shellQuote(vm.reefConfig.services.join(",")),
    REEF_CAPABILITIES: shellQuote(vm.reefConfig.capabilities.join(",")),
    PUNKIN_RELEASE_TAG: shellQuote(topology.sources.punkin.ref || DEFAULT_PUNKIN_RELEASE_TAG),
    PUNKIN_BIN: shellQuote(options.punkinBin || "punkin"),
    PI_PATH: shellQuote(options.punkinBin || "punkin"),
    PI_VERS_HOME: shellQuote("/opt/pi-vers"),
    SERVICES_DIR: shellQuote("/opt/reef/services-active"),
  };

  if (options.rootCommitId && String(options.rootCommitId).trim()) {
    env.VERS_ROOT_COMMIT_ID = shellQuote(options.rootCommitId);
  }
  if (options.goldenCommitId && String(options.goldenCommitId).trim()) {
    env.VERS_GOLDEN_COMMIT_ID = shellQuote(options.goldenCommitId);
  }

  return env;
}

function buildSourceScript(name, source, targetDir, options = {}) {
  if (source.type === "workspace") {
    return `
if [ ! -d ${shellQuote(targetDir)} ]; then
  echo "[vers-fleets] expected staged workspace source at ${targetDir} for ${name}" >&2
  exit 1
fi
`;
  }

  const refBlock = source.ref
    ? `
git fetch --tags --force origin
if ${options.preferExactTag ? `git rev-parse --verify -q ${shellQuote(`refs/tags/${source.ref}`)} >/dev/null` : "false"}; then
  git -c advice.detachedHead=false checkout --detach ${shellQuote(`refs/tags/${source.ref}`)}
else
  git checkout ${shellQuote(source.ref)}
fi
`
    : `
git fetch origin
git checkout --detach origin/HEAD
`;

  return `
if [ -d ${shellQuote(targetDir)}/.git ]; then
  cd ${shellQuote(targetDir)}
  git fetch --all --tags --force
else
  rm -rf ${shellQuote(targetDir)}
  git clone ${shellQuote(source.repoUrl)} ${shellQuote(targetDir)}
  cd ${shellQuote(targetDir)}
fi
${refBlock}
`;
}

function buildActiveServicesBlock(vm) {
  return `
rm -rf /opt/reef/services-active
mkdir -p /opt/reef/services-active
ACTIVE_SERVICES=${shellQuote(vm.reefConfig.services.join(" "))}
for dir in /opt/reef/services/*/; do
  svc=$(basename "$dir")
  if echo "$ACTIVE_SERVICES" | grep -qw "$svc"; then
    ln -s "../services/$svc" "/opt/reef/services-active/$svc"
  fi
done
export SERVICES_DIR="/opt/reef/services-active"
`;
}

/**
 * Phase 1: Build the root reef image — install system deps, clone repos,
 * build all packages, install punkin CLI. No secrets, no runtime config.
 * The result can be committed as a public image.
 */
export function buildImageScript(topology, options = {}) {
  return `#!/bin/bash
set -euo pipefail

echo "[vers-fleets] building root reef image"
export DEBIAN_FRONTEND=noninteractive
export PATH="/root/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

apt-get update -qq
apt-get install -y -qq curl git ca-certificates build-essential openssl unzip

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'Number(process.versions.node.split(".")[ 0])' 2>/dev/null || echo 0)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi

if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
  export PATH="/root/.bun/bin:$PATH"
fi

mkdir -p /opt/src

${buildSourceScript("reef", topology.sources.reef, "/opt/src/reef")}
${buildSourceScript("pi-vers", topology.sources.piVers, "/opt/src/pi-vers")}
${buildSourceScript("punkin-pi", topology.sources.punkin, "/opt/src/punkin-pi", { preferExactTag: true })}

ln -sfn /opt/src/reef /opt/reef
ln -sfn /opt/src/pi-vers /opt/pi-vers
ln -sfn /opt/src/punkin-pi /opt/punkin-pi

cd /opt/punkin-pi
HUSKY=0 npm install
npm run build

cd /opt/pi-vers
npm install
npm run build

cd /opt/reef
bun install

for pkg_root in /opt/pi-vers /opt/reef; do
  mkdir -p "$pkg_root/node_modules/@mariozechner"
  ln -sfn /opt/punkin-pi/packages/tui "$pkg_root/node_modules/@mariozechner/pi-tui"
  ln -sfn /opt/punkin-pi/packages/coding-agent "$pkg_root/node_modules/@mariozechner/pi-coding-agent"
  ln -sfn /opt/punkin-pi/packages/ai "$pkg_root/node_modules/@mariozechner/pi-ai"
  ln -sfn /opt/punkin-pi/packages/agent "$pkg_root/node_modules/@mariozechner/pi-agent-core"
done

# Create a wrapper script for punkin that uses bun and resolves paths correctly.
# Direct symlinks break because bun resolves relative imports from the symlink location.
BUN_PATH=$(command -v bun 2>/dev/null || echo "/root/.bun/bin/bun")
if [ -x /opt/punkin-pi/builds/punkin ]; then
  cat > /usr/local/bin/punkin <<WRAPPER
#!/bin/sh
exec $BUN_PATH /opt/punkin-pi/builds/punkin "\\\$@"
WRAPPER
elif [ -x /opt/punkin-pi/packages/coding-agent/dist/cli.js ]; then
  cat > /usr/local/bin/punkin <<WRAPPER
#!/bin/sh
exec $BUN_PATH /opt/punkin-pi/packages/coding-agent/dist/cli.js "\\\$@"
WRAPPER
fi
chmod +x /usr/local/bin/punkin 2>/dev/null || true
if [ -x /usr/local/bin/punkin ]; then
  ln -sf /usr/local/bin/punkin /usr/local/bin/pi
fi

mkdir -p /root/.punkin/agent /root/.pi/agent
if command -v "${options.punkinBin || "punkin"}" >/dev/null 2>&1; then
  "${options.punkinBin || "punkin"}" install /opt/pi-vers
  "${options.punkinBin || "punkin"}" install /opt/reef
fi

echo "[vers-fleets] root reef image build complete"
`;
}

/**
 * Build the golden agent image — install system deps, clone/upload repos,
 * build all packages, install punkin CLI, set up child agent profile.
 * No secrets, no runtime config. The result can be committed as a public image.
 */
export function buildGoldenImageScript(topology, options = {}) {
  const punkinRef = topology.sources.punkin.ref || DEFAULT_PUNKIN_RELEASE_TAG;
  return `#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
export PATH="/root/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

echo "[vers-fleets] building golden agent image"

apt-get update -qq
apt-get install -y -qq curl git ca-certificates build-essential openssl unzip

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi

if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
  export PATH="/root/.bun/bin:$PATH"
fi

${buildSourceScript("reef", topology.sources.reef, "/root/reef")}
${buildSourceScript("pi-vers", topology.sources.piVers, "/root/pi-vers")}
${buildSourceScript("punkin-pi", topology.sources.punkin, "/root/punkin-pi", { preferExactTag: true })}

cd /root/punkin-pi
HUSKY=0 npm install
npm run build

cd /root/pi-vers
npm install
npm run build

cd /root/reef
bun install

for pkg_root in /root/pi-vers /root/reef; do
  mkdir -p "$pkg_root/node_modules/@mariozechner"
  ln -sfn /root/punkin-pi/packages/tui "$pkg_root/node_modules/@mariozechner/pi-tui"
  ln -sfn /root/punkin-pi/packages/coding-agent "$pkg_root/node_modules/@mariozechner/pi-coding-agent"
  ln -sfn /root/punkin-pi/packages/ai "$pkg_root/node_modules/@mariozechner/pi-ai"
  ln -sfn /root/punkin-pi/packages/agent "$pkg_root/node_modules/@mariozechner/pi-agent-core"
done

rm -rf /root/reef/services-active
mkdir -p /root/reef/services-active
for dir in /root/reef/services/*/; do
  svc=$(basename "$dir")
  ln -s "../services/$svc" "/root/reef/services-active/$svc"
done

mkdir -p /root/workspace /root/.punkin/agent /root/.pi/agent /etc/profile.d

# Punkin wrapper — uses absolute bun path, sources reef-agent.sh for child env
BUN_PATH=$(command -v bun 2>/dev/null || echo "/root/.bun/bin/bun")
if [ -x /root/punkin-pi/builds/punkin ]; then
  cat > /usr/local/bin/punkin <<WRAPPER
#!/bin/sh
if [ -f /etc/profile.d/reef-agent.sh ]; then
  set -a
  . /etc/profile.d/reef-agent.sh
  set +a
fi
exec $BUN_PATH /root/punkin-pi/builds/punkin "\\\$@"
WRAPPER
elif [ -x /root/punkin-pi/packages/coding-agent/dist/cli.js ]; then
  chmod +x /root/punkin-pi/packages/coding-agent/dist/cli.js
  cat > /usr/local/bin/punkin <<WRAPPER
#!/bin/sh
if [ -f /etc/profile.d/reef-agent.sh ]; then
  set -a
  . /etc/profile.d/reef-agent.sh
  set +a
fi
exec $BUN_PATH /root/punkin-pi/packages/coding-agent/dist/cli.js "\\\$@"
WRAPPER
fi
chmod +x /usr/local/bin/punkin 2>/dev/null || true
ln -sf /usr/local/bin/punkin /usr/local/bin/pi

# Patch punkin shebang to use bun instead of node.
# Reef services use bun:sqlite which requires the bun runtime.
for f in /root/punkin-pi/packages/coding-agent/dist/cli.js /root/punkin-pi/builds/punkin; do
  if [ -f "$f" ] && head -1 "$f" | grep -q "#!/usr/bin/env node"; then
    sed -i '1s|#!/usr/bin/env node|#!/usr/bin/env bun|' "$f"
  fi
done

cat > /etc/profile.d/reef-agent.sh <<ENVEOF
export PATH="/root/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:\\$PATH"
# VERS_INFRA_URL, LLM_PROXY_KEY, and VERS_API_KEY are injected post-spawn, not baked into the image
export PUNKIN_RELEASE_TAG=${shellQuote(punkinRef)}
export PUNKIN_BIN=punkin
export PI_PATH=punkin
export PI_VERS_HOME=/root/pi-vers
export SERVICES_DIR=/root/reef/services-active
export REEF_CHILD_AGENT=true
ENVEOF
chmod 0644 /etc/profile.d/reef-agent.sh

for shell_rc in /root/.profile /root/.bashrc /root/.zshenv; do
  touch "$shell_rc"
  if ! grep -q "reef-agent.sh" "$shell_rc"; then
    printf '\\n[ -f /etc/profile.d/reef-agent.sh ] && . /etc/profile.d/reef-agent.sh\\n' >> "$shell_rc"
  fi
done

set -a
source /etc/profile.d/reef-agent.sh
set +a

if command -v "$PI_PATH" >/dev/null 2>&1; then
  "$PI_PATH" install /root/pi-vers
  "$PI_PATH" install /root/reef
fi

test -x /usr/local/bin/pi
test -d /root/pi-vers
test -d /root/reef/services-active

echo "[vers-fleets] golden agent image build complete"
`;
}

/**
 * Phase 2: Inject secrets and start reef. Runs on a VM that already has
 * the image built (either from buildImageScript or restored from a commit).
 */
export function buildRuntimeScript(vm, topology, options = {}) {
  const rootUrl = options.rootUrl || remotePublicUrl(topology.root.vmId);
  const envBlock = formatEnvBlock(buildRuntimeEnv(vm, topology, { ...options, rootUrl }));

  return `#!/bin/bash
set -euo pipefail

echo "[vers-fleets] configuring runtime for ${vm.name}"
export PATH="/root/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

cat > /opt/reef/.env <<ENVEOF
${envBlock}
ENVEOF

set -a
source /opt/reef/.env
set +a

${buildActiveServicesBlock(vm)}

# Install punkin extensions with runtime env available (SERVICES_DIR, LLM_PROXY_KEY, etc.)
mkdir -p /root/.punkin/agent /root/.pi/agent
if command -v "${options.punkinBin || "punkin"}" >/dev/null 2>&1; then
  "${options.punkinBin || "punkin"}" install /opt/pi-vers 2>/dev/null || true
  "${options.punkinBin || "punkin"}" install /opt/reef 2>/dev/null || true
fi

cd /opt/reef
pkill -f "bun run src/main.ts" 2>/dev/null || true
tmux kill-session -t reef 2>/dev/null || true
tmux new-session -d -s reef "set -a; source /opt/reef/.env; set +a; export PATH=/root/.bun/bin:\$PATH; cd /opt/reef; bun run src/main.ts >> /tmp/reef.log 2>&1"

for i in $(seq 1 45); do
  if curl -sf http://localhost:3000/health >/dev/null 2>&1; then
    echo "[vers-fleets] reef is healthy on ${vm.name}"
    exit 0
  fi
  sleep 1
done

echo "[vers-fleets] reef failed to start on ${vm.name}" >&2
tail -50 /tmp/reef.log >&2 || true
exit 1
`;
}

/**
 * Combined script (image build + runtime) — used by legacy `provision` when
 * building from scratch without a pre-built image.
 */
function buildVmScript(vm, topology, options = {}) {
  const imageScript = buildImageScript(topology, options);
  const runtimeScript = buildRuntimeScript(vm, topology, options);
  // Strip the shebang and set -euo from the runtime script since the image script already has them
  const runtimeBody = runtimeScript
    .replace(/^#!.*\n/, "")
    .replace(/^set -euo pipefail\n/, "");
  return imageScript + "\n" + runtimeBody;
}

export function buildBootstrapBundle(input = {}, options = {}) {
  const topology = buildTopology(input);
  return {
    topology,
    scripts: {
      root: buildVmScript(topology.root, topology, options),
      lieutenant: null,
      swarm: [],
    },
  };
}
