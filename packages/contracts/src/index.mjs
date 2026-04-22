import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const contractsRoot = packageRoot;
const workspaceRoot = resolve(packageRoot, "../..");

const ajv = new Ajv2020({
  allErrors: true,
  allowUnionTypes: true,
  strict: false,
});
addFormats(ajv);

const validatorCache = new Map();
let contractIndexCache = null;

async function readJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export function getWorkspaceRoot() {
  return workspaceRoot;
}

export function getContractsRoot() {
  return contractsRoot;
}

export async function loadContractIndex() {
  if (contractIndexCache) {
    return contractIndexCache;
  }

  contractIndexCache = await readJson(resolve(contractsRoot, "contract_index.json"));
  return contractIndexCache;
}

export async function listContracts() {
  const index = await loadContractIndex();
  return index.contracts ?? [];
}

export async function getContractEntry(contractId) {
  const contracts = await listContracts();
  return contracts.find((entry) => entry.id === contractId) ?? null;
}

export async function loadContractSchema(contractId) {
  const entry = await getContractEntry(contractId);
  if (!entry) {
    throw new Error(`Unknown contract: ${contractId}`);
  }
  return readJson(resolve(workspaceRoot, entry.path));
}

export async function getValidator(contractId) {
  if (validatorCache.has(contractId)) {
    return validatorCache.get(contractId);
  }

  const schema = await loadContractSchema(contractId);
  const validate = ajv.compile(schema);
  validatorCache.set(contractId, validate);
  return validate;
}

export async function validateContractPayload(contractId, payload) {
  const validate = await getValidator(contractId);
  const valid = validate(payload);

  return {
    ok: Boolean(valid),
    contractId,
    errors: valid
      ? []
      : (validate.errors ?? []).map((error) => ({
          instancePath: error.instancePath,
          schemaPath: error.schemaPath,
          message: error.message ?? "Validation failed",
        })),
  };
}

export async function loadExamplePayload(examplePathRelativeToContractsRoot) {
  return readJson(resolve(contractsRoot, examplePathRelativeToContractsRoot));
}
