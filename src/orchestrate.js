import { randomBytes } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolve } from "node:path";
import { buildBootstrapBundle } from "./boot.js";
import { createPiVersClient, ensurePiVersApiKey } from "./pi-vers.js";
import { buildTopology, validateSpec } from "./topology.js";

function createAuthToken() {
  return randomBytes(32).toString("hex");
}

function publicVmUrl(vmId) {
  return `https://${vmId}.vm.vers.sh:3000`;
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
    const materialized = await materializeWorkspaceSource({
      repoPath: source.localPath,
      ref: topology.sources[source.name].ref,
    });
    try {
      await client.uploadDirectory(vmId, materialized.path, source.remotePath);
    } finally {
      materialized.cleanup();
    }
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

export async function provisionFleet(input = {}, options = {}) {
  const spec = validateSpec(input);
  const auth = options.ensureVersApiKey
    ? await options.ensureVersApiKey({ email: options.email, forceShellAuth: options.forceShellAuth === true })
    : await ensurePiVersApiKey({ email: options.email, forceShellAuth: options.forceShellAuth === true });
  const authToken = options.authToken || process.env[spec.authTokenEnv] || createAuthToken();
  const fetchImpl = options.fetchImpl || fetch;
  const client = options.client || (await createPiVersClient({ apiKey: auth.apiKey, fetchImpl }));
  const rootVm = await client.createRoot(spec.rootVmConfig, true);

  const topology = buildTopology({
    ...input,
    rootVmId: rootVm.vm_id,
  });
  const rootUrl = publicVmUrl(topology.root.vmId);
  const bundle = buildBootstrapBundle(
    {
      ...input,
      rootVmId: topology.root.vmId,
    },
    {
      rootUrl,
      versApiKey: auth.apiKey,
      versAuthToken: authToken,
      anthropicApiKey: process.env[spec.anthroKeyEnv] || "",
    },
  );

  const stageSources = options.stageSources || defaultStageSources;
  const runBootstrap = options.runBootstrap || (async (vmId, script) => client.execScript(vmId, script));
  const registerRoot = options.registerRoot || ((fleetTopology) => registerRootFleetRecords(fleetTopology, authToken, fetchImpl));
  const nodes = [{ vmId: topology.root.vmId, script: bundle.scripts.root }];

  for (const node of nodes) {
    await stageSources(client, node.vmId, topology);
    await runBootstrap(node.vmId, node.script);
  }

  await registerRoot(topology);

  const deployment = {
    topology,
    auth: {
      versApiKeySource: auth.source,
      versAuthToken: authToken,
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
