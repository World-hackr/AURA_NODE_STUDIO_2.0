import { validateContractPayload } from "@aura/contracts";
import { buildDeterministicIntentFromPrompt, generateCircuitFromIntent } from "./circuit_pipeline.mjs";
import { getAiProjectContext, recordAiPatchHistory } from "./db.mjs";
import { listCuratedPackages } from "./library.mjs";
import { planLayoutPatch, validateLayoutIntent } from "./layout_planner.mjs";
import { inferLayoutRole } from "./layout_roles.mjs";

const DEFAULT_OLLAMA_BASE_URL = String(process.env.AURA_OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
const DEFAULT_OLLAMA_MODEL = String(process.env.AURA_OLLAMA_MODEL || "gemma4:e2b");
const DEFAULT_GEMINI_MODEL = String(process.env.AURA_GEMINI_MODEL || "gemini-2.5-flash");
const DEFAULT_PROVIDER = String(process.env.AURA_AI_PROVIDER || "ollama");
const ENV_GEMINI_API_KEY = process.env.AURA_GEMINI_API_KEY || process.env.GEMINI_API_KEY || "";
const GEMINI_REFERENCE_MODELS = [
  "gemini-2.5-flash",
  "gemini-flash-latest",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro",
  "gemini-3-flash-preview",
  "gemini-3-pro-preview",
];

const AI_RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    message: {
      type: "string",
      description: "Short user-facing explanation of the proposed circuit change.",
    },
    patch: {
      type: ["object", "null"],
      description: "A valid aura.circuit_patch.v1 object or null if no safe patch can be produced.",
    },
    layoutIntent: {
      type: ["object", "null"],
      description: "A valid aura.layout_intent.v1 object or null when no deterministic placement plan is needed.",
    },
  },
  required: ["message", "patch"],
};

const CIRCUIT_INTENT_RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    schema: { type: "string" },
    metadata: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        userPrompt: { type: "string" },
        preferredView: { type: "string" },
        createdBy: { type: "string" },
      },
      required: ["title", "userPrompt"],
    },
    requirements: {
      type: "object",
      properties: {
        goal: { type: "string" },
        parts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              role: { type: "string" },
              query: { type: "string" },
              quantity: { type: "integer" },
              valueHint: { type: "string" },
              packageHint: { type: "string" },
              required: { type: "boolean" },
              notes: { type: "string" },
            },
            required: ["role", "query", "quantity"],
          },
        },
        connections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              fromRole: { type: "string" },
              fromPinHint: { type: "string" },
              toRole: { type: "string" },
              toPinHint: { type: "string" },
              netLabel: { type: "string" },
              notes: { type: "string" },
            },
            required: ["fromRole", "toRole"],
          },
        },
        constraints: { type: "object" },
      },
      required: ["parts"],
    },
    reviewHints: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["schema", "metadata", "requirements"],
};

export function getAiProviderDefaults() {
  return {
    ok: true,
    providers: [
      {
        id: "ollama",
        label: "Ollama",
        defaultModel: DEFAULT_OLLAMA_MODEL,
      },
      {
        id: "gemini",
        label: "Gemini API",
        defaultModel: DEFAULT_GEMINI_MODEL,
      },
    ],
    defaults: {
      provider: DEFAULT_PROVIDER,
      ollamaBaseUrl: DEFAULT_OLLAMA_BASE_URL,
      ollamaModel: DEFAULT_OLLAMA_MODEL,
      geminiModel: DEFAULT_GEMINI_MODEL,
      geminiKeyConfigured: Boolean(ENV_GEMINI_API_KEY),
    },
  };
}

function buildGeminiReferenceModelEntries() {
  return GEMINI_REFERENCE_MODELS.map((modelId) => ({
    id: modelId,
    label: `${modelId} - Reference`,
    source: "reference",
  }));
}

function mergeGeminiModelEntries(liveModels = []) {
  const merged = [];
  const seen = new Set();

  for (const model of liveModels) {
    const id = String(model?.id || "").trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    merged.push({
      id,
      label: String(model?.label || id).trim() || id,
      source: "live",
    });
  }

  for (const model of buildGeminiReferenceModelEntries()) {
    if (seen.has(model.id)) {
      continue;
    }
    seen.add(model.id);
    merged.push(model);
  }

  return merged;
}

export async function listAiProviderModels({ provider, apiKey }) {
  const normalizedProvider = String(provider || DEFAULT_PROVIDER).trim().toLowerCase();

  if (normalizedProvider === "gemini") {
    const effectiveApiKey = String(apiKey || ENV_GEMINI_API_KEY || "").trim();
    if (!effectiveApiKey) {
      return {
        ok: true,
        provider: "gemini",
        models: buildGeminiReferenceModelEntries(),
        requiresApiKey: true,
      };
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(effectiveApiKey)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw createAiError(
        data?.error?.message || data?.message || "Failed to list Gemini models.",
        502,
        data,
      );
    }

    const liveModels = (data?.models ?? [])
      .filter((model) => Array.isArray(model.supportedGenerationMethods) && model.supportedGenerationMethods.includes("generateContent"))
      .map((model) => ({
        id: String(model.name || "").replace(/^models\//, "").trim(),
        label: [
          String(model.displayName || "").trim(),
          String(model.name || "").replace(/^models\//, "").trim(),
        ].filter(Boolean).join(" - "),
        source: "live",
      }))
      .filter((model) => model.id)
      .sort((left, right) => left.label.localeCompare(right.label));

    const models = mergeGeminiModelEntries(liveModels);

    return {
      ok: true,
      provider: "gemini",
      models: models.length ? models : buildGeminiReferenceModelEntries(),
      requiresApiKey: true,
    };
  }

  const response = await fetch(`${DEFAULT_OLLAMA_BASE_URL}/api/tags`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw createAiError(
      data?.error || data?.message || "Failed to list Ollama models.",
      502,
      data,
    );
  }

  const models = (data?.models ?? [])
    .map((model) => ({
      id: String(model?.name || "").trim(),
      label: String(model?.name || "").trim(),
    }))
    .filter((model) => model.id)
    .sort((left, right) => left.label.localeCompare(right.label));

  return {
    ok: true,
    provider: "ollama",
    models: models.length ? models : [
      { id: DEFAULT_OLLAMA_MODEL, label: DEFAULT_OLLAMA_MODEL },
    ],
    requiresApiKey: false,
  };
}

export async function getAiProviderStatus({ provider, apiKey, model } = {}) {
  const normalizedProvider = String(provider || DEFAULT_PROVIDER).trim().toLowerCase();
  const selectedModel = String(model || (normalizedProvider === "gemini" ? DEFAULT_GEMINI_MODEL : DEFAULT_OLLAMA_MODEL)).trim();

  if (normalizedProvider === "gemini") {
    const effectiveApiKey = String(apiKey || ENV_GEMINI_API_KEY || "").trim();
    if (!effectiveApiKey) {
      return {
        ok: true,
        provider: "gemini",
        ready: false,
        model: selectedModel,
        message: "Gemini API key is not configured.",
      };
    }

    const models = await listAiProviderModels({ provider: "gemini", apiKey: effectiveApiKey });
    const foundModel = models.models.some((entry) => entry.id === selectedModel);
    return {
      ok: true,
      provider: "gemini",
      ready: foundModel,
      model: selectedModel,
      modelFound: foundModel,
      message: foundModel
        ? `Gemini is reachable and ${selectedModel} is available.`
        : "Gemini is reachable, but the selected model was not listed.",
    };
  }

  const response = await fetch(`${DEFAULT_OLLAMA_BASE_URL}/api/tags`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw createAiError(
      data?.error || data?.message || "Ollama is not reachable.",
      502,
      data,
    );
  }

  const installedModels = (data?.models ?? []).map((entry) => String(entry?.name || "").trim()).filter(Boolean);
  const modelFound = installedModels.includes(selectedModel);
  return {
    ok: true,
    provider: "ollama",
    ready: modelFound,
    model: selectedModel,
    modelFound,
    installedModels,
    message: modelFound
      ? `Ollama is running and ${selectedModel} is installed.`
      : `Ollama is running, but ${selectedModel} is not installed.`,
  };
}

function createAiError(message, statusCode = 400, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function normalizeConversation(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }
  return messages
    .map((message) => ({
      role: String(message?.role || "").trim().toLowerCase(),
      content: String(message?.content || "").trim(),
    }))
    .filter((message) => ["user", "assistant"].includes(message.role) && message.content);
}

function stringifyJson(value) {
  return JSON.stringify(value, null, 2);
}

function buildConversationBlock(conversation) {
  if (!conversation.length) {
    return "No prior conversation.";
  }
  return conversation
    .map((message, index) => `${index + 1}. ${message.role.toUpperCase()}: ${message.content}`)
    .join("\n");
}

function deriveProjectKey(input, sceneState = null) {
  const direct = String(input?.projectKey || "").trim();
  if (direct) {
    return direct;
  }
  const fromScene = String(sceneState?.metadata?.sourceSchematicId || "").trim();
  return fromScene || "studio-canvas";
}

async function getAiProjectContextSafe(projectKey) {
  try {
    return await getAiProjectContext(projectKey);
  } catch (error) {
    console.warn("AI project context unavailable:", error?.message || error);
    return {
      projectKey: String(projectKey || "studio-canvas"),
      memory: null,
      recentHistory: [],
      contextWarning: String(error?.message || "AI project context unavailable."),
    };
  }
}

async function recordAiPatchHistorySafe(entry) {
  try {
    await recordAiPatchHistory(entry);
  } catch (error) {
    console.warn("AI patch history unavailable:", error?.message || error);
  }
}

function buildSelectionSummary(sceneState) {
  if (!sceneState?.selection) {
    return "";
  }
  const componentIds = Array.isArray(sceneState.selection.componentIds) ? sceneState.selection.componentIds.map(String) : [];
  const wireIds = Array.isArray(sceneState.selection.wireIds) ? sceneState.selection.wireIds.map(String) : [];
  const junctionIds = Array.isArray(sceneState.selection.junctionIds) ? sceneState.selection.junctionIds.map(String) : [];
  return [
    `components=${componentIds.join(",") || "none"}`,
    `wires=${wireIds.join(",") || "none"}`,
    `junctions=${junctionIds.join(",") || "none"}`,
    `scope=${sceneState.selection.scope || "both"}`,
  ].join("; ");
}

function buildLayoutSceneSummary(sceneState) {
  const components = Array.isArray(sceneState?.components) ? sceneState.components : [];
  const nets = Array.isArray(sceneState?.netSummary) ? sceneState.netSummary : [];
  const selectedIds = new Set([
    ...(sceneState?.selection?.componentIds ?? []),
  ].map((value) => String(value)));

  const componentSummary = components.map((component) => ({
    id: String(component.id),
    symbolKey: String(component.symbolKey || ""),
    reference: String(component.reference || ""),
    role: inferLayoutRole(component.symbolKey),
    selected: selectedIds.has(String(component.id)),
    x: Number(component.placement?.x || 0),
    y: Number(component.placement?.y || 0),
    rotationDeg: Number(component.placement?.rotationDeg || 0),
  }));

  const labeledNets = nets
    .map((net) => ({
      id: String(net.id || ""),
      label: String(net.label || net.id || ""),
      memberCount: Array.isArray(net.members) ? net.members.length : 0,
    }))
    .filter((net) => net.label);

  return {
    componentCount: componentSummary.length,
    components: componentSummary,
    labeledNets,
    selection: {
      componentIds: [...selectedIds],
      scope: sceneState?.selection?.scope || "both",
    },
  };
}

function buildLayoutIntentGuide() {
  return {
    schema: "aura.layout_intent.v1",
    metadata: {
      title: "Short placement title",
      requestedBy: "assistant",
    },
    target: {
      sceneSchema: "aura.scene_state.v1",
    },
    flow: {
      direction: "left_to_right",
      emphasizeRails: true,
      keepMainTrunkStraight: true,
    },
    anchors: [
      { net: "VIN", zone: "left" },
      { net: "VOUT", zone: "right" },
      { net: "GND", zone: "bottom_support" },
    ],
    placements: [
      {
        componentId: "existing_component_id",
        role: "filter",
        zone: "center_right",
        orientationPreference: "inline",
        after: "another_component_id",
      },
      {
        create: {
          id: "new_component_id",
          symbolKey: "Device:C",
          reference: "C9",
          value: "100n",
        },
        role: "passive_shunt",
        zone: "bottom_support",
        orientationPreference: "shunt_vertical",
        nearNet: "VOUT",
      },
    ],
  };
}

function buildRetrievedContextBlock(projectContext) {
  const stableMemory = projectContext?.memory?.memory ?? {};
  const recentHistory = Array.isArray(projectContext?.recentHistory) ? projectContext.recentHistory.slice(0, 5) : [];

  return {
    projectKey: projectContext?.projectKey || "studio-canvas",
    memorySummary: projectContext?.memory?.summaryText || "",
    stableMemory,
    recentHistory: recentHistory.map((entry) => ({
      requestMode: entry.requestMode,
      status: entry.status,
      userMessage: entry.userMessage,
      assistantMessage: entry.assistantMessage,
      hasPatch: Boolean(entry.patch),
      hasLayoutIntent: Boolean(entry.layoutIntent),
      createdAt: entry.createdAt,
    })),
  };
}

function buildAiPatchSystemPrompt({ sceneState, allowedSymbolKeys, conversation, projectContext }) {
  const layoutSceneSummary = buildLayoutSceneSummary(sceneState);
  const layoutIntentGuide = buildLayoutIntentGuide();
  const retrievedContext = buildRetrievedContextBlock(projectContext);

  return [
    "You are AURA Studio's deterministic circuit editing assistant.",
    "Your task is to propose a safe patch for the current Studio scene.",
    "When placement/orientation matters, use `layoutIntent` so Studio can compute deterministic geometry.",
    "",
    "Non-negotiable rules:",
    "- Return JSON only.",
    "- The response must match the provided schema with keys `message`, `patch`, and optional `layoutIntent`.",
    "- `message` must be short and clear.",
    "- `patch` must be either a valid `aura.circuit_patch.v1` object or null.",
    "- `layoutIntent` must be either a valid `aura.layout_intent.v1` object or null.",
    "- If you cannot make a safe deterministic edit, set `patch` to null and explain why in `message`.",
    "- Preserve existing ids unless adding new objects.",
    "- Use only these allowed symbol keys when adding components:",
    stringifyJson(allowedSymbolKeys),
    "- Target scene schema must be `aura.scene_state.v1`.",
    "- Prefer `metadata.mode = \"preview\"` in returned patches.",
    "- Do not regenerate the whole circuit.",
    "- Do not invent unsupported components or pin ids.",
    "- Do not invent raw coordinates unless you are updating an already-fixed placement by exception.",
    "- For new components where placement matters, prefer `layoutIntent.placements[].create` instead of guessed patch coordinates.",
    "- Use layout roles like `connector`, `switch`, `filter`, `passive_inline`, `passive_shunt`, `feedback`, `indicator`, `support`, or `generic`.",
    "- Prefer moving existing components through `layoutIntent` instead of direct patch placements when the goal is cleaner layout.",
    "- Use zone words only from: `left`, `center_left`, `center`, `center_right`, `right`, `top_support`, `bottom_support`.",
    "- Use orientationPreference only from: `preserve`, `inline`, `shunt_vertical`, `face_inward`, `face_outward`, `upright`.",
    "",
    "Conversation so far:",
    buildConversationBlock(conversation),
    "",
    "Retrieved project context:",
    stringifyJson(retrievedContext),
    "",
    "Placement-planning summary for the current scene:",
    stringifyJson(layoutSceneSummary),
    "",
    "Preferred `layoutIntent` shape when layout changes matter:",
    stringifyJson(layoutIntentGuide),
    "",
    "Current scene state JSON:",
    stringifyJson(sceneState),
    "",
    "Return only the final JSON object.",
  ].join("\n");
}

function buildAiChatSystemPrompt() {
  return [
    "You are AURA Studio's built-in assistant.",
    "Behave like a normal concise technical chat assistant.",
    "Do not force JSON.",
    "Answer the user's request directly.",
    "If the user asks about the current circuit but no structured scene is provided, say that clearly instead of inventing details.",
  ].join("\n");
}

function buildAiChatSystemPromptWithContext(projectContext) {
  const retrievedContext = buildRetrievedContextBlock(projectContext);
  return [
    buildAiChatSystemPrompt(),
    "",
    "Retrieved project context:",
    stringifyJson(retrievedContext),
  ].join("\n");
}

function buildCircuitIntentSystemPrompt({ userPrompt, curatedPackages }) {
  return [
    "You are the AURA Circuit Intent Generator.",
    "Turn the user's plain-language request into valid `aura.circuit_intent.v1` JSON.",
    "",
    "Rules:",
    "- Return JSON only.",
    "- Do not generate final canvas state, coordinates, wires, or package ids.",
    "- Use human-readable roles like `controller`, `indicator`, `current_limit`, `input`, `output`, or `power`.",
    "- Keep ambiguity visible in `reviewHints`.",
    "- Prefer beginner-friendly simple circuits.",
    "- Only mention parts that can plausibly resolve against the curated package list.",
    "",
    "Curated packages available to the deterministic resolver:",
    stringifyJson(curatedPackages.map((entry) => ({
      name: entry.name,
      category: entry.category,
      aliases: entry.aliases ?? [],
      runtimeProfileId: entry.runtimeProfileId ?? null,
    }))),
    "",
    "User prompt:",
    String(userPrompt || "").trim(),
    "",
    "Return only the `aura.circuit_intent.v1` JSON object.",
  ].join("\n");
}

function tryParseJson(text) {
  if (typeof text !== "string" || !text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function repairReturnedPatch(patch, sceneState) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return patch;
  }
  return {
    schema: "aura.circuit_patch.v1",
    metadata: {
      title: typeof patch.metadata?.title === "string" && patch.metadata.title.trim()
        ? patch.metadata.title.trim()
        : "AI patch",
      description: typeof patch.metadata?.description === "string" ? patch.metadata.description : "",
      mode: patch.metadata?.mode === "apply" ? "apply" : "preview",
      requestedBy: ["user", "assistant", "external_ai"].includes(patch.metadata?.requestedBy)
        ? patch.metadata.requestedBy
        : "assistant",
    },
    target: {
      sceneSchema: "aura.scene_state.v1",
      sourceSchematicId: typeof patch.target?.sourceSchematicId === "string"
        ? patch.target.sourceSchematicId
        : (sceneState?.metadata?.sourceSchematicId || "studio-canvas"),
      sourceRevision: Number.isInteger(patch.target?.sourceRevision)
        ? patch.target.sourceRevision
        : (Number.isInteger(sceneState?.metadata?.sourceRevision) ? sceneState.metadata.sourceRevision : 0),
    },
    operations: Array.isArray(patch.operations) ? patch.operations : [],
  };
}

function repairReturnedLayoutIntent(layoutIntent, sceneState) {
  if (!layoutIntent || typeof layoutIntent !== "object" || Array.isArray(layoutIntent)) {
    return layoutIntent;
  }

  return {
    schema: "aura.layout_intent.v1",
    metadata: {
      title: typeof layoutIntent.metadata?.title === "string" && layoutIntent.metadata.title.trim()
        ? layoutIntent.metadata.title.trim()
        : "AI layout intent",
      description: typeof layoutIntent.metadata?.description === "string" ? layoutIntent.metadata.description : "",
      requestedBy: ["user", "assistant", "external_ai"].includes(layoutIntent.metadata?.requestedBy)
        ? layoutIntent.metadata.requestedBy
        : "assistant",
    },
    target: {
      sceneSchema: "aura.scene_state.v1",
      sourceSchematicId: typeof layoutIntent.target?.sourceSchematicId === "string"
        ? layoutIntent.target.sourceSchematicId
        : (sceneState?.metadata?.sourceSchematicId || "studio-canvas"),
      sourceRevision: Number.isInteger(layoutIntent.target?.sourceRevision)
        ? layoutIntent.target.sourceRevision
        : (Number.isInteger(sceneState?.metadata?.sourceRevision) ? sceneState.metadata.sourceRevision : 0),
    },
    flow: {
      direction: ["left_to_right", "right_to_left", "top_to_bottom", "bottom_to_top"].includes(layoutIntent.flow?.direction)
        ? layoutIntent.flow.direction
        : "left_to_right",
      emphasizeRails: Boolean(layoutIntent.flow?.emphasizeRails),
      keepMainTrunkStraight: layoutIntent.flow?.keepMainTrunkStraight !== false,
    },
    anchors: Array.isArray(layoutIntent.anchors) ? layoutIntent.anchors : [],
    clusters: Array.isArray(layoutIntent.clusters) ? layoutIntent.clusters : [],
    placements: Array.isArray(layoutIntent.placements) ? layoutIntent.placements : [],
  };
}

async function validateSceneState(sceneState) {
  const validation = await validateContractPayload("scene_state.v1", sceneState);
  if (!validation.ok) {
    throw createAiError("scene_state payload is invalid.", 400, validation);
  }
}

async function validatePatch(patch) {
  const validation = await validateContractPayload("circuit_patch.v1", patch);
  if (!validation.ok) {
    throw createAiError("AI returned an invalid circuit patch.", 502, validation);
  }
}

async function normalizePatchFromEnvelope({ rawPatch, rawLayoutIntent, sceneState }) {
  const layoutIntent = rawLayoutIntent == null ? null : repairReturnedLayoutIntent(rawLayoutIntent, sceneState);
  if (layoutIntent != null) {
    try {
      await validateLayoutIntent(layoutIntent);
    } catch (error) {
      throw createAiError("AI returned an invalid layout intent.", 502, error?.validation || error);
    }
  }

  let patch = rawPatch == null ? null : repairReturnedPatch(rawPatch, sceneState);
  if (layoutIntent != null) {
    try {
      patch = await planLayoutPatch({
        sceneState,
        layoutIntent,
        patch,
      });
    } catch (error) {
      throw createAiError("Failed to convert layout intent into a circuit patch.", 502, error?.validation || error);
    }
  }

  return {
    patch,
    layoutIntent,
  };
}

async function callOllamaProvider({ model, systemPrompt, conversation, responseJsonSchema = AI_RESPONSE_JSON_SCHEMA }) {
  const response = await fetch(`${DEFAULT_OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: model || DEFAULT_OLLAMA_MODEL,
      stream: false,
      format: responseJsonSchema,
      options: {
        temperature: 0.2,
      },
      messages: [
        { role: "system", content: systemPrompt },
        ...conversation.map((message) => ({
          role: message.role === "assistant" ? "assistant" : "user",
          content: message.content,
        })),
      ],
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw createAiError(
      data?.error || data?.message || "Ollama request failed.",
      502,
      data,
    );
  }

  return {
    rawText: data?.message?.content || "",
    providerMetadata: {
      totalDurationNs: data?.total_duration ?? null,
      evalCount: data?.eval_count ?? null,
    },
  };
}

async function callOllamaChatProvider({ model, systemPrompt, conversation }) {
  const response = await fetch(`${DEFAULT_OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: model || DEFAULT_OLLAMA_MODEL,
      stream: false,
      options: {
        temperature: 0.2,
      },
      messages: [
        { role: "system", content: systemPrompt },
        ...conversation.map((message) => ({
          role: message.role === "assistant" ? "assistant" : "user",
          content: message.content,
        })),
      ],
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw createAiError(
      data?.error || data?.message || "Ollama chat request failed.",
      502,
      data,
    );
  }

  return {
    rawText: String(data?.message?.content || "").trim(),
    providerMetadata: {
      totalDurationNs: data?.total_duration ?? null,
      evalCount: data?.eval_count ?? null,
    },
  };
}

async function callGeminiProvider({ model, apiKey, systemPrompt, conversation, responseJsonSchema = AI_RESPONSE_JSON_SCHEMA }) {
  const effectiveApiKey = String(apiKey || ENV_GEMINI_API_KEY || "").trim();
  if (!effectiveApiKey) {
    throw createAiError("Gemini API key is required for the Gemini provider.", 400);
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || DEFAULT_GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(effectiveApiKey)}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: conversation.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      })),
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseJsonSchema,
      },
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw createAiError(
      data?.error?.message || data?.message || "Gemini request failed.",
      502,
      data,
    );
  }

  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const rawText = parts
    .map((part) => part?.text || "")
    .join("")
    .trim();

  return {
    rawText,
    providerMetadata: {
      finishReason: data?.candidates?.[0]?.finishReason ?? null,
    },
  };
}

async function callGeminiChatProvider({ model, apiKey, systemPrompt, conversation }) {
  const effectiveApiKey = String(apiKey || ENV_GEMINI_API_KEY || "").trim();
  if (!effectiveApiKey) {
    throw createAiError("Gemini API key is required for the Gemini provider.", 400);
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || DEFAULT_GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(effectiveApiKey)}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: conversation.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      })),
      generationConfig: {
        temperature: 0.2,
      },
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw createAiError(
      data?.error?.message || data?.message || "Gemini chat request failed.",
      502,
      data,
    );
  }

  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const rawText = parts
    .map((part) => part?.text || "")
    .join("")
    .trim();

  return {
    rawText,
    providerMetadata: {
      finishReason: data?.candidates?.[0]?.finishReason ?? null,
    },
  };
}

export async function generateAiPatchReply(input) {
  const provider = String(input?.provider || DEFAULT_PROVIDER).trim().toLowerCase();
  const model = String(input?.model || "").trim();
  const allowedSymbolKeys = Array.isArray(input?.allowedSymbolKeys)
    ? input.allowedSymbolKeys.map((value) => String(value)).filter(Boolean)
    : [];
  const sceneState = input?.sceneState;
  const conversation = normalizeConversation(input?.conversation);
  const projectKey = deriveProjectKey(input, sceneState);

  if (!conversation.length || conversation[conversation.length - 1]?.role !== "user") {
    throw createAiError("A user message is required.", 400);
  }

  await validateSceneState(sceneState);
  const projectContext = await getAiProjectContextSafe(projectKey);

  const systemPrompt = buildAiPatchSystemPrompt({
    sceneState,
    allowedSymbolKeys,
    conversation,
    projectContext,
  });

  const providerResponse = provider === "gemini"
    ? await callGeminiProvider({
      model,
      apiKey: input?.apiKey,
      systemPrompt,
      conversation,
    })
    : await callOllamaProvider({
      model,
      systemPrompt,
      conversation,
    });

  const envelope = tryParseJson(providerResponse.rawText);
  if (!envelope || typeof envelope !== "object") {
    throw createAiError("AI response was not valid JSON.", 502, {
      rawText: providerResponse.rawText,
    });
  }

  const normalizedReply = await normalizePatchFromEnvelope({
    rawPatch: envelope.patch,
    rawLayoutIntent: envelope.layoutIntent,
    sceneState,
  });
  const patch = normalizedReply.patch;
  const message = typeof envelope.message === "string" && envelope.message.trim()
    ? envelope.message.trim()
    : (patch ? "AI returned a patch." : "AI did not return a patch.");

  if (patch != null) {
    await validatePatch(patch);
  }

  await recordAiPatchHistorySafe({
    projectKey,
    requestMode: "patch",
    provider,
    modelName: model || (provider === "gemini" ? DEFAULT_GEMINI_MODEL : DEFAULT_OLLAMA_MODEL),
    userMessage: conversation[conversation.length - 1]?.content || "",
    sceneSchema: sceneState?.schema || null,
    sceneRevision: Number.isInteger(sceneState?.metadata?.sourceRevision) ? sceneState.metadata.sourceRevision : null,
    selectionSummary: buildSelectionSummary(sceneState),
    layoutIntent: normalizedReply.layoutIntent,
    patch,
    status: patch ? "patch_generated" : "no_patch",
    assistantMessage: message,
  });

  return {
    ok: true,
    provider,
    model: model || (provider === "gemini" ? DEFAULT_GEMINI_MODEL : DEFAULT_OLLAMA_MODEL),
    assistantMessage: message,
    patch,
    layoutIntent: normalizedReply.layoutIntent,
    rawText: providerResponse.rawText,
    providerMetadata: providerResponse.providerMetadata,
  };
}

export async function generateAiChatReply(input) {
  const provider = String(input?.provider || DEFAULT_PROVIDER).trim().toLowerCase();
  const model = String(input?.model || "").trim();
  const conversation = normalizeConversation(input?.conversation);
  const projectKey = deriveProjectKey(input, input?.sceneState || null);

  if (!conversation.length || conversation[conversation.length - 1]?.role !== "user") {
    throw createAiError("A user message is required.", 400);
  }

  const projectContext = await getAiProjectContextSafe(projectKey);
  const systemPrompt = buildAiChatSystemPromptWithContext(projectContext);
  const providerResponse = provider === "gemini"
    ? await callGeminiChatProvider({
      model,
      apiKey: input?.apiKey,
      systemPrompt,
      conversation,
    })
    : await callOllamaChatProvider({
      model,
      systemPrompt,
      conversation,
    });

  const assistantMessage = String(providerResponse.rawText || "").trim() || "AI returned an empty response.";

  await recordAiPatchHistorySafe({
    projectKey,
    requestMode: "chat",
    provider,
    modelName: model || (provider === "gemini" ? DEFAULT_GEMINI_MODEL : DEFAULT_OLLAMA_MODEL),
    userMessage: conversation[conversation.length - 1]?.content || "",
    sceneSchema: input?.sceneState?.schema || null,
    sceneRevision: Number.isInteger(input?.sceneState?.metadata?.sourceRevision) ? input.sceneState.metadata.sourceRevision : null,
    selectionSummary: buildSelectionSummary(input?.sceneState || null),
    layoutIntent: null,
    patch: null,
    status: "chat_reply",
    assistantMessage,
  });

  return {
    ok: true,
    provider,
    model: model || (provider === "gemini" ? DEFAULT_GEMINI_MODEL : DEFAULT_OLLAMA_MODEL),
    assistantMessage,
    rawText: providerResponse.rawText,
    providerMetadata: providerResponse.providerMetadata,
  };
}

export async function generateAiCircuitReply(input) {
  const userPrompt = String(input?.prompt || input?.userPrompt || "").trim();
  if (!userPrompt) {
    throw createAiError("A non-empty prompt is required.", 400);
  }

  const provider = String(input?.provider || DEFAULT_PROVIDER).trim().toLowerCase();
  const model = String(input?.model || "").trim();
  const useAi = input?.useAi !== false && provider !== "deterministic";
  let intent = null;
  let providerResponse = null;
  let intentSource = "deterministic";
  let aiWarning = "";

  if (useAi) {
    const curatedPackages = await listCuratedPackages();
    const systemPrompt = buildCircuitIntentSystemPrompt({
      userPrompt,
      curatedPackages,
    });
    const conversation = [{ role: "user", content: userPrompt }];

    try {
      providerResponse = provider === "gemini"
        ? await callGeminiProvider({
          model,
          apiKey: input?.apiKey,
          systemPrompt,
          conversation,
          responseJsonSchema: CIRCUIT_INTENT_RESPONSE_JSON_SCHEMA,
        })
        : await callOllamaProvider({
          model,
          systemPrompt,
          conversation,
          responseJsonSchema: CIRCUIT_INTENT_RESPONSE_JSON_SCHEMA,
        });

      const parsed = tryParseJson(providerResponse.rawText);
      if (!parsed || typeof parsed !== "object") {
        throw createAiError("AI response was not valid circuit_intent JSON.", 502, {
          rawText: providerResponse.rawText,
        });
      }
      intent = parsed;
      intentSource = "ai";
    } catch (error) {
      if (input?.allowDeterministicFallback === false) {
        throw error;
      }
      aiWarning = error instanceof Error ? error.message : "AI intent generation failed.";
    }
  }

  if (!intent) {
    intent = buildDeterministicIntentFromPrompt(userPrompt);
  }

  if (intent?.metadata && !intent.metadata.userPrompt) {
    intent.metadata.userPrompt = userPrompt;
  }
  if (intent?.metadata && !intent.metadata.createdBy) {
    intent.metadata.createdBy = intentSource === "ai" ? "aura_ai" : "aura_deterministic_fallback";
  }

  const intentValidation = await validateContractPayload("circuit_intent.v1", intent);
  if (!intentValidation.ok) {
    if (input?.allowDeterministicFallback === false || intentSource !== "ai") {
      throw createAiError("Generated circuit_intent payload is invalid.", 502, intentValidation);
    }
    aiWarning = "AI returned invalid circuit_intent JSON; used deterministic fallback.";
    intent = buildDeterministicIntentFromPrompt(userPrompt);
  }

  const generated = await generateCircuitFromIntent(intent);
  const irValidation = await validateContractPayload("circuit_ir.v1", generated.circuitIr);

  return {
    ok: true,
    provider: useAi ? provider : "deterministic",
    model: useAi ? (model || (provider === "gemini" ? DEFAULT_GEMINI_MODEL : DEFAULT_OLLAMA_MODEL)) : "",
    intentSource,
    ...(aiWarning ? { warning: aiWarning } : {}),
    intent: generated.intent,
    resolution: generated.resolution,
    circuitIr: generated.circuitIr,
    validations: {
      circuitIntent: await validateContractPayload("circuit_intent.v1", generated.intent),
      circuitIr: irValidation,
    },
    ...(providerResponse ? {
      rawText: providerResponse.rawText,
      providerMetadata: providerResponse.providerMetadata,
    } : {}),
  };
}
