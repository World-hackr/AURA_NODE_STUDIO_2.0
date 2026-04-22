import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..");
const workspaceRoot = resolve(appRoot, "../..");
const fritzingRoot = resolve(workspaceRoot, "vendor_reference", "fritzing_paired");
const fritzingIndexPath = resolve(fritzingRoot, "index.json");

let fritzingIndexCache = null;

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function parseXmlAttr(source, name) {
  const match = source.match(new RegExp(`${name}="([^"]*)"`, "i"));
  return match ? match[1] : null;
}

function stripSvgEnvelope(svgText) {
  return svgText
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .trim();
}

function extractSvgSize(svgText) {
  const viewBox = parseXmlAttr(svgText, "viewBox");
  if (viewBox) {
    const parts = viewBox.split(/[ ,]+/).map(Number).filter((value) => Number.isFinite(value));
    if (parts.length === 4) {
      return { width: parts[2], height: parts[3] };
    }
  }

  const width = Number(parseXmlAttr(svgText, "width"));
  const height = Number(parseXmlAttr(svgText, "height"));
  if (Number.isFinite(width) && Number.isFinite(height)) {
    return { width, height };
  }

  return { width: 100, height: 100 };
}

function parseConnectorRefs(fzpText) {
  const connectors = [];
  const connectorRegex = /<connector\b([^>]*)>([\s\S]*?)<\/connector>/gi;

  for (const match of fzpText.matchAll(connectorRegex)) {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    const id = parseXmlAttr(attrs, "id");
    if (!id) {
      continue;
    }

    const breadboardMatch = body.match(/<breadboardView>\s*<p\b([^>]*)\/>\s*<\/breadboardView>/i);
    const breadboardAttrs = breadboardMatch?.[1] ?? "";

    connectors.push({
      id,
      name: parseXmlAttr(attrs, "name"),
      type: parseXmlAttr(attrs, "type"),
      description: body.match(/<description>([\s\S]*?)<\/description>/i)?.[1]?.trim() ?? null,
      svgId: parseXmlAttr(breadboardAttrs, "svgId"),
      legId: parseXmlAttr(breadboardAttrs, "legId"),
      terminalId: parseXmlAttr(breadboardAttrs, "terminalId"),
    });
  }

  return connectors;
}

async function loadFritzingIndex() {
  if (!fritzingIndexCache) {
    fritzingIndexCache = await readJson(fritzingIndexPath);
  }
  return fritzingIndexCache;
}

export async function getFritzingPartByModuleId(moduleId) {
  const index = await loadFritzingIndex();
  const part = index.parts.find((entry) => entry.moduleId === moduleId);
  if (!part) {
    return null;
  }

  const partRoot = resolve(workspaceRoot, part.folder);
  const metaPath = resolve(partRoot, "part.meta.json");
  const fzpPath = resolve(partRoot, "part.fzp");

  const meta = await readJson(metaPath);
  const fzpText = await readFile(fzpPath, "utf8");
  const svgCache = new Map();
  const getViewSvg = async (viewName) => {
    const view = meta.copiedViews.find((entry) => entry.view === viewName);
    if (!view) {
      return null;
    }
    if (!svgCache.has(view.file)) {
      svgCache.set(view.file, stripSvgEnvelope(await readFile(resolve(partRoot, view.file), "utf8")));
    }
    return svgCache.get(view.file);
  };

  const breadboardSvg = await getViewSvg("breadboard");
  const iconSvg = await getViewSvg("icon");
  const schematicSvg = await getViewSvg("schematic");
  const displaySvg = breadboardSvg ?? iconSvg ?? schematicSvg ?? null;
  const displayView = breadboardSvg ? "breadboard" : iconSvg ? "icon" : schematicSvg ? "schematic" : null;
  const displaySize = displaySvg ? extractSvgSize(displaySvg) : null;

  return {
    moduleId: part.moduleId,
    title: meta.title ?? part.title,
    folder: part.folder,
    connectorCount: meta.connectorCount ?? part.connectorCount,
    copiedViews: meta.copiedViews ?? [],
    missingViews: meta.missingViews ?? [],
    connectors: parseConnectorRefs(fzpText),
    breadboardSvg,
    iconSvg,
    schematicSvg,
    displaySvg,
    displayView,
    displaySize,
    fzpText,
  };
}
