import assert from "node:assert/strict";
import test from "node:test";
import { provisionFleet } from "../src/orchestrate.js";

test("provisionFleet bootstraps only the root by default", async () => {
  const created = [];
  const staged = [];
  const bootstrapped = [];
  const registered = [];
  let count = 0;

  const deployment = await provisionFleet(
    {
      rootName: "reef-root",
    },
    {
      ensureVersApiKey: async () => ({ apiKey: "vers-key", source: "test" }),
      client: {
        async createRoot() {
          count += 1;
          const vm_id = `vm-${count}`;
          created.push(vm_id);
          return { vm_id };
        },
      },
      stageSources: async (_client, vmId, topology) => {
        staged.push({ vmId, sources: topology.sources });
      },
      runBootstrap: async (vmId, script) => {
        bootstrapped.push({ vmId, script });
      },
      registerRoot: async (topology) => {
        registered.push({ kind: "root", vmId: topology.root.vmId, parentVmId: null });
      },
      resolveLlmProxyKey: async () => ({
        key: "sk-vers-test",
        key_prefix: "sk-vers-test",
        id: "llm-key-id",
        team_id: "llm-team-id",
      }),
    },
  );

  assert.deepEqual(created, ["vm-1"]);
  assert.equal(staged.length, 1);
  assert.equal(bootstrapped.length, 1);
  assert.equal(deployment.topology.root.vmId, "vm-1");
  assert.equal(deployment.topology.lieutenant, null);
  assert.deepEqual(deployment.topology.swarm, []);
  assert.equal(registered[0].kind, "root");
  assert.match(bootstrapped[0].script, /configuring runtime for reef-root/);
  assert.match(bootstrapped[0].script, /LLM_PROXY_KEY='sk-vers-test'/);
  assert.equal(deployment.nodes.root.vmId, "vm-1");
  assert.equal(deployment.nodes.lieutenant, null);
  assert.deepEqual(deployment.nodes.swarm, []);
  assert.equal(deployment.auth.llmProxyKey, "sk-vers-test");
});

test("provisionFleet restores from root commit when rootCommitId is provided", async () => {
  const restored = [];
  const bootstrapped = [];

  const deployment = await provisionFleet(
    { rootName: "reef-root" },
    {
      ensureVersApiKey: async () => ({ apiKey: "vers-key", source: "test" }),
      client: {
        async restoreFromCommit(commitId) {
          restored.push(commitId);
          return { vm_id: "vm-restored" };
        },
        async execScript(vmId, script) {
          bootstrapped.push({ vmId, script });
          return { stdout: "", stderr: "" };
        },
      },
      registerRoot: async () => {},
      resolveLlmProxyKey: async () => ({
        key: "sk-vers-test",
        key_prefix: "sk-vers-test",
        id: "llm-key-id",
        team_id: "llm-team-id",
      }),
      rootCommitId: "root-commit-abc",
      goldenCommitId: "golden-commit-xyz",
    },
  );

  assert.deepEqual(restored, ["root-commit-abc"]);
  assert.equal(bootstrapped.length, 1);
  // Fast path should only run the runtime script, not the image build
  assert.doesNotMatch(bootstrapped[0].script, /building root reef image/);
  assert.match(bootstrapped[0].script, /configuring runtime for reef-root/);
  assert.match(bootstrapped[0].script, /LLM_PROXY_KEY='sk-vers-test'/);
  assert.match(bootstrapped[0].script, /VERS_GOLDEN_COMMIT_ID='golden-commit-xyz'/);
  assert.equal(deployment.nodes.root.vmId, "vm-restored");
});
