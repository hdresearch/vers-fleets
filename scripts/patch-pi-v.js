#!/usr/bin/env bun
/**
 * Patches @hdresearch/pi-v dist files for Windows compatibility.
 * Applied automatically via postinstall. Remove once upstream PR is merged:
 * https://github.com/hdresearch/pi-vers/pull/70
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const piVDist = resolve(root, "node_modules/@hdresearch/pi-v/dist/core");

function patch(file, replacements) {
  const filePath = resolve(piVDist, file);
  let src = readFileSync(filePath, "utf-8");
  for (const [from, to] of replacements) {
    if (!src.includes(from)) {
      console.warn(`[patch-pi-v] WARNING: expected string not found in ${file}: ${from.slice(0, 60)}`);
      continue;
    }
    src = src.replaceAll(from, to);
  }
  writeFileSync(filePath, src, "utf-8");
  console.log(`[patch-pi-v] Patched ${file}`);
}

// vers-client.js
patch("vers-client.js", [
  // Fix require("fs") in ESM
  [
    `import { execFile, spawn } from "node:child_process";\nimport { writeFile, mkdir } from "node:fs/promises";`,
    `import { execFile, spawn } from "node:child_process";\nimport { readFileSync } from "node:fs";\nimport { writeFile, mkdir } from "node:fs/promises";`,
  ],
  [
    `const data = require("fs").readFileSync(keysPath, "utf-8");`,
    `const data = readFileSync(keysPath, "utf-8");`,
  ],
  // Fix key file ACLs on Windows
  [
    `await writeFile(keyPath, keyInfo.ssh_private_key, { mode: 0o600 });\n        this.keyPathCache.set(vmId, keyPath);`,
    `await writeFile(keyPath, keyInfo.ssh_private_key, { mode: 0o600 });\n        if (process.platform === "win32") {\n            await new Promise((res, rej) => {\n                execFile("icacls", [keyPath, "/inheritance:r", "/grant:r", \`\${process.env.USERNAME}:F\`],\n                    (err) => err ? rej(err) : res());\n            });\n        }\n        this.keyPathCache.set(vmId, keyPath);`,
  ],
  // Fix UserKnownHostsFile and ProxyCommand
  [
    `            "-o", "UserKnownHostsFile=/dev/null",`,
    `            "-o", \`UserKnownHostsFile=\${process.platform === "win32" ? "NUL" : "/dev/null"}\`,`,
  ],
  [
    `ProxyCommand=openssl s_client -connect %h:443 -servername %h -quiet 2>/dev/null`,
    `ProxyCommand=openssl s_client -connect %h:443 -servername %h -quiet`,
  ],
]);

// swarm.js
patch("swarm.js", [
  [
    `        "-o", "UserKnownHostsFile=/dev/null",`,
    `        "-o", \`UserKnownHostsFile=\${process.platform === "win32" ? "NUL" : "/dev/null"}\`,`,
  ],
  [
    `ProxyCommand=openssl s_client -connect %h:443 -servername %h -quiet 2>/dev/null`,
    `ProxyCommand=openssl s_client -connect %h:443 -servername %h -quiet`,
  ],
]);
