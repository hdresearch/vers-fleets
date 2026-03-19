import assert from "node:assert/strict";
import test from "node:test";
import { provisionFleet } from "../src/orchestrate.js";

test("provisionFleet bootstraps only the root by default", async () => {
  const created = [];
  const staged = [];
  const bootstrapped = [];
  const registered = [];
  const lieutenantRegistrations = [];
  let count = 0;

  const deployment = await provisionFleet(
    {
      rootName: "reef-root",
      lieutenantName: "lt-main",
      swarmCount: 2,
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
      registerChildren: async () => {
        registered.push({ kind: "children" });
      },
      registerLieutenant: async (topology) => {
        lieutenantRegistrations.push(topology.lieutenant);
      },
    },
  );

  assert.deepEqual(created, ["vm-1"]);
  assert.equal(staged.length, 1);
  assert.equal(bootstrapped.length, 1);
  assert.equal(deployment.topology.root.vmId, "vm-1");
  assert.equal(deployment.topology.lieutenant, null);
  assert.deepEqual(deployment.topology.swarm, []);
  assert.equal(registered[0].kind, "root");
  assert.equal(registered[1].kind, "children");
  assert.deepEqual(lieutenantRegistrations, [null]);
  assert.match(bootstrapped[0].script, /bootstrapping reef-root/);
  assert.equal(deployment.nodes.root.vmId, "vm-1");
  assert.deepEqual(deployment.nodes.swarm, []);
});
