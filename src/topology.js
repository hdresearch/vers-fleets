import { randomUUID } from "node:crypto";

export const DEFAULT_ROOT_CATEGORY = "infra_vm";

function defaultRootVmConfig() {
  return {
    vcpu_count: 2,
    mem_size_mib: 4096,
    fs_size_mib: 8192,
  };
}

export function defaultSharedOperationalDna() {
  return {
    services: ["bootloader", "cron", "docs", "installer", "lieutenant", "services", "ui", "vers-config"],
    capabilities: ["pi-vers", "punkin", "reef-extension", "vers-fleets"],
  };
}

export function defaultRootAuthorityOverlayDna() {
  return {
    services: ["commits", "registry", "store", "vm-tree"],
    capabilities: ["reef-root", "root-lineage", "sqlite-authority"],
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
  const baseServices = baseDna.services || baseDna.organs || [];
  const extraServices = extraDna.services || extraDna.organs || [];
  return {
    services: unique([...baseServices, ...extraServices]).sort(),
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
      profile: hasSqliteAuthority ? "root-with-authority-overlay" : "shared-operational",
    },
  };
}

export function validateSpec(input = {}) {
  if (!input || typeof input !== "object") throw new Error("spec must be an object");

  const rootName = typeof input.rootName === "string" && input.rootName.trim() ? input.rootName.trim() : "root-reef";
  const rootVmId = typeof input.rootVmId === "string" && input.rootVmId.trim() ? input.rootVmId.trim() : null;

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
      type: "git",
      repoPath: "../punkin-pi",
      repoUrl: "https://github.com/hdresearch/punkin-pi.git",
      ref: "v1rc3",
    }),
  };

  const rootVmConfig = normalizeVmConfig(input.rootVmConfig, "rootVmConfig", defaultRootVmConfig());

  const sharedExtraDna = input.sharedExtraDna || {};
  const rootAuthorityExtraDna = input.rootAuthorityExtraDna || {};
  const rootExtraDna = input.rootExtraDna || {};
  if (sharedExtraDna.services) ensureStringArray(sharedExtraDna.services, "sharedExtraDna.services");
  if (sharedExtraDna.organs) ensureStringArray(sharedExtraDna.organs, "sharedExtraDna.organs");
  if (sharedExtraDna.capabilities) ensureStringArray(sharedExtraDna.capabilities, "sharedExtraDna.capabilities");
  if (rootAuthorityExtraDna.services) ensureStringArray(rootAuthorityExtraDna.services, "rootAuthorityExtraDna.services");
  if (rootAuthorityExtraDna.organs) ensureStringArray(rootAuthorityExtraDna.organs, "rootAuthorityExtraDna.organs");
  if (rootAuthorityExtraDna.capabilities) ensureStringArray(rootAuthorityExtraDna.capabilities, "rootAuthorityExtraDna.capabilities");
  if (rootExtraDna.services) ensureStringArray(rootExtraDna.services, "rootExtraDna.services");
  if (rootExtraDna.organs) ensureStringArray(rootExtraDna.organs, "rootExtraDna.organs");
  if (rootExtraDna.capabilities) ensureStringArray(rootExtraDna.capabilities, "rootExtraDna.capabilities");

  return {
    rootName,
    rootVmId,
    sources,
    rootVmConfig,
    anthroKeyEnv,
    versKeyEnv,
    authTokenEnv,
    infraUrlEnv,
    sharedExtraDna,
    rootAuthorityExtraDna,
    rootExtraDna,
  };
}

export function buildTopology(input = {}) {
  const spec = validateSpec(input);

  const rootVmId = spec.rootVmId || buildVmId("infra");

  const sharedOperationalProfile = mergeDna(defaultSharedOperationalDna(), spec.sharedExtraDna);
  const rootAuthorityOverlay = mergeDna(defaultRootAuthorityOverlayDna(), spec.rootAuthorityExtraDna);
  const rootBaseProfile = mergeDna(sharedOperationalProfile, rootAuthorityOverlay);

  const root = makeRecord({
    vmId: rootVmId,
    name: spec.rootName,
    category: DEFAULT_ROOT_CATEGORY,
    reefConfig: mergeDna(rootBaseProfile, spec.rootExtraDna),
    hasSqliteAuthority: true,
    harness: "punkin",
    reefRole: "root",
    vmConfig: spec.rootVmConfig,
  });

  return {
    version: 1,
    semantics: {
      bootstrapMode: "fresh_vms_only",
      snapshotsInBootstrap: false,
      rootOwnsSqlite: true,
      childVmMayBecomeParentLater: true,
    },
    profiles: {
      sharedOperational: sharedOperationalProfile,
      rootAuthorityOverlay,
      inheritanceRule: "runtime child VMs inherit the shared operational profile; only the root applies the authority overlay",
    },
    sources: spec.sources,
    env: {
      anthropicApiKeyEnv: spec.anthroKeyEnv,
      versApiKeyEnv: spec.versKeyEnv,
      versAuthTokenEnv: spec.authTokenEnv,
      versInfraUrlEnv: spec.infraUrlEnv,
    },
    root,
    lieutenant: null,
    swarm: [],
  };
}
