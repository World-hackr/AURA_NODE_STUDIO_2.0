import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  findKiCadSymbolDir,
  getKiCadStatus,
  listKiCadLibraries,
  listKiCadSymbolsInLibrary,
} from "../apps/studio_api/src/kicad_symbols.mjs";

const outputDir = resolve(process.cwd(), "library", "starter_sources", "kicad");
const outputPath = resolve(outputDir, "library_index.json");

async function main() {
  const sourceDir = await findKiCadSymbolDir();
  const status = await getKiCadStatus();

  if (!sourceDir || !status.installed) {
    throw new Error("KiCad symbol directory was not found on this machine.");
  }

  const libraries = await listKiCadLibraries();
  const librarySummaries = [];

  for (const library of libraries) {
    const result = await listKiCadSymbolsInLibrary(library.id);
    librarySummaries.push({
      id: library.id,
      name: library.name,
      symbolCount: result.symbols.length,
    });
  }

  const payload = {
    schema: "aura.kicad_library_index.v1",
    generatedAt: new Date().toISOString(),
    sourceKind: "kicad",
    sourceDir,
    libraryCount: librarySummaries.length,
    libraries: librarySummaries,
  };

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(`Wrote KiCad library index to ${outputPath}`);
  console.log(`Source dir: ${sourceDir}`);
  console.log(`Libraries indexed: ${librarySummaries.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
