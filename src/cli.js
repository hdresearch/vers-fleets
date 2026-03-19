#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildBootstrapBundle } from "./boot.js";
import { provisionFleet } from "./orchestrate.js";

function parseArgs(argv) {
  const args = {
    command: "bundle",
    outDir: "out",
    rootName: "root-reef",
    lieutenantName: "lieutenant-1",
    swarmCount: 3,
    email: "",
    forceShellAuth: false,
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
    } else if (arg === "--lieutenant-name" && next) {
      args.lieutenantName = next;
      i += 1;
    } else if (arg === "--swarm-count" && next) {
      args.swarmCount = Number(next);
      i += 1;
    } else if (arg === "--email" && next) {
      args.email = next;
      i += 1;
    } else if (arg === "--force-shell-auth") {
      args.forceShellAuth = true;
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
  if (bundle.scripts.lieutenant) {
    writeFileSync(resolve(outDir, "lieutenant.sh"), bundle.scripts.lieutenant);
  }
  for (const swarm of bundle.scripts.swarm) {
    writeFileSync(resolve(outDir, `${swarm.name}.sh`), swarm.script);
  }
}

function printHelp() {
  console.log(`vers-fleets

Usage:
  node src/cli.js bundle [--out-dir out] [--root-name root-reef] [--lieutenant-name lieutenant-1] [--swarm-count 3]
  node src/cli.js provision [--out-dir out] [--email you@example.com] [--force-shell-auth] [--root-name root-reef] [--lieutenant-name lieutenant-1] [--swarm-count 3]
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
      lieutenantName: args.lieutenantName,
      swarmCount: args.swarmCount,
    });
    writeBundle(args.outDir, bundle);
    console.log(`Wrote vers-fleets bootstrap bundle to ${resolve(args.outDir)}`);
    return;
  }

  if (args.command === "provision") {
    const deployment = await provisionFleet(
      {
        rootName: args.rootName,
        lieutenantName: args.lieutenantName,
        swarmCount: args.swarmCount,
        bootstrapChildren: false,
      },
      {
        outDir: args.outDir,
        email: args.email || undefined,
        forceShellAuth: args.forceShellAuth,
      },
    );
    console.log(`Provisioned vers-fleets topology. Root reef is ${deployment.nodes.root.url}`);
    console.log(`Wrote deployment manifest to ${resolve(args.outDir, "deployment.json")}`);
    return;
  }

  throw new Error(`Unknown command: ${args.command}`);
}

await main();
