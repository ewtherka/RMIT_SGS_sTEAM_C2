import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, "releases");
const files = [
  "START-DEMO.cmd",
  "DEMO.md",
  "scripts/start-demo.mjs",
  "scripts/demo-server.mjs",
  "careflow-frontend/dist",
  "careflow-backend/dist/src",
  "careflow-backend/dist/scripts",
  "careflow-backend/public",
  "careflow-backend/package.json",
  "careflow-backend/package-lock.json",
];
for (const file of files)
  if (!existsSync(resolve(root, file)))
    throw Error(`Build first: missing ${file}`);
mkdirSync(output, { recursive: true });
const stage = mkdtempSync(resolve(tmpdir(), "careflow-demo-"));
const bundle = resolve(stage, "CareFlow-demo");
for (const file of files) {
  const target = resolve(bundle, file);
  mkdirSync(resolve(target, ".."), { recursive: true });
  cpSync(resolve(root, file), target, { recursive: true });
}
// Write a fresh archive in the new staging directory, never update a previous ZIP.
const archive = resolve(stage, "CareFlow-demo.zip");
const result = spawnSync("zip", ["-qr", archive, "CareFlow-demo"], {
  cwd: stage,
  stdio: "inherit",
});
if (result.status !== 0) throw Error("Packaging needs the zip utility.");
cpSync(archive, resolve(output, "CareFlow-demo.zip"));
const checksum = createHash("sha256")
  .update(readFileSync(archive))
  .digest("hex");
writeFileSync(
  resolve(output, "CareFlow-demo.sha256"),
  `${checksum}  CareFlow-demo.zip\n`,
);
console.log(`Packaged releases/CareFlow-demo.zip. SHA256: ${checksum}`);
console.log(`Staging folder retained for verification: ${bundle}`);
