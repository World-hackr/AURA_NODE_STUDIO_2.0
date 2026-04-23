import { access, readdir, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = fileURLToPath(new URL(".", import.meta.url));
const WORKSPACE_KICAD_RAW_DIR = resolve(moduleDir, "..", "..", "..", "library", "starter_sources", "kicad", "raw");
const WINDOWS_KICAD_SYMBOL_DIRS = [
  resolve(process.cwd(), "../../library/starter_sources/kicad/raw"),
  WORKSPACE_KICAD_RAW_DIR,
  "C:\\Program Files\\KiCad\\9.0\\share\\kicad\\symbols",
];


const MIL_PER_MM = 39.3700787402;
const libraryCache = new Map();

async function pathExists(path) {
  try {
    await access(path, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function hasFlatKiCadSymbolFiles(path) {
  if (!await pathExists(path)) {
    return false;
  }

  const entries = await readdir(path);
  return entries.some((entry) => entry.endsWith(".kicad_sym"));
}

function mmToMil(value) {
  return Number((Number(value) * MIL_PER_MM).toFixed(2));
}

function scanSExpressionBlocks(raw, shouldCapture) {
  const blocks = [];
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let captureStart = -1;
  let captureDepth = -1;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];

    if (inString) {
      if (escapeNext) {
        escapeNext = false;
      } else if (char === "\\") {
        escapeNext = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "(") {
      const nextDepth = depth + 1;
      if (captureStart < 0 && shouldCapture(raw, index, nextDepth)) {
        captureStart = index;
        captureDepth = nextDepth;
      }
      depth = nextDepth;
      continue;
    }

    if (char === ")") {
      if (captureStart >= 0 && depth === captureDepth) {
        blocks.push(raw.slice(captureStart, index + 1));
        captureStart = -1;
        captureDepth = -1;
      }
      depth -= 1;
    }
  }

  return blocks;
}

function parseProperty(block, propertyName) {
  const escaped = propertyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`\\(property\\s+"${escaped}"\\s+"([^"]*)"([\\s\\S]*?)\\)\\s*\\)`, "m"));
  if (!match) {
    return null;
  }

  const atMatch = match[2].match(/\(at\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/m);
  const sizeMatch = match[2].match(/\(font[\s\S]*?\(size\s+([-\d.]+)\s+([-\d.]+)/m);

  return {
    value: match[1],
    visible: !/\(hide yes\)/m.test(match[2]),
    x: atMatch ? mmToMil(atMatch[1]) : 0,
    y: atMatch ? -mmToMil(atMatch[2]) : 0,
    rotationDeg: atMatch ? -Number(atMatch[3]) : 0,
    fontSize: sizeMatch ? mmToMil(sizeMatch[1]) : 50,
  };
}

function parseTopLevelSymbolBlocks(raw) {
  return scanSExpressionBlocks(raw, (source, index, nextDepth) => nextDepth === 2 && source.startsWith("(symbol ", index));
}

function parseChildSymbolBlocks(block) {
  return scanSExpressionBlocks(block, (_source, index, nextDepth) => nextDepth === 2 && index !== 0);
}

function parseNestedBlocks(block, prefixes) {
  return scanSExpressionBlocks(
    block,
    (source, index, nextDepth) => nextDepth === 2 && prefixes.some((prefix) => source.startsWith(prefix, index)),
  );
}

function parsePinBlocks(block) {
  return parseNestedBlocks(block, ["(pin "]);
}

function parseGraphicBlocks(block) {
  return parseNestedBlocks(block, ["(rectangle", "(polyline", "(circle", "(arc", "(text "]);
}

function parseBlockName(block) {
  return block.match(/^\(symbol\s+"([^"]+)"/m)?.[1] ?? null;
}

function summarizeSymbolBlock(block, libraryName) {
  const sourceSymbol = parseBlockName(block);
  if (!sourceSymbol) {
    return null;
  }

  const extendsMatch = block.match(/\(extends\s+"([^"]+)"/m);
  const reference = parseProperty(block, "Reference")?.value ?? null;
  const value = parseProperty(block, "Value")?.value ?? null;
  const description = parseProperty(block, "Description")?.value ?? null;
  const keywords = parseProperty(block, "ki_keywords")?.value ?? null;

  return {
    id: `${libraryName}:${sourceSymbol}`,
    name: value ?? sourceSymbol,
    sourceSymbol,
    sourceLibrary: libraryName,
    reference,
    description,
    keywords: keywords ? keywords.split(/\s+/).filter(Boolean) : [],
    extends: extendsMatch?.[1] ?? null,
  };
}

function pinSideFromAngle(angle) {
  const normalized = ((Number(angle) % 360) + 360) % 360;
  if (normalized === 0) {
    return "left";
  }
  if (normalized === 180) {
    return "right";
  }
  if (normalized === 90) {
    return "bottom";
  }
  if (normalized === 270) {
    return "top";
  }
  return "left";
}

function inferPinLayout(pins) {
  const pinUnitCount = new Set(pins.map((pin) => pin.unitId).filter(Boolean)).size;
  if (pinUnitCount > 1) {
    return "split_units";
  }

  const visibleSides = new Set(pins.filter((pin) => pin.side !== "hidden").map((pin) => pin.side));
  if (visibleSides.size <= 1) {
    return "single_side";
  }
  if (visibleSides.size === 2) {
    return "opposite_sides";
  }
  return "four_side";
}

function inferShape(summary) {
  const reference = summary.reference ?? "";
  if (reference === "R" || reference === "C" || reference === "L") {
    return "rectangle";
  }
  if (reference === "U" || reference === "IC") {
    return "rectangle";
  }
  return "custom";
}

function pinInnerPoint(xMm, yMm, lengthMm, angleDeg) {
  const normalized = ((Number(angleDeg) % 360) + 360) % 360;
  if (normalized === 0) {
    return { x: xMm + lengthMm, y: yMm };
  }
  if (normalized === 180) {
    return { x: xMm - lengthMm, y: yMm };
  }
  if (normalized === 90) {
    return { x: xMm, y: yMm + lengthMm };
  }
  if (normalized === 270) {
    return { x: xMm, y: yMm - lengthMm };
  }
  return { x: xMm, y: yMm };
}

function parsePinBlock(pinBlock, unitId) {
  const headerMatch = pinBlock.match(/^\(pin\s+(\S+)\s+(\S+)/m);
  const atMatch = pinBlock.match(/\(at\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/m);
  const lengthMatch = pinBlock.match(/\(length\s+([-\d.]+)/m);
  const nameMatch = pinBlock.match(/\(name\s+"([^"]*)"/m);
  const numberMatch = pinBlock.match(/\(number\s+"([^"]*)"/m);

  if (!headerMatch || !atMatch || !numberMatch) {
    return null;
  }

  const electricalType = headerMatch[1];
  const graphicalStyle = headerMatch[2];
  const xMm = Number(atMatch[1]);
  const yMm = Number(atMatch[2]);
  const angleDeg = Number(atMatch[3]);
  const lengthMm = Number(lengthMatch?.[1] ?? 0);
  const number = numberMatch[1];
  const inner = pinInnerPoint(xMm, yMm, lengthMm, angleDeg);

  return {
    id: `pin_${number.replace(/[^A-Za-z0-9_]+/g, "_")}`,
    number,
    name: nameMatch?.[1] ?? number,
    side: pinSideFromAngle(angleDeg),
    electricalType,
    unitId,
    graphicalStyle,
    sequence: 0,
    x: mmToMil(xMm),
    y: -mmToMil(yMm),
    innerX: mmToMil(inner.x),
    innerY: -mmToMil(inner.y),
    length: mmToMil(lengthMm),
    angleDeg,
  };
}

function parseStrokeWidth(block) {
  const match = block.match(/\(stroke[\s\S]*?\(width\s+([-\d.]+)/m);
  return match ? mmToMil(match[1]) : 10;
}

function parseStrokeType(block) {
  return block.match(/\(stroke[\s\S]*?\(type\s+([^)]+)/m)?.[1] ?? "default";
}

function parseFillType(block) {
  return block.match(/\(fill[\s\S]*?\(type\s+([^)]+)/m)?.[1] ?? "none";
}

function parseGraphicBlock(graphicBlock, unitId, graphicIndex) {
  const strokeWidth = parseStrokeWidth(graphicBlock);
  const strokeType = parseStrokeType(graphicBlock);
  const fillType = parseFillType(graphicBlock);

  if (graphicBlock.startsWith("(rectangle")) {
    const startMatch = graphicBlock.match(/\(start\s+([-\d.]+)\s+([-\d.]+)/m);
    const endMatch = graphicBlock.match(/\(end\s+([-\d.]+)\s+([-\d.]+)/m);
    if (!startMatch || !endMatch) {
      return null;
    }
    return {
      id: `graphic_${unitId}_${graphicIndex}`,
      kind: "rectangle",
      unitId,
      x1: mmToMil(startMatch[1]),
      y1: -mmToMil(startMatch[2]),
      x2: mmToMil(endMatch[1]),
      y2: -mmToMil(endMatch[2]),
      strokeWidth,
      strokeType,
      fillType,
    };
  }

  if (graphicBlock.startsWith("(polyline")) {
    const points = Array.from(graphicBlock.matchAll(/\(xy\s+([-\d.]+)\s+([-\d.]+)\)/g)).map((match) => ({
      x: mmToMil(match[1]),
      y: -mmToMil(match[2]),
    }));
    if (points.length < 2) {
      return null;
    }
    return {
      id: `graphic_${unitId}_${graphicIndex}`,
      kind: "polyline",
      unitId,
      points,
      strokeWidth,
      strokeType,
      fillType,
    };
  }

  if (graphicBlock.startsWith("(circle")) {
    const centerMatch = graphicBlock.match(/\(center\s+([-\d.]+)\s+([-\d.]+)/m);
    const radiusMatch = graphicBlock.match(/\(radius\s+([-\d.]+)/m);
    if (!centerMatch || !radiusMatch) {
      return null;
    }
    return {
      id: `graphic_${unitId}_${graphicIndex}`,
      kind: "circle",
      unitId,
      cx: mmToMil(centerMatch[1]),
      cy: -mmToMil(centerMatch[2]),
      radius: mmToMil(radiusMatch[1]),
      strokeWidth,
      strokeType,
      fillType,
    };
  }

  if (graphicBlock.startsWith("(arc")) {
    const startMatch = graphicBlock.match(/\(start\s+([-\d.]+)\s+([-\d.]+)/m);
    const midMatch = graphicBlock.match(/\(mid\s+([-\d.]+)\s+([-\d.]+)/m);
    const endMatch = graphicBlock.match(/\(end\s+([-\d.]+)\s+([-\d.]+)/m);
    if (!startMatch || !midMatch || !endMatch) {
      return null;
    }
    return {
      id: `graphic_${unitId}_${graphicIndex}`,
      kind: "arc",
      unitId,
      x1: mmToMil(startMatch[1]),
      y1: -mmToMil(startMatch[2]),
      x2: mmToMil(midMatch[1]),
      y2: -mmToMil(midMatch[2]),
      cx: mmToMil(endMatch[1]),
      cy: -mmToMil(endMatch[2]),
      strokeWidth,
      strokeType,
      fillType,
    };
  }

  if (graphicBlock.startsWith("(text ")) {
    const textMatch = graphicBlock.match(/^\(text\s+"([^"]*)"/m);
    const atMatch = graphicBlock.match(/\(at\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/m);
    const sizeMatch = graphicBlock.match(/\(font[\s\S]*?\(size\s+([-\d.]+)\s+([-\d.]+)/m);
    if (!textMatch || !atMatch) {
      return null;
    }
    return {
      id: `graphic_${unitId}_${graphicIndex}`,
      kind: "text",
      unitId,
      text: textMatch[1],
      x1: mmToMil(atMatch[1]),
      y1: -mmToMil(atMatch[2]),
      rotationDeg: -Number(atMatch[3]),
      fontSize: sizeMatch ? mmToMil(sizeMatch[1]) : 50,
      strokeWidth,
      strokeType,
      fillType,
    };
  }

  return null;
}

function buildFieldList(block) {
  const fieldNames = ["Reference", "Value", "Footprint", "Datasheet", "Description", "ki_keywords", "ki_fp_filters"];
  return fieldNames
    .map((fieldName) => {
      const property = parseProperty(block, fieldName);
      if (!property) {
        return null;
      }

      return {
        key: fieldName,
        value: property.value,
        visible: property.visible,
      };
    })
    .filter(Boolean);
}

function buildSymbolDefinition(libraryName, symbolName, blockMap) {
  const block = blockMap.get(symbolName);
  if (!block) {
    return null;
  }

  const summary = summarizeSymbolBlock(block, libraryName);
  if (!summary) {
    return null;
  }

  const chain = [];
  const visited = new Set();
  let currentName = symbolName;
  while (currentName && !visited.has(currentName)) {
    visited.add(currentName);
    const currentBlock = blockMap.get(currentName);
    if (!currentBlock) {
      break;
    }
    chain.unshift(currentBlock);
    currentName = summarizeSymbolBlock(currentBlock, libraryName)?.extends ?? null;
  }

  const units = [];
  const pins = [];
  const graphics = [];
  const seenPins = new Set();

  for (const chainBlock of chain) {
    const childBlocks = parseChildSymbolBlocks(chainBlock);
    if (childBlocks.length === 0) {
      continue;
    }

    for (const childBlock of childBlocks) {
      const unitName = parseBlockName(childBlock);
      if (!unitName) {
        continue;
      }

      const pinBlocks = parsePinBlocks(childBlock);
      const graphicBlocks = parseGraphicBlocks(childBlock);
      if (pinBlocks.length === 0 && graphicBlocks.length === 0) {
        continue;
      }

      if (!units.find((unit) => unit.id === unitName)) {
        units.push({ id: unitName, name: unitName });
      }

      for (const [index, graphicBlock] of graphicBlocks.entries()) {
        const graphic = parseGraphicBlock(graphicBlock, unitName, index);
        if (graphic) {
          graphics.push(graphic);
        }
      }

      for (const pinBlock of pinBlocks) {
        const pin = parsePinBlock(pinBlock, unitName);
        if (!pin) {
          continue;
        }
        const dedupeKey = `${pin.unitId}:${pin.number}`;
        if (seenPins.has(dedupeKey)) {
          continue;
        }
        seenPins.add(dedupeKey);
        pin.sequence = pins.length;
        pins.push(pin);
      }
    }
  }

  return {
    schema: "aura.symbol_definition.v1",
    metadata: {
      id: `sym_${libraryName}_${symbolName}`.replace(/[^A-Za-z0-9_]+/g, "_"),
      slug: `${libraryName}_${symbolName}`.toLowerCase().replace(/[^a-z0-9_]+/g, "_"),
      name: summary.name,
      description: summary.description ?? "",
      keywords: summary.keywords,
      sourceKind: "kicad",
      sourceLibrary: libraryName,
      sourceSymbol: symbolName,
      defaultReferencePrefix: summary.reference ?? "U",
      symbolKey: `${libraryName}:${symbolName}`,
    },
    body: {
      shape: inferShape(summary),
      pinLayout: inferPinLayout(pins),
      units,
      graphics,
    },
    pins,
    fields: buildFieldList(block),
  };
}

async function loadKiCadLibrary(libraryName) {
  const cached = libraryCache.get(libraryName);
  if (cached) {
    return cached;
  }

  const symbolDir = await findKiCadSymbolDir();
  if (!symbolDir) {
    return null;
  }

  const libraryPath = resolve(symbolDir, `${libraryName}.kicad_sym`);
  if (!await pathExists(libraryPath)) {
    return null;
  }

  const raw = await readFile(libraryPath, "utf8");
  const topLevelBlocks = parseTopLevelSymbolBlocks(raw);
  const blockMap = new Map();
  const summaries = [];

  for (const block of topLevelBlocks) {
    const summary = summarizeSymbolBlock(block, libraryName);
    if (!summary) {
      continue;
    }
    blockMap.set(summary.sourceSymbol, block);
    summaries.push(summary);
  }

  const value = {
    library: {
      id: libraryName,
      name: libraryName,
      path: libraryPath,
      symbolCount: summaries.length,
    },
    summaries,
    blockMap,
  };
  libraryCache.set(libraryName, value);
  return value;
}

export async function findKiCadSymbolDir() {
  if (process.env.KICAD9_SYMBOL_DIR && await hasFlatKiCadSymbolFiles(process.env.KICAD9_SYMBOL_DIR)) {
    return process.env.KICAD9_SYMBOL_DIR;
  }

  for (const candidate of WINDOWS_KICAD_SYMBOL_DIRS) {
    if (await hasFlatKiCadSymbolFiles(candidate)) {
      return candidate;
    }
  }

  return null;
}

export async function getKiCadStatus() {
  const symbolDir = await findKiCadSymbolDir();
  if (!symbolDir) {
    return {
      installed: false,
      symbolDir: null,
      libraryCount: 0,
    };
  }

  const files = await readdir(symbolDir);
  const libraryCount = files.filter((file) => file.endsWith(".kicad_sym")).length;
  return {
    installed: true,
    symbolDir,
    libraryCount,
  };
}

export async function listKiCadLibraries() {
  const symbolDir = await findKiCadSymbolDir();
  if (!symbolDir) {
    return [];
  }

  const files = (await readdir(symbolDir))
    .filter((file) => file.endsWith(".kicad_sym"))
    .sort((left, right) => left.localeCompare(right));

  return files.map((file) => ({
    id: basename(file, ".kicad_sym"),
    name: basename(file, ".kicad_sym"),
    path: resolve(symbolDir, file),
  }));
}

export async function listKiCadSymbolsInLibrary(libraryName) {
  const libraryData = await loadKiCadLibrary(libraryName);
  if (!libraryData) {
    return null;
  }

  return {
    library: libraryData.library,
    symbols: libraryData.summaries,
  };
}

export async function searchKiCadSymbols(query, options = {}) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  const limit = Math.max(1, Math.min(200, Number(options.limit) || 60));
  const allowedLibraries = Array.isArray(options.libraries) && options.libraries.length
    ? new Set(options.libraries.map((value) => String(value)))
    : null;

  const libraries = await listKiCadLibraries();
  const targetLibraries = allowedLibraries
    ? libraries.filter((library) => allowedLibraries.has(library.id))
    : libraries;

  const scoreSymbol = (symbol) => {
    const symbolId = String(symbol.id || "").toLowerCase();
    const symbolName = String(symbol.name || "").toLowerCase();
    const sourceSymbol = String(symbol.sourceSymbol || "").toLowerCase();
    const description = String(symbol.description || "").toLowerCase();
    const reference = String(symbol.reference || "").toLowerCase();
    const keywords = Array.isArray(symbol.keywords)
      ? symbol.keywords.map((value) => String(value).toLowerCase())
      : [];

    let score = 0;
    if (symbolId === normalizedQuery || symbolName === normalizedQuery || sourceSymbol === normalizedQuery) {
      score += 1000;
    }
    if (sourceSymbol.startsWith(normalizedQuery)) {
      score += 500;
    }
    if (symbolName.startsWith(normalizedQuery)) {
      score += 350;
    }
    if (symbolId.includes(normalizedQuery)) {
      score += 250;
    }
    if (symbolName.includes(normalizedQuery)) {
      score += 180;
    }
    if (sourceSymbol.includes(normalizedQuery)) {
      score += 180;
    }
    if (reference === normalizedQuery) {
      score += 120;
    }
    if (description.includes(normalizedQuery)) {
      score += 60;
    }
    if (keywords.some((keyword) => keyword.includes(normalizedQuery))) {
      score += 40;
    }
    return score;
  };

  const results = [];
  for (const library of targetLibraries) {
    const libraryData = await loadKiCadLibrary(library.id);
    if (!libraryData) {
      continue;
    }
    for (const symbol of libraryData.summaries) {
      const score = scoreSymbol(symbol);
      if (score <= 0) {
        continue;
      }
      results.push({
        ...symbol,
        matchScore: score,
      });
    }
  }

  return results
    .sort((left, right) => {
      if (right.matchScore !== left.matchScore) {
        return right.matchScore - left.matchScore;
      }
      if (left.sourceLibrary !== right.sourceLibrary) {
        return String(left.sourceLibrary).localeCompare(String(right.sourceLibrary));
      }
      return String(left.name).localeCompare(String(right.name));
    })
    .slice(0, limit);
}

export async function getKiCadSymbolDefinition(libraryName, symbolName) {
  const libraryData = await loadKiCadLibrary(libraryName);
  if (!libraryData) {
    return null;
  }

  const definition = buildSymbolDefinition(libraryName, symbolName, libraryData.blockMap);
  if (!definition) {
    return null;
  }

  return {
    library: libraryData.library,
    definition,
  };
}
