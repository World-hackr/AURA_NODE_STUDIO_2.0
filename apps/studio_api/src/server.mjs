import Fastify from "fastify";
import cors from "@fastify/cors";
import { generateAiPatchReply, getAiProviderDefaults, getAiProviderStatus, listAiProviderModels } from "./ai.mjs";

import {
  listContracts,
  validateContractPayload,
} from "@aura/contracts";
import {
  getDatabaseStatus,
  getCircuitProjectBySlug,
  getSchematicProjectBySlug,
  listCircuitProjects,
  listSchematicProjects,
  migrateDatabase,
  saveCircuitProject,
  saveSchematicProject,
} from "./db.mjs";
import { getFritzingPartByModuleId } from "./fritzing.mjs";
import {
  getKiCadStatus,
  listKiCadLibraries,
  getKiCadSymbolDefinition,
  listKiCadSymbolsInLibrary,
  searchKiCadSymbols,
} from "./kicad_symbols.mjs";
import { listCuratedPackages } from "./library.mjs";

const app = Fastify({
  logger: false,
});

await app.register(cors, {
  origin: true,
});

app.get("/health", async () => ({
  ok: true,
  service: "aura-studio-api",
}));

app.get("/contracts", async () => ({
  ok: true,
  contracts: await listContracts(),
}));

app.get("/ai/providers", async () => getAiProviderDefaults());

app.get("/ai/models", async (request, reply) => {
  try {
    return await listAiProviderModels({
      provider: request.query?.provider,
      apiKey: request.query?.apiKey,
    });
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    return reply.code(statusCode).send({
      ok: false,
      message: error instanceof Error ? error.message : "AI model listing failed.",
      ...(error?.details ? { details: error.details } : {}),
    });
  }
});

app.get("/ai/status", async (request, reply) => {
  try {
    return await getAiProviderStatus({
      provider: request.query?.provider,
      apiKey: request.query?.apiKey,
      model: request.query?.model,
    });
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    return reply.code(statusCode).send({
      ok: false,
      ready: false,
      message: error instanceof Error ? error.message : "AI provider status check failed.",
      ...(error?.details ? { details: error.details } : {}),
    });
  }
});

app.post("/ai/generate-patch", async (request, reply) => {
  try {
    return await generateAiPatchReply(request.body ?? {});
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    return reply.code(statusCode).send({
      ok: false,
      message: error instanceof Error ? error.message : "AI request failed.",
      ...(error?.details ? { details: error.details } : {}),
    });
  }
});

app.post("/validate/:contractId", async (request, reply) => {
  const { contractId } = request.params;
  try {
    const result = await validateContractPayload(contractId, request.body);
    if (!result.ok) {
      return reply.code(400).send(result);
    }
    return result;
  } catch (error) {
    return reply.code(404).send({
      ok: false,
      contractId,
      errors: [
        {
          instancePath: "",
          schemaPath: "",
          message: error instanceof Error ? error.message : "Unknown contract error",
        },
      ],
    });
  }
});

app.get("/database/status", async () => ({
  ok: true,
  database: await getDatabaseStatus(),
}));

app.post("/database/migrate", async () => ({
  ok: true,
  database: await migrateDatabase(),
}));

app.get("/library/packages", async () => ({
  ok: true,
  packages: await listCuratedPackages(),
}));

app.get("/symbol-sources/kicad/status", async () => ({
  ok: true,
  source: await getKiCadStatus(),
}));

app.get("/symbol-sources/kicad/libraries", async () => ({
  ok: true,
  libraries: await listKiCadLibraries(),
}));

app.get("/symbol-sources/kicad/libraries/:libraryId", async (request, reply) => {
  const result = await listKiCadSymbolsInLibrary(request.params.libraryId);
  if (!result) {
    return reply.code(404).send({
      ok: false,
      message: "KiCad symbol library not found.",
    });
  }

  return {
    ok: true,
    ...result,
  };
});

app.get("/symbol-sources/kicad/search", async (request) => {
  const rawLibraries = String(request.query?.libraries || "").trim();
  const libraries = rawLibraries
    ? rawLibraries.split(",").map((value) => value.trim()).filter(Boolean)
    : [];
  return {
    ok: true,
    query: String(request.query?.q || ""),
    symbols: await searchKiCadSymbols(request.query?.q, {
      libraries,
      limit: request.query?.limit,
    }),
  };
});

app.get("/symbol-sources/kicad/libraries/:libraryId/symbols/:symbolId/definition", async (request, reply) => {
  const result = await getKiCadSymbolDefinition(request.params.libraryId, request.params.symbolId);
  if (!result) {
    return reply.code(404).send({
      ok: false,
      message: "KiCad symbol definition not found.",
    });
  }

  return {
    ok: true,
    ...result,
  };
});

app.get("/sources/fritzing/:moduleId", async (request, reply) => {
  const part = await getFritzingPartByModuleId(request.params.moduleId);
  if (!part) {
    return reply.code(404).send({
      ok: false,
      message: "Fritzing part not found.",
    });
  }

  return {
    ok: true,
    part,
  };
});

app.get("/projects", async () => ({
  ok: true,
  projects: await listCircuitProjects(),
}));

app.get("/projects/:slug", async (request, reply) => {
  const project = await getCircuitProjectBySlug(request.params.slug);
  if (!project) {
    return reply.code(404).send({
      ok: false,
      message: "Project not found.",
    });
  }

  return {
    ok: true,
    project,
  };
});

app.post("/projects", async (request, reply) => {
  const body = request.body ?? {};
  const { name, circuitIntent = null, circuitIr, description = null, slug = "", sourceKind = "manual" } = body;

  if (typeof name !== "string" || !name.trim()) {
    return reply.code(400).send({
      ok: false,
      message: "A non-empty project name is required.",
    });
  }

  const irValidation = await validateContractPayload("circuit_ir.v1", circuitIr);
  if (!irValidation.ok) {
    return reply.code(400).send({
      ok: false,
      message: "circuit_ir payload is invalid.",
      validation: irValidation,
    });
  }

  if (circuitIntent != null) {
    const intentValidation = await validateContractPayload("circuit_intent.v1", circuitIntent);
    if (!intentValidation.ok) {
      return reply.code(400).send({
        ok: false,
        message: "circuit_intent payload is invalid.",
        validation: intentValidation,
      });
    }
  }

  const saved = await saveCircuitProject({
    slug,
    name: name.trim(),
    description: typeof description === "string" ? description : null,
    circuitIntent,
    circuitIr,
    sourceKind: typeof sourceKind === "string" && sourceKind.trim() ? sourceKind.trim() : "manual",
  });

  return {
    ok: true,
    ...saved,
  };
});

app.get("/schematics", async () => ({
  ok: true,
  projects: await listSchematicProjects(),
}));

app.get("/schematics/:slug", async (request, reply) => {
  const project = await getSchematicProjectBySlug(request.params.slug);
  if (!project) {
    return reply.code(404).send({
      ok: false,
      message: "Schematic project not found.",
    });
  }

  return {
    ok: true,
    project,
  };
});

app.post("/schematics", async (request, reply) => {
  const body = request.body ?? {};
  const { name, description = null, schematic, slug = "", sourceKind = "manual" } = body;

  if (typeof name !== "string" || !name.trim()) {
    return reply.code(400).send({
      ok: false,
      message: "A non-empty schematic project name is required.",
    });
  }

  const schematicValidation = await validateContractPayload("schematic_document.v1", schematic);
  if (!schematicValidation.ok) {
    return reply.code(400).send({
      ok: false,
      message: "schematic_document payload is invalid.",
      validation: schematicValidation,
    });
  }

  const saved = await saveSchematicProject({
    slug,
    name: name.trim(),
    description: typeof description === "string" ? description : null,
    schematic,
    sourceKind: typeof sourceKind === "string" && sourceKind.trim() ? sourceKind.trim() : "manual",
  });

  return {
    ok: true,
    ...saved,
  };
});

const port = Number(process.env.PORT || 8787);

app.listen({ port, host: "0.0.0.0" }).then(() => {
  console.log(`AURA Studio API listening on http://localhost:${port}`);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
