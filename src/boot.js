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

function buildRuntimeEnv(vm, topology, options = {}) {
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
  };

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

function buildVmScript(vm, topology, options = {}) {
  const rootUrl = options.rootUrl || remotePublicUrl(topology.root.vmId);
  const envBlock = formatEnvBlock(buildRuntimeEnv(vm, topology, { ...options, rootUrl }));

  return `#!/bin/bash
set -euo pipefail

echo "[vers-fleets] bootstrapping ${vm.name} (${vm.category})"
export DEBIAN_FRONTEND=noninteractive
export PATH="/root/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

apt-get update -qq
apt-get install -y -qq curl git ca-certificates build-essential openssl unzip

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'Number(process.versions.node.split(\".\")[0])' 2>/dev/null || echo 0)" -lt 20 ]; then
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

cat > /opt/reef/.env <<ENVEOF
${envBlock}
ENVEOF

set -a
source /opt/reef/.env
set +a

${buildActiveServicesBlock(vm)}

if [ -x /opt/punkin-pi/builds/punkin ]; then
  ln -sf /opt/punkin-pi/builds/punkin /usr/local/bin/punkin
elif [ -x /opt/punkin-pi/packages/coding-agent/dist/cli.js ]; then
  ln -sf /opt/punkin-pi/packages/coding-agent/dist/cli.js /usr/local/bin/punkin
  chmod +x /opt/punkin-pi/packages/coding-agent/dist/cli.js
fi
if [ -x /usr/local/bin/punkin ]; then
  ln -sf /usr/local/bin/punkin /usr/local/bin/pi
fi

mkdir -p /root/.punkin/agent /root/.pi/agent
if command -v "${options.punkinBin || "punkin"}" >/dev/null 2>&1; then
  "${options.punkinBin || "punkin"}" install /opt/pi-vers
  "${options.punkinBin || "punkin"}" install /opt/reef
fi

pkill -f "bun run src/main.ts" 2>/dev/null || true
nohup bun run src/main.ts >/tmp/reef.log 2>&1 &

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
