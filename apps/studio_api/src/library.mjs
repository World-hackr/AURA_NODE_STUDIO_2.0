import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateContractPayload } from "@aura/contracts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..");
const workspaceRoot = resolve(appRoot, "../..");
const libraryIndexPath = resolve(workspaceRoot, "library", "curated_packages", "library_index.json");

export async function loadLibraryIndex() {
  const raw = await readFile(libraryIndexPath, "utf8");
  const parsed = JSON.parse(raw);
  const validation = await validateContractPayload("library_index.v1", parsed);
  if (!validation.ok) {
    throw new Error(`Library index validation failed: ${validation.errors.map((e) => e.message).join("; ")}`);
  }
  return parsed;
}

export async function listCuratedPackages() {
  const index = await loadLibraryIndex();
  return index.packages ?? [];
}
