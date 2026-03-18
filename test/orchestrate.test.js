import assert from "node:assert/strict";
import test from "node:test";
import { provisionFleet } from "../src/orchestrate.js";

test("provisionFleet creates fresh VMs, bootstraps them, and registers lineage against the root", async () => {
  const created = [];
  const staged = [];
  const bootstrapped = [];
  const registered = [];
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
      registerChildren: async (topology) => {
        registered.push({
          kind: "children",
          nodes: [topology.lieutenant, ...topology.swarm].map((vm) => ({
            vmId: vm.vmId,
            parentVmId: vm.parentVmId,
            category: vm.category,
          })),
        });
      },
    },
  );

  assert.deepEqual(created, ["vm-1", "vm-2", "vm-3", "vm-4"]);
  assert.equal(staged.length, 4);
  assert.equal(bootstrapped.length, 4);
  assert.equal(deployment.topology.root.vmId, "vm-1");
  assert.equal(deployment.topology.lieutenant.vmId, "vm-2");
  assert.deepEqual(
    deployment.topology.swarm.map((vm) => vm.vmId),
    ["vm-3", "vm-4"],
  );
  assert.equal(registered[0].kind, "root");
  assert.equal(registered[1].kind, "children");
  assert.deepEqual(
    registered[1].nodes.map((node) => node.parentVmId),
    ["vm-1", "vm-2", "vm-2"],
  );
  assert.match(bootstrapped[0].script, /bootstrapping reef-root/);
  assert.match(bootstrapped[1].script, /bootstrapping lt-main/);
});
