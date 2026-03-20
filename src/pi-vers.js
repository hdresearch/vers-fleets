import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const defaultPiVersRepo = resolve(here, "../node_modules/@hdresearch/pi-v");
let cachedCore = null;
let buildPromise = null;

function execFileAsync(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(
          Object.assign(error, {
            stdout: stdout?.toString() ?? "",
            stderr: stderr?.toString() ?? "",
          }),
        );
        return;
      }
      resolvePromise({
        stdout: stdout?.toString() ?? "",
        stderr: stderr?.toString() ?? "",
      });
    });
  });
}

function piVersRepoPath() {
  return process.env.PI_VERS_REPO_PATH || defaultPiVersRepo;
}

function piVersDistIndexPath() {
  return resolve(piVersRepoPath(), "dist/core/index.js");
}

async function ensurePiVersBuilt() {
  const distIndex = piVersDistIndexPath();
  if (existsSync(distIndex)) return;
  if (!buildPromise) {
    buildPromise = execFileAsync("npm", ["run", "build"], {
      cwd: piVersRepoPath(),
    }).finally(() => {
      buildPromise = null;
    });
  }
  await buildPromise;
}

export async function loadPiVersCore() {
  if (cachedCore) return cachedCore;
  await ensurePiVersBuilt();
  cachedCore = await import(pathToFileURL(piVersDistIndexPath()).href);
  return cachedCore;
}

export async function createPiVersClient(options = {}) {
  const core = await loadPiVersCore();
  return new core.VersClient(options);
}

export async function ensurePiVersApiKey(options = {}) {
  const core = await loadPiVersCore();
  return core.ensureVersApiKey({
    ...options,
    label: options.label || "vers-fleets",
  });
}
