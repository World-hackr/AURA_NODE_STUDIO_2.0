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

export async function loadCuratedPackageDetails(packageEntry) {
  const componentPath = resolve(workspaceRoot, packageEntry.path, "component.json");
  const raw = await readFile(componentPath, "utf8");
  const component = JSON.parse(raw);
  const validation = await validateContractPayload("component_package.v1", component);
  if (!validation.ok) {
    throw new Error(`Component package validation failed for ${packageEntry.packageId}: ${validation.errors.map((e) => e.message).join("; ")}`);
  }

  return {
    ...packageEntry,
    component,
  };
}

export async function listTrustedPackageDetails() {
  const packages = await listCuratedPackages();
  return Promise.all(
    packages
      .filter((entry) => entry.status === "trusted")
      .map((entry) => loadCuratedPackageDetails(entry)),
  );
}
