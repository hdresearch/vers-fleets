#!/usr/bin/env bun

import { resolve } from "node:path";
import { buildGolden, buildRoot, provisionFleet } from "./orchestrate.js";

function parseArgs(argv) {
  const args = {
    command: "",
    outDir: "out",
    rootName: "root-reef",
    email: "",
    forceShellAuth: false,
    rootCommitId: "",
    goldenCommitId: "",
    reefPath: "",
    piVersPath: "",
    visibility: "", // "public" or "private"
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
    } else if (arg === "--public") {
      args.visibility = "public";
    } else if (arg === "--private") {
      args.visibility = "private";
    } else if (arg === "--help") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function hasVersApiKey() {
  return !!(process.env.VERS_API_KEY?.trim());
}

function requireAuth(args) {
  if (!hasVersApiKey() && !args.email) {
    console.error("Error: Authentication required. Either set VERS_API_KEY in your environment or pass --email for shell-auth.");
    process.exit(1);
  }
}

function printHelp() {
  console.log(`vers-fleets

Usage:
  bun src/cli.js provision    --root-commit <id> --golden-commit <id> [--email you@example.com]
                               [--force-shell-auth] [--root-name root-reef] [--out-dir out]
  bun src/cli.js build-root   --public | --private [--email you@example.com]
                               [--force-shell-auth] [--root-name root-reef] [--out-dir out]
  bun src/cli.js build-golden --public | --private --reef-path <path> --pi-vers-path <path>
                               [--email you@example.com] [--force-shell-auth] [--out-dir out]

Commands:
  provision      Spawn a root reef VM from pre-built commits and configure it
  build-root     Build a root reef image and commit it (no secrets baked in)
  build-golden   Build a golden agent image and commit it (no secrets baked in)

Auth:
  All commands require a VERS_API_KEY (set in env, e.g. .zshrc) or --email for shell-auth.

Flags:
  --public       Make the commit publicly visible immediately and delete the builder VM
  --private      Keep the commit private and the builder VM alive for testing/SSH
  --root-commit  Commit ID of a pre-built root reef image (required for provision)
  --golden-commit Commit ID of a pre-built golden agent image (required for provision)
  --reef-path    Path to local reef directory (required for build-golden)
  --pi-vers-path Path to local pi-vers directory (required for build-golden)
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.command) {
    printHelp();
    return;
  }

  if (args.command === "build-root") {
    requireAuth(args);
    if (!args.visibility) {
      console.error("Error: --public or --private is required for build-root.");
      process.exit(1);
    }

    const result = await buildRoot(
      { rootName: args.rootName },
      {
        outDir: args.outDir,
        email: args.email || undefined,
        forceShellAuth: args.forceShellAuth,
        makePublic: args.visibility === "public",
      },
    );

    console.log(`\nRoot image committed: ${result.commitId}`);
    console.log(`VERS_API_KEY used: ${result.versApiKey}`);
    if (result.isPublic) {
      console.log(`Visibility: public`);
    } else {
      console.log(`Visibility: private (builder VM still running: ${result.vmId})`);
      console.log(`\nSSH into the builder VM to test:`);
      console.log(`  ssh root@${result.vmId}.vm.vers.sh`);
      console.log(`\nWhen ready, make it public:`);
      console.log(`  curl -X PATCH https://api.vers.sh/api/v1/commits/${result.commitId} \\`);
      console.log(`    -H "Authorization: Bearer ${result.versApiKey}" -H "Content-Type: application/json" \\`);
      console.log(`    -d '{"is_public": true}'`);
    }
    console.log(`\nSave this VERS_API_KEY — you need it to manage this commit.`);
    console.log(`\nTo provision from this image:`);
    console.log(`  bun src/cli.js provision --root-commit ${result.commitId} --golden-commit <golden-id>`);
    return;
  }

  if (args.command === "build-golden") {
    requireAuth(args);
    if (!args.visibility) {
      console.error("Error: --public or --private is required for build-golden.");
      process.exit(1);
    }
    if (!args.reefPath) {
      console.error("Error: --reef-path is required for build-golden.");
      process.exit(1);
    }
    if (!args.piVersPath) {
      console.error("Error: --pi-vers-path is required for build-golden.");
      process.exit(1);
    }

    const result = await buildGolden(
      {},
      {
        outDir: args.outDir,
        email: args.email || undefined,
        forceShellAuth: args.forceShellAuth,
        reefPath: args.reefPath,
        piVersPath: args.piVersPath,
        makePublic: args.visibility === "public",
      },
    );

    console.log(`\nGolden image committed: ${result.commitId}`);
    console.log(`VERS_API_KEY used: ${result.versApiKey}`);
    if (result.isPublic) {
      console.log(`Visibility: public`);
    } else {
      console.log(`Visibility: private (builder VM still running: ${result.vmId})`);
      console.log(`\nSSH into the builder VM to test:`);
      console.log(`  ssh root@${result.vmId}.vm.vers.sh`);
      console.log(`\nWhen ready, make it public:`);
      console.log(`  curl -X PATCH https://api.vers.sh/api/v1/commits/${result.commitId} \\`);
      console.log(`    -H "Authorization: Bearer ${result.versApiKey}" -H "Content-Type: application/json" \\`);
      console.log(`    -d '{"is_public": true}'`);
    }
    console.log(`\nSave this VERS_API_KEY — you need it to manage this commit.`);
    console.log(`\nTo provision with this golden image:`);
    console.log(`  bun src/cli.js provision --root-commit <root-id> --golden-commit ${result.commitId}`);
    return;
  }

  if (args.command === "provision") {
    requireAuth(args);
    if (!args.rootCommitId) {
      console.error("Error: --root-commit is required for provision.");
      process.exit(1);
    }
    if (!args.goldenCommitId) {
      console.error("Error: --golden-commit is required for provision.");
      process.exit(1);
    }

    const deployment = await provisionFleet(
      { rootName: args.rootName },
      {
        outDir: args.outDir,
        email: args.email || undefined,
        forceShellAuth: args.forceShellAuth,
        rootCommitId: args.rootCommitId,
        goldenCommitId: args.goldenCommitId,
      },
    );

    console.log(`\nProvisioned vers-fleets topology. Root reef is ${deployment.nodes.root.url}`);
    console.log(`VERS_API_KEY used: ${deployment.auth.versApiKey}`);
    console.log(`\nSave this VERS_API_KEY — you need it to SSH into VMs and manage commits from this run.`);
    console.log(`Wrote deployment manifest to ${resolve(args.outDir, "deployment.json")}`);
    return;
  }

  console.error(`Unknown command: ${args.command}`);
  printHelp();
  process.exit(1);
}

await main();
