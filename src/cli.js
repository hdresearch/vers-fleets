#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildBootstrapBundle } from "./boot.js";
import { buildGolden, buildRoot, provisionFleet } from "./orchestrate.js";

function parseArgs(argv) {
  const args = {
    command: "bundle",
    outDir: "out",
    rootName: "root-reef",
    email: "",
    forceShellAuth: false,
    rootCommitId: "",
    goldenCommitId: "",
    reefPath: "",
    piVersPath: "",
  };

  const values = [...argv];
  if (values[0] && !values[0].startsWith("--")) {
    args.command = values.shift();
  }

  for (let i = 0; i < values.length; i += 1) {
    const arg = values[i];
    const next = values[i + 1];

    if (arg === "--out-dir" && next) {
      args.outDir = next;
      i += 1;
    } else if (arg === "--root-name" && next) {
      args.rootName = next;
      i += 1;
    } else if (arg === "--email" && next) {
      args.email = next;
      i += 1;
    } else if (arg === "--force-shell-auth") {
      args.forceShellAuth = true;
    } else if (arg === "--root-commit" && next) {
      args.rootCommitId = next;
      i += 1;
    } else if (arg === "--golden-commit" && next) {
      args.goldenCommitId = next;
      i += 1;
    } else if (arg === "--reef-path" && next) {
      args.reefPath = next;
      i += 1;
    } else if (arg === "--pi-vers-path" && next) {
      args.piVersPath = next;
      i += 1;
    } else if (arg === "--help") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function writeBundle(outDir, bundle) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "topology.json"), `${JSON.stringify(bundle.topology, null, 2)}\n`);
  writeFileSync(resolve(outDir, "root.sh"), bundle.scripts.root);
}

function printHelp() {
  console.log(`vers-fleets

Usage:
  node src/cli.js bundle      [--out-dir out] [--root-name root-reef]
  node src/cli.js provision   [--out-dir out] [--email you@example.com] [--force-shell-auth]
                              [--root-name root-reef] [--root-commit <id>] [--golden-commit <id>]
  node src/cli.js build-root  [--out-dir out] [--email you@example.com] [--force-shell-auth]
                              [--root-name root-reef]
  node src/cli.js build-golden [--out-dir out] [--email you@example.com] [--force-shell-auth]
                              [--reef-path ../reef] [--pi-vers-path ../pi-vers]

Commands:
  bundle         Generate bootstrap scripts locally (no VM creation)
  provision      Create and configure a live root reef VM
                   --root-commit   Skip image build, restore from pre-built root commit
                   --golden-commit Inject golden commit ID so root reef can spawn agents
  build-root     Build a root reef image and commit it (no secrets baked in)
  build-golden   Build a golden agent image and commit it (no secrets baked in)
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (args.command === "bundle") {
    const bundle = buildBootstrapBundle({
      rootName: args.rootName,
    });
    writeBundle(args.outDir, bundle);
    console.log(`Wrote vers-fleets bootstrap bundle to ${resolve(args.outDir)}`);
    return;
  }

  if (args.command === "build-root") {
    const result = await buildRoot(
      { rootName: args.rootName },
      {
        outDir: args.outDir,
        email: args.email || undefined,
        forceShellAuth: args.forceShellAuth,
      },
    );
    console.log(`\nRoot image committed: ${result.commitId}`);
    console.log(`VERS_API_KEY used: ${result.versApiKey}`);
    console.log(`\nTo make this image public, run:`);
    console.log(`  VERS_API_KEY=${result.versApiKey} curl -X PATCH https://api.vers.sh/api/v1/commits/${result.commitId} \\`);
    console.log(`    -H "Authorization: Bearer ${result.versApiKey}" -H "Content-Type: application/json" \\`);
    console.log(`    -d '{"is_public": true}'`);
    console.log(`\nTo provision from this image:`);
    console.log(`  node src/cli.js provision --root-commit ${result.commitId}`);
    return;
  }

  if (args.command === "build-golden") {
    const result = await buildGolden(
      {},
      {
        outDir: args.outDir,
        email: args.email || undefined,
        forceShellAuth: args.forceShellAuth,
        reefPath: args.reefPath || undefined,
        piVersPath: args.piVersPath || undefined,
      },
    );
    console.log(`\nGolden image committed: ${result.commitId}`);
    console.log(`VERS_API_KEY used: ${result.versApiKey}`);
    console.log(`\nTo make this image public, run:`);
    console.log(`  VERS_API_KEY=${result.versApiKey} curl -X PATCH https://api.vers.sh/api/v1/commits/${result.commitId} \\`);
    console.log(`    -H "Authorization: Bearer ${result.versApiKey}" -H "Content-Type: application/json" \\`);
    console.log(`    -d '{"is_public": true}'`);
    console.log(`\nTo provision with this golden image:`);
    console.log(`  node src/cli.js provision --golden-commit ${result.commitId}`);
    return;
  }

  if (args.command === "provision") {
    const deployment = await provisionFleet(
      {
        rootName: args.rootName,
      },
      {
        outDir: args.outDir,
        email: args.email || undefined,
        forceShellAuth: args.forceShellAuth,
        rootCommitId: args.rootCommitId || undefined,
        goldenCommitId: args.goldenCommitId || undefined,
      },
    );
    console.log(`Provisioned vers-fleets topology. Root reef is ${deployment.nodes.root.url}`);
    console.log(`Wrote deployment manifest to ${resolve(args.outDir, "deployment.json")}`);
    return;
  }

  throw new Error(`Unknown command: ${args.command}`);
}

await main();
