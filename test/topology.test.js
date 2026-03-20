import assert from "node:assert/strict";
import test from "node:test";
import { buildBootstrapBundle } from "../src/boot.js";
import { buildTopology } from "../src/topology.js";

test("buildTopology creates root-only sqlite authority topology", () => {
  const topology = buildTopology({
    rootName: "reef-root",
  });

  assert.equal(topology.semantics.bootstrapMode, "fresh_vms_only");
  assert.equal(topology.semantics.snapshotsInBootstrap, false);
  assert.equal(topology.semantics.rootOwnsSqlite, true);
  assert.equal(topology.sources.punkin.ref, "v1rc3");
  assert.equal(topology.sources.punkin.type, "git");
  assert.equal(topology.sources.reef.type, "git");
  assert.equal(topology.sources.reef.ref, "main");
  assert.equal(topology.sources.piVers.type, "git");
  assert.equal(topology.sources.piVers.ref, "main");
  assert.equal(topology.profiles.sharedOperational.capabilities.includes("pi-vers"), true);
  assert.equal(topology.profiles.sharedOperational.capabilities.includes("punkin"), true);
  assert.equal(topology.profiles.sharedOperational.capabilities.includes("reef-extension"), true);
  assert.equal(topology.profiles.rootAuthorityOverlay.capabilities.includes("sqlite-authority"), true);
  assert.equal(topology.root.runtime.hasSqliteAuthority, true);
  assert.equal(topology.root.runtime.profile, "root-with-authority-overlay");
  assert.equal(topology.root.reefConfig.services.includes("registry"), true);
  assert.equal(topology.root.reefConfig.services.includes("vm-tree"), true);
  assert.equal(topology.root.reefConfig.services.includes("store"), true);
  assert.equal(topology.root.reefConfig.services.includes("commits"), true);
  assert.equal(topology.lieutenant, null);
  assert.deepEqual(topology.swarm, []);
});

test("buildBootstrapBundle emits git-based root bootstrap script", () => {
  const bundle = buildBootstrapBundle({
    rootName: "reef-root",
  });

  assert.match(bundle.scripts.root, /git clone 'https:\/\/github.com\/hdresearch\/reef\.git' '\/opt\/src\/reef'/);
  assert.match(bundle.scripts.root, /git checkout 'main'/);
  assert.match(bundle.scripts.root, /git clone 'https:\/\/github.com\/hdresearch\/pi-vers\.git' '\/opt\/src\/pi-vers'/);
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
  assert.equal(bundle.scripts.lieutenant, null);
  assert.deepEqual(bundle.scripts.swarm, []);
});

test("buildBootstrapBundle can inline runtime secrets for remote bootstrap", () => {
  const bundle = buildBootstrapBundle(
    {
      rootName: "reef-root",
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
