import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dirname, "..");
const preservedRoot = resolve(workspaceRoot, "..", "AURA Node Studio_1");
const sourceRoot = resolve(preservedRoot, "vendor_reference", "fritzing_paired");
const targetRoot = resolve(workspaceRoot, "vendor_reference", "fritzing_paired");

async function run() {
  await mkdir(resolve(workspaceRoot, "vendor_reference"), { recursive: true });
  await rm(targetRoot, { recursive: true, force: true });
  await cp(sourceRoot, targetRoot, { recursive: true, force: true });
  console.log(`Imported Fritzing paired library into ${targetRoot}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
