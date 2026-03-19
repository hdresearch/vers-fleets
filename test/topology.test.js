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
  assert.equal(topology.sources.punkin.type, "git");
  assert.equal(topology.profiles.sharedOperational.capabilities.includes("pi-vers"), true);
  assert.equal(topology.profiles.sharedOperational.capabilities.includes("punkin"), true);
  assert.equal(topology.profiles.rootAuthorityOverlay.capabilities.includes("sqlite-authority"), true);
  assert.equal(topology.root.runtime.hasSqliteAuthority, true);
  assert.equal(topology.lieutenant.runtime.hasSqliteAuthority, false);
  assert.equal(topology.swarm[0].runtime.hasSqliteAuthority, false);
  assert.equal(topology.root.runtime.profile, "root-with-authority-overlay");
  assert.equal(topology.lieutenant.runtime.profile, "shared-operational");
  assert.equal(topology.lieutenant.parentVmId, topology.root.vmId);
  assert.equal(topology.swarm[0].parentVmId, topology.lieutenant.vmId);
  assert.equal(topology.lieutenant.reefConfig.organs.includes("registry"), false);
  assert.equal(topology.lieutenant.reefConfig.organs.includes("vm-tree"), false);
  assert.equal(topology.lieutenant.reefConfig.organs.includes("store"), false);
  assert.equal(topology.lieutenant.reefConfig.organs.includes("lieutenant"), true);
  assert.deepEqual(topology.lieutenant.reefConfig, topology.swarm[0].reefConfig);
  assert.equal(topology.root.reefConfig.organs.includes("registry"), true);
  assert.equal(topology.root.reefConfig.organs.includes("vm-tree"), true);
  assert.equal(topology.root.reefConfig.organs.includes("store"), true);
});

test("buildBootstrapBundle emits workspace-aware root and public punkin bootstrap scripts", () => {
  const bundle = buildBootstrapBundle({
    rootName: "reef-root",
    lieutenantName: "lt-main",
    swarmCount: 1,
  });

  assert.match(bundle.scripts.root, /expected staged workspace source at \/opt\/src\/reef/);
  assert.match(bundle.scripts.root, /git clone 'https:\/\/github.com\/hdresearch\/punkin-pi\.git' '\/opt\/src\/punkin-pi'/);
  assert.match(bundle.scripts.root, /git checkout 'v1rc3'/);
  assert.match(bundle.scripts.root, /setup_22\.x/);
  assert.match(bundle.scripts.root, /HUSKY=0 npm install/);
  assert.match(bundle.scripts.root, /PI_PATH='punkin'/);
  assert.match(bundle.scripts.root, /ln -sf \/usr\/local\/bin\/punkin \/usr\/local\/bin\/pi/);
  assert.match(bundle.scripts.root, /"punkin" install \/opt\/pi-vers/);
  assert.match(bundle.scripts.root, /"punkin" install \/opt\/reef/);
  assert.match(bundle.scripts.root, /SERVICES_DIR="\/opt\/reef\/services-active"/);
  assert.match(bundle.scripts.root, /PUNKIN_RELEASE_TAG='v1rc3'/);
  assert.doesNotMatch(bundle.scripts.lieutenant, /root\.sqlite/);
  assert.match(bundle.scripts.lieutenant, /VERS_INFRA_URL='https:\/\/.*\.vm\.vers\.sh:3000'/);
});

test("buildBootstrapBundle can inline runtime secrets for remote bootstrap", () => {
  const bundle = buildBootstrapBundle(
    {
      rootName: "reef-root",
      lieutenantName: "lt-main",
      swarmCount: 1,
    },
    {
      rootUrl: "https://infra.vm.vers.sh:3000",
      versApiKey: "vers-secret",
      versAuthToken: "auth-secret",
      anthropicApiKey: "anthropic-secret",
    },
  );

  assert.match(bundle.scripts.root, /VERS_API_KEY='vers-secret'/);
  assert.match(bundle.scripts.root, /VERS_AUTH_TOKEN='auth-secret'/);
  assert.match(bundle.scripts.root, /ANTHROPIC_API_KEY='anthropic-secret'/);
});
