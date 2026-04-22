const API_BASE = "http://localhost:8787";
const MILS_PER_AURA_GRID = 12.5;
const PCB_METADATA_FIELDS = new Set(["Footprint", "ki_fp_filters"]);

const state = {
    libraries: [],
    symbols: [],
    selectedLibraryId: null,
    selectedSymbolId: null,
    selectedSummary: null,
    selectedDefinition: null,
    activeUnitId: null,
    showPinLabels: true,
    definitionCache: new Map(),
};

const dom = {
    apiBadge: document.getElementById("api-badge"),
    libraryCount: document.getElementById("library-count"),
    symbolCount: document.getElementById("symbol-count"),
    librarySearch: document.getElementById("library-search"),
    symbolSearch: document.getElementById("symbol-search"),
    libraryList: document.getElementById("library-list"),
    symbolList: document.getElementById("symbol-list"),
    activeSymbolTitle: document.getElementById("active-symbol-title"),
    unitSelect: document.getElementById("unit-select"),
    viewMode: document.getElementById("view-mode"),
    fitSymbol: document.getElementById("fit-symbol"),
    togglePinLabels: document.getElementById("toggle-pin-labels"),
    symbolCanvas: document.getElementById("symbol-canvas"),
    rendererStatus: document.getElementById("renderer-status"),
    summaryRef: document.getElementById("summary-ref"),
    summaryCard: document.getElementById("summary-card"),
    pinCount: document.getElementById("pin-count"),
    pinTable: document.getElementById("pin-table"),
    fieldCount: document.getElementById("field-count"),
    fieldList: document.getElementById("field-list"),
    checkCount: document.getElementById("check-count"),
    checkList: document.getElementById("check-list"),
};

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

async function apiGet(path) {
    const response = await fetch(`${API_BASE}${path}`);
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.message || `Request failed: ${path}`);
    }
    return data;
}

function setApiState(kind, text) {
    dom.apiBadge.classList.remove("online", "offline");
    dom.apiBadge.classList.add(kind);
    dom.apiBadge.textContent = text;
}

function setRendererStatus(text) {
    dom.rendererStatus.textContent = text;
}

function filteredLibraries() {
    const query = dom.librarySearch.value.trim().toLowerCase();
    return state.libraries.filter((library) => !query || library.name.toLowerCase().includes(query));
}

function filteredSymbols() {
    const query = dom.symbolSearch.value.trim().toLowerCase();
    return state.symbols.filter((symbol) => {
        if (!query) {
            return true;
        }
        return [
            symbol.name,
            symbol.sourceSymbol,
            symbol.reference,
            symbol.description,
            ...(symbol.keywords ?? []),
        ].some((part) => String(part ?? "").toLowerCase().includes(query));
    });
}

function renderLibraries() {
    const libraries = filteredLibraries();
    dom.libraryCount.textContent = String(state.libraries.length);
    if (!libraries.length) {
        dom.libraryList.innerHTML = `<div class="empty-state">No libraries match.</div>`;
        return;
    }

    dom.libraryList.innerHTML = libraries.map((library) => `
        <button class="library-row ${library.id === state.selectedLibraryId ? "active" : ""}" type="button" data-library-id="${escapeHtml(library.id)}">
            <span class="library-name">${escapeHtml(library.name)}</span>
            <span class="library-meta">.kicad_sym</span>
        </button>
    `).join("");
}

function renderSymbols() {
    const symbols = filteredSymbols();
    dom.symbolCount.textContent = String(state.symbols.length);
    if (!state.selectedLibraryId) {
        dom.symbolList.innerHTML = `<div class="empty-state">Select a library.</div>`;
        return;
    }
    if (!symbols.length) {
        dom.symbolList.innerHTML = `<div class="empty-state">No symbols match.</div>`;
        return;
    }

    dom.symbolList.innerHTML = symbols.map((symbol) => `
        <button class="symbol-row ${symbol.id === state.selectedSymbolId ? "active" : ""}" type="button" data-symbol-id="${escapeHtml(symbol.id)}">
            <span class="symbol-ref">${escapeHtml(symbol.reference || "U")}</span>
            <span>
                <span class="symbol-name">${escapeHtml(symbol.name)}</span>
                <span class="symbol-meta">${escapeHtml(symbol.sourceSymbol)}</span>
            </span>
            <span class="symbol-meta">${escapeHtml(symbol.keywords?.[0] || "")}</span>
        </button>
    `).join("");
}

function parseKiCadUnitSuffix(unitId) {
    const match = String(unitId ?? "").match(/_(\d+)_(\d+)$/);
    if (!match) {
        return null;
    }
    return {
        unitNumber: Number(match[1]),
        demorganVariant: Number(match[2]),
    };
}

function isCommonUnitForActiveUnit(candidateUnitId, activeUnitId) {
    if (!candidateUnitId || !activeUnitId || candidateUnitId === activeUnitId) {
        return false;
    }
    const candidate = parseKiCadUnitSuffix(candidateUnitId);
    const active = parseKiCadUnitSuffix(activeUnitId);
    return !!candidate
        && !!active
        && candidate.unitNumber === 0
        && candidate.demorganVariant === active.demorganVariant;
}

function graphicsForUnit(definition, unitId) {
    return (definition?.body?.graphics ?? []).filter((graphic) =>
        graphic.unitId === unitId || isCommonUnitForActiveUnit(graphic.unitId, unitId),
    );
}

function pinsForUnit(definition, unitId) {
    return (definition?.pins ?? []).filter((pin) => pin.unitId === unitId);
}

function pickPrimaryUnitId(definition) {
    const units = definition?.body?.units ?? [];
    if (!units.length) {
        return null;
    }

    const scores = new Map(units.map((unit) => [unit.id, 0]));
    const pinCountByUnit = new Map(units.map((unit) => [unit.id, 0]));
    for (const graphic of definition?.body?.graphics ?? []) {
        scores.set(graphic.unitId, (scores.get(graphic.unitId) ?? 0) + 2);
    }
    for (const pin of definition?.pins ?? []) {
        scores.set(pin.unitId, (scores.get(pin.unitId) ?? 0) + 5);
        pinCountByUnit.set(pin.unitId, (pinCountByUnit.get(pin.unitId) ?? 0) + 1);
    }

    const unitEntries = units.map((unit) => ({
        id: unit.id,
        score: scores.get(unit.id) ?? 0,
        pinCount: pinCountByUnit.get(unit.id) ?? 0,
    }));

    const pinnedUnits = unitEntries.filter((unit) => unit.pinCount > 0);
    const candidates = pinnedUnits.length ? pinnedUnits : unitEntries;

    return candidates
        .sort((left, right) => (right.score - left.score) || (right.pinCount - left.pinCount))
        [0]?.id ?? units[0].id;
}

function includeBounds(bounds, x, y) {
    bounds.minX = Math.min(bounds.minX, x);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxY = Math.max(bounds.maxY, y);
}

function computeBounds(graphics, pins) {
    const bounds = {
        minX: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
    };

    for (const graphic of graphics) {
        if (graphic.kind === "rectangle") {
            includeBounds(bounds, graphic.x1, graphic.y1);
            includeBounds(bounds, graphic.x2, graphic.y2);
        } else if (graphic.kind === "polyline") {
            for (const point of graphic.points ?? []) {
                includeBounds(bounds, point.x, point.y);
            }
        } else if (graphic.kind === "circle") {
            includeBounds(bounds, graphic.cx - graphic.radius, graphic.cy - graphic.radius);
            includeBounds(bounds, graphic.cx + graphic.radius, graphic.cy + graphic.radius);
        } else if (graphic.kind === "arc") {
            includeBounds(bounds, graphic.x1, graphic.y1);
            includeBounds(bounds, graphic.x2, graphic.y2);
            includeBounds(bounds, graphic.cx, graphic.cy);
        } else if (graphic.kind === "text") {
            const size = number(graphic.fontSize, 50);
            includeBounds(bounds, graphic.x1 - size, graphic.y1 - size);
            includeBounds(bounds, graphic.x1 + size, graphic.y1 + size);
        }
    }

    for (const pin of pins) {
        includeBounds(bounds, pin.x, pin.y);
        includeBounds(bounds, pin.innerX, pin.innerY);
    }

    if (!Number.isFinite(bounds.minX)) {
        return { minX: -200, maxX: 200, minY: -150, maxY: 150, width: 400, height: 300 };
    }

    return {
        ...bounds,
        width: Math.max(1, bounds.maxX - bounds.minX),
        height: Math.max(1, bounds.maxY - bounds.minY),
    };
}

function strokeWidthFor(graphic) {
    return Math.max(5, number(graphic.strokeWidth, 10));
}

function fillFor(graphic) {
    if (graphic.fillType === "background") {
        return "#ffffff";
    }
    if (graphic.fillType === "outline") {
        return "#f7f9fb";
    }
    return "none";
}

function svgPathForArc(graphic) {
    const x1 = number(graphic.x1);
    const y1 = number(graphic.y1);
    const xm = number(graphic.x2);
    const ym = number(graphic.y2);
    const x2 = number(graphic.cx);
    const y2 = number(graphic.cy);

    const determinant = 2 * (x1 * (ym - y2) + xm * (y2 - y1) + x2 * (y1 - ym));
    if (Math.abs(determinant) < 0.01) {
        return `M ${x1} ${y1} Q ${xm} ${ym} ${x2} ${y2}`;
    }

    const ux = ((x1 * x1 + y1 * y1) * (ym - y2) + (xm * xm + ym * ym) * (y2 - y1) + (x2 * x2 + y2 * y2) * (y1 - ym)) / determinant;
    const uy = ((x1 * x1 + y1 * y1) * (x2 - xm) + (xm * xm + ym * ym) * (x1 - x2) + (x2 * x2 + y2 * y2) * (xm - x1)) / determinant;
    const radius = Math.hypot(x1 - ux, y1 - uy);
    const cross = (xm - x1) * (y2 - ym) - (ym - y1) * (x2 - xm);
    const sweep = cross < 0 ? 0 : 1;
    return `M ${x1} ${y1} A ${radius} ${radius} 0 0 ${sweep} ${x2} ${y2}`;
}

function graphicMarkup(graphic) {
    const stroke = "#1e2732";
    const width = strokeWidthFor(graphic);
    const fill = fillFor(graphic);
    if (graphic.kind === "rectangle") {
        const x = Math.min(graphic.x1, graphic.x2);
        const y = Math.min(graphic.y1, graphic.y2);
        const w = Math.abs(graphic.x2 - graphic.x1);
        const h = Math.abs(graphic.y2 - graphic.y1);
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" />`;
    }
    if (graphic.kind === "polyline") {
        const points = (graphic.points ?? []).map((point) => `${point.x},${point.y}`).join(" ");
        return `<polyline points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="square" stroke-linejoin="miter" />`;
    }
    if (graphic.kind === "circle") {
        return `<circle cx="${graphic.cx}" cy="${graphic.cy}" r="${graphic.radius}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" />`;
    }
    if (graphic.kind === "arc") {
        return `<path d="${svgPathForArc(graphic)}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="square" />`;
    }
    if (graphic.kind === "text") {
        const rotation = number(graphic.rotationDeg);
        const transform = rotation ? ` transform="rotate(${rotation} ${graphic.x1} ${graphic.y1})"` : "";
        return `<text x="${graphic.x1}" y="${graphic.y1}"${transform} fill="#1e2732" font-size="${Math.max(28, number(graphic.fontSize, 50))}" font-family="Arial, sans-serif">${escapeHtml(graphic.text)}</text>`;
    }
    return "";
}

function pinLabelPosition(pin) {
    const dx = number(pin.innerX) - number(pin.x);
    const dy = number(pin.innerY) - number(pin.y);
    const sx = Math.sign(dx);
    const sy = Math.sign(dy);
    const labelX = number(pin.innerX) + (sx || 0) * 24;
    const labelY = number(pin.innerY) + (sy || 0) * 24 + 10;
    const numberX = number(pin.x) - (sx || 0) * 24;
    const numberY = number(pin.y) - (sy || 0) * 24 + 10;
    let anchor = "middle";
    if (sx > 0) {
        anchor = "start";
    } else if (sx < 0) {
        anchor = "end";
    }
    return { labelX, labelY, numberX, numberY, anchor };
}

function pinMarkup(pin) {
    const label = pin.name && pin.name !== "~" ? pin.name : "";
    const pos = pinLabelPosition(pin);
    const isPinFocus = dom.viewMode.value === "pins";
    const pinStroke = isPinFocus ? "#b41f2c" : "#263442";
    const pinWidth = isPinFocus ? 8 : 6;
    const connectorMark = isPinFocus
        ? `<rect x="${number(pin.x) - 10}" y="${number(pin.y) - 10}" width="20" height="20" fill="#ffffff" stroke="#b41f2c" stroke-width="5" />`
        : "";
    const labelText = state.showPinLabels && label
        ? `<text x="${pos.labelX}" y="${pos.labelY}" text-anchor="${pos.anchor}" fill="#263442" font-size="34" font-family="Arial, sans-serif">${escapeHtml(label)}</text>`
        : "";
    const numberText = state.showPinLabels
        ? `<text x="${pos.numberX}" y="${pos.numberY}" text-anchor="${pos.anchor === "start" ? "end" : pos.anchor === "end" ? "start" : "middle"}" fill="#8a1f2a" font-size="30" font-family="Arial, sans-serif">${escapeHtml(pin.number)}</text>`
        : "";

    return `
        <g class="pin">
            <line x1="${pin.x}" y1="${pin.y}" x2="${pin.innerX}" y2="${pin.innerY}" stroke="${pinStroke}" stroke-width="${pinWidth}" stroke-linecap="square" />
            ${connectorMark}
            ${labelText}
            ${numberText}
        </g>
    `;
}

function boundsMarkup(bounds, viewMode) {
    if (viewMode !== "bounds") {
        return "";
    }
    return `
        <rect x="${bounds.minX}" y="${bounds.minY}" width="${bounds.width}" height="${bounds.height}" fill="none" stroke="#1967b3" stroke-width="7" stroke-dasharray="28 20" />
        <text x="${bounds.minX}" y="${bounds.minY - 22}" fill="#1967b3" font-size="32" font-family="Arial, sans-serif">normalized bounds</text>
    `;
}

function createSymbolSvg(definition, unitId) {
    const graphics = graphicsForUnit(definition, unitId);
    const pins = pinsForUnit(definition, unitId);
    const bounds = computeBounds(graphics, pins);
    const padding = Math.max(120, Math.max(bounds.width, bounds.height) * 0.18);
    const viewBoxX = bounds.minX - padding;
    const viewBoxY = bounds.minY - padding;
    const viewBoxW = bounds.width + padding * 2;
    const viewBoxH = bounds.height + padding * 2;
    const patternId = `grid-${definition.metadata.slug}-${unitId}`.replace(/[^A-Za-z0-9_-]+/g, "-");
    const axisWidth = Math.max(3, Math.max(viewBoxW, viewBoxH) / 900);
    const graphicsSvg = graphics.map(graphicMarkup).join("");
    const pinsSvg = pins.map(pinMarkup).join("");
    const origin = `
        <line x1="${viewBoxX}" y1="0" x2="${viewBoxX + viewBoxW}" y2="0" stroke="#d6dee8" stroke-width="${axisWidth}" />
        <line x1="0" y1="${viewBoxY}" x2="0" y2="${viewBoxY + viewBoxH}" stroke="#d6dee8" stroke-width="${axisWidth}" />
    `;

    return `
        <svg class="symbol-svg" viewBox="${viewBoxX} ${viewBoxY} ${viewBoxW} ${viewBoxH}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeHtml(definition.metadata.name)}">
            <defs>
                <pattern id="${patternId}" width="50" height="50" patternUnits="userSpaceOnUse">
                    <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#e7edf5" stroke-width="3" />
                </pattern>
                <pattern id="${patternId}-major" width="250" height="250" patternUnits="userSpaceOnUse">
                    <path d="M 250 0 L 0 0 0 250" fill="none" stroke="#ccd7e4" stroke-width="5" />
                </pattern>
            </defs>
            <rect x="${viewBoxX}" y="${viewBoxY}" width="${viewBoxW}" height="${viewBoxH}" fill="#ffffff" />
            <rect x="${viewBoxX}" y="${viewBoxY}" width="${viewBoxW}" height="${viewBoxH}" fill="url(#${patternId})" />
            <rect x="${viewBoxX}" y="${viewBoxY}" width="${viewBoxW}" height="${viewBoxH}" fill="url(#${patternId}-major)" />
            ${origin}
            <g>${graphicsSvg}</g>
            <g>${pinsSvg}</g>
            ${boundsMarkup(bounds, dom.viewMode.value)}
        </svg>
    `;
}

function renderUnitSelect(definition) {
    const units = definition?.body?.units ?? [];
    if (!units.length) {
        dom.unitSelect.disabled = true;
        dom.unitSelect.innerHTML = `<option>No units</option>`;
        return;
    }
    dom.unitSelect.disabled = false;
    dom.unitSelect.innerHTML = units.map((unit) => {
        const pinCount = pinsForUnit(definition, unit.id).length;
        const graphicsCount = graphicsForUnit(definition, unit.id).length;
        return `<option value="${escapeHtml(unit.id)}" ${unit.id === state.activeUnitId ? "selected" : ""}>${escapeHtml(unit.id)} - ${pinCount} pins, ${graphicsCount} graphics</option>`;
    }).join("");
}

function renderSummary(definition) {
    if (!definition) {
        dom.summaryRef.textContent = "-";
        dom.summaryCard.innerHTML = `<div class="empty-state">No symbol selected.</div>`;
        return;
    }

    const pins = pinsForUnit(definition, state.activeUnitId);
    const graphics = graphicsForUnit(definition, state.activeUnitId);
    const bounds = computeBounds(graphics, pins);
    dom.summaryRef.textContent = definition.metadata.defaultReferencePrefix || "U";
    dom.summaryCard.innerHTML = `
        <div class="summary-grid">
            <div class="summary-item"><span>Library</span><strong>${escapeHtml(definition.metadata.sourceLibrary)}</strong></div>
            <div class="summary-item"><span>Symbol</span><strong>${escapeHtml(definition.metadata.sourceSymbol)}</strong></div>
            <div class="summary-item"><span>Reference</span><strong>${escapeHtml(definition.metadata.defaultReferencePrefix || "U")}</strong></div>
            <div class="summary-item"><span>Unit</span><strong>${escapeHtml(state.activeUnitId || "-")}</strong></div>
            <div class="summary-item"><span>Bounds</span><strong>${Math.round(bounds.width)} x ${Math.round(bounds.height)} mil</strong></div>
            <div class="summary-item"><span>AURA grid</span><strong>${(bounds.width / MILS_PER_AURA_GRID).toFixed(1)} x ${(bounds.height / MILS_PER_AURA_GRID).toFixed(1)} u</strong></div>
        </div>
    `;
}

function renderPins(definition) {
    const pins = definition ? pinsForUnit(definition, state.activeUnitId) : [];
    dom.pinCount.textContent = String(pins.length);
    if (!pins.length) {
        dom.pinTable.innerHTML = `<div class="empty-state">No pins in this unit.</div>`;
        return;
    }

    dom.pinTable.innerHTML = pins
        .slice()
        .sort((left, right) => String(left.number).localeCompare(String(right.number), undefined, { numeric: true }))
        .map((pin) => `
            <div class="pin-row">
                <span class="cell-code">${escapeHtml(pin.number)}</span>
                <span class="cell-main">${escapeHtml(pin.name && pin.name !== "~" ? pin.name : "(unnamed)")}</span>
                <span class="cell-muted">${escapeHtml(pin.electricalType || "passive")}</span>
            </div>
        `).join("");
}

function renderFields(definition) {
    const fields = (definition?.fields ?? []).filter((field) => !PCB_METADATA_FIELDS.has(field.key));
    const hiddenPcbFields = (definition?.fields ?? []).filter((field) => PCB_METADATA_FIELDS.has(field.key));
    dom.fieldCount.textContent = String(fields.length);
    if (!fields.length) {
        const hiddenNote = hiddenPcbFields.length
            ? `<span>${hiddenPcbFields.length} PCB metadata field${hiddenPcbFields.length === 1 ? "" : "s"} hidden from this schematic-symbol view.</span>`
            : `<span>No fields loaded.</span>`;
        dom.fieldList.innerHTML = `<div class="empty-state">${hiddenNote}</div>`;
        return;
    }

    const hiddenNote = hiddenPcbFields.length
        ? `<div class="field-row field-row-muted"><span class="cell-code">PCB</span><span class="cell-main">${hiddenPcbFields.length} footprint/filter field${hiddenPcbFields.length === 1 ? "" : "s"} hidden from primary view</span></div>`
        : "";
    dom.fieldList.innerHTML = fields.map((field) => `
        <div class="field-row">
            <span class="cell-code">${escapeHtml(field.key)}</span>
            <span class="cell-main">${escapeHtml(field.value || "-")}</span>
        </div>
    `).join("") + hiddenNote;
}

function buildChecks(definition) {
    if (!definition) {
        return [];
    }

    const pins = pinsForUnit(definition, state.activeUnitId);
    const graphics = graphicsForUnit(definition, state.activeUnitId);
    const units = definition.body?.units ?? [];
    const checks = [];
    checks.push({
        level: graphics.length ? "ok" : "bad",
        text: graphics.length ? `${graphics.length} graphic primitives available.` : "No graphic primitives in the active unit.",
    });
    checks.push({
        level: pins.length ? "ok" : "warn",
        text: pins.length ? `${pins.length} pins mapped to the active unit.` : "No pins mapped to the active unit.",
    });
    checks.push({
        level: units.length > 1 ? "warn" : "ok",
        text: units.length > 1 ? `${units.length} symbol units found. Check unit selector before placement.` : "Single-unit symbol.",
    });
    checks.push({
        level: "ok",
        text: "Renderer is showing schematic symbol graphics and pin lines; PCB footprint metadata is not primary content.",
    });
    return checks;
}

function renderChecks(definition) {
    const checks = buildChecks(definition);
    dom.checkCount.textContent = String(checks.length);
    if (!checks.length) {
        dom.checkList.innerHTML = `<div class="empty-state">Waiting for symbol.</div>`;
        return;
    }
    dom.checkList.innerHTML = checks.map((check) => `
        <div class="check-row">
            <span class="check-level ${check.level}">${check.level}</span>
            <span class="cell-main">${escapeHtml(check.text)}</span>
        </div>
    `).join("");
}

function renderActiveSymbol() {
    const definition = state.selectedDefinition;
    if (!definition) {
        dom.activeSymbolTitle.textContent = "No symbol selected";
        dom.symbolCanvas.innerHTML = `
            <div class="empty-canvas">
                <strong>Choose a KiCad symbol.</strong>
                <span>The lab will render one normalized symbol definition here, with grid, pins, bounds, and fields.</span>
            </div>
        `;
        renderUnitSelect(null);
        renderSummary(null);
        renderPins(null);
        renderFields(null);
        renderChecks(null);
        setRendererStatus("Renderer idle");
        return;
    }

    dom.activeSymbolTitle.textContent = `${definition.metadata.sourceLibrary}:${definition.metadata.sourceSymbol}`;
    renderUnitSelect(definition);
    dom.symbolCanvas.innerHTML = createSymbolSvg(definition, state.activeUnitId);
    renderSummary(definition);
    renderPins(definition);
    renderFields(definition);
    renderChecks(definition);
    const pins = pinsForUnit(definition, state.activeUnitId).length;
    const graphics = graphicsForUnit(definition, state.activeUnitId).length;
    setRendererStatus(`Rendered ${definition.metadata.name} / ${state.activeUnitId} - ${graphics} graphics, ${pins} pins`);
}

async function loadLibrary(libraryId) {
    state.selectedLibraryId = libraryId;
    state.selectedSymbolId = null;
    state.selectedSummary = null;
    state.selectedDefinition = null;
    state.activeUnitId = null;
    renderLibraries();
    renderSymbols();
    renderActiveSymbol();
    setRendererStatus(`Loading ${libraryId}...`);

    const data = await apiGet(`/symbol-sources/kicad/libraries/${encodeURIComponent(libraryId)}`);
    state.symbols = (data.symbols ?? []).slice().sort((left, right) => left.name.localeCompare(right.name));
    renderSymbols();
    setRendererStatus(`${libraryId} loaded with ${state.symbols.length} symbols`);
}

async function ensureDefinition(summary) {
    const cacheKey = summary.id;
    if (!state.definitionCache.has(cacheKey)) {
        const promise = apiGet(`/symbol-sources/kicad/libraries/${encodeURIComponent(summary.sourceLibrary)}/symbols/${encodeURIComponent(summary.sourceSymbol)}/definition`);
        state.definitionCache.set(cacheKey, promise);
    }
    const data = await state.definitionCache.get(cacheKey);
    return data.definition;
}

async function selectSymbol(symbolId) {
    const summary = state.symbols.find((symbol) => symbol.id === symbolId);
    if (!summary) {
        return;
    }

    state.selectedSymbolId = symbolId;
    state.selectedSummary = summary;
    renderSymbols();
    setRendererStatus(`Loading ${summary.sourceSymbol} definition...`);

    const definition = await ensureDefinition(summary);
    state.selectedDefinition = definition;
    state.activeUnitId = pickPrimaryUnitId(definition);
    renderActiveSymbol();
}

async function init() {
    try {
        const [status, libraries] = await Promise.all([
            apiGet("/symbol-sources/kicad/status"),
            apiGet("/symbol-sources/kicad/libraries"),
        ]);
        state.libraries = (libraries.libraries ?? []).slice().sort((left, right) => left.name.localeCompare(right.name));
        setApiState(status.source?.installed ? "online" : "offline", status.source?.installed ? "API online" : "No KiCad source");
        renderLibraries();

        const defaultLibrary = state.libraries.find((library) => library.id === "Device") ?? state.libraries[0];
        if (defaultLibrary) {
            await loadLibrary(defaultLibrary.id);
        }
    } catch (error) {
        console.error(error);
        setApiState("offline", "API offline");
        dom.libraryList.innerHTML = `<div class="empty-state">Could not reach ${escapeHtml(API_BASE)}.</div>`;
        setRendererStatus(error.message);
    }
}

dom.librarySearch.addEventListener("input", renderLibraries);
dom.symbolSearch.addEventListener("input", renderSymbols);

dom.libraryList.addEventListener("click", (event) => {
    const row = event.target.closest("[data-library-id]");
    if (row) {
        loadLibrary(row.dataset.libraryId).catch((error) => {
            console.error(error);
            setRendererStatus(error.message);
        });
    }
});

dom.symbolList.addEventListener("click", (event) => {
    const row = event.target.closest("[data-symbol-id]");
    if (row) {
        selectSymbol(row.dataset.symbolId).catch((error) => {
            console.error(error);
            setRendererStatus(error.message);
        });
    }
});

dom.unitSelect.addEventListener("change", () => {
    state.activeUnitId = dom.unitSelect.value;
    renderActiveSymbol();
});

dom.viewMode.addEventListener("change", renderActiveSymbol);

dom.togglePinLabels.addEventListener("click", () => {
    state.showPinLabels = !state.showPinLabels;
    dom.togglePinLabels.textContent = state.showPinLabels ? "Pin Labels On" : "Pin Labels Off";
    renderActiveSymbol();
});

dom.fitSymbol.addEventListener("click", renderActiveSymbol);

document.querySelectorAll(".tool-button[data-tool]").forEach((button) => {
    button.addEventListener("click", () => {
        document.querySelectorAll(".tool-button[data-tool]").forEach((item) => item.classList.remove("active"));
        button.classList.add("active");
        setRendererStatus(`${button.textContent.trim()} tool selected`);
    });
});

init();
