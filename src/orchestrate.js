import { randomBytes } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolve } from "node:path";
import { buildBootstrapBundle, buildImageScript, buildRuntimeScript, buildRuntimeEnv } from "./boot.js";
import { createPiVersClient, ensurePiVersApiKey } from "./pi-vers.js";
import { buildTopology, validateSpec } from "./topology.js";

const DEFAULT_LLM_PROXY_BASE_URL = "https://tokens.vers.sh";

function createAuthToken() {
  return randomBytes(32).toString("hex");
}

function publicVmUrl(vmId) {
  return `https://${vmId}.vm.vers.sh:3000`;
}

function parseJsonResponse(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function exchangeVersLlmKey({ versApiKey, name, fetchImpl = fetch, baseUrl = DEFAULT_LLM_PROXY_BASE_URL }) {
  if (!versApiKey || typeof versApiKey !== "string" || !versApiKey.trim()) {
    throw new Error("VERS_API_KEY is required before exchanging an LLM proxy key");
  }

  const healthResponse = await fetchImpl(`${baseUrl}/health`);
  const healthText = await healthResponse.text().catch(() => "");
  if (!healthResponse.ok) {
    throw new Error(`LLM proxy health check failed (${healthResponse.status}): ${healthText}`);
  }

  const exchangeResponse = await fetchImpl(`${baseUrl}/v1/keys/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      vers_api_key: versApiKey,
      name,
    }),
  });
  const exchangeText = await exchangeResponse.text().catch(() => "");
  const payload = parseJsonResponse(exchangeText);
  if (!exchangeResponse.ok) {
    throw new Error(
      `LLM key exchange failed (${exchangeResponse.status}): ${payload?.error || exchangeText || "unknown error"}`,
    );
  }
  if (!payload.key || typeof payload.key !== "string" || !payload.key.startsWith("sk-vers-")) {
    throw new Error("LLM key exchange did not return a valid sk-vers-* key");
  }

  return payload;
}

async function apiRequest(baseUrl, token, method, path, body, fetchImpl = fetch) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetchImpl(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`Fleet API ${method} ${path} failed (${response.status}): ${payload?.error || text}`);
  }
  return payload;
}

async function waitForHealth(baseUrl, fetchImpl = fetch, maxAttempts = 60, delayMs = 2000) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(`${baseUrl}/health`);
      if (response.ok) {
        return true;
      }
    } catch {
      // Retry until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`Timed out waiting for reef health at ${baseUrl}/health`);
}

function stageableSources(topology) {
  return Object.entries(topology.sources)
    .filter(([, source]) => source.type === "workspace")
    .map(([name, source]) => ({
      name,
      localPath: resolve(source.repoPath),
      remotePath: `/opt/src/${name === "piVers" ? "pi-vers" : name === "punkin" ? "punkin-pi" : name}`,
    }));
}

function execFileAsync(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(
          Object.assign(error, {
            stdout: stdout?.toString() ?? "",
            stderr: stderr?.toString() ?? "",
          }),
        );
        return;
      }
      resolvePromise({
        stdout: stdout?.toString() ?? "",
        stderr: stderr?.toString() ?? "",
      });
    });
  });
}

async function materializeWorkspaceSource(source) {
  const localPath = resolve(source.repoPath);
  if (!source.ref) {
    return {
      path: localPath,
      cleanup: () => {},
    };
  }

  const tempRoot = mkdtempSync(join(process.cwd(), ".vers-fleets-stage-"));
  await new Promise((resolvePromise, reject) => {
    const archive = spawn("git", ["archive", source.ref], {
      cwd: localPath,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const untar = spawn("tar", ["-xf", "-", "-C", tempRoot], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    archive.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    untar.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    archive.on("error", reject);
    untar.on("error", reject);
    archive.stdout.pipe(untar.stdin);

    untar.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Failed to materialize ${source.repoPath}@${source.ref}: ${stderr}`));
        return;
      }
      resolvePromise(undefined);
    });
  });

  return {
    path: tempRoot,
    cleanup: () => {
      rmSync(tempRoot, { recursive: true, force: true });
    },
  };
}

async function defaultStageSources(client, vmId, topology) {
  for (const source of stageableSources(topology)) {
    // For workspace sources, upload the working tree directly (no git archive).
    // This ensures uncommitted changes and feature branches are included.
    const localPath = resolve(source.localPath);
    await client.uploadDirectory(vmId, localPath, source.remotePath);
  }
}

async function registerRootFleetRecords(topology, authToken, fetchImpl = fetch) {
  const rootBaseUrl = publicVmUrl(topology.root.vmId);
  await waitForHealth(rootBaseUrl, fetchImpl);

  await apiRequest(rootBaseUrl, authToken, "PATCH", `/vm-tree/vms/${encodeURIComponent(topology.root.vmId)}`, {
    name: topology.root.name,
    category: topology.root.category,
    reefConfig: topology.root.reefConfig,
  }, fetchImpl).catch(async () => {
    await apiRequest(rootBaseUrl, authToken, "POST", "/vm-tree/vms", {
      vmId: topology.root.vmId,
      name: topology.root.name,
      category: topology.root.category,
      reefConfig: topology.root.reefConfig,
    }, fetchImpl);
  });

  await apiRequest(rootBaseUrl, authToken, "POST", "/registry/vms", {
    id: topology.root.vmId,
    name: topology.root.name,
    role: "infra",
    address: `${topology.root.vmId}.vm.vers.sh`,
    reefConfig: topology.root.reefConfig,
    registeredBy: "vers-fleets",
    metadata: {
      category: topology.root.category,
      publicUrl: rootBaseUrl,
      sqliteAuthority: true,
    },
  }, fetchImpl);
}

function writeDeployment(outDir, deployment) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "deployment.json"), `${JSON.stringify(deployment, null, 2)}\n`);
}

// =============================================================================
// build-root: Build a root reef image and commit it (no secrets)
// =============================================================================

export async function buildRoot(input = {}, options = {}) {
  const spec = validateSpec(input);
  const auth = options.ensureVersApiKey
    ? await options.ensureVersApiKey({ email: options.email, forceShellAuth: options.forceShellAuth === true })
    : await ensurePiVersApiKey({ email: options.email, forceShellAuth: options.forceShellAuth === true });
  const client = options.client || (await createPiVersClient({ apiKey: auth.apiKey }));

  // Support local workspace sources via --reef-path / --pi-vers-path
  const sources = {};
  if (options.reefPath) {
    sources.reef = { type: "workspace", repoPath: resolve(options.reefPath) };
  }
  if (options.piVersPath) {
    sources.piVers = { type: "workspace", repoPath: resolve(options.piVersPath) };
  }
  const topoInput = { ...input, ...(Object.keys(sources).length > 0 ? { sources } : {}) };

  const topology = buildTopology(topoInput);
  const imageScript = buildImageScript(topology, {});

  console.log("[vers-fleets] Creating VM for root image build...");
  const rootVm = await client.createRoot(spec.rootVmConfig, true);
  const vmId = rootVm.vm_id;

  try {
    const stageSources = options.stageSources || defaultStageSources;
    await stageSources(client, vmId, topology);

    console.log("[vers-fleets] Running image build script (this may take a few minutes)...");
    await client.execScript(vmId, imageScript);

    console.log("[vers-fleets] Committing root image...");
    const committed = await client.commit(vmId, true);

    if (options.makePublic) {
      console.log("[vers-fleets] Making commit public...");
      await client.setCommitPublic(committed.commit_id, true);
    }

    if (options.makePublic) {
      console.log("[vers-fleets] Cleaning up builder VM...");
      try {
        await client.delete(vmId);
      } catch {
        // Commit is durable; deletion is best-effort
      }
    } else {
      console.log(`[vers-fleets] Builder VM kept alive: ${vmId}`);
    }

    const result = {
      commitId: committed.commit_id,
      vmId,
      isPublic: !!options.makePublic,
      versApiKey: auth.apiKey,
      versApiKeySource: auth.source,
    };

    if (options.outDir) {
      mkdirSync(options.outDir, { recursive: true });
      writeFileSync(
        resolve(options.outDir, "build-root.json"),
        `${JSON.stringify(result, null, 2)}\n`,
      );
    }

    return result;
  } catch (error) {
    try {
      await client.delete(vmId);
    } catch {
      // Ignore cleanup failure
    }
    throw error;
  }
}

// =============================================================================
// build-golden: Build a golden agent image and commit it (no secrets)
// =============================================================================

export async function buildGolden(input = {}, options = {}) {
  const auth = options.ensureVersApiKey
    ? await options.ensureVersApiKey({ email: options.email, forceShellAuth: options.forceShellAuth === true })
    : await ensurePiVersApiKey({ email: options.email, forceShellAuth: options.forceShellAuth === true });
  const client = options.client || (await createPiVersClient({ apiKey: auth.apiKey }));

  // Import the golden bootstrap script builder from reef (TypeScript, runs under Bun)
  const { buildGoldenBootstrapScript } = await import(
    resolve(options.reefPath || "../reef", "services/commits/golden.ts")
  ).catch(() => {
    throw new Error(
      "Could not load reef golden bootstrap. Set --reef-path to the local reef directory.",
    );
  });

  const DEFAULT_GOLDEN_VM_CONFIG = {
    vcpu_count: 2,
    mem_size_mib: 4096,
    fs_size_mib: 8192,
  };

  const vmConfig = input.vmConfig || DEFAULT_GOLDEN_VM_CONFIG;
  const reefDir = resolve(options.reefPath || "../reef");
  const piVersDir = resolve(options.piVersPath || "../pi-vers");

  console.log("[vers-fleets] Creating VM for golden image build...");
  const builder = await client.createRoot(vmConfig, true);
  const vmId = builder.vm_id;

  try {
    console.log("[vers-fleets] Uploading reef and pi-vers sources...");
    await client.uploadDirectory(vmId, reefDir, "/root/reef");
    await client.uploadDirectory(vmId, piVersDir, "/root/pi-vers");

    console.log("[vers-fleets] Running golden image build script (this may take a few minutes)...");
    await client.execScript(vmId, buildGoldenBootstrapScript());

    console.log("[vers-fleets] Committing golden image...");
    const committed = await client.commit(vmId, true);

    if (options.makePublic) {
      console.log("[vers-fleets] Making commit public...");
      await client.setCommitPublic(committed.commit_id, true);
    }

    if (options.makePublic) {
      console.log("[vers-fleets] Cleaning up builder VM...");
      try {
        await client.delete(vmId);
      } catch {
        // Commit is durable
      }
    } else {
      console.log(`[vers-fleets] Builder VM kept alive: ${vmId}`);
    }

    const result = {
      commitId: committed.commit_id,
      vmId,
      isPublic: !!options.makePublic,
      versApiKey: auth.apiKey,
      versApiKeySource: auth.source,
    };

    if (options.outDir) {
      mkdirSync(options.outDir, { recursive: true });
      writeFileSync(
        resolve(options.outDir, "build-golden.json"),
        `${JSON.stringify(result, null, 2)}\n`,
      );
    }

    return result;
  } catch (error) {
    try {
      await client.delete(vmId);
    } catch {
      // Ignore cleanup failure
    }
    throw error;
  }
}

// =============================================================================
// provision: Full provisioning (from scratch or from pre-built commits)
// =============================================================================

export async function provisionFleet(input = {}, options = {}) {
  const spec = validateSpec(input);
  const auth = options.ensureVersApiKey
    ? await options.ensureVersApiKey({ email: options.email, forceShellAuth: options.forceShellAuth === true })
    : await ensurePiVersApiKey({ email: options.email, forceShellAuth: options.forceShellAuth === true });
  const fetchImpl = options.fetchImpl || fetch;
  const resolveLlmProxyKey =
    options.resolveLlmProxyKey ||
    ((ctx) =>
      exchangeVersLlmKey({
        versApiKey: ctx.versApiKey,
        name: `vers-fleets-${ctx.rootName}`,
        fetchImpl,
        baseUrl: options.llmProxyBaseUrl || DEFAULT_LLM_PROXY_BASE_URL,
      }));
  const llmProxy = await resolveLlmProxyKey({
    versApiKey: auth.apiKey,
    rootName: spec.rootName,
  });
  const authToken = options.authToken || process.env[spec.authTokenEnv] || createAuthToken();
  const client = options.client || (await createPiVersClient({ apiKey: auth.apiKey, fetchImpl }));

  const rootCommitId = options.rootCommitId || null;
  const goldenCommitId = options.goldenCommitId || null;

  let rootVm;
  if (rootCommitId) {
    // Fast path: restore from pre-built root image
    console.log(`[vers-fleets] Restoring root from commit ${rootCommitId}...`);
    rootVm = await client.restoreFromCommit(rootCommitId);
  } else {
    // Legacy path: create fresh VM
    rootVm = await client.createRoot(spec.rootVmConfig, true);
  }

  const topology = buildTopology({
    ...input,
    rootVmId: rootVm.vm_id,
  });
  const rootUrl = publicVmUrl(topology.root.vmId);

  if (rootCommitId) {
    // Fast path: only run the runtime script (inject secrets + start reef)
    const runtimeScript = buildRuntimeScript(topology.root, topology, {
      rootUrl,
      versApiKey: auth.apiKey,
      versAuthToken: authToken,
      llmProxyKey: llmProxy.key,
      goldenCommitId,
    });
    const runBootstrap = options.runBootstrap || (async (vmId, script) => client.execScript(vmId, script));
    await runBootstrap(topology.root.vmId, runtimeScript);
  } else {
    // Legacy path: full build + runtime
    const bundle = buildBootstrapBundle(
      {
        ...input,
        rootVmId: topology.root.vmId,
      },
      {
        rootUrl,
        versApiKey: auth.apiKey,
        versAuthToken: authToken,
        llmProxyKey: llmProxy.key,
        goldenCommitId,
      },
    );

    const stageSources = options.stageSources || defaultStageSources;
    const runBootstrap = options.runBootstrap || (async (vmId, script) => client.execScript(vmId, script));
    const nodes = [{ vmId: topology.root.vmId, script: bundle.scripts.root }];

    for (const node of nodes) {
      await stageSources(client, node.vmId, topology);
      await runBootstrap(node.vmId, node.script);
    }
  }

  const registerRoot = options.registerRoot || ((fleetTopology) => registerRootFleetRecords(fleetTopology, authToken, fetchImpl));
  await registerRoot(topology);

  const deployment = {
    topology,
    auth: {
      versApiKey: auth.apiKey,
      versApiKeySource: auth.source,
      versAuthToken: authToken,
      llmProxyKey: llmProxy.key,
      llmProxyKeyPrefix: llmProxy.key_prefix || "",
      llmProxyKeyId: llmProxy.id || "",
      llmProxyTeamId: llmProxy.team_id || "",
    },
    nodes: {
      root: {
        vmId: topology.root.vmId,
        url: rootUrl,
      },
      lieutenant: null,
      swarm: [],
    },
  };

  if (options.outDir) {
    writeDeployment(options.outDir, deployment);
  }

  return deployment;
}
