import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

import {
  getContractsRoot,
  validateContractPayload,
  loadExamplePayload,
} from "../src/index.mjs";

const EXAMPLE_TO_CONTRACT = new Map([
  ["circuit_intent.blink_led.json", "circuit_intent.v1"],
  ["circuit_ir.blink_led.json", "circuit_ir.v1"],
  ["symbol_definition.generic_resistor.json", "symbol_definition.v1"],
  ["schematic_document.resistor_divider.json", "schematic_document.v1"],
  ["scene_state.resistor_divider.json", "scene_state.v1"],
  ["circuit_patch.add_indicator_led.json", "circuit_patch.v1"],
  ["component_package.led_red_5mm.json", "component_package.v1"],
  ["runtime_profile.light_output.json", "runtime_profile.v1"],
  ["library_index.sample.json", "library_index.v1"],
]);

async function main() {
  const examplesDir = resolve(getContractsRoot(), "examples");
  const files = (await readdir(examplesDir)).filter((file) => file.endsWith(".json"));

  let failed = false;
  for (const file of files) {
    const contractId = EXAMPLE_TO_CONTRACT.get(file);
    if (!contractId) {
      console.warn(`Skipping unmapped example: ${file}`);
      continue;
    }

    const payload = await loadExamplePayload(`examples/${file}`);
    const result = await validateContractPayload(contractId, payload);
    if (!result.ok) {
      failed = true;
      console.error(`Validation failed for ${file} against ${contractId}`);
      result.errors.forEach((error) => {
        console.error(`  ${error.instancePath || "/"} :: ${error.message}`);
      });
      continue;
    }

    console.log(`OK ${file} -> ${contractId}`);
  }

  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
