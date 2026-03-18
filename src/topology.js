import { randomUUID } from "node:crypto";

export const DEFAULT_ROOT_CATEGORY = "infra_vm";
export const DEFAULT_LIEUTENANT_CATEGORY = "lieutenant";
export const DEFAULT_SWARM_CATEGORY = "swarm_vm";

function defaultRootVmConfig() {
  return {
    vcpu_count: 2,
    mem_size_mib: 4096,
    fs_size_mib: 8192,
  };
}

function defaultChildVmConfig() {
  return {
    vcpu_count: 2,
    mem_size_mib: 4096,
    fs_size_mib: 8192,
  };
}

export function defaultRootDna() {
  return {
    organs: ["bootloader", "docs", "installer", "lieutenant", "registry", "services", "ui", "vers-config", "vm-tree"],
    capabilities: ["pi-vers", "punkin", "reef-root", "root-lineage", "vers-fleets"],
  };
}

export function defaultChildDna() {
  return {
    organs: ["bootloader", "docs", "services", "ui", "vers-config"],
    capabilities: ["punkin", "reef-node", "vers-fleets"],
  };
}

function ensureStringArray(values, field) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || value.trim() === "")) {
    throw new Error(`${field} must be an array of non-empty strings`);
  }
  return values.map((value) => value.trim());
}

function unique(values) {
  return [...new Set(values)];
}

function buildVmId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

function mergeDna(baseDna, extraDna = {}) {
  return {
    organs: unique([...(baseDna.organs || []), ...(extraDna.organs || [])]).sort(),
    capabilities: unique([...(baseDna.capabilities || []), ...(extraDna.capabilities || [])]).sort(),
  };
}

function normalizeVmConfig(value, fieldName, fallback) {
  const source = value && typeof value === "object" ? value : {};
  const config = {
    vcpu_count: source.vcpu_count ?? fallback.vcpu_count,
    mem_size_mib: source.mem_size_mib ?? fallback.mem_size_mib,
    fs_size_mib: source.fs_size_mib ?? fallback.fs_size_mib,
  };

  for (const [key, raw] of Object.entries(config)) {
    if (!Number.isInteger(raw) || raw <= 0) {
      throw new Error(`${fieldName}.${key} must be a positive integer`);
    }
  }

  return config;
}

function normalizeSource(name, value, fallback) {
  const source = value && typeof value === "object" ? value : {};
  const type = typeof source.type === "string" && source.type.trim() ? source.type.trim() : fallback.type;
  if (!["workspace", "git"].includes(type)) {
    throw new Error(`${name}.type must be "workspace" or "git"`);
  }

  const repoPath =
    typeof source.repoPath === "string" && source.repoPath.trim() ? source.repoPath.trim() : fallback.repoPath ?? null;
  const repoUrl =
    typeof source.repoUrl === "string" && source.repoUrl.trim() ? source.repoUrl.trim() : fallback.repoUrl ?? null;
  const ref = typeof source.ref === "string" && source.ref.trim() ? source.ref.trim() : fallback.ref ?? null;

  if (type === "workspace" && !repoPath) {
    throw new Error(`${name}.repoPath is required for workspace sources`);
  }

  if (type === "git" && !repoUrl) {
    throw new Error(`${name}.repoUrl is required for git sources`);
  }

  return {
    type,
    repoPath,
    repoUrl,
    ref,
  };
}

function makeRecord({
  vmId,
  name,
  parentVmId = null,
  category,
  reefConfig,
  hasSqliteAuthority,
  harness,
  reefRole,
  vmConfig,
}) {
  return {
    vmId,
    name,
    parentVmId,
    category,
    reefConfig,
    vmConfig,
    runtime: {
      harness,
      reefRole,
      hasSqliteAuthority,
    },
  };
}

export function validateSpec(input = {}) {
  if (!input || typeof input !== "object") throw new Error("spec must be an object");

  const rootName = typeof input.rootName === "string" && input.rootName.trim() ? input.rootName.trim() : "root-reef";
  const lieutenantName =
    typeof input.lieutenantName === "string" && input.lieutenantName.trim()
      ? input.lieutenantName.trim()
      : "lieutenant-1";
  const swarmCount =
    input.swarmCount === undefined ? 3 : Number.isInteger(input.swarmCount) && input.swarmCount >= 0 ? input.swarmCount : null;
  if (swarmCount === null) throw new Error("swarmCount must be a non-negative integer");

  const rootVmId = typeof input.rootVmId === "string" && input.rootVmId.trim() ? input.rootVmId.trim() : null;
  const lieutenantVmId =
    typeof input.lieutenantVmId === "string" && input.lieutenantVmId.trim() ? input.lieutenantVmId.trim() : null;
  const swarmVmIds = Array.isArray(input.swarmVmIds)
    ? input.swarmVmIds.map((value, index) => {
        if (typeof value !== "string" || !value.trim()) {
          throw new Error(`swarmVmIds[${index}] must be a non-empty string`);
        }
        return value.trim();
      })
    : [];
  if (swarmVmIds.length > 0 && swarmVmIds.length !== swarmCount) {
    throw new Error("swarmVmIds length must match swarmCount");
  }

  const anthroKeyEnv =
    typeof input.anthropicApiKeyEnv === "string" && input.anthropicApiKeyEnv.trim()
      ? input.anthropicApiKeyEnv.trim()
      : "ANTHROPIC_API_KEY";
  const versKeyEnv =
    typeof input.versApiKeyEnv === "string" && input.versApiKeyEnv.trim() ? input.versApiKeyEnv.trim() : "VERS_API_KEY";
  const authTokenEnv =
    typeof input.versAuthTokenEnv === "string" && input.versAuthTokenEnv.trim()
      ? input.versAuthTokenEnv.trim()
      : "VERS_AUTH_TOKEN";
  const infraUrlEnv =
    typeof input.versInfraUrlEnv === "string" && input.versInfraUrlEnv.trim()
      ? input.versInfraUrlEnv.trim()
      : "VERS_INFRA_URL";

  const sources = {
    reef: normalizeSource("sources.reef", input.sources?.reef, {
      type: "workspace",
      repoPath: "../reef",
      repoUrl: "https://github.com/hdresearch/reef.git",
      ref: null,
    }),
    piVers: normalizeSource("sources.piVers", input.sources?.piVers, {
      type: "workspace",
      repoPath: "../pi-vers",
      repoUrl: "https://github.com/hdresearch/pi-vers.git",
      ref: null,
    }),
    punkin: normalizeSource("sources.punkin", input.sources?.punkin, {
      type: "workspace",
      repoPath: "../punkin-pi",
      repoUrl: "https://github.com/hdresearch/punkin-pi.git",
      ref: "v1rc3",
    }),
  };

  const rootVmConfig = normalizeVmConfig(input.rootVmConfig, "rootVmConfig", defaultRootVmConfig());
  const childVmConfig = normalizeVmConfig(input.childVmConfig, "childVmConfig", defaultChildVmConfig());

  const rootExtraDna = input.rootExtraDna || {};
  const lieutenantExtraDna = input.lieutenantExtraDna || {};
  const swarmExtraDna = input.swarmExtraDna || {};
  if (rootExtraDna.organs) ensureStringArray(rootExtraDna.organs, "rootExtraDna.organs");
  if (rootExtraDna.capabilities) ensureStringArray(rootExtraDna.capabilities, "rootExtraDna.capabilities");
  if (lieutenantExtraDna.organs) ensureStringArray(lieutenantExtraDna.organs, "lieutenantExtraDna.organs");
  if (lieutenantExtraDna.capabilities) ensureStringArray(lieutenantExtraDna.capabilities, "lieutenantExtraDna.capabilities");
  if (swarmExtraDna.organs) ensureStringArray(swarmExtraDna.organs, "swarmExtraDna.organs");
  if (swarmExtraDna.capabilities) ensureStringArray(swarmExtraDna.capabilities, "swarmExtraDna.capabilities");

  return {
    rootName,
    lieutenantName,
    swarmCount,
    rootVmId,
    lieutenantVmId,
    swarmVmIds,
    sources,
    rootVmConfig,
    childVmConfig,
    anthroKeyEnv,
    versKeyEnv,
    authTokenEnv,
    infraUrlEnv,
    rootExtraDna,
    lieutenantExtraDna,
    swarmExtraDna,
  };
}

export function buildTopology(input = {}) {
  const spec = validateSpec(input);

  const rootVmId = spec.rootVmId || buildVmId("infra");
  const lieutenantVmId = spec.lieutenantVmId || buildVmId("lt");
  const swarmVmIds =
    spec.swarmVmIds.length > 0 ? spec.swarmVmIds : Array.from({ length: spec.swarmCount }, () => buildVmId("swarm"));

  const root = makeRecord({
    vmId: rootVmId,
    name: spec.rootName,
    category: DEFAULT_ROOT_CATEGORY,
    reefConfig: mergeDna(defaultRootDna(), spec.rootExtraDna),
    hasSqliteAuthority: true,
    harness: "punkin",
    reefRole: "root",
    vmConfig: spec.rootVmConfig,
  });

  const lieutenant = makeRecord({
    vmId: lieutenantVmId,
    name: spec.lieutenantName,
    parentVmId: rootVmId,
    category: DEFAULT_LIEUTENANT_CATEGORY,
    reefConfig: mergeDna(defaultChildDna(), spec.lieutenantExtraDna),
    hasSqliteAuthority: false,
    harness: "punkin",
    reefRole: "child",
    vmConfig: spec.childVmConfig,
  });

  const swarm = swarmVmIds.map((vmId, index) =>
    makeRecord({
      vmId,
      name: `swarm-${index + 1}`,
      parentVmId: lieutenantVmId,
      category: DEFAULT_SWARM_CATEGORY,
      reefConfig: mergeDna(defaultChildDna(), spec.swarmExtraDna),
      hasSqliteAuthority: false,
      harness: "punkin",
      reefRole: "child",
      vmConfig: spec.childVmConfig,
    }),
  );

  return {
    version: 1,
    semantics: {
      bootstrapMode: "fresh_vms_only",
      snapshotsInBootstrap: false,
      rootOwnsSqlite: true,
      childVmMayBecomeParentLater: true,
    },
    sources: spec.sources,
    env: {
      anthropicApiKeyEnv: spec.anthroKeyEnv,
      versApiKeyEnv: spec.versKeyEnv,
      versAuthTokenEnv: spec.authTokenEnv,
      versInfraUrlEnv: spec.infraUrlEnv,
    },
    root,
    lieutenant,
    swarm,
  };
}
