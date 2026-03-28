import assert from "node:assert/strict";
import test from "node:test";
import { buildBootstrapBundle, buildImageScript, buildRuntimeScript } from "../src/boot.js";
import { buildTopology } from "../src/topology.js";

test("buildTopology creates root-only sqlite authority topology", () => {
  const topology = buildTopology({
    rootName: "reef-root",
  });

  assert.equal(topology.semantics.bootstrapMode, "fresh_vms_only");
  assert.equal(topology.semantics.snapshotsInBootstrap, false);
  assert.equal(topology.semantics.rootOwnsSqlite, true);
  assert.equal(topology.sources.punkin.ref, "carter/punkin/v1_rc5");
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
  assert.equal(topology.root.reefConfig.services.includes("vm-tree"), true);
  assert.equal(topology.root.reefConfig.services.includes("store"), true);
  assert.equal(topology.root.reefConfig.services.includes("scheduled"), true);
  assert.equal(topology.root.reefConfig.services.includes("usage"), true);
  assert.equal(topology.root.reefConfig.services.includes("probe"), true);
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
  assert.match(bundle.scripts.root, /git rev-parse --verify -q 'refs\/tags\/carter\/punkin\/v1_rc5' >/);
  assert.match(bundle.scripts.root, /git -c advice\.detachedHead=false checkout --detach 'refs\/tags\/carter\/punkin\/v1_rc5'/);
  assert.match(bundle.scripts.root, /setup_22\.x/);
  assert.match(bundle.scripts.root, /HUSKY=0 npm install/);
  assert.match(bundle.scripts.root, /PI_PATH='punkin'/);
  assert.match(bundle.scripts.root, /ln -sf \/usr\/local\/bin\/punkin \/usr\/local\/bin\/pi/);
  assert.match(bundle.scripts.root, /ln -sfn \/opt\/punkin-pi\/packages\/coding-agent "\$pkg_root\/node_modules\/@mariozechner\/pi-coding-agent"/);
  assert.match(bundle.scripts.root, /"punkin" install \/opt\/pi-vers/);
  assert.match(bundle.scripts.root, /"punkin" install \/opt\/reef/);
  assert.match(bundle.scripts.root, /SERVICES_DIR="\/opt\/reef\/services-active"/);
  assert.match(bundle.scripts.root, /PUNKIN_RELEASE_TAG='carter\/punkin\/v1_rc5'/);
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
      llmProxyKey: "sk-vers-secret",
    },
  );

  assert.match(bundle.scripts.root, /VERS_API_KEY='vers-secret'/);
  assert.match(bundle.scripts.root, /VERS_AUTH_TOKEN='auth-secret'/);
  assert.match(bundle.scripts.root, /LLM_PROXY_KEY='sk-vers-secret'/);
});

test("buildBootstrapBundle prefers a dedicated secondary provider key when provided", () => {
  const bundle = buildBootstrapBundle(
    {
      rootName: "reef-root",
    },
    {
      rootUrl: "https://infra.vm.vers.sh:3000",
      versApiKey: "vers-secret",
      versAuthToken: "auth-secret",
      llmProxyKey: "sk-vers-secret",
      anthropicApiKey: "sk-ant-secret",
    },
  );

  assert.match(bundle.scripts.root, /LLM_PROXY_KEY='sk-vers-secret'/);
  assert.match(bundle.scripts.root, /ANTHROPIC_API_KEY='sk-ant-secret'/);
});

test("buildImageScript produces a secret-free image build script", () => {
  const topology = buildTopology({ rootName: "reef-root" });
  const script = buildImageScript(topology);
  assert.match(script, /building root reef image/);
  assert.match(script, /git clone/);
  assert.match(script, /HUSKY=0 npm install/);
  assert.match(script, /bun install/);
  assert.match(script, /image build complete/);
  // No secrets in the image script
  assert.doesNotMatch(script, /VERS_API_KEY/);
  assert.doesNotMatch(script, /LLM_PROXY_KEY/);
  assert.doesNotMatch(script, /VERS_AUTH_TOKEN/);
  assert.doesNotMatch(script, /\.env/);
});

test("buildRuntimeScript injects secrets and starts reef", () => {
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const topology = buildTopology({ rootName: "reef-root", rootVmId: "vm-1" });
  try {
    const script = buildRuntimeScript(topology.root, topology, {
      versApiKey: "vers-key",
      versAuthToken: "auth-token",
      llmProxyKey: "sk-vers-proxy",
      goldenCommitId: "golden-abc-123",
    });
    assert.match(script, /configuring runtime for reef-root/);
    assert.match(script, /VERS_API_KEY='vers-key'/);
    assert.match(script, /VERS_AUTH_TOKEN='auth-token'/);
    assert.match(script, /LLM_PROXY_KEY='sk-vers-proxy'/);
    assert.match(script, /ANTHROPIC_API_KEY='sk-vers-proxy'/);
    assert.match(script, /VERS_GOLDEN_COMMIT_ID='golden-abc-123'/);
    assert.match(script, /bun run src\/main\.ts/);
    assert.match(script, /reef is healthy/);
  } finally {
    if (originalAnthropicKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
    }
  }
});

test("buildRuntimeScript prefers a dedicated secondary provider key", () => {
  const topology = buildTopology({ rootName: "reef-root", rootVmId: "vm-1" });
  const script = buildRuntimeScript(topology.root, topology, {
    versApiKey: "vers-key",
    versAuthToken: "auth-token",
    llmProxyKey: "sk-vers-proxy",
    anthropicApiKey: "sk-ant-secret",
    goldenCommitId: "golden-abc-123",
  });

  assert.match(script, /LLM_PROXY_KEY='sk-vers-proxy'/);
  assert.match(script, /ANTHROPIC_API_KEY='sk-ant-secret'/);
});
