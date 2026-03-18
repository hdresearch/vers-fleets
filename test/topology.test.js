import assert from "node:assert/strict";
import test from "node:test";
import { buildBootstrapBundle } from "../src/boot.js";
import { buildTopology } from "../src/topology.js";

test("buildTopology creates root-only sqlite authority topology", () => {
  const topology = buildTopology({
    rootName: "reef-root",
    lieutenantName: "lt-main",
    swarmCount: 3,
  });

  assert.equal(topology.semantics.bootstrapMode, "fresh_vms_only");
  assert.equal(topology.semantics.snapshotsInBootstrap, false);
  assert.equal(topology.semantics.rootOwnsSqlite, true);
  assert.equal(topology.sources.punkin.ref, "v1rc3");
  assert.equal(topology.sources.punkin.type, "workspace");
  assert.equal(topology.root.runtime.hasSqliteAuthority, true);
  assert.equal(topology.lieutenant.runtime.hasSqliteAuthority, false);
  assert.equal(topology.swarm[0].runtime.hasSqliteAuthority, false);
  assert.equal(topology.lieutenant.parentVmId, topology.root.vmId);
  assert.equal(topology.swarm[0].parentVmId, topology.lieutenant.vmId);
  assert.equal(topology.lieutenant.reefConfig.organs.includes("registry"), false);
  assert.equal(topology.lieutenant.reefConfig.organs.includes("vm-tree"), false);
  assert.equal(topology.lieutenant.reefConfig.organs.includes("store"), false);
});

test("buildBootstrapBundle emits workspace-aware root and child scripts", () => {
  const bundle = buildBootstrapBundle({
    rootName: "reef-root",
    lieutenantName: "lt-main",
    swarmCount: 1,
  });

  assert.match(bundle.scripts.root, /expected staged workspace source at \/opt\/src\/reef/);
  assert.match(bundle.scripts.root, /expected staged workspace source at \/opt\/src\/punkin-pi/);
  assert.match(bundle.scripts.root, /setup_22\.x/);
  assert.match(bundle.scripts.root, /SERVICES_DIR="\/opt\/reef\/services-active"/);
  assert.match(bundle.scripts.root, /PUNKIN_RELEASE_TAG='v1rc3'/);
  assert.doesNotMatch(bundle.scripts.lieutenant, /root\.sqlite/);
  assert.match(bundle.scripts.lieutenant, /VERS_INFRA_URL='https:\/\/.*\.vm\.vers\.sh:3000'/);
});
