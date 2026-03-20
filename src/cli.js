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
}

function printHelp() {
  console.log(`vers-fleets

Usage:
  node src/cli.js bundle [--out-dir out] [--root-name root-reef]
  node src/cli.js provision [--out-dir out] [--email you@example.com] [--force-shell-auth] [--root-name root-reef]
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

  if (args.command === "provision") {
    const deployment = await provisionFleet(
      {
        rootName: args.rootName,
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
