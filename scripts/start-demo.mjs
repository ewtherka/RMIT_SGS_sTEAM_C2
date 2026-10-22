import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { serveFrontend } from "./demo-server.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const backend = resolve(root, "careflow-backend");
const frontend = resolve(root, "careflow-frontend");
const children = new Set();
let web;
let stopping = false;
const env = {
  ...process.env,
  TIDE_MODE: "simulated",
  PORT: "3333",
  HOST: "127.0.0.1",
  PUBLIC_API_URL: "http://localhost:3333",
  FRONTEND_ORIGINS: "http://localhost:5173,http://127.0.0.1:5173",
  QR_SIGNING_KEY:
    process.env.QR_SIGNING_KEY || randomBytes(48).toString("base64url"),
};

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  web?.close();
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
function child(command, args, cwd, background = false) {
  // All Windows shell arguments here are fixed, never user-provided strings.
  const npmWindows = process.platform === "win32" && command === "npm";
  const task = spawn(
    npmWindows ? process.env.ComSpec || "cmd.exe" : command,
    npmWindows ? ["/d", "/s", "/c", "npm", ...args] : args,
    { cwd, env, stdio: "inherit", windowsHide: true },
  );
  children.add(task);
  task.once("exit", (code) => {
    children.delete(task);
    if (background && !stopping) {
      console.error("CareFlow API stopped.");
      stop(code || 1);
    }
  });
  return new Promise((done, reject) => {
    task.once("error", reject);
    if (background) {
      task.once("spawn", () => done(task));
      return;
    }
    task.once("exit", (code) =>
      code === 0
        ? done()
        : reject(Error(`${command} ${args.join(" ")} failed (${code})`)),
    );
  });
}
async function occupied(port) {
  return new Promise((done) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      done(true);
    });
    socket.once("error", () => done(false));
    socket.once("timeout", () => {
      socket.destroy();
      done(false);
    });
  });
}
async function apiReady() {
  try {
    const response = await fetch("http://localhost:3333/v1/auth/config", {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok && (await response.json()).mode === "SIMULATED";
  } catch {
    return false;
  }
}
async function main() {
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw Error("Install Node.js 24+ from https://nodejs.org first.");
  console.log("\nCareFlow demo - SIMULATED TideCloak. Synthetic data only.\n");
  if (await occupied(3333)) {
    if (!(await apiReady()))
      throw Error(
        "Port 3333 is busy, but not a CareFlow simulated API. Stop that service yourself, then retry.",
      );
    console.log("Reusing your running CareFlow simulated API on port 3333.");
  } else {
    const source = existsSync(resolve(backend, "src/main.ts"));
    if (
      !existsSync(resolve(backend, "node_modules/@nestjs/core/package.json")) ||
      (source &&
        !existsSync(resolve(backend, "node_modules/typescript/package.json")))
    ) {
      await child(
        "npm",
        source
          ? ["ci", "--ignore-scripts", "--no-audit", "--no-fund"]
          : ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
        backend,
      );
    }
    if (source) await child("npm", ["run", "build"], backend);
    if (!existsSync(resolve(backend, "dist/src/main.js")))
      throw Error(
        "Missing backend build. Download the complete demo ZIP or build the source.",
      );
    // Idempotent seed: never clears an existing database or resets access decisions.
    await child(process.execPath, ["dist/scripts/seed.js"], backend);
    await child(process.execPath, ["dist/src/main.js"], backend, true);
    let ready = false;
    for (let attempt = 0; attempt < 40 && !stopping; attempt++) {
      if (await apiReady()) {
        ready = true;
        break;
      }
      await delay(500);
    }
    if (!ready)
      throw Error("CareFlow API did not become ready. Read the error above.");
  }
  if (stopping) return;
  if (await occupied(5173)) {
    const response = await fetch("http://localhost:5173", {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok || !(await response.text()).includes("CareFlow"))
      throw Error(
        "Port 5173 is busy with another app. Stop it yourself, then retry.",
      );
    console.log("Reusing your running CareFlow frontend on port 5173.");
  } else {
    if (existsSync(resolve(frontend, "src/main.tsx"))) {
      if (!existsSync(resolve(frontend, "node_modules/vite/package.json")))
        await child("npm", ["ci", "--no-audit", "--no-fund"], frontend);
      await child("npm", ["run", "build"], frontend);
    }
    if (!existsSync(resolve(frontend, "dist/index.html")))
      throw Error(
        "Missing frontend build. Download the complete demo ZIP or build the source.",
      );
    web = await serveFrontend(resolve(frontend, "dist"));
  }
  console.log(
    "\nREADY: http://localhost:5173\nAPI docs: http://localhost:3333/docs\nChoose Nguyen An, BS. Lan and independent admins using the visible account switcher.\nKeep this window open while recording. Ctrl+C stops only services started here.\n",
  );
  if (process.platform === "win32" && !process.argv.includes("--no-open")) {
    const opener = spawn(
      process.env.ComSpec || "cmd.exe",
      ["/d", "/s", "/c", "start", '""', "http://localhost:5173"],
      { stdio: "ignore", windowsHide: true },
    );
    opener.on("error", () => {});
  }
}
main().catch((error) => {
  console.error("\nCould not start CareFlow:", error.message);
  stop(1);
});
