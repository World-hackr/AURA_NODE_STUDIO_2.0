import { validateContractPayload } from "@aura/contracts";

const DEFAULT_OLLAMA_BASE_URL = String(process.env.AURA_OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
const DEFAULT_OLLAMA_MODEL = String(process.env.AURA_OLLAMA_MODEL || "gemma4:e2b");
const DEFAULT_GEMINI_MODEL = String(process.env.AURA_GEMINI_MODEL || "gemini-2.5-flash");
const DEFAULT_PROVIDER = String(process.env.AURA_AI_PROVIDER || "ollama");
const ENV_GEMINI_API_KEY = process.env.AURA_GEMINI_API_KEY || process.env.GEMINI_API_KEY || "";

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
  },
  required: ["message", "patch"],
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

export async function listAiProviderModels({ provider, apiKey }) {
  const normalizedProvider = String(provider || DEFAULT_PROVIDER).trim().toLowerCase();

  if (normalizedProvider === "gemini") {
    const effectiveApiKey = String(apiKey || ENV_GEMINI_API_KEY || "").trim();
    if (!effectiveApiKey) {
      return {
        ok: true,
        provider: "gemini",
        models: [
          { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
          { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
          { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
        ],
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

    const models = (data?.models ?? [])
      .filter((model) => Array.isArray(model.supportedGenerationMethods) && model.supportedGenerationMethods.includes("generateContent"))
      .map((model) => ({
        id: String(model.baseModelId || "").trim(),
        label: String(model.displayName || model.baseModelId || "").trim(),
      }))
      .filter((model) => model.id)
      .filter((model, index, entries) => entries.findIndex((entry) => entry.id === model.id) === index)
      .sort((left, right) => left.label.localeCompare(right.label));

    return {
      ok: true,
      provider: "gemini",
      models: models.length ? models : [
        { id: DEFAULT_GEMINI_MODEL, label: "Gemini 2.5 Flash" },
      ],
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
      ready: true,
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

function buildAiPatchSystemPrompt({ sceneState, allowedSymbolKeys, conversation }) {
  return [
    "You are AURA Studio's deterministic circuit editing assistant.",
    "Your task is to propose a safe patch for the current Studio scene.",
    "",
    "Non-negotiable rules:",
    "- Return JSON only.",
    "- The response must match the provided schema with keys `message` and `patch`.",
    "- `message` must be short and clear.",
    "- `patch` must be either a valid `aura.circuit_patch.v1` object or null.",
    "- If you cannot make a safe deterministic edit, set `patch` to null and explain why in `message`.",
    "- Preserve existing ids unless adding new objects.",
    "- Use only these allowed symbol keys when adding components:",
    stringifyJson(allowedSymbolKeys),
    "- Target scene schema must be `aura.scene_state.v1`.",
    "- Prefer `metadata.mode = \"preview\"` in returned patches.",
    "- Do not regenerate the whole circuit.",
    "- Do not invent unsupported components or pin ids.",
    "",
    "Conversation so far:",
    buildConversationBlock(conversation),
    "",
    "Current scene state JSON:",
    stringifyJson(sceneState),
    "",
    "Return only the final JSON object.",
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

async function callOllamaProvider({ model, systemPrompt, conversation }) {
  const response = await fetch(`${DEFAULT_OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: model || DEFAULT_OLLAMA_MODEL,
      stream: false,
      format: AI_RESPONSE_JSON_SCHEMA,
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

async function callGeminiProvider({ model, apiKey, systemPrompt, conversation }) {
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
        responseJsonSchema: AI_RESPONSE_JSON_SCHEMA,
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

export async function generateAiPatchReply(input) {
  const provider = String(input?.provider || DEFAULT_PROVIDER).trim().toLowerCase();
  const model = String(input?.model || "").trim();
  const allowedSymbolKeys = Array.isArray(input?.allowedSymbolKeys)
    ? input.allowedSymbolKeys.map((value) => String(value)).filter(Boolean)
    : [];
  const sceneState = input?.sceneState;
  const conversation = normalizeConversation(input?.conversation);

  if (!conversation.length || conversation[conversation.length - 1]?.role !== "user") {
    throw createAiError("A user message is required.", 400);
  }

  await validateSceneState(sceneState);

  const systemPrompt = buildAiPatchSystemPrompt({
    sceneState,
    allowedSymbolKeys,
    conversation,
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

  const patch = envelope.patch == null ? null : repairReturnedPatch(envelope.patch, sceneState);
  const message = typeof envelope.message === "string" && envelope.message.trim()
    ? envelope.message.trim()
    : (patch ? "AI returned a patch." : "AI did not return a patch.");

  if (patch != null) {
    await validatePatch(patch);
  }

  return {
    ok: true,
    provider,
    model: model || (provider === "gemini" ? DEFAULT_GEMINI_MODEL : DEFAULT_OLLAMA_MODEL),
    assistantMessage: message,
    patch,
    rawText: providerResponse.rawText,
    providerMetadata: providerResponse.providerMetadata,
  };
}
