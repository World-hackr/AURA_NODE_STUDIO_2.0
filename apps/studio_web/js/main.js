const canvas = document.getElementById("workspace");
const ctx = canvas.getContext("2d");
const scaleCanvas = document.getElementById("scale-overlay");
const scaleCtx = scaleCanvas.getContext("2d");

let texture = new Image();
texture.src = "assets/textures/texture1.jpg";
let useTextureBackground = false;
let canvasSolidColor = "#000000";
let currentCanvasTheme = "dark";

let zoom = 1.0;
let offsetX = 0;
let offsetY = 0;
let texZoom = 1.0;
let texOffsetX = 0;
let texOffsetY = 0;

let isEditingTexture = false;
let isFirstLoad = true;
let dpr = window.devicePixelRatio || 1;

const BASE_UNIT_MM = 0.3175; 
let pixelsPerUnit = 10;
let accentColor = "#4a90e2";
const AUTOROUTE_BATCH_LIMIT = 12;
const AUTOROUTE_BATCH_FRAME_YIELD_EVERY = 4;
const AUTOROUTE_LOCAL_PADDING_MIN = 160;
const AUTOROUTE_LOCAL_PADDING_MAX = 360;
const AUTOROUTE_LOCAL_OBSTACLE_PADDING = 48;
const AUTOROUTE_REFERENCE_ROUTE_LIMIT = 32;
const LIVE_JUMP_LOCAL_TOLERANCE_PX = 28;
const LIVE_JUMP_FALLBACK_TOLERANCE_PX = 220;

// INTERACTION MODES
let currentTool = 'select'; // 'select' or 'wire'

// WIRING STATE
let wires = [];
let junctions = [];
let activeWire = null;
let currentWireColor = "#2196F3";
let wireWidth = 2;
let mouseUx = 0;
let mouseUy = 0;

let dragging = false;
let draggedComponent = null;
let selectedComponent = null;
let selectedComponentIds = [];
let placingComponent = null;
let hoveredPin = null;
let handledActiveWireCrossings = [];
let pendingWireTurnCrossingDecision = null;
let selectedWireId = null;
let selectedWireIds = [];
let selectedJunctionId = null;
let autorouteRequestWireId = null;
let autorouteBatchWireIds = [];
let autorouteBatchProgress = 0;
let autorouteBatchRequestedCount = 0;
let selectionBox = null;
let selectionMode = false;
let selectionScope = "both";
let lastSelectionCycle = null;
let aiPatchPreviewState = null;
let aiConversation = [];
let aiProviderDefaults = null;
let aiRequestInFlight = false;
let aiGeminiKeyRefreshTimer = 0;

let showGrid = true;
let gridOpacity = 0.4;
let textureIsDark = true;
let useSketchyStyle = true;
let showAllPinLabels = false;

// HISTORY SYSTEM
let history = [];
let historyIndex = -1;

function saveHistory() {
    if (historyIndex < history.length - 1) {
        history = history.slice(0, historyIndex + 1);
    }
    const snapshot = JSON.stringify({
        components,
        junctions,
        wires: wires
    });
    if (history.length > 0 && history[history.length - 1] === snapshot) return;
    history.push(snapshot);
    if (history.length > 50) history.shift();
    historyIndex = history.length - 1;
}

function undo() {
    if (historyIndex > 0) {
        historyIndex--;
        const state = JSON.parse(history[historyIndex]);
        components = state.components;
        junctions = state.junctions ?? [];
        wires = state.wires;
        activeWire = null;
        handledActiveWireCrossings = [];
        pendingWireTurnCrossingDecision = null;
        selectedComponent = null;
        selectedComponentIds = [];
        selectedWireIds = [];
        selectedWireId = null;
        selectedJunctionId = null;
        selectionBox = null;
        closeInspector();
        refreshWireAutoroutePanel();
        draw();
    }
}

function redo() {
    if (historyIndex < history.length - 1) {
        historyIndex++;
        const state = JSON.parse(history[historyIndex]);
        components = state.components;
        junctions = state.junctions ?? [];
        wires = state.wires;
        activeWire = null;
        handledActiveWireCrossings = [];
        pendingWireTurnCrossingDecision = null;
        selectedComponent = null;
        selectedComponentIds = [];
        selectedWireIds = [];
        selectedWireId = null;
        selectedJunctionId = null;
        selectionBox = null;
        refreshWireAutoroutePanel();
        draw();
    }
}

let COMPONENT_DEFS = {};
let backendOnline = false;
let kicadStatus = null;
let kicadLibraries = [];
let currentLibrary = null;
let currentLibrarySymbols = [];
let selectedLibraryId = null;
let selectedSymbolId = null;
let selectedSymbolSummary = null;
let selectedSymbolDefinition = null;
let librarySearchQuery = "";
let symbolSearchQuery = "";
let globalSymbolSearchQuery = "";
let globalSymbolSearchResults = [];
let globalSymbolSearchBusy = false;
let globalSymbolSearchRequestToken = 0;
let selectedLibraryGroup = "common";
let selectedLibraryPanel = "search";
let symbolPreviewObserver = null;
const symbolPreviewPending = new Map();

const symbolDefinitionCache = new Map();
const libraryDataCache = new Map();
const API_BASE = "http://localhost:8787";
const KICAD_MILS_PER_AURA_UNIT = 12.5;
const SYMBOL_UNIT_SCALE = 1 / KICAD_MILS_PER_AURA_UNIT;
const DEFAULT_SYMBOL_STYLE = "ansi";
const SYMBOL_STYLE_VARIANTS = {
    ansi: {
        "Device:R": "Device:R_US",
        "Device:R_Small": "Device:R_Small_US",
        "Device:R_Variable": "Device:R_Variable_US",
        "Device:R_Shunt": "Device:R_Shunt_US",
        "Device:Thermistor": "Device:Thermistor_US",
        "Device:Thermistor_NTC": "Device:Thermistor_NTC_US",
        "Device:Thermistor_PTC": "Device:Thermistor_PTC_US",
    },
    iec: {},
};

function getPreferredSymbolKey(symbolKey, style = DEFAULT_SYMBOL_STYLE) {
    const normalizedKey = String(symbolKey || "");
    const styleMap = SYMBOL_STYLE_VARIANTS[style] ?? {};
    return styleMap[normalizedKey] || normalizedKey;
}

function getPreferredLibrarySymbolId(libraryId, symbolId, style = DEFAULT_SYMBOL_STYLE) {
    const preferredKey = getPreferredSymbolKey(`${libraryId}:${symbolId}`, style);
    const separatorIndex = preferredKey.indexOf(":");
    if (separatorIndex < 0) {
        return { libraryId, symbolId };
    }
    return {
        libraryId: preferredKey.slice(0, separatorIndex),
        symbolId: preferredKey.slice(separatorIndex + 1),
    };
}

const LIBRARY_GROUPS = {
    common: {
        label: "Common schematic",
        libraries: ["Device", "power", "Switch", "Connector", "Connector_Generic", "Diode", "Transistor_BJT", "Transistor_FET"],
    },
    power: {
        label: "Power and connectors",
        libraries: ["power", "Connector", "Connector_Generic", "Regulator_Linear", "Regulator_Switching", "Battery_Management"],
    },
    semiconductors: {
        label: "Semiconductors",
        libraries: ["Diode", "Transistor_BJT", "Transistor_FET", "Transistor_Array", "Analog", "Amplifier_Operational"],
    },
    ics: {
        label: "ICs and modules",
        libraries: ["Amplifier_Operational", "Interface", "Logic_74xx", "MCU_Microchip_ATmega", "MCU_ST_STM32", "Sensor"],
    },
    all: {
        label: "All KiCad libraries",
        libraries: [],
    },
};

const COMMON_COMPONENTS = [
    { label: "Resistor", ref: "R", libraryId: "Device", symbolId: "R_US" },
    { label: "Capacitor", ref: "C", libraryId: "Device", symbolId: "C" },
    { label: "Inductor", ref: "L", libraryId: "Device", symbolId: "L" },
    { label: "Diode", ref: "D", libraryId: "Device", symbolId: "D" },
    { label: "LED", ref: "D", libraryId: "Device", symbolId: "LED" },
    { label: "Battery Cell", ref: "BT", libraryId: "Device", symbolId: "Battery_Cell" },
    { label: "Ground", ref: "PWR", libraryId: "power", symbolId: "GND" },
    { label: "+5V", ref: "PWR", libraryId: "power", symbolId: "+5V" },
    { label: "+3V3", ref: "PWR", libraryId: "power", symbolId: "+3V3" },
    { label: "VCC", ref: "PWR", libraryId: "power", symbolId: "VCC" },
    { label: "2 Pin Conn", ref: "J", libraryId: "Connector_Generic", symbolId: "Conn_01x02" },
    { label: "3 Pin Conn", ref: "J", libraryId: "Connector_Generic", symbolId: "Conn_01x03" },
];

const JSON_IMPORT_EXAMPLE = {
    schema: "aura.scene_state.v1",
    metadata: {
        title: "Buck Converter Demo",
        description: "Left-to-right demonstration circuit with manually clean wiring for AI and routing tests.",
        captureSource: "studio_example",
        sourceSchematicId: "demo-buck-converter",
        sourceRevision: 1,
        standard: "iec",
    },
    canvas: {
        grid: {
            unitMm: BASE_UNIT_MM,
            pixelsPerUnit,
        },
        viewport: {
            zoom: 1,
            offsetX: 0,
            offsetY: 0,
        },
    },
    components: [
        {
            id: "pwr_vcc",
            symbolKey: "power:VCC",
            reference: "#PWR1",
            value: "VCC",
            placement: { x: 80, y: 80, rotationDeg: 0 },
        },
        {
            id: "pwr_gnd",
            symbolKey: "power:GND",
            reference: "#PWR2",
            value: "GND",
            placement: { x: 160, y: 300, rotationDeg: 0 },
        },
        {
            id: "s1",
            symbolKey: "Switch:SW_SPST",
            reference: "S1",
            value: "SW",
            placement: { x: 170, y: 80, rotationDeg: 0 },
        },
        {
            id: "l1",
            symbolKey: "Device:L",
            reference: "L1",
            value: "22uH",
            placement: { x: 310, y: 80, rotationDeg: 0 },
        },
        {
            id: "c_in",
            symbolKey: "Device:C",
            reference: "C1",
            value: "10u",
            placement: { x: 80, y: 180, rotationDeg: 90 },
        },
        {
            id: "d1",
            symbolKey: "Device:D",
            reference: "D1",
            value: "Schottky",
            placement: { x: 240, y: 180, rotationDeg: 90 },
        },
        {
            id: "c_out",
            symbolKey: "Device:C",
            reference: "C2",
            value: "47u",
            placement: { x: 440, y: 180, rotationDeg: 90 },
        },
        {
            id: "r_load",
            symbolKey: getPreferredSymbolKey("Device:R"),
            reference: "R3",
            value: "20R",
            placement: { x: 580, y: 180, rotationDeg: 90 },
        },
        {
            id: "j_out",
            symbolKey: "Connector_Generic:Conn_01x02",
            reference: "J1",
            value: "OUTPUT",
            placement: { x: 730, y: 180, rotationDeg: 0 },
        },
    ],
    junctions: [
        {
            id: "j_vin",
            x: 120,
            y: 80,
        },
        {
            id: "j_sw",
            x: 240,
            y: 80,
        },
        {
            id: "j_vout_a",
            x: 440,
            y: 80,
        },
        {
            id: "j_vout_b",
            x: 580,
            y: 80,
        },
        {
            id: "j_vout_c",
            x: 700,
            y: 80,
        },
        {
            id: "j_gnd_a",
            x: 160,
            y: 240,
        },
        {
            id: "j_gnd_b",
            x: 240,
            y: 240,
        },
        {
            id: "j_gnd_c",
            x: 440,
            y: 240,
        },
        {
            id: "j_gnd_d",
            x: 580,
            y: 240,
        },
        {
            id: "j_gnd_e",
            x: 700,
            y: 240,
        },
    ],
    wires: [
        {
            id: "w_vin_rail",
            netId: "net_vin",
            label: "VIN",
            from: { kind: "pin", componentId: "pwr_vcc", pinId: "1" },
            to: { kind: "junction", junctionId: "j_vin" },
            routePoints: [],
        },
        {
            id: "w_switch_in",
            netId: "net_vin",
            label: "VIN",
            from: { kind: "pin", componentId: "s1", pinId: "1" },
            to: { kind: "junction", junctionId: "j_vin" },
            routePoints: [],
        },
        {
            id: "w_cin_top",
            netId: "net_vin",
            label: "VIN",
            from: { kind: "pin", componentId: "c_in", pinId: "pin_1" },
            to: { kind: "junction", junctionId: "j_vin" },
            routePoints: [
                { x: 80, y: 80 },
            ],
        },
        {
            id: "w_switch_out",
            netId: "net_sw",
            label: "SW",
            from: { kind: "pin", componentId: "s1", pinId: "2" },
            to: { kind: "junction", junctionId: "j_sw" },
            routePoints: [],
        },
        {
            id: "w_l1_in",
            netId: "net_sw",
            label: "SW",
            from: { kind: "pin", componentId: "l1", pinId: "pin_1" },
            to: { kind: "junction", junctionId: "j_sw" },
            routePoints: [],
        },
        {
            id: "w_diode_top",
            netId: "net_sw",
            label: "SW",
            from: { kind: "pin", componentId: "d1", pinId: "1" },
            to: { kind: "junction", junctionId: "j_sw" },
            routePoints: [
                { x: 240, y: 120 },
            ],
        },
        {
            id: "w_l1_out",
            netId: "net_vout",
            label: "VOUT",
            from: { kind: "pin", componentId: "l1", pinId: "pin_2" },
            to: { kind: "junction", junctionId: "j_vout_a" },
            routePoints: [],
        },
        {
            id: "w_vout_bus_ab",
            netId: "net_vout",
            label: "VOUT",
            from: { kind: "junction", junctionId: "j_vout_a" },
            to: { kind: "junction", junctionId: "j_vout_b" },
            routePoints: [],
        },
        {
            id: "w_vout_bus_bc",
            netId: "net_vout",
            label: "VOUT",
            from: { kind: "junction", junctionId: "j_vout_b" },
            to: { kind: "junction", junctionId: "j_vout_c" },
            routePoints: [],
        },
        {
            id: "w_cout_top",
            netId: "net_vout",
            label: "VOUT",
            from: { kind: "pin", componentId: "c_out", pinId: "pin_1" },
            to: { kind: "junction", junctionId: "j_vout_a" },
            routePoints: [
                { x: 440, y: 120 },
            ],
        },
        {
            id: "w_rload_top",
            netId: "net_vout",
            label: "VOUT",
            from: { kind: "pin", componentId: "r_load", pinId: "pin_1" },
            to: { kind: "junction", junctionId: "j_vout_b" },
            routePoints: [
                { x: 580, y: 120 },
            ],
        },
        {
            id: "w_out_top",
            netId: "net_vout",
            label: "VOUT",
            from: { kind: "pin", componentId: "j_out", pinId: "1" },
            to: { kind: "junction", junctionId: "j_vout_c" },
            routePoints: [
                { x: 700, y: 80 },
            ],
        },
        {
            id: "w_gnd_symbol",
            netId: "net_gnd",
            label: "GND",
            from: { kind: "pin", componentId: "pwr_gnd", pinId: "1" },
            to: { kind: "junction", junctionId: "j_gnd_a" },
            routePoints: [],
        },
        {
            id: "w_gnd_bus_ab",
            netId: "net_gnd",
            label: "GND",
            from: { kind: "junction", junctionId: "j_gnd_a" },
            to: { kind: "junction", junctionId: "j_gnd_b" },
            routePoints: [],
        },
        {
            id: "w_gnd_bus_bc",
            netId: "net_gnd",
            label: "GND",
            from: { kind: "junction", junctionId: "j_gnd_b" },
            to: { kind: "junction", junctionId: "j_gnd_c" },
            routePoints: [],
        },
        {
            id: "w_gnd_bus_cd",
            netId: "net_gnd",
            label: "GND",
            from: { kind: "junction", junctionId: "j_gnd_c" },
            to: { kind: "junction", junctionId: "j_gnd_d" },
            routePoints: [],
        },
        {
            id: "w_gnd_bus_de",
            netId: "net_gnd",
            label: "GND",
            from: { kind: "junction", junctionId: "j_gnd_d" },
            to: { kind: "junction", junctionId: "j_gnd_e" },
            routePoints: [],
        },
        {
            id: "w_cin_bottom",
            netId: "net_gnd",
            label: "GND",
            from: { kind: "pin", componentId: "c_in", pinId: "pin_2" },
            to: { kind: "junction", junctionId: "j_gnd_a" },
            routePoints: [
                { x: 80, y: 240 },
            ],
        },
        {
            id: "w_diode_bottom",
            netId: "net_gnd",
            label: "GND",
            from: { kind: "pin", componentId: "d1", pinId: "2" },
            to: { kind: "junction", junctionId: "j_gnd_b" },
            routePoints: [
                { x: 240, y: 120 },
                { x: 240, y: 240 },
            ],
        },
        {
            id: "w_cout_bottom",
            netId: "net_gnd",
            label: "GND",
            from: { kind: "pin", componentId: "c_out", pinId: "pin_2" },
            to: { kind: "junction", junctionId: "j_gnd_c" },
            routePoints: [
                { x: 440, y: 240 },
            ],
        },
        {
            id: "w_rload_bottom",
            netId: "net_gnd",
            label: "GND",
            from: { kind: "pin", componentId: "r_load", pinId: "pin_2" },
            to: { kind: "junction", junctionId: "j_gnd_d" },
            routePoints: [
                { x: 580, y: 240 },
            ],
        },
        {
            id: "w_out_bottom",
            netId: "net_gnd",
            label: "GND",
            from: { kind: "pin", componentId: "j_out", pinId: "2" },
            to: { kind: "junction", junctionId: "j_gnd_e" },
            routePoints: [
                { x: 700, y: 240 },
            ],
        },
    ],
    selection: {
        componentIds: [],
        wireIds: [],
        junctionIds: [],
        scope: "both",
    },
    netSummary: [],
    issues: [],
};

const AI_PATCH_EXAMPLE = {
    schema: "aura.circuit_patch.v1",
    metadata: {
        title: "Add Output Sense Divider",
        description: "Preview-mode patch for the buck converter demo scene.",
        mode: "preview",
        requestedBy: "assistant",
    },
    target: {
        sceneSchema: "aura.scene_state.v1",
        sourceSchematicId: "studio-canvas",
        sourceRevision: 0,
    },
    operations: [
        {
            op: "add_component",
            component: {
                id: "r_fb_top",
                symbolKey: getPreferredSymbolKey("Device:R"),
                reference: "R4",
                value: "82k",
                placement: {
                    x: 640,
                    y: 180,
                    rotationDeg: 90,
                },
            },
        },
        {
            op: "add_component",
            component: {
                id: "r_fb_bottom",
                symbolKey: getPreferredSymbolKey("Device:R"),
                reference: "R5",
                value: "15k",
                placement: {
                    x: 640,
                    y: 270,
                    rotationDeg: 90,
                },
            },
        },
        {
            op: "add_wire",
            wire: {
                id: "w_fb_top_vout",
                netId: "net_vout",
                label: "VOUT",
                from: {
                    kind: "junction",
                    junctionId: "j_vout_c",
                },
                to: {
                    kind: "pin",
                    componentId: "r_fb_top",
                    pinId: "pin_1",
                },
                routePoints: [
                    { x: 640, y: 80 },
                    { x: 640, y: 140 },
                ],
            },
        },
        {
            op: "add_wire",
            wire: {
                id: "w_fb_mid",
                netId: "net_fb",
                label: "FB",
                from: {
                    kind: "pin",
                    componentId: "r_fb_top",
                    pinId: "pin_2",
                },
                to: {
                    kind: "pin",
                    componentId: "r_fb_bottom",
                    pinId: "pin_1",
                },
                routePoints: [],
            },
        },
        {
            op: "add_wire",
            wire: {
                id: "w_fb_gnd",
                netId: "net_gnd",
                label: "GND",
                from: {
                    kind: "pin",
                    componentId: "r_fb_bottom",
                    pinId: "pin_2",
                },
                to: {
                    kind: "junction",
                    junctionId: "j_gnd_e",
                },
                routePoints: [
                    { x: 640, y: 240 },
                ],
            },
        },
        {
            op: "set_selection",
            selection: {
                componentIds: ["r_fb_top", "r_fb_bottom"],
                wireIds: ["w_fb_top_vout", "w_fb_mid", "w_fb_gnd"],
                junctionIds: [],
                scope: "both",
            },
        },
    ],
};

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function splitSymbolKey(symbolKey) {
    const separatorIndex = String(symbolKey).indexOf(":");
    if (separatorIndex < 0) {
        return { libraryId: "", symbolId: String(symbolKey) };
    }
    return {
        libraryId: symbolKey.slice(0, separatorIndex),
        symbolId: symbolKey.slice(separatorIndex + 1),
    };
}

function getSelectionScopeLabel() {
    if (selectionScope === "components") {
        return "Parts";
    }
    if (selectionScope === "wires") {
        return "Wires";
    }
    return "Both";
}

function getActiveSelectionScope() {
    return selectionMode ? selectionScope : "both";
}

function getFieldValue(fields, key) {
    return fields?.find((field) => field.key === key)?.value ?? "";
}

async function apiGet(path) {
    const response = await fetch(`${API_BASE}${path}`);
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.message || `Request failed for ${path}`);
    }
    return data;
}

async function apiPost(path, body) {
    const response = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
        },
        body: JSON.stringify(body ?? {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data?.message || `Request failed for ${path}`);
    }
    return data;
}

async function apiPostWithTimeout(path, body, timeoutMs = 180000) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(`${API_BASE}${path}`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
            },
            body: JSON.stringify(body ?? {}),
            signal: controller.signal,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data?.message || `Request failed for ${path}`);
        }
        return data;
    } catch (error) {
        if (error?.name === "AbortError") {
            throw new Error("AI request timed out after 3 minutes. Try a smaller request or a faster model.");
        }
        throw error;
    } finally {
        window.clearTimeout(timeoutId);
    }
}

function getJsonImportElements() {
    return {
        modal: document.getElementById("json-import-modal"),
        input: document.getElementById("json-import-input"),
        status: document.getElementById("json-import-status"),
        trigger: document.getElementById("json-import-trigger"),
        close: document.getElementById("json-import-close"),
        cancel: document.getElementById("json-import-cancel"),
        clear: document.getElementById("json-import-clear"),
        example: document.getElementById("json-import-example"),
        apply: document.getElementById("json-import-apply"),
    };
}

function setJsonImportStatus(message, tone = "") {
    const { status } = getJsonImportElements();
    if (!status) {
        return;
    }
    status.textContent = message;
    status.classList.remove("is-error", "is-success");
    if (tone === "error") {
        status.classList.add("is-error");
    } else if (tone === "success") {
        status.classList.add("is-success");
    }
}

function openJsonImportModal() {
    const { modal, input } = getJsonImportElements();
    if (!modal) {
        return;
    }
    modal.hidden = false;
    setJsonImportStatus("Paste a schematic JSON payload, then apply it to the canvas.");
    input?.focus();
}

function closeJsonImportModal() {
    const { modal } = getJsonImportElements();
    if (modal) {
        modal.hidden = true;
    }
}

function getAiToolsElements() {
    return {
        chatToggle: document.getElementById("ai-chat-toggle"),
        canvasToggle: document.getElementById("ai-canvas-toggle"),
        chatPanel: document.getElementById("ai-chat-panel"),
        canvasPanel: document.getElementById("ai-canvas-panel"),
        chatClose: document.getElementById("ai-chat-close"),
        canvasClose: document.getElementById("ai-canvas-close"),
        chatSetupToggle: document.getElementById("ai-chat-setup-toggle"),
        chatSetupPanel: document.getElementById("ai-chat-setup-panel"),
        chatSetupClose: document.getElementById("ai-chat-setup-close"),
        canvasAdvancedToggle: document.getElementById("ai-canvas-advanced-toggle"),
        canvasAdvancedPanel: document.getElementById("ai-canvas-advanced-panel"),
        canvasAdvancedClose: document.getElementById("ai-canvas-advanced-close"),
        exportScene: document.getElementById("ai-tools-export-scene"),
        providerSelect: document.getElementById("ai-provider-select"),
        modelSelect: document.getElementById("ai-model-select"),
        geminiKeyField: document.getElementById("ai-gemini-key-field"),
        geminiKeyInput: document.getElementById("ai-gemini-key"),
        refreshModels: document.getElementById("ai-tools-refresh-models"),
        checkProvider: document.getElementById("ai-tools-check-provider"),
        providerStatus: document.getElementById("ai-provider-status"),
        runStatus: document.getElementById("ai-run-status"),
        generateCircuit: document.getElementById("ai-tools-generate-circuit"),
        sendRequest: document.getElementById("ai-tools-send-request"),
        sendChat: document.getElementById("ai-tools-send-chat"),
        clearChat: document.getElementById("ai-tools-clear-chat"),
        chatLog: document.getElementById("ai-chat-log"),
        chatRequest: document.getElementById("ai-chat-request"),
        chatStatus: document.getElementById("ai-chat-status"),
        chatConnectionSummary: document.getElementById("ai-chat-connection-summary"),
        canvasProviderSummary: document.getElementById("ai-canvas-provider-summary"),
        sceneOutput: document.getElementById("ai-scene-output"),
        responseOutput: document.getElementById("ai-response-output"),
        userRequest: document.getElementById("ai-user-request"),
        generatePrompt: document.getElementById("ai-tools-generate-prompt"),
        clearPrompt: document.getElementById("ai-tools-clear-prompt"),
        promptOutput: document.getElementById("ai-prompt-output"),
        patchInput: document.getElementById("ai-patch-input"),
        loadExample: document.getElementById("ai-tools-load-example"),
        clearPatch: document.getElementById("ai-tools-clear-patch"),
        clearPreview: document.getElementById("ai-tools-clear-preview"),
        preview: document.getElementById("ai-tools-preview"),
        apply: document.getElementById("ai-tools-apply"),
        status: document.getElementById("ai-tools-status"),
    };
}

function setAiToolsStatus(message, tone = "") {
    const { status } = getAiToolsElements();
    if (!status) {
        return;
    }
    status.textContent = message;
    status.classList.remove("is-error", "is-success");
    if (tone === "error") {
        status.classList.add("is-error");
    } else if (tone === "success") {
        status.classList.add("is-success");
    }
}

function clearAiPatchPreview() {
    aiPatchPreviewState = null;
    draw();
}

async function openAiToolsModal() {
    const { chatPanel, canvasPanel, sceneOutput } = getAiToolsElements();
    if (!chatPanel || !canvasPanel) {
        return;
    }
    chatPanel.hidden = false;
    canvasPanel.hidden = false;
    syncAiPanelVisibility();
    syncAiProviderFieldVisibility();
    renderAiModelOptions("ollama", getFallbackAiModels("ollama"), readStoredAiSetting(AI_PROVIDER_STORAGE_KEYS.model) || "gemma4:e2b");
    await ensureAiProviderUiDefaults().catch((error) => {
        console.error("Failed to load AI provider defaults:", error);
        setAiToolsStatus(error?.message || "Failed to load AI provider defaults.", "error");
    });
    renderAiChatLog();
    setAiToolsStatus("Canvas AI is ready. Ask for a change, then review the preview before applying.");
    setAiChatStatus("Ready.");
    if (sceneOutput) {
        sceneOutput.value = JSON.stringify(exportSceneState(), null, 2);
    }
    getAiToolsElements().chatRequest?.focus();
}

function closeAiToolsModal() {
    closeAiPanel("chat");
    closeAiPanel("canvas");
    clearAiPatchPreview();
}

function syncAiPanelVisibility() {
    const { chatPanel, canvasPanel, chatToggle, canvasToggle, chatSetupPanel, chatSetupToggle, canvasAdvancedPanel, canvasAdvancedToggle } = getAiToolsElements();
    if (chatToggle) {
        const isOpen = !!chatPanel && !chatPanel.hidden;
        chatToggle.classList.toggle("active", isOpen);
        chatToggle.setAttribute("aria-pressed", isOpen ? "true" : "false");
    }
    if (canvasToggle) {
        const isOpen = !!canvasPanel && !canvasPanel.hidden;
        canvasToggle.classList.toggle("active", isOpen);
        canvasToggle.setAttribute("aria-pressed", isOpen ? "true" : "false");
    }
    if (chatSetupToggle) {
        const isOpen = !!chatSetupPanel && !chatSetupPanel.hidden;
        chatSetupToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
        chatSetupToggle.classList.toggle("active", isOpen);
    }
    if (canvasAdvancedToggle) {
        const isOpen = !!canvasAdvancedPanel && !canvasAdvancedPanel.hidden;
        canvasAdvancedToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
        canvasAdvancedToggle.classList.toggle("active", isOpen);
    }
}

function openAiPanel(kind) {
    const { chatPanel, canvasPanel, chatRequest, userRequest, sceneOutput } = getAiToolsElements();
    const panel = kind === "chat" ? chatPanel : canvasPanel;
    if (!panel) {
        return;
    }
    panel.hidden = false;
    syncAiPanelVisibility();
    if (sceneOutput && kind === "canvas") {
        sceneOutput.value = JSON.stringify(exportSceneState(), null, 2);
    }
    if (kind === "chat") {
        chatRequest?.focus();
    } else {
        userRequest?.focus();
    }
}

function closeAiPanel(kind) {
    const { chatPanel, canvasPanel } = getAiToolsElements();
    const panel = kind === "chat" ? chatPanel : canvasPanel;
    if (!panel) {
        return;
    }
    panel.hidden = true;
    if (kind === "chat") {
        closeAiPopover("chatSetup");
    } else {
        closeAiPopover("canvasAdvanced");
    }
    syncAiPanelVisibility();
}

function toggleAiPanel(kind) {
    const { chatPanel, canvasPanel } = getAiToolsElements();
    const panel = kind === "chat" ? chatPanel : canvasPanel;
    if (!panel) {
        return;
    }
    if (panel.hidden) {
        openAiPanel(kind);
    } else {
        closeAiPanel(kind);
    }
}

function openAiPopover(kind) {
    const { chatSetupPanel, canvasAdvancedPanel } = getAiToolsElements();
    const popover = kind === "chatSetup" ? chatSetupPanel : canvasAdvancedPanel;
    if (!popover) {
        return;
    }
    popover.hidden = false;
    syncAiPanelVisibility();
}

function closeAiPopover(kind) {
    const { chatSetupPanel, canvasAdvancedPanel } = getAiToolsElements();
    const popover = kind === "chatSetup" ? chatSetupPanel : canvasAdvancedPanel;
    if (!popover) {
        return;
    }
    popover.hidden = true;
    syncAiPanelVisibility();
}

function toggleAiPopover(kind) {
    const { chatSetupPanel, canvasAdvancedPanel } = getAiToolsElements();
    const popover = kind === "chatSetup" ? chatSetupPanel : canvasAdvancedPanel;
    if (!popover) {
        return;
    }
    if (popover.hidden) {
        openAiPopover(kind);
    } else {
        closeAiPopover(kind);
    }
}

const AI_PROVIDER_STORAGE_KEYS = {
    provider: "aura.ai.provider",
    model: "aura.ai.model",
    geminiKey: "aura.ai.geminiKey",
};
let aiProviderModelCache = {
    ollama: [],
    gemini: [],
};

function readStoredAiSetting(key) {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeStoredAiSetting(key, value) {
    try {
        if (value == null || value === "") {
            window.localStorage.removeItem(key);
        } else {
            window.localStorage.setItem(key, value);
        }
    } catch {
        // Ignore localStorage failures in the browser shell.
    }
}

function getAiDefaultModelForProvider(provider) {
    if (provider === "gemini") {
        return aiProviderDefaults?.defaults?.geminiModel || "gemini-2.5-flash";
    }
    return aiProviderDefaults?.defaults?.ollamaModel || "gemma4:e2b";
}

function getFallbackAiModels(provider) {
    if (provider === "gemini") {
        return [
            { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
            { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
            { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
        ];
    }
    return [
        { id: "gemma4:e2b", label: "gemma4:e2b" },
    ];
}

function renderAiChatLog() {
    const { chatLog } = getAiToolsElements();
    if (!chatLog) {
        return;
    }
    if (!aiConversation.length) {
        chatLog.innerHTML = `<div class="empty-state">No built-in AI conversation yet.</div>`;
        return;
    }
    chatLog.innerHTML = aiConversation.map((entry) => `
        <div class="ai-chat-entry" data-role="${escapeHtml(entry.role)}">
            <div class="ai-chat-role">${escapeHtml(entry.role === "assistant" ? "Assistant" : "User")}</div>
            <div class="ai-chat-message">${escapeHtml(entry.content)}</div>
        </div>
    `).join("");
    chatLog.scrollTop = chatLog.scrollHeight;
}

function syncAiProviderFieldVisibility() {
    const { providerSelect, geminiKeyField, modelSelect, canvasProviderSummary, chatConnectionSummary } = getAiToolsElements();
    const provider = providerSelect?.value || "ollama";
    const model = String(modelSelect?.value ?? "").trim() || getAiDefaultModelForProvider(provider);
    if (geminiKeyField) {
        geminiKeyField.hidden = provider !== "gemini";
    }
    if (modelSelect) {
        modelSelect.disabled = false;
    }
    if (chatConnectionSummary) {
        chatConnectionSummary.textContent = `Using ${provider} - ${model}`;
    }
    if (canvasProviderSummary) {
        canvasProviderSummary.textContent = `Using ${provider} - ${model}`;
    }
}

async function loadAiProviderDefaults() {
    if (aiProviderDefaults) {
        return aiProviderDefaults;
    }
    aiProviderDefaults = await apiGet("/ai/providers");
    return aiProviderDefaults;
}

async function loadAiModelsForProvider(provider, { force = false } = {}) {
    const normalizedProvider = provider === "gemini" ? "gemini" : "ollama";
    if (!force && aiProviderModelCache[normalizedProvider]?.length) {
        return aiProviderModelCache[normalizedProvider];
    }
    const { geminiKeyInput } = getAiToolsElements();
    const query = new URLSearchParams({ provider: normalizedProvider });
    if (normalizedProvider === "gemini") {
        const apiKey = String(geminiKeyInput?.value ?? "").trim();
        if (apiKey) {
            query.set("apiKey", apiKey);
        }
    }
    const result = await apiGet(`/ai/models?${query.toString()}`);
    aiProviderModelCache[normalizedProvider] = result.models ?? [];
    return aiProviderModelCache[normalizedProvider];
}

function renderAiModelOptions(provider, models, preferredModel = "") {
    const { modelSelect } = getAiToolsElements();
    if (!modelSelect) {
        return;
    }
    const fallbackModel = preferredModel || getAiDefaultModelForProvider(provider);
    const safeModels = Array.isArray(models) && models.length
        ? models
        : [{ id: fallbackModel, label: fallbackModel }];
    modelSelect.innerHTML = safeModels.map((model) => `
        <option value="${escapeHtml(model.id)}">${escapeHtml(model.label || model.id)}</option>
    `).join("");
    const targetValue = safeModels.some((model) => model.id === preferredModel)
        ? preferredModel
        : (safeModels.some((model) => model.id === fallbackModel) ? fallbackModel : safeModels[0].id);
    modelSelect.value = targetValue;
}

function setAiProviderStatus(message, tone = "") {
    const { providerStatus } = getAiToolsElements();
    if (!providerStatus) {
        return;
    }
    providerStatus.textContent = message;
    providerStatus.classList.remove("is-ready", "is-error");
    if (tone === "ready") {
        providerStatus.classList.add("is-ready");
    } else if (tone === "error") {
        providerStatus.classList.add("is-error");
    }
}

function setAiRunStatus(message, tone = "") {
    const { runStatus } = getAiToolsElements();
    if (!runStatus) {
        return;
    }
    runStatus.textContent = message;
    runStatus.classList.remove("is-busy", "is-success", "is-error");
    if (tone === "busy") {
        runStatus.classList.add("is-busy");
    } else if (tone === "success") {
        runStatus.classList.add("is-success");
    } else if (tone === "error") {
        runStatus.classList.add("is-error");
    }
}

function setAiChatStatus(message, tone = "") {
    const { chatStatus } = getAiToolsElements();
    if (!chatStatus) {
        return;
    }
    chatStatus.textContent = message;
    chatStatus.classList.remove("is-busy", "is-success", "is-error");
    if (tone === "busy") {
        chatStatus.classList.add("is-busy");
    } else if (tone === "success") {
        chatStatus.classList.add("is-success");
    } else if (tone === "error") {
        chatStatus.classList.add("is-error");
    }
}

function setAiControlsBusy(isBusy) {
    aiRequestInFlight = !!isBusy;
    const {
        sendRequest,
        generateCircuit,
        sendChat,
        refreshModels,
        checkProvider,
        preview,
        apply,
    } = getAiToolsElements();
    [sendRequest, generateCircuit, sendChat, refreshModels, checkProvider, preview, apply].forEach((button) => {
        if (button) {
            button.disabled = aiRequestInFlight;
        }
    });
    if (generateCircuit) {
        generateCircuit.textContent = aiRequestInFlight ? "Thinking..." : "Generate Circuit";
    }
    if (sendRequest) {
        sendRequest.textContent = aiRequestInFlight ? "Thinking..." : "Preview Change";
    }
    if (sendChat) {
        sendChat.textContent = aiRequestInFlight ? "Thinking..." : "Send";
    }
}

function summarizeAiMessage(message, fallback = "") {
    const text = String(message ?? "").trim() || fallback;
    if (text.length <= 140) {
        return text;
    }
    return `${text.slice(0, 137)}...`;
}

function formatAiDetails(result, mode) {
    const metadata = result?.providerMetadata ?? {};
    const detail = {
        mode,
        provider: result?.provider || "",
        model: result?.model || "",
        hasPatch: Boolean(result?.patch),
        hasLayoutIntent: Boolean(result?.layoutIntent),
        hasIntent: Boolean(result?.intent),
        hasCircuitIr: Boolean(result?.circuitIr),
        assistantMessage: String(result?.assistantMessage || ""),
        warning: String(result?.warning || ""),
        rawText: String(result?.rawText || ""),
        providerMetadata: metadata,
    };
    return JSON.stringify(detail, null, 2);
}

function setAiResponseOutput(value) {
    const { responseOutput } = getAiToolsElements();
    if (responseOutput) {
        responseOutput.value = String(value ?? "");
    }
}

async function refreshGeminiModelsFromCurrentKey() {
    const { providerSelect, geminiKeyInput, modelSelect } = getAiToolsElements();
    const provider = providerSelect?.value || "ollama";
    writeStoredAiSetting(AI_PROVIDER_STORAGE_KEYS.geminiKey, geminiKeyInput?.value.trim() || "");
    if (provider !== "gemini") {
        return;
    }
    const models = await loadAiModelsForProvider("gemini", { force: true }).catch(() => getFallbackAiModels("gemini"));
    renderAiModelOptions("gemini", models, modelSelect?.value || getAiDefaultModelForProvider("gemini"));
    writeStoredAiSetting(AI_PROVIDER_STORAGE_KEYS.model, modelSelect?.value || "");
    syncAiProviderFieldVisibility();
    checkSelectedAiProviderStatus().catch((error) => {
        setAiProviderStatus(error?.message || "AI status check failed.", "error");
    });
}

async function checkSelectedAiProviderStatus() {
    const { providerSelect, modelSelect, geminiKeyInput } = getAiToolsElements();
    const provider = providerSelect?.value || "ollama";
    const model = modelSelect?.value || getAiDefaultModelForProvider(provider);
    const query = new URLSearchParams({ provider, model });
    if (provider === "gemini") {
        const apiKey = String(geminiKeyInput?.value ?? "").trim();
        if (apiKey) {
            query.set("apiKey", apiKey);
        }
    }

    setAiProviderStatus(`Checking ${provider}...`);
    const result = await apiGet(`/ai/status?${query.toString()}`);
    setAiProviderStatus(result.message || `${provider} status checked.`, result.ready ? "ready" : "error");
    return result;
}

async function ensureAiProviderUiDefaults() {
    await loadAiProviderDefaults().catch(() => {
        aiProviderDefaults = {
            defaults: {
                provider: "ollama",
                ollamaModel: "gemma4:e2b",
                geminiModel: "gemini-2.5-flash",
            },
        };
    });
    const { providerSelect, modelSelect, geminiKeyInput } = getAiToolsElements();
    if (providerSelect) {
        providerSelect.value = readStoredAiSetting(AI_PROVIDER_STORAGE_KEYS.provider)
            || aiProviderDefaults?.defaults?.provider
            || "ollama";
    }
    if (geminiKeyInput && !geminiKeyInput.value) {
        geminiKeyInput.value = readStoredAiSetting(AI_PROVIDER_STORAGE_KEYS.geminiKey) || "";
    }
    const provider = providerSelect?.value || "ollama";
    const preferredModel = readStoredAiSetting(AI_PROVIDER_STORAGE_KEYS.model)
        || getAiDefaultModelForProvider(provider);
    const models = await loadAiModelsForProvider(provider).catch(() => getFallbackAiModels(provider));
    renderAiModelOptions(provider, models, preferredModel);
    if (modelSelect) {
        writeStoredAiSetting(AI_PROVIDER_STORAGE_KEYS.model, modelSelect.value);
    }
    syncAiProviderFieldVisibility();
    checkSelectedAiProviderStatus().catch((error) => {
        setAiProviderStatus(error?.message || "AI status check failed.", "error");
    });
}

function pickPrimaryUnitId(definition) {
    const scoreByUnit = new Map();
    const units = definition?.body?.units ?? [];
    for (const unit of units) {
        scoreByUnit.set(unit.id, 0);
    }
    const pinCountByUnit = new Map();
    for (const pin of definition?.pins ?? []) {
        const weight = pin.electricalType === "power_in" ? 1 : 4;
        scoreByUnit.set(pin.unitId, (scoreByUnit.get(pin.unitId) ?? 0) + weight);
        pinCountByUnit.set(pin.unitId, (pinCountByUnit.get(pin.unitId) ?? 0) + 1);
    }
    for (const graphic of definition?.body?.graphics ?? []) {
        scoreByUnit.set(graphic.unitId, (scoreByUnit.get(graphic.unitId) ?? 0) + 2);
    }

    const unitEntries = units.map((unit) => ({
        id: unit.id,
        score: scoreByUnit.get(unit.id) ?? 0,
        pinCount: pinCountByUnit.get(unit.id) ?? 0,
    }));

    const pinnedUnits = unitEntries.filter((unit) => unit.pinCount > 0);
    const candidates = pinnedUnits.length ? pinnedUnits : unitEntries;

    return candidates
        .sort((left, right) => (right.score - left.score) || (right.pinCount - left.pinCount))
        [0]?.id ?? units[0]?.id ?? null;
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

function getUnitGraphics(definition, unitId) {
    return (definition?.body?.graphics ?? []).filter((graphic) =>
        graphic.unitId === unitId || isCommonUnitForActiveUnit(graphic.unitId, unitId),
    );
}

function getUnitPins(definition, unitId) {
    return (definition?.pins ?? []).filter((pin) => pin.unitId === unitId);
}

function includePointInBounds(bounds, x, y) {
    bounds.minX = Math.min(bounds.minX, x);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxY = Math.max(bounds.maxY, y);
}

function getFieldDisplayText(field, comp, def) {
    if (!field) {
        return "";
    }

    if (field.key === "Reference") {
        return comp?.refdes
            || field.value
            || def?.referencePrefix
            || def?.sourceSymbol
            || "U";
    }

    if (field.key === "Value") {
        return comp?.properties?.netLabel
            || comp?.properties?.value
            || field.value
            || def?.sourceSymbol
            || def?.label
            || "";
    }

    return field.value || "";
}

function getCanvasComponentLabels(comp, def) {
    const referenceText = String(comp?.refdes || "").trim();
    const valueText = String(
        comp?.properties?.netLabel
        || comp?.properties?.value
        || getFieldValue(def?.fields, "Value")
        || "",
    ).trim();
    const sourceSymbol = String(def?.sourceSymbol || "").trim();
    const normalizedValue = valueText.toLowerCase();
    const normalizedSource = sourceSymbol.toLowerCase();
    const hideReference = referenceText.startsWith("#PWR");
    const hideValue = !valueText
        || normalizedValue === normalizedSource
        || normalizedValue === "r_us"
        || normalizedValue === "r"
        || normalizedValue === "c"
        || normalizedValue === "d";

    return {
        reference: hideReference ? "" : referenceText,
        value: hideValue ? "" : valueText,
    };
}

function computeSymbolBounds(graphics, pins, fields = [], def = null) {
    const bounds = {
        minX: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
    };

    for (const graphic of graphics) {
        if (graphic.kind === "rectangle") {
            includePointInBounds(bounds, graphic.x1, graphic.y1);
            includePointInBounds(bounds, graphic.x2, graphic.y2);
        } else if (graphic.kind === "polyline") {
            for (const point of graphic.points ?? []) {
                includePointInBounds(bounds, point.x, point.y);
            }
        } else if (graphic.kind === "circle") {
            includePointInBounds(bounds, graphic.cx - graphic.radius, graphic.cy - graphic.radius);
            includePointInBounds(bounds, graphic.cx + graphic.radius, graphic.cy + graphic.radius);
        } else if (graphic.kind === "arc") {
            includePointInBounds(bounds, graphic.x1, graphic.y1);
            includePointInBounds(bounds, graphic.x2, graphic.y2);
            includePointInBounds(bounds, graphic.cx, graphic.cy);
        } else if (graphic.kind === "text") {
            includePointInBounds(bounds, graphic.x1 - graphic.fontSize, graphic.y1 - graphic.fontSize);
            includePointInBounds(bounds, graphic.x1 + graphic.fontSize, graphic.y1 + graphic.fontSize);
        }
    }

    for (const pin of pins) {
        includePointInBounds(bounds, pin.x, pin.y);
        includePointInBounds(bounds, pin.innerX, pin.innerY);
    }

    for (const field of fields) {
        if (field.visible === false) {
            continue;
        }
        const text = getFieldDisplayText(field, null, def);
        if (!text) {
            continue;
        }
        const fontSize = Number.isFinite(field.fontSize) ? field.fontSize : 0.7;
        const halfWidth = Math.max(fontSize * 0.5, text.length * fontSize * 0.32);
        const halfHeight = Math.max(fontSize * 0.65, 0.45);
        includePointInBounds(bounds, field.x - halfWidth, field.y - halfHeight);
        includePointInBounds(bounds, field.x + halfWidth, field.y + halfHeight);
    }

    if (!Number.isFinite(bounds.minX)) {
        return { minX: -200, maxX: 200, minY: -150, maxY: 150, width: 400, height: 300 };
    }

    return {
        ...bounds,
        width: bounds.maxX - bounds.minX,
        height: bounds.maxY - bounds.minY,
    };
}

function scaleValue(value) {
    return Number((Number(value) * SYMBOL_UNIT_SCALE).toFixed(3));
}

function scaleGraphic(graphic) {
    if (graphic.kind === "rectangle") {
        return { ...graphic, x1: scaleValue(graphic.x1), y1: scaleValue(graphic.y1), x2: scaleValue(graphic.x2), y2: scaleValue(graphic.y2) };
    }
    if (graphic.kind === "polyline") {
        return { ...graphic, points: (graphic.points ?? []).map((point) => ({ x: scaleValue(point.x), y: scaleValue(point.y) })) };
    }
    if (graphic.kind === "circle") {
        return { ...graphic, cx: scaleValue(graphic.cx), cy: scaleValue(graphic.cy), radius: scaleValue(graphic.radius) };
    }
    if (graphic.kind === "arc") {
        return {
            ...graphic,
            x1: scaleValue(graphic.x1),
            y1: scaleValue(graphic.y1),
            x2: scaleValue(graphic.x2),
            y2: scaleValue(graphic.y2),
            cx: scaleValue(graphic.cx),
            cy: scaleValue(graphic.cy),
        };
    }
    if (graphic.kind === "text") {
        return {
            ...graphic,
            x1: scaleValue(graphic.x1),
            y1: scaleValue(graphic.y1),
            fontSize: scaleValue(graphic.fontSize),
        };
    }
    return graphic;
}

function scalePin(pin) {
    return {
        ...pin,
        x: scaleValue(pin.x),
        y: scaleValue(pin.y),
        innerX: scaleValue(pin.innerX),
        innerY: scaleValue(pin.innerY),
        length: scaleValue(pin.length),
    };
}

function scaleField(field) {
    return {
        ...field,
        x: Number.isFinite(Number(field.x)) ? scaleValue(field.x) : 0,
        y: Number.isFinite(Number(field.y)) ? scaleValue(field.y) : 0,
        fontSize: Number.isFinite(Number(field.fontSize)) ? scaleValue(field.fontSize) : scaleValue(50),
    };
}

function createComponentDef(summary, definition) {
    const activeUnitId = pickPrimaryUnitId(definition);
    const graphics = getUnitGraphics(definition, activeUnitId).map(scaleGraphic);
    const pins = getUnitPins(definition, activeUnitId).map(scalePin).map((pin) => ({
        ...pin,
        label: pin.name && pin.name !== "~" ? `${pin.number} ${pin.name}` : pin.number,
        uX: pin.x,
        uY: -pin.y,
        wireUX: pin.innerX,
        wireUY: -pin.innerY,
    }));
    const fields = (definition.fields ?? []).map(scaleField);
    const bodyBounds = computeSymbolBounds(graphics, []);
    const hitBounds = computeSymbolBounds(graphics, pins);
    const bounds = computeSymbolBounds(graphics, pins, fields, {
        referencePrefix: definition.metadata.defaultReferencePrefix || summary.reference || "U",
        sourceSymbol: summary.sourceSymbol,
        label: summary.name,
    });
    return {
        type: definition.metadata.symbolKey,
        label: summary.name,
        category: summary.sourceLibrary,
        description: summary.description || definition.metadata.description || "",
        referencePrefix: definition.metadata.defaultReferencePrefix || summary.reference || "U",
        sourceLibrary: summary.sourceLibrary,
        sourceSymbol: summary.sourceSymbol,
        symbolKey: definition.metadata.symbolKey,
        activeUnitId,
        views: { breadboard: definition.metadata.symbolKey },
        fields,
        graphics,
        pins,
        bodyBounds,
        hitBounds,
        bounds,
        schematicDefinition: definition,
    };
}

async function ensureComponentDef(summary) {
    const symbolKey = summary.id;
    if (COMPONENT_DEFS[symbolKey]?.schematicDefinition) {
        return COMPONENT_DEFS[symbolKey];
    }

    if (!symbolDefinitionCache.has(symbolKey)) {
        symbolDefinitionCache.set(symbolKey, apiGet(`/symbol-sources/kicad/libraries/${encodeURIComponent(summary.sourceLibrary)}/symbols/${encodeURIComponent(summary.sourceSymbol)}/definition`));
    }

    const result = await symbolDefinitionCache.get(symbolKey);
    const def = createComponentDef(summary, result.definition);
    COMPONENT_DEFS[symbolKey] = def;
    return def;
}

async function ensureComponentDefByKey(symbolKey) {
    if (COMPONENT_DEFS[symbolKey]?.schematicDefinition) {
        return COMPONENT_DEFS[symbolKey];
    }

    let summary = currentLibrarySymbols.find((symbol) => symbol.id === symbolKey) ?? null;
    if (!summary) {
        const { libraryId } = splitSymbolKey(symbolKey);
        if (libraryId) {
            const libraryData = await fetchLibraryData(libraryId);
            summary = libraryData?.symbols?.find((symbol) => symbol.id === symbolKey) ?? null;
        }
    }

    return summary ? ensureComponentDef(summary) : null;
}

function graphicStrokeWidth(graphic) {
    return Math.max(0.05, graphic.strokeWidth * SYMBOL_UNIT_SCALE * 0.8);
}

function svgPathForArc(graphic) {
    const x1 = graphic.x1;
    const y1 = graphic.y1;
    const x2 = graphic.x2;
    const y2 = graphic.y2;
    const x3 = graphic.cx;
    const y3 = graphic.cy;

    const determinant = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));
    if (Math.abs(determinant) < 0.01) {
        return `M ${x1} ${y1} Q ${x2} ${y2} ${x3} ${y3}`;
    }

    const ux = ((x1 * x1 + y1 * y1) * (y2 - y3) + (x2 * x2 + y2 * y2) * (y3 - y1) + (x3 * x3 + y3 * y3) * (y1 - y2)) / determinant;
    const uy = ((x1 * x1 + y1 * y1) * (x3 - x2) + (x2 * x2 + y2 * y2) * (x1 - x3) + (x3 * x3 + y3 * y3) * (x2 - x1)) / determinant;
    const radius = Math.hypot(x1 - ux, y1 - uy);
    const cross = (x2 - x1) * (y3 - y2) - (y2 - y1) * (x3 - x2);
    const sweepFlag = cross < 0 ? 0 : 1;
    return `M ${x1} ${y1} A ${radius} ${radius} 0 0 ${sweepFlag} ${x3} ${y3}`;
}

function createSymbolPreviewSvg(def) {
    if (!def) {
        return "";
    }

    const bounds = def.bounds;
    const padding = 1.2;
    const viewBoxX = bounds.minX - padding;
    const viewBoxY = bounds.minY - padding;
    const viewBoxWidth = bounds.width + padding * 2;
    const viewBoxHeight = bounds.height + padding * 2;

    const graphicsMarkup = def.graphics.map((graphic) => {
        if (graphic.kind === "rectangle") {
            const x = Math.min(graphic.x1, graphic.x2);
            const y = Math.min(graphic.y1, graphic.y2);
            const width = Math.abs(graphic.x2 - graphic.x1);
            const height = Math.abs(graphic.y2 - graphic.y1);
            return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="none" stroke="#111111" stroke-width="${graphicStrokeWidth(graphic)}" />`;
        }
        if (graphic.kind === "polyline") {
            const points = (graphic.points ?? []).map((point) => `${point.x},${point.y}`).join(" ");
            return `<polyline points="${points}" fill="none" stroke="#111111" stroke-width="${graphicStrokeWidth(graphic)}" stroke-linecap="square" stroke-linejoin="miter" />`;
        }
        if (graphic.kind === "circle") {
            return `<circle cx="${graphic.cx}" cy="${graphic.cy}" r="${graphic.radius}" fill="none" stroke="#111111" stroke-width="${graphicStrokeWidth(graphic)}" />`;
        }
        if (graphic.kind === "arc") {
            const path = svgPathForArc(graphic);
            return `<path d="${path}" fill="none" stroke="#111111" stroke-width="${graphicStrokeWidth(graphic)}" stroke-linecap="square" />`;
        }
        if (graphic.kind === "text") {
            return `<text x="${graphic.x1}" y="${graphic.y1}" fill="#111111" font-size="${Math.max(0.24, graphic.fontSize * 0.7)}" font-family="IBM Plex Sans, Segoe UI, sans-serif">${escapeHtml(graphic.text)}</text>`;
        }
        return "";
    }).join("");

    const pinMarkup = def.pins.map((pin) => `
        <g>
            <line x1="${pin.x}" y1="${pin.y}" x2="${pin.innerX}" y2="${pin.innerY}" stroke="#111111" stroke-width="0.1" stroke-linecap="square" />
        </g>
    `).join("");

    const fieldMarkup = (def.fields ?? []).map((field) => {
        if (field.visible === false) {
            return "";
        }
        const text = getFieldDisplayText(field, null, def);
        if (!text) {
            return "";
        }
        return `<text x="${field.x}" y="${field.y}" fill="#111111" font-size="${Math.max(0.24, (field.fontSize || 0.7) * 0.8)}" font-family="IBM Plex Sans, Segoe UI, sans-serif" text-anchor="middle" dominant-baseline="middle">${escapeHtml(text)}</text>`;
    }).join("");

    return `
        <svg viewBox="${viewBoxX} ${viewBoxY} ${viewBoxWidth} ${viewBoxHeight}" xmlns="http://www.w3.org/2000/svg" aria-label="${escapeHtml(def.label)} preview">
            <rect x="${viewBoxX}" y="${viewBoxY}" width="${viewBoxWidth}" height="${viewBoxHeight}" fill="#ffffff" />
            ${graphicsMarkup}
            ${pinMarkup}
            ${fieldMarkup}
        </svg>
    `;
}

function updateShellStatus() {
    const apiChip = document.getElementById("api-state-chip");
    const kicadChip = document.getElementById("kicad-state-chip");
    const libraryCountValue = document.getElementById("library-count-value");
    const symbolCountValue = document.getElementById("symbol-count-value");
    const currentLibraryLabel = document.getElementById("current-library-label");
    const libraryFooter = document.getElementById("library-footer");
    const symbolFooter = document.getElementById("symbol-footer");
    const selectionFooter = document.getElementById("selection-footer");
    const selectedSymbolName = document.getElementById("selected-symbol-name");
    const selectedSymbolDescription = document.getElementById("selected-symbol-description");
    const selectedSymbolPreview = document.getElementById("selected-symbol-preview");
    const stageModeLabel = document.getElementById("stage-mode-label");

    if (apiChip) {
        apiChip.textContent = backendOnline ? "API online" : "API offline";
        apiChip.style.color = backendOnline ? "var(--accent-green)" : "var(--accent-red)";
    }
    if (kicadChip) {
        const libraryCount = kicadLibraries.length;
        kicadChip.textContent = backendOnline ? `KiCad source ${libraryCount} libraries` : "KiCad source unavailable";
        kicadChip.style.color = backendOnline ? "var(--accent-cyan)" : "var(--accent-red)";
    }
    if (libraryCountValue) {
        libraryCountValue.textContent = String(kicadLibraries.length);
    }
    if (symbolCountValue) {
        symbolCountValue.textContent = String(currentLibrarySymbols.length);
    }
    if (currentLibraryLabel) {
        currentLibraryLabel.textContent = currentLibrary?.name ?? "None";
    }
    if (libraryFooter) {
        libraryFooter.textContent = currentLibrary?.name ?? "None";
    }
    if (symbolFooter) {
        symbolFooter.textContent = selectedSymbolSummary?.name ?? "None";
    }
    if (selectionFooter) {
        selectionFooter.textContent = selectedComponent
            ? selectedComponent.refdes
            : selectedWireIds.length > 1
                ? `${selectedWireIds.length} wires`
                : selectedWireId
                    ? String(selectedWireId).toUpperCase()
                    : selectedJunctionId
                        ? String(selectedJunctionId)
                        : "None";
    }
    if (selectedSymbolName) {
        selectedSymbolName.textContent = selectedSymbolSummary?.name ?? "No symbol selected";
    }
    if (selectedSymbolDescription) {
        selectedSymbolDescription.textContent = selectedSymbolSummary?.description || "Pick a library entry to inspect its preview and fields.";
    }
    if (selectedSymbolPreview) {
        if (selectedSymbolDefinition) {
            selectedSymbolPreview.classList.remove("empty");
            selectedSymbolPreview.innerHTML = createSymbolPreviewSvg(selectedSymbolDefinition);
        } else {
            selectedSymbolPreview.classList.add("empty");
            selectedSymbolPreview.textContent = backendOnline ? "Choose a symbol" : "Backend offline";
        }
    }
    syncSymbolPreviewPanels();
    if (stageModeLabel) {
        if (pendingWireTurnCrossingDecision) {
            stageModeLabel.textContent = "Wire crossing detected. Press J to jump, C to connect, Esc to cancel.";
        } else if (placingComponent) {
            stageModeLabel.textContent = `Placing ${placingComponent.refdes}. Click to place, Esc to stop.`;
        } else if (currentTool === "wire" && activeWire?.from) {
            const startEndpoint = resolveWireEndpoint(activeWire.from);
            const pinLabel = startEndpoint?.kind === "pin"
                ? `${startEndpoint.comp?.refdes || "?"}:${startEndpoint.pin?.number || startEndpoint.pinId || "?"}`
                : startEndpoint?.junctionId || "?";
            stageModeLabel.textContent = `Routing ${pinLabel}. Click stage to add bends, drag to pan, click a pin or junction to finish, Esc to stop.`;
        } else {
            stageModeLabel.textContent = currentTool === "wire"
                ? "Wire"
                : selectionMode
                    ? `Select ${getSelectionScopeLabel()} active. Drag anywhere to box-select.${selectionScope === "both" ? " Repeat click on overlaps to cycle part and wire." : ""} Turn SEL off to pan with left drag.`
                    : "Select. Drag empty stage to pan. Turn SEL on for marquee select, or hold Shift to box-select once.";
        }
    }
}

function disconnectSymbolPreviewObserver() {
    if (symbolPreviewObserver) {
        symbolPreviewObserver.disconnect();
        symbolPreviewObserver = null;
    }
}

async function populateSymbolTilePreview(placeholder) {
    const symbolId = placeholder?.getAttribute("data-symbol-id");
    if (!symbolId || placeholder.dataset.previewLoaded === "true") {
        return;
    }

    if (symbolPreviewPending.has(symbolId)) {
        await symbolPreviewPending.get(symbolId);
        return;
    }

    placeholder.classList.add("is-loading");
    const pending = (async () => {
        try {
            const def = await ensureComponentDefByKey(symbolId);
            if (!def || !placeholder.isConnected) {
                return;
            }
            placeholder.innerHTML = createSymbolPreviewSvg(def);
            placeholder.dataset.previewLoaded = "true";
        } catch (error) {
            console.error(`Preview load failed for ${symbolId}:`, error);
            if (placeholder.isConnected) {
                placeholder.innerHTML = `<div class="empty-state" style="padding: 6px;">!</div>`;
                placeholder.dataset.previewLoaded = "error";
            }
        } finally {
            placeholder.classList.remove("is-loading");
            symbolPreviewPending.delete(symbolId);
        }
    })();

    symbolPreviewPending.set(symbolId, pending);
    await pending;
}

function setupSymbolPreviewObserver(root) {
    disconnectSymbolPreviewObserver();
    if (!root) {
        return;
    }

    symbolPreviewObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) {
                continue;
            }
            const placeholder = entry.target;
            symbolPreviewObserver.unobserve(placeholder);
            populateSymbolTilePreview(placeholder);
        }
    }, {
        root,
        rootMargin: "120px",
        threshold: 0.05,
    });

    root.querySelectorAll(".symbol-tile-preview[data-symbol-id]").forEach((placeholder) => {
        symbolPreviewObserver.observe(placeholder);
    });
}

function libraryIsInSelectedGroup(library) {
    const group = LIBRARY_GROUPS[selectedLibraryGroup] ?? LIBRARY_GROUPS.common;
    if (!group.libraries.length) {
        return true;
    }
    return group.libraries.includes(library.id);
}

function compareLibrariesByGroup(left, right) {
    const group = LIBRARY_GROUPS[selectedLibraryGroup] ?? LIBRARY_GROUPS.common;
    const leftIndex = group.libraries.indexOf(left.id);
    const rightIndex = group.libraries.indexOf(right.id);
    if (leftIndex >= 0 || rightIndex >= 0) {
        return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex);
    }
    return left.name.localeCompare(right.name);
}

function isGlobalSymbolSearchActive() {
    return globalSymbolSearchQuery.trim().length > 0;
}

async function runGlobalSymbolSearch(query) {
    const normalizedQuery = String(query ?? "").trim();
    const requestToken = ++globalSymbolSearchRequestToken;
    if (!normalizedQuery) {
        globalSymbolSearchResults = [];
        globalSymbolSearchBusy = false;
        renderLibraryBrowser();
        return;
    }

    globalSymbolSearchBusy = true;
    renderLibraryBrowser();

    try {
        const data = await apiGet(`/symbol-sources/kicad/search?q=${encodeURIComponent(normalizedQuery)}&limit=80`);
        if (requestToken !== globalSymbolSearchRequestToken) {
            return;
        }
        globalSymbolSearchResults = Array.isArray(data.symbols) ? data.symbols : [];
        renderLibraryBrowser();
    } catch (error) {
        if (requestToken !== globalSymbolSearchRequestToken) {
            return;
        }
        console.error("Global KiCad search failed:", error);
        globalSymbolSearchResults = [];
        renderLibraryBrowser();
    } finally {
        if (requestToken === globalSymbolSearchRequestToken) {
            globalSymbolSearchBusy = false;
            renderLibraryBrowser();
        }
    }
}

async function loadFirstLibraryForCurrentGroup() {
    const groupLibraries = kicadLibraries
        .filter(libraryIsInSelectedGroup)
        .sort(compareLibrariesByGroup);
    const nextLibrary = groupLibraries[0] ?? kicadLibraries[0] ?? null;
    if (nextLibrary) {
        await loadLibrary(nextLibrary.id);
    } else {
        renderLibraryBrowser();
    }
}

async function setLibraryGroup(groupId) {
    if (!LIBRARY_GROUPS[groupId]) {
        return;
    }
    selectedLibraryGroup = groupId;
    librarySearchQuery = "";
    symbolSearchQuery = "";
    renderCategoryToolbar();
    await loadFirstLibraryForCurrentGroup();
}

function renderCategoryToolbar() {
    const modeChip = document.getElementById("symbol-browser-mode-chip");
    const modeLabels = {
        search: "Search",
        libraries: "Browse",
    };
    if (modeChip) {
        modeChip.textContent = modeLabels[selectedLibraryPanel] || "Symbols";
    }
    document.querySelectorAll("[data-library-group-shortcut]").forEach((button) => {
        const groupId = button.getAttribute("data-library-group-shortcut");
        button.classList.toggle("active", groupId === selectedLibraryGroup);
        button.onclick = () => {
            setLibraryGroup(groupId).catch((error) => {
                console.error("Failed to switch library group:", error);
            });
        };
    });
    document.querySelectorAll("[data-library-panel]").forEach((button) => {
        const panelId = button.getAttribute("data-library-panel");
        button.classList.toggle("active", panelId === selectedLibraryPanel);
        button.onclick = () => {
            setLibraryPanel(panelId);
        };
    });
}

function syncSymbolPreviewPanels() {
    const previewArea = document.getElementById("selected-symbol-preview");
    const previewName = document.getElementById("selected-symbol-name");
    const previewDescription = document.getElementById("selected-symbol-description");
    void previewArea;
    void previewName;
    void previewDescription;
}

function applyLibraryPanelLayout() {
    const searchSection = document.getElementById("symbol-browser-search-section");
    const mainSection = document.getElementById("symbol-browser-main");
    const librarySection = document.getElementById("symbol-browser-library-section");
    const resultsSection = document.getElementById("symbol-browser-results-section");
    const symbolSearch = document.getElementById("symbol-search");
    const librarySearch = document.getElementById("library-search");
    const previewDock = document.getElementById("symbol-browser-preview-dock");
    const addButton = document.getElementById("add-selected-symbol");
    const resultsTitle = resultsSection?.querySelector(".panel-section-title");
    const libraryTitle = librarySection?.querySelector(".panel-section-title");

    if (searchSection) searchSection.hidden = selectedLibraryPanel !== "search";
    if (mainSection) mainSection.hidden = !["search", "libraries"].includes(selectedLibraryPanel);
    if (librarySection) librarySection.hidden = selectedLibraryPanel !== "libraries";
    if (resultsSection) resultsSection.hidden = !["search", "libraries"].includes(selectedLibraryPanel);
    if (previewDock) previewDock.hidden = !["search", "libraries"].includes(selectedLibraryPanel);
    mainSection?.classList.toggle("symbol-browser-main--search", selectedLibraryPanel === "search");
    if (symbolSearch) {
        symbolSearch.hidden = selectedLibraryPanel !== "libraries";
    }
    if (librarySearch) {
        librarySearch.placeholder = selectedLibraryPanel === "libraries" ? "Filter libraries..." : librarySearch.placeholder;
    }
    if (resultsTitle) {
        resultsTitle.textContent = selectedLibraryPanel === "search" ? "Search Results" : "Results";
    }
    if (libraryTitle) {
        libraryTitle.textContent = "Library Sets";
    }

    const canPlace = !!selectedSymbolId;
    if (addButton) {
        addButton.disabled = !canPlace;
        addButton.onclick = () => {
            if (selectedSymbolId) {
                addComponent(selectedSymbolId);
            }
        };
    }
    syncSymbolPreviewPanels();
}

function setLibraryPanel(panelId) {
    const allowedPanels = new Set(["search", "libraries"]);
    if (!allowedPanels.has(panelId)) {
        return;
    }
    selectedLibraryPanel = panelId;
    if (panelId === "search") {
        symbolSearchQuery = "";
    }
    renderCategoryToolbar();
    applyLibraryPanelLayout();
    if (panelId === "search") {
        window.requestAnimationFrame(() => {
            document.getElementById("global-symbol-search")?.focus();
        });
    }
}

async function placeKnownComponent(libraryId, symbolId) {
    const preferredSymbol = getPreferredLibrarySymbolId(libraryId, symbolId);
    const symbolKey = `${preferredSymbol.libraryId}:${preferredSymbol.symbolId}`;
    if (selectedLibraryId !== preferredSymbol.libraryId) {
        await loadLibrary(preferredSymbol.libraryId);
    }
    await selectSymbol(symbolKey);
    await addComponent(symbolKey);
}

function renderCommonComponents() {
    const container = document.getElementById("common-component-list");
    if (!container) {
        return;
    }

    container.innerHTML = COMMON_COMPONENTS.map((component) => `
        <button type="button" class="common-component-btn" data-common-library="${escapeHtml(component.libraryId)}" data-common-symbol="${escapeHtml(component.symbolId)}" title="${escapeHtml(component.libraryId)}:${escapeHtml(component.symbolId)}">
            <span class="common-component-ref">${escapeHtml(component.ref)}</span>
            <span>
                <span class="common-component-name">${escapeHtml(component.label)}</span>
                <span class="common-component-source">${escapeHtml(component.libraryId)}:${escapeHtml(component.symbolId)}</span>
            </span>
        </button>
    `).join("");

    container.querySelectorAll("[data-common-library][data-common-symbol]").forEach((button) => {
        button.onclick = async () => {
            const libraryId = button.getAttribute("data-common-library");
            const symbolId = button.getAttribute("data-common-symbol");
            button.disabled = true;
            try {
                await placeKnownComponent(libraryId, symbolId);
            } catch (error) {
                console.error("Failed to place common component:", error);
                alert(`Could not place ${libraryId}:${symbolId}. Check API and symbol data.`);
            } finally {
                button.disabled = false;
            }
        };
    });
}

function renderLibraryBrowser() {
    const libraryGroup = document.getElementById("library-group");
    const globalSymbolSearch = document.getElementById("global-symbol-search");
    const librarySearch = document.getElementById("library-search");
    const symbolSearch = document.getElementById("symbol-search");
    const libraryList = document.getElementById("kicad-library-list");
    const symbolList = document.getElementById("component-palette");

    if (!libraryList || !symbolList) {
        return;
    }

    renderCategoryToolbar();
    renderCommonComponents();

    if (libraryGroup) {
        libraryGroup.value = selectedLibraryGroup;
        libraryGroup.onchange = async (event) => {
            await setLibraryGroup(event.target.value);
        };
    }

    if (librarySearch) {
        librarySearch.value = librarySearchQuery;
        librarySearch.oninput = (event) => {
            librarySearchQuery = event.target.value;
            renderLibraryBrowser();
        };
    }

    if (globalSymbolSearch) {
        globalSymbolSearch.value = globalSymbolSearchQuery;
        globalSymbolSearch.oninput = (event) => {
            globalSymbolSearchQuery = event.target.value;
            runGlobalSymbolSearch(globalSymbolSearchQuery);
        };
    }

    if (symbolSearch) {
        symbolSearch.value = symbolSearchQuery;
        symbolSearch.oninput = (event) => {
            symbolSearchQuery = event.target.value;
            renderLibraryBrowser();
        };
    }

    const libraryQuery = librarySearchQuery.trim().toLowerCase();
    const filteredLibraries = kicadLibraries
        .filter(libraryIsInSelectedGroup)
        .filter((library) => !libraryQuery || library.name.toLowerCase().includes(libraryQuery))
        .sort(compareLibrariesByGroup);

    libraryList.innerHTML = filteredLibraries.map((library) => `
        <button type="button" class="library-row${library.id === selectedLibraryId ? " is-selected" : ""}" data-library-id="${escapeHtml(library.id)}">
            <strong>${escapeHtml(library.name)}</strong>
            <small>${library.id === selectedLibraryId ? `${currentLibrarySymbols.length} symbols` : "library"}</small>
        </button>
    `).join("") || `<div class="empty-state" style="padding: 12px;">No libraries match this symbol set.</div>`;

    libraryList.querySelectorAll("[data-library-id]").forEach((button) => {
        button.addEventListener("click", () => {
            const libraryId = button.getAttribute("data-library-id");
            if (libraryId && libraryId !== selectedLibraryId) {
                loadLibrary(libraryId);
            }
        });
    });

    const query = symbolSearchQuery.trim().toLowerCase();
    const globalSearchActive = isGlobalSymbolSearchActive();
    const filteredSymbols = globalSearchActive
        ? [...globalSymbolSearchResults]
        : [...currentLibrarySymbols]
            .sort((a, b) => a.name.localeCompare(b.name))
            .filter((symbol) => {
                if (!query) {
                    return true;
                }
                const haystack = [
                    symbol.name,
                    symbol.description,
                    symbol.reference,
                    ...(symbol.keywords ?? []),
                ].join(" ").toLowerCase();
                return haystack.includes(query);
            });

    if (globalSearchActive) {
        const searchingMarkup = globalSymbolSearchBusy
            ? `<div class="empty-state" style="padding: 12px;">Searching all KiCad symbols...</div>`
            : "";
        const resultsMarkup = filteredSymbols.map((symbol) => `
            <button type="button" class="symbol-row" data-global-library-id="${escapeHtml(symbol.sourceLibrary)}" data-global-symbol-id="${escapeHtml(symbol.sourceSymbol)}" title="${escapeHtml(symbol.id)}">
                <span class="symbol-ref">${escapeHtml(symbol.reference || "U")}</span>
                <span class="symbol-main">
                    <span class="symbol-name">${escapeHtml(symbol.name)}</span>
                    <span class="symbol-subtitle">${escapeHtml(symbol.sourceLibrary)}:${escapeHtml(symbol.sourceSymbol)}${symbol.description ? ` - ${escapeHtml(symbol.description)}` : ""}</span>
                </span>
            </button>
        `).join("");
        symbolList.innerHTML = searchingMarkup || resultsMarkup || `<div class="empty-state" style="padding: 12px;">No global symbol matches for "${escapeHtml(globalSymbolSearchQuery.trim())}".</div>`;
        symbolList.querySelectorAll("[data-global-library-id][data-global-symbol-id]").forEach((button) => {
            button.addEventListener("click", async () => {
                const libraryId = button.getAttribute("data-global-library-id");
                const symbolId = button.getAttribute("data-global-symbol-id");
                if (libraryId && symbolId) {
                    await placeKnownComponent(libraryId, symbolId);
                }
            });
        });
    } else {
        symbolList.innerHTML = filteredSymbols.map((symbol) => `
            <button type="button" class="symbol-row${symbol.id === selectedSymbolId ? " is-selected" : ""}" data-symbol-id="${escapeHtml(symbol.id)}" title="${escapeHtml(symbol.name)}">
                <span class="symbol-ref">${escapeHtml(symbol.reference || "U")}</span>
                <span class="symbol-main">
                    <span class="symbol-name">${escapeHtml(symbol.name)}</span>
                    <span class="symbol-subtitle">${escapeHtml(symbol.description || symbol.sourceSymbol || symbol.id)}</span>
                </span>
            </button>
        `).join("") || `<div class="empty-state" style="padding: 12px;">No symbols match this query.</div>`;

        symbolList.querySelectorAll("[data-symbol-id]").forEach((button) => {
            button.addEventListener("click", async () => {
                const symbolId = button.getAttribute("data-symbol-id");
                if (symbolId) {
                    await addComponent(symbolId);
                }
            });
        });
    }

    setupSymbolPreviewObserver(symbolList);
    applyLibraryPanelLayout();
    updateShellStatus();
}

async function selectSymbol(symbolId) {
    selectedSymbolId = symbolId;
    selectedSymbolSummary = currentLibrarySymbols.find((symbol) => symbol.id === symbolId) ?? null;
    selectedSymbolDefinition = selectedSymbolSummary ? await ensureComponentDef(selectedSymbolSummary) : null;
    renderLibraryBrowser();
    if (selectedComponent) {
        openInspector(selectedComponent);
    } else {
        closeInspector();
    }
}

async function fetchLibraryData(libraryId) {
    const normalizedLibraryId = String(libraryId || "").trim();
    if (!normalizedLibraryId) {
        return null;
    }
    if (!libraryDataCache.has(normalizedLibraryId)) {
        libraryDataCache.set(normalizedLibraryId, apiGet(`/symbol-sources/kicad/libraries/${encodeURIComponent(normalizedLibraryId)}`).catch((error) => {
            libraryDataCache.delete(normalizedLibraryId);
            throw error;
        }));
    }
    return libraryDataCache.get(normalizedLibraryId);
}

async function loadLibrary(libraryId) {
    const data = await fetchLibraryData(libraryId);
    selectedLibraryId = libraryId;
    currentLibrary = data.library;
    currentLibrarySymbols = data.symbols ?? [];

    for (const symbol of currentLibrarySymbols) {
        COMPONENT_DEFS[symbol.id] = {
            ...(COMPONENT_DEFS[symbol.id] ?? {}),
            type: symbol.id,
            label: symbol.name,
            category: symbol.sourceLibrary,
            description: symbol.description,
            referencePrefix: symbol.reference || "U",
            sourceKind: "kicad",
            sourceLibrary: symbol.sourceLibrary,
            sourceSymbol: symbol.sourceSymbol,
            symbolKey: symbol.id,
            symbolSummary: symbol,
            views: null,
            graphics: COMPONENT_DEFS[symbol.id]?.graphics ?? [],
            pins: COMPONENT_DEFS[symbol.id]?.pins ?? [],
            bounds: COMPONENT_DEFS[symbol.id]?.bounds ?? { minX: -2, maxX: 2, minY: -1.5, maxY: 1.5, width: 4, height: 3 },
        };
    }

    const fallbackSymbolId = currentLibrarySymbols.find((symbol) => symbol.id === selectedSymbolId)?.id
        ?? currentLibrarySymbols[0]?.id
        ?? null;

    if (fallbackSymbolId) {
        await selectSymbol(fallbackSymbolId);
    } else {
        selectedSymbolId = null;
        selectedSymbolSummary = null;
        selectedSymbolDefinition = null;
        renderLibraryBrowser();
    }
}

async function initLibrary() {
    try {
        const [statusData, librariesData] = await Promise.all([
            apiGet("/symbol-sources/kicad/status"),
            apiGet("/symbol-sources/kicad/libraries"),
        ]);

        backendOnline = true;
        kicadStatus = statusData.source;
        kicadLibraries = librariesData.libraries ?? [];
        currentLibrarySymbols = [];

        const defaultLibraryId = selectedLibraryId && kicadLibraries.some((library) => library.id === selectedLibraryId)
            ? selectedLibraryId
            : (kicadLibraries.find((library) => library.id === "Device")?.id ?? kicadLibraries[0]?.id ?? null);

        if (defaultLibraryId) {
            await loadLibrary(defaultLibraryId);
        } else {
            currentLibrary = null;
            currentLibrarySymbols = [];
            selectedSymbolId = null;
            selectedSymbolSummary = null;
            selectedSymbolDefinition = null;
            renderLibraryBrowser();
        }

        saveHistory();
    } catch (error) {
        console.error("Backend Error:", error);
        backendOnline = false;
        kicadLibraries = [];
        currentLibrary = null;
        currentLibrarySymbols = [];
        selectedSymbolId = null;
        selectedSymbolSummary = null;
        selectedSymbolDefinition = null;
        renderLibraryBrowser();
    }

    updateShellStatus();
    draw();
}

function bindJsonImportModal() {
    const {
        modal,
        input,
        trigger,
        close,
        cancel,
        clear,
        example,
        apply,
    } = getJsonImportElements();

    trigger?.addEventListener("click", openJsonImportModal);
    close?.addEventListener("click", closeJsonImportModal);
    cancel?.addEventListener("click", closeJsonImportModal);
    clear?.addEventListener("click", () => {
        if (input) {
            input.value = "";
        }
        setJsonImportStatus("Cleared. Paste a schematic JSON payload, then apply it to the canvas.");
    });
    example?.addEventListener("click", () => {
        if (input) {
            input.value = JSON.stringify(JSON_IMPORT_EXAMPLE, null, 2);
        }
        setJsonImportStatus("Loaded the buck converter demo scene. Apply it to place the clean left-to-right example.");
    });
    apply?.addEventListener("click", async () => {
        if (!input) {
            return;
        }
        try {
            setJsonImportStatus("Parsing JSON and resolving symbols...");
            const payload = JSON.parse(input.value);
            closeJsonImportModal();
            await applyJsonPayloadToCanvas(payload);
        } catch (error) {
            console.error("JSON import failed:", error);
            openJsonImportModal();
            setJsonImportStatus(error?.message || "Import failed.", "error");
        }
    });
    modal?.addEventListener("click", (event) => {
        if (event.target === modal) {
            closeJsonImportModal();
        }
    });
}

function bindAiToolsModal() {
    const {
        chatPanel,
        canvasPanel,
        chatToggle,
        canvasToggle,
        chatClose,
        canvasClose,
        chatSetupToggle,
        chatSetupPanel,
        chatSetupClose,
        canvasAdvancedToggle,
        canvasAdvancedPanel,
        canvasAdvancedClose,
        exportScene,
        providerSelect,
        modelSelect,
        geminiKeyInput,
        refreshModels,
        checkProvider,
        generateCircuit,
        sendRequest,
        sendChat,
        clearChat,
        chatRequest,
        sceneOutput,
        responseOutput,
        userRequest,
        generatePrompt,
        clearPrompt,
        promptOutput,
        patchInput,
        loadExample,
        clearPatch,
        clearPreview,
        preview,
        apply,
    } = getAiToolsElements();

    chatToggle?.addEventListener("click", () => {
        ensureAiProviderUiDefaults().catch((error) => {
            setAiToolsStatus(error?.message || "Failed to load AI defaults.", "error");
        });
        toggleAiPanel("chat");
    });
    canvasToggle?.addEventListener("click", () => {
        ensureAiProviderUiDefaults().catch((error) => {
            setAiToolsStatus(error?.message || "Failed to load AI defaults.", "error");
        });
        toggleAiPanel("canvas");
    });
    chatClose?.addEventListener("click", () => closeAiPanel("chat"));
    canvasClose?.addEventListener("click", () => closeAiPanel("canvas"));
    chatSetupToggle?.addEventListener("click", () => toggleAiPopover("chatSetup"));
    chatSetupClose?.addEventListener("click", () => closeAiPopover("chatSetup"));
    canvasAdvancedToggle?.addEventListener("click", () => toggleAiPopover("canvasAdvanced"));
    canvasAdvancedClose?.addEventListener("click", () => closeAiPopover("canvasAdvanced"));
    providerSelect?.addEventListener("change", async () => {
        writeStoredAiSetting(AI_PROVIDER_STORAGE_KEYS.provider, providerSelect.value);
        syncAiProviderFieldVisibility();
        const models = await loadAiModelsForProvider(providerSelect.value, { force: true }).catch(() => getFallbackAiModels(providerSelect.value));
        renderAiModelOptions(providerSelect.value, models, getAiDefaultModelForProvider(providerSelect.value));
        writeStoredAiSetting(AI_PROVIDER_STORAGE_KEYS.model, modelSelect?.value || "");
        checkSelectedAiProviderStatus().catch((error) => {
            setAiProviderStatus(error?.message || "AI status check failed.", "error");
        });
    });
    modelSelect?.addEventListener("change", () => {
        writeStoredAiSetting(AI_PROVIDER_STORAGE_KEYS.model, modelSelect.value);
        checkSelectedAiProviderStatus().catch((error) => {
            setAiProviderStatus(error?.message || "AI status check failed.", "error");
        });
    });
    geminiKeyInput?.addEventListener("input", () => {
        window.clearTimeout(aiGeminiKeyRefreshTimer);
        aiGeminiKeyRefreshTimer = window.setTimeout(() => {
            refreshGeminiModelsFromCurrentKey().catch((error) => {
                setAiProviderStatus(error?.message || "Failed to refresh Gemini models.", "error");
            });
        }, 350);
    });
    geminiKeyInput?.addEventListener("change", () => {
        refreshGeminiModelsFromCurrentKey().catch((error) => {
            setAiProviderStatus(error?.message || "Failed to refresh Gemini models.", "error");
        });
    });
    refreshModels?.addEventListener("click", async () => {
        try {
            const provider = providerSelect?.value || "ollama";
            const models = await loadAiModelsForProvider(provider, { force: true }).catch(() => getFallbackAiModels(provider));
            renderAiModelOptions(provider, models, modelSelect?.value || getAiDefaultModelForProvider(provider));
            writeStoredAiSetting(AI_PROVIDER_STORAGE_KEYS.model, modelSelect?.value || "");
            setAiToolsStatus(`Refreshed ${provider} model list.`, "success");
            checkSelectedAiProviderStatus().catch((error) => {
                setAiProviderStatus(error?.message || "AI status check failed.", "error");
            });
        } catch (error) {
            console.error("Model refresh failed:", error);
            setAiToolsStatus(error?.message || "Model refresh failed.", "error");
        }
    });
    checkProvider?.addEventListener("click", async () => {
        try {
            const result = await checkSelectedAiProviderStatus();
            setAiToolsStatus(result.message || "AI status checked.", result.ready ? "success" : "error");
        } catch (error) {
            console.error("AI status check failed:", error);
            setAiProviderStatus(error?.message || "AI status check failed.", "error");
            setAiToolsStatus(error?.message || "AI status check failed.", "error");
        }
    });
    clearChat?.addEventListener("click", () => {
        aiConversation = [];
        renderAiChatLog();
        if (chatRequest) {
            chatRequest.value = "";
        }
        setAiRunStatus("Idle. Type a request, then click Ask Canvas AI.");
        setAiChatStatus("Ready.");
        setAiToolsStatus("Built-in AI conversation cleared.");
        if (responseOutput) {
            responseOutput.value = "";
        }
    });
    generateCircuit?.addEventListener("click", async () => {
        try {
            await sendBuiltInAiGenerateCircuitRequest();
        } catch (error) {
            console.error("Built-in AI circuit generation failed:", error);
            setAiRunStatus(error?.message || "Built-in AI circuit generation failed.", "error");
            setAiToolsStatus(error?.message || "Built-in AI circuit generation failed.", "error");
        }
    });
    sendRequest?.addEventListener("click", async () => {
        try {
            await sendBuiltInAiRequest();
        } catch (error) {
            console.error("Built-in AI request failed:", error);
            setAiRunStatus(error?.message || "Built-in AI request failed.", "error");
            setAiToolsStatus(error?.message || "Built-in AI request failed.", "error");
        }
    });
    sendChat?.addEventListener("click", async () => {
        try {
            await sendBuiltInAiChatRequest();
        } catch (error) {
            console.error("Built-in AI chat request failed:", error);
            setAiRunStatus(error?.message || "Built-in AI chat request failed.", "error");
            setAiToolsStatus(error?.message || "Built-in AI chat request failed.", "error");
        }
    });
    exportScene?.addEventListener("click", () => {
        const sceneState = exportSceneState();
        if (sceneOutput) {
            sceneOutput.value = JSON.stringify(sceneState, null, 2);
        }
        setAiToolsStatus(`Exported scene with ${sceneState.components.length} components and ${sceneState.wires.length} wires.`, "success");
    });
    generatePrompt?.addEventListener("click", () => {
        try {
            const promptPack = buildExternalAiPromptPack(userRequest?.value ?? "");
            if (sceneOutput && !sceneOutput.value.trim()) {
                sceneOutput.value = JSON.stringify(exportSceneState(), null, 2);
            }
            if (promptOutput) {
                promptOutput.value = promptPack;
            }
            setAiToolsStatus("Generated external AI prompt pack. Paste it into ChatGPT, Gemini, or another model, then paste the returned patch JSON into Patch Input.", "success");
        } catch (error) {
            console.error("Prompt pack generation failed:", error);
            setAiToolsStatus(error?.message || "Prompt pack generation failed.", "error");
        }
    });
    clearPrompt?.addEventListener("click", () => {
        if (promptOutput) {
            promptOutput.value = "";
        }
        setAiToolsStatus("Prompt pack cleared.");
    });
    loadExample?.addEventListener("click", () => {
        if (patchInput) {
            patchInput.value = JSON.stringify(AI_PATCH_EXAMPLE, null, 2);
        }
        setAiToolsStatus("Loaded patch example for the buck converter demo scene. Preview it to see the overlay.", "success");
    });
    clearPatch?.addEventListener("click", () => {
        if (patchInput) {
            patchInput.value = "";
        }
        setAiToolsStatus("Patch input cleared.");
    });
    clearPreview?.addEventListener("click", () => {
        clearAiPatchPreview();
        setAiToolsStatus("Preview cleared.");
    });
    preview?.addEventListener("click", async () => {
        if (!patchInput) {
            return;
        }
        try {
            setAiToolsStatus("Validating patch and building preview...");
            const payload = JSON.parse(patchInput.value);
            await previewCircuitPatch(payload);
        } catch (error) {
            console.error("Patch preview failed:", error);
            setAiToolsStatus(error?.message || "Patch preview failed.", "error");
        }
    });
    apply?.addEventListener("click", async () => {
        if (!patchInput) {
            return;
        }
        try {
            setAiToolsStatus("Applying patch...");
            const payload = JSON.parse(patchInput.value);
            const previewState = await applyCircuitPatch(payload);
            closeAiPanel("canvas");
            const { sceneOutput } = getAiToolsElements();
            if (sceneOutput) {
                sceneOutput.value = JSON.stringify(exportSceneState("preview_overlay"), null, 2);
            }
            setAiToolsStatus(`Applied "${previewState.title}" to the canvas.`, "success");
        } catch (error) {
            console.error("Patch apply failed:", error);
            openAiPanel("canvas");
            setAiToolsStatus(error?.message || "Patch apply failed.", "error");
        }
    });
    [chatPanel, canvasPanel, chatSetupPanel, canvasAdvancedPanel].forEach((panel) => {
        panel?.addEventListener("click", (event) => {
            event.stopPropagation();
        });
    });
    document.addEventListener("click", () => {
        closeAiPopover("chatSetup");
        closeAiPopover("canvasAdvanced");
    });
}

function updateSelectionScopeControls() {
    const panel = document.getElementById("selection-scope-panel");
    const componentButton = document.getElementById("selection-scope-components");
    const wireButton = document.getElementById("selection-scope-wires");
    const bothButton = document.getElementById("selection-scope-both");
    const summary = document.getElementById("selection-scope-summary");
    if (!panel || !componentButton || !wireButton || !bothButton || !summary) {
        return;
    }

    panel.hidden = currentTool !== "select" || !selectionMode;
    componentButton.classList.toggle("active", selectionScope === "components");
    wireButton.classList.toggle("active", selectionScope === "wires");
    bothButton.classList.toggle("active", selectionScope === "both");
    summary.textContent = `${selectedComponentIds.length} part / ${selectedWireIds.length} wire`;
}

function updateSelectionModeToggleButton() {
    const button = document.getElementById("selection-mode-toggle-btn");
    if (!button) {
        return;
    }
    button.classList.toggle("active", selectionMode);
    button.setAttribute("aria-pressed", selectionMode ? "true" : "false");
    button.title = selectionMode ? "Selection mode active" : "Toggle selection mode";
}

function setSelectionMode(enabled) {
    selectionMode = !!enabled;
    if (!selectionMode) {
        selectionBox = null;
        lastSelectionCycle = null;
    }
    updateSelectionModeToggleButton();
    updateSelectionScopeControls();
    draw();
}

function setSelectionScope(scope) {
    if (!["components", "wires", "both"].includes(scope)) {
        return;
    }
    selectionScope = scope;
    lastSelectionCycle = null;

    if (scope === "components") {
        selectedWireId = null;
        selectedWireIds = [];
        autorouteRequestWireId = null;
        selectedJunctionId = null;
    } else if (scope === "wires") {
        selectedComponent = null;
        selectedComponentIds = [];
        selectedJunctionId = null;
    }

    syncSelectionPresentation();
    updateSelectionScopeControls();
    draw();
}

function bindSelectionScopeControls() {
    document.getElementById("selection-scope-components")?.addEventListener("click", () => {
        setSelectionScope("components");
    });
    document.getElementById("selection-scope-wires")?.addEventListener("click", () => {
        setSelectionScope("wires");
    });
    document.getElementById("selection-scope-both")?.addEventListener("click", () => {
        setSelectionScope("both");
    });
    updateSelectionScopeControls();
}

function bindSelectionModeToggleButton() {
    document.getElementById("selection-mode-toggle-btn")?.addEventListener("click", () => {
        setSelectionMode(!selectionMode);
    });
    updateSelectionModeToggleButton();
}

let isResizingPanel = false;
document.addEventListener('DOMContentLoaded', () => {
    const resizer = document.getElementById('panel-resizer');
    const leftPanel = document.getElementById('left-panel');
    bindCanvasSettings();
    bindJsonImportModal();
    bindAiToolsModal();
    bindPinLabelToggleButton();
    bindWireAutoroutePanel();
    bindSelectionModeToggleButton();
    bindSelectionScopeControls();
    bindToolButtons();
    if (resizer && leftPanel) {
        resizer.addEventListener('mousedown', (e) => { isResizingPanel = true; resizer.classList.add('resizing'); document.body.style.cursor = 'ew-resize'; });
        document.addEventListener('mousemove', (e) => {
            if (!isResizingPanel) return;
            const offset = leftPanel.getBoundingClientRect().left;
            let newWidth = e.clientX - offset;
            if (newWidth < 250) newWidth = 250; if (newWidth > 800) newWidth = 800;
            leftPanel.style.width = newWidth + 'px'; leftPanel.style.minWidth = newWidth + 'px';
            resizeWorkspace();
        });
        document.addEventListener('mouseup', () => { if (isResizingPanel) { isResizingPanel = false; resizer.classList.remove('resizing'); document.body.style.cursor = 'default'; resizeWorkspace(); } });
    }
});

let components = [];

function getPinAnchor(pin) {
    return {
        uX: pin.uX !== undefined ? pin.uX : (pin.wireUX !== undefined ? pin.wireUX : 0),
        uY: pin.uY !== undefined ? pin.uY : (pin.wireUY !== undefined ? pin.wireUY : 0),
    };
}

function getInnerPinAnchor(pin) {
    return {
        uX: pin.wireUX !== undefined ? pin.wireUX : (pin.innerX !== undefined ? pin.innerX : (pin.uX || 0)),
        uY: pin.wireUY !== undefined ? pin.wireUY : (pin.innerY !== undefined ? pin.innerY : (pin.uY || 0)),
    };
}

function localPointToWorld(comp, localPoint) {
    const rad = (comp.rotation || 0) * Math.PI / 180;
    const rx = localPoint.uX * Math.cos(rad) - (-localPoint.uY) * Math.sin(rad);
    const ry = localPoint.uX * Math.sin(rad) + (-localPoint.uY) * Math.cos(rad);
    return {
        uX: comp.uX + rx,
        uY: comp.uY + (-ry),
    };
}

function getPinWorldGeometry(comp, pin) {
    const tip = localPointToWorld(comp, getPinAnchor(pin));
    const inner = localPointToWorld(comp, getInnerPinAnchor(pin));
    return {
        comp,
        pin,
        label: pin.label || pin.number || "",
        uX: tip.uX,
        uY: tip.uY,
        innerUX: inner.uX,
        innerUY: inner.uY,
        outwardUX: tip.uX - inner.uX,
        outwardUY: tip.uY - inner.uY,
    };
}

function getPinId(pin) {
    return String(pin?.id ?? pin?.number ?? pin?.label ?? "");
}

function getEndpointKey(compId, pinId) {
    return `${String(compId)}:${String(pinId)}`;
}

function getGraphNodeKeyForEndpoint(endpoint) {
    const normalizedEndpoint = normalizeEndpoint(endpoint);
    if (!normalizedEndpoint) {
        return null;
    }
    if (normalizedEndpoint.kind === "junction") {
        return `junction:${String(normalizedEndpoint.junctionId)}`;
    }
    return `pin:${getEndpointKey(normalizedEndpoint.compId, normalizedEndpoint.pinId)}`;
}

function findComponentById(compId) {
    return components.find((comp) => String(comp.id) === String(compId)) ?? null;
}

function findPinById(comp, pinId) {
    const def = comp ? COMPONENT_DEFS[comp.type] : null;
    return def?.pins?.find((pin) => getPinId(pin) === String(pinId)) ?? null;
}

function normalizeImportPinToken(value) {
    return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function getPinMatchTokens(pin) {
    const baseTokens = [
        pin?.id,
        pin?.number,
        pin?.name,
        pin?.label,
        pin?.electricalType,
        pin?.number != null ? `pin_${pin.number}` : null,
        pin?.number != null ? `pin${pin.number}` : null,
    ];
    return baseTokens
        .map(normalizeImportPinToken)
        .filter(Boolean);
}

function resolveImportPinId(comp, requestedPinId) {
    const def = comp ? COMPONENT_DEFS[comp.type] : null;
    if (!def?.pins?.length) {
        return null;
    }

    const directMatch = def.pins.find((pin) => String(getPinId(pin)) === String(requestedPinId));
    if (directMatch) {
        return getPinId(directMatch);
    }

    const normalizedRequest = normalizeImportPinToken(requestedPinId);
    const matchedPin = def.pins.find((pin) => getPinMatchTokens(pin).includes(normalizedRequest));
    return matchedPin ? getPinId(matchedPin) : null;
}

function mapCircuitIrPackageToSymbolKey(component) {
    const packageId = String(component?.packageId ?? "").toLowerCase();
    const attrs = component?.attrs ?? {};
    const explicitSymbolKey = attrs.symbolKey || attrs.symbol_key || component?.symbolKey || null;
    if (explicitSymbolKey) {
        return String(explicitSymbolKey);
    }
    if (packageId.includes("arduino_uno")) return "Connector_Generic:Conn_01x03";
    if (packageId.includes("resistor")) return getPreferredSymbolKey("Device:R");
    if (packageId.includes("capacitor")) return "Device:C";
    if (packageId.includes("inductor")) return "Device:L";
    if (packageId.includes("led")) return "Device:LED";
    if (packageId.includes("diode")) return "Device:D";
    if (packageId.includes("battery")) return "Device:Battery_Cell";
    if (packageId.includes("conn_01x02") || packageId.includes("connector_2")) return "Connector_Generic:Conn_01x02";
    if (packageId.includes("conn_01x03") || packageId.includes("connector_3")) return "Connector_Generic:Conn_01x03";
    if (packageId.includes("switch")) return "Switch:SW_SPST";
    return null;
}

function mapCircuitIrPinToSymbolPin(packageId, pinId) {
    const normalizedPackageId = String(packageId ?? "").toLowerCase();
    const normalizedPinId = String(pinId ?? "");
    if (normalizedPackageId.includes("arduino_uno")) {
        const arduinoPinMap = {
            D13: "1",
            "5V": "2",
            GND: "3",
        };
        return arduinoPinMap[normalizedPinId.toUpperCase()] || normalizedPinId;
    }
    return normalizedPinId;
}

function normalizeImportedPlacement(placement = {}) {
    return {
        uX: Number.isFinite(Number(placement.x)) ? Number(placement.x) : 0,
        uY: Number.isFinite(Number(placement.y)) ? Number(placement.y) : 0,
        rotation: Number.isFinite(Number(placement.rotationDeg)) ? Number(placement.rotationDeg) : 0,
    };
}

function buildImportWireId(baseId, index) {
    return `${baseId}_${index}`;
}

function getScreenPointFromUnits(uX, uY) {
    const u = pixelsPerUnit * zoom;
    return {
        x: offsetX + uX * u,
        y: offsetY - uY * u,
    };
}

function getPinScreenGeometry(comp, pin) {
    const pinWorld = getPinWorldGeometry(comp, pin);
    const tipScreen = getScreenPointFromUnits(pinWorld.uX, pinWorld.uY);
    const innerScreen = getScreenPointFromUnits(pinWorld.innerUX, pinWorld.innerUY);
    return {
        ...pinWorld,
        screenX: tipScreen.x,
        screenY: tipScreen.y,
        innerScreenX: innerScreen.x,
        innerScreenY: innerScreen.y,
    };
}

function getRoutingDirectionFromDelta(dx, dy) {
    if (Math.abs(dx) >= Math.abs(dy)) {
        return dx >= 0 ? "right" : "left";
    }
    return dy >= 0 ? "down" : "up";
}

function getPinRoutingDirection(comp, pin) {
    const pinScreen = getPinScreenGeometry(comp, pin);
    return getRoutingDirectionFromDelta(
        pinScreen.screenX - pinScreen.innerScreenX,
        pinScreen.screenY - pinScreen.innerScreenY,
    );
}

function getPreviewEndDirection(startPoint, endPoint) {
    return getRoutingDirectionFromDelta(startPoint.x - endPoint.x, startPoint.y - endPoint.y);
}

function getComponentObstacle(comp) {
    const def = COMPONENT_DEFS[comp.type];
    if (!def) {
        return null;
    }

    const localBounds = computeSymbolBounds(def.graphics ?? [], def.pins ?? []);
    const worldCorners = [
        localPointToWorld(comp, { uX: localBounds.minX, uY: localBounds.minY }),
        localPointToWorld(comp, { uX: localBounds.minX, uY: localBounds.maxY }),
        localPointToWorld(comp, { uX: localBounds.maxX, uY: localBounds.minY }),
        localPointToWorld(comp, { uX: localBounds.maxX, uY: localBounds.maxY }),
    ];
    const screenCorners = worldCorners.map((corner) => getScreenPointFromUnits(corner.uX, corner.uY));
    const pad = Math.max(6, zoom * 4);
    return {
        compId: comp.id,
        left: Math.min(...screenCorners.map((point) => point.x)) - pad,
        top: Math.min(...screenCorners.map((point) => point.y)) - pad,
        right: Math.max(...screenCorners.map((point) => point.x)) + pad,
        bottom: Math.max(...screenCorners.map((point) => point.y)) + pad,
    };
}

function getComponentBodyBounds(comp) {
    const def = COMPONENT_DEFS[comp.type];
    if (!def) {
        return null;
    }

    const localBounds = computeSymbolBounds(def.graphics ?? [], def.pins ?? []);
    const worldCorners = [
        localPointToWorld(comp, { uX: localBounds.minX, uY: localBounds.minY }),
        localPointToWorld(comp, { uX: localBounds.minX, uY: localBounds.maxY }),
        localPointToWorld(comp, { uX: localBounds.maxX, uY: localBounds.minY }),
        localPointToWorld(comp, { uX: localBounds.maxX, uY: localBounds.maxY }),
    ];
    const screenCorners = worldCorners.map((corner) => getScreenPointFromUnits(corner.uX, corner.uY));
    return {
        compId: comp.id,
        left: Math.min(...screenCorners.map((point) => point.x)),
        top: Math.min(...screenCorners.map((point) => point.y)),
        right: Math.max(...screenCorners.map((point) => point.x)),
        bottom: Math.max(...screenCorners.map((point) => point.y)),
    };
}

function getRoutingObstacles(excludedCompIds = new Set()) {
    return components
        .filter((comp) => !excludedCompIds.has(comp.id))
        .map((comp) => getComponentObstacle(comp))
        .filter(Boolean)
        .map(({ left, top, right, bottom }) => ({ left, top, right, bottom }));
}

function getEndpointRouteAnchor(endpoint, escapePadding = 18) {
    if (!endpoint?.point || endpoint.kind !== "pin" || !endpoint.direction) {
        return endpoint?.point ?? null;
    }

    const nudgePoint = window.AuraRouting?.nudgePoint;
    if (typeof nudgePoint === "function") {
        return nudgePoint(endpoint.point, endpoint.direction, escapePadding);
    }

    switch (endpoint.direction) {
        case "left":
            return { x: endpoint.point.x - escapePadding, y: endpoint.point.y };
        case "right":
            return { x: endpoint.point.x + escapePadding, y: endpoint.point.y };
        case "up":
            return { x: endpoint.point.x, y: endpoint.point.y - escapePadding };
        case "down":
            return { x: endpoint.point.x, y: endpoint.point.y + escapePadding };
        default:
            return endpoint.point;
    }
}

function getAutorouteRoutingObstacles(connection) {
    const defaultClearance = 18;
    const connectedSideClearance = 6;
    const pinFrontageDepth = 26;
    const pinFrontageInset = 4;
    const escapeHalfSpan = 12;
    const clearanceByComponentId = new Map();
    const escapeWindowByComponentId = new Map();
    const obstacles = [];

    const pushObstacle = (rect) => {
        if (!rect || rect.right - rect.left < 0.5 || rect.bottom - rect.top < 0.5) {
            return;
        }
        obstacles.push(rect);
    };

    const applyEndpointEscape = (endpoint) => {
        if (!endpoint || endpoint.kind !== "pin") {
            return;
        }

        const component = findComponentById(endpoint.compId);
        const pin = component ? findPinById(component, endpoint.pinId) : null;
        if (!component || !pin) {
            return;
        }

        const direction = getPinRoutingDirection(component, pin);
        if (!direction) {
            return;
        }

        const current = clearanceByComponentId.get(component.id) ?? {
            left: defaultClearance,
            right: defaultClearance,
            top: defaultClearance,
            bottom: defaultClearance,
        };

        if (direction === "left") current.left = Math.min(current.left, connectedSideClearance);
        else if (direction === "right") current.right = Math.min(current.right, connectedSideClearance);
        else if (direction === "up") current.top = Math.min(current.top, connectedSideClearance);
        else if (direction === "down") current.bottom = Math.min(current.bottom, connectedSideClearance);

        clearanceByComponentId.set(component.id, current);

        const pinScreen = getPinScreenGeometry(component, pin);
        const span =
            direction === "left" || direction === "right"
                ? { min: pinScreen.screenY - escapeHalfSpan, max: pinScreen.screenY + escapeHalfSpan }
                : { min: pinScreen.screenX - escapeHalfSpan, max: pinScreen.screenX + escapeHalfSpan };
        const currentEscape = escapeWindowByComponentId.get(component.id) ?? {};
        const existing = currentEscape[direction];
        currentEscape[direction] = existing
            ? { min: Math.min(existing.min, span.min), max: Math.max(existing.max, span.max) }
            : span;
        escapeWindowByComponentId.set(component.id, currentEscape);
    };

    applyEndpointEscape(normalizeEndpoint(connection?.from));
    applyEndpointEscape(normalizeEndpoint(connection?.to));

    components.forEach((component) => {
        const def = COMPONENT_DEFS[component.type];
        const bounds = getComponentBodyBounds(component);
        if (!def || !bounds) {
            return;
        }

        const clearance = clearanceByComponentId.get(component.id) ?? {
            left: defaultClearance,
            right: defaultClearance,
            top: defaultClearance,
            bottom: defaultClearance,
        };
        pushObstacle({
            left: bounds.left - clearance.left,
            top: bounds.top - clearance.top,
            right: bounds.right + clearance.right,
            bottom: bounds.bottom + clearance.bottom,
        });

        const pinsBySide = new Map();
        (def.pins ?? []).forEach((pin) => {
            const side = getPinRoutingDirection(component, pin);
            const point = getPinScreenGeometry(component, pin);
            const values = pinsBySide.get(side) ?? [];
            values.push(side === "left" || side === "right" ? point.screenY : point.screenX);
            pinsBySide.set(side, values);
        });

        const escapeWindows = escapeWindowByComponentId.get(component.id) ?? {};
        const leftPins = pinsBySide.get("left");
        if (leftPins?.length) {
            const min = Math.min(...leftPins) - 8;
            const max = Math.max(...leftPins) + 8;
            const gap = escapeWindows.left;
            const rectLeft = bounds.left - pinFrontageDepth;
            const rectRight = bounds.left + pinFrontageInset;
            if (gap) {
                pushObstacle({ left: rectLeft, right: rectRight, top: min, bottom: Math.max(min, gap.min) });
                pushObstacle({ left: rectLeft, right: rectRight, top: Math.min(max, gap.max), bottom: max });
            } else {
                pushObstacle({ left: rectLeft, right: rectRight, top: min, bottom: max });
            }
        }

        const rightPins = pinsBySide.get("right");
        if (rightPins?.length) {
            const min = Math.min(...rightPins) - 8;
            const max = Math.max(...rightPins) + 8;
            const gap = escapeWindows.right;
            const rectLeft = bounds.right - pinFrontageInset;
            const rectRight = bounds.right + pinFrontageDepth;
            if (gap) {
                pushObstacle({ left: rectLeft, right: rectRight, top: min, bottom: Math.max(min, gap.min) });
                pushObstacle({ left: rectLeft, right: rectRight, top: Math.min(max, gap.max), bottom: max });
            } else {
                pushObstacle({ left: rectLeft, right: rectRight, top: min, bottom: max });
            }
        }

        const topPins = pinsBySide.get("up");
        if (topPins?.length) {
            const min = Math.min(...topPins) - 8;
            const max = Math.max(...topPins) + 8;
            const gap = escapeWindows.up;
            const rectTop = bounds.top - pinFrontageDepth;
            const rectBottom = bounds.top + pinFrontageInset;
            if (gap) {
                pushObstacle({ left: min, right: Math.max(min, gap.min), top: rectTop, bottom: rectBottom });
                pushObstacle({ left: Math.min(max, gap.max), right: max, top: rectTop, bottom: rectBottom });
            } else {
                pushObstacle({ left: min, right: max, top: rectTop, bottom: rectBottom });
            }
        }

        const bottomPins = pinsBySide.get("down");
        if (bottomPins?.length) {
            const min = Math.min(...bottomPins) - 8;
            const max = Math.max(...bottomPins) + 8;
            const gap = escapeWindows.down;
            const rectTop = bounds.bottom - pinFrontageInset;
            const rectBottom = bounds.bottom + pinFrontageDepth;
            if (gap) {
                pushObstacle({ left: min, right: Math.max(min, gap.min), top: rectTop, bottom: rectBottom });
                pushObstacle({ left: Math.min(max, gap.max), right: max, top: rectTop, bottom: rectBottom });
            } else {
                pushObstacle({ left: min, right: max, top: rectTop, bottom: rectBottom });
            }
        }
    });

    return obstacles;
}

function normalizeEndpoint(endpoint) {
    if (!endpoint) {
        return null;
    }
    if (endpoint.kind === "pin" || endpoint.kind === "junction") {
        return endpoint;
    }
    if (endpoint.compId != null && endpoint.pinId != null) {
        return {
            kind: "pin",
            compId: endpoint.compId,
            pinId: endpoint.pinId,
        };
    }
    return null;
}

function getConnectionSegments(routePoints) {
    return window.AuraRouting?.getConnectionSegments?.(routePoints) ?? [];
}

function getJunctionById(junctionId) {
    return junctions.find((junction) => String(junction.id) === String(junctionId)) ?? null;
}

function getJunctionScreenPoint(junction) {
    return getScreenPointFromUnits(junction.uX, junction.uY);
}

function getUnitsFromScreenPoint(point) {
    return {
        uX: (point.x - offsetX) / (pixelsPerUnit * zoom),
        uY: (offsetY - point.y) / (pixelsPerUnit * zoom),
    };
}

function createJunctionAtScreenPoint(point) {
    let index = 1;
    while (junctions.some((junction) => junction.id === `junction_${index}`)) {
        index += 1;
    }
    const units = getUnitsFromScreenPoint(point);
    return {
        id: `junction_${index}`,
        uX: units.uX,
        uY: units.uY,
    };
}

function routePointsScreenToUnits(points) {
    return points.map((point) => ({
        uX: (point.x - offsetX) / (pixelsPerUnit * zoom),
        uY: (offsetY - point.y) / (pixelsPerUnit * zoom),
    }));
}

function getWireJumps(wire) {
    return wire?.jumps ?? wire?.jumpPoints ?? [];
}

function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function jumpsUnitsToScreen(points) {
    return (points ?? []).map((point) => ({
        ...getScreenPointFromUnits(point.uX, point.uY),
        ...(Number.isInteger(point?.segmentIndex) ? { segmentIndex: point.segmentIndex } : {}),
    }));
}

function getRouteSegmentAtIndex(routePoints, segmentIndex) {
    if (!Array.isArray(routePoints) || segmentIndex < 0 || segmentIndex >= routePoints.length - 1) {
        return null;
    }
    const start = routePoints[segmentIndex];
    const end = routePoints[segmentIndex + 1];
    if (!start || !end) {
        return null;
    }
    return { start, end };
}

function getJumpSegmentT(segment, pointPx) {
    if (!segment || !pointPx) {
        return null;
    }

    const dx = segment.end.x - segment.start.x;
    const dy = segment.end.y - segment.start.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= 0.0001) {
        return 0;
    }

    const projection = ((pointPx.x - segment.start.x) * dx + (pointPx.y - segment.start.y) * dy) / lengthSquared;
    return clampNumber(projection, 0, 1);
}

function getJumpPointForRoute(routePoints, jump) {
    if (!Array.isArray(routePoints) || routePoints.length < 2 || !jump) {
        return null;
    }

    let segmentIndex = Number.isInteger(jump?.segmentIndex) ? jump.segmentIndex : null;
    let segment = Number.isInteger(segmentIndex) ? getRouteSegmentAtIndex(routePoints, segmentIndex) : null;
    let t = Number.isFinite(jump?.t) ? clampNumber(jump.t, 0, 1) : null;
    let pointPx = Number.isFinite(jump?.x) && Number.isFinite(jump?.y)
        ? { x: jump.x, y: jump.y }
        : null;

    if (!segment) {
        if (!pointPx && (jump?.uX == null || jump?.uY == null)) {
            return null;
        }
        pointPx = pointPx ?? getScreenPointFromUnits(jump.uX, jump.uY);
        const candidates = getJumpSegmentIndicesForRoute(routePoints, pointPx);
        if (!candidates.length) {
            return null;
        }
        segmentIndex = candidates.includes(jump?.segmentIndex) ? jump.segmentIndex : candidates[0];
        segment = getRouteSegmentAtIndex(routePoints, segmentIndex);
        t = getJumpSegmentT(segment, pointPx);
    } else if (t == null && pointPx) {
        t = getJumpSegmentT(segment, pointPx);
    } else if (t == null && jump?.uX != null && jump?.uY != null) {
        t = getJumpSegmentT(segment, getScreenPointFromUnits(jump.uX, jump.uY));
    } else if (t == null) {
        t = 0.5;
    }

    if (!segment || t == null) {
        return null;
    }

    const resolvedPointPx = {
        x: segment.start.x + (segment.end.x - segment.start.x) * t,
        y: segment.start.y + (segment.end.y - segment.start.y) * t,
    };
    const units = getUnitsFromScreenPoint(resolvedPointPx);
    return {
        ...resolvedPointPx,
        uX: units.uX,
        uY: units.uY,
        segmentIndex,
        t,
    };
}

function getResolvedJumpPointsForRoute(routePoints, jumps) {
    return (jumps ?? [])
        .map((jump) => getJumpPointForRoute(routePoints, jump))
        .filter(Boolean)
        .filter((jump, index, entries) =>
            entries.findIndex((candidate) =>
                candidate.segmentIndex === jump.segmentIndex
                && Math.abs(candidate.t - jump.t) < 0.0001,
            ) === index,
        );
}

function getJumpSegmentIndicesForRoute(routePoints, pointPx) {
    const matches = [];
    for (let index = 0; index < routePoints.length - 1; index += 1) {
        if (window.AuraRouting?.isPointOnSegment?.(pointPx, routePoints[index], routePoints[index + 1])) {
            matches.push(index);
        }
    }
    return matches;
}

function resolveJumpSegmentIndex(routePoints, jump) {
    return getJumpPointForRoute(routePoints, jump)?.segmentIndex ?? null;
}

function reindexJumpsForRoute(routePoints, jumps, options = {}) {
    if (!jumps || jumps.length === 0) {
        return undefined;
    }
    const excludePoint = options.excludePoint ?? null;
    const pointsAlmostEqual = window.AuraRouting?.pointsAlmostEqual;

    const keptJumps = getResolvedJumpPointsForRoute(routePoints, jumps)
        .filter((jump) => !(excludePoint && (pointsAlmostEqual?.(jump, excludePoint) ?? false)))
        .map((jump) => ({
            uX: jump.uX,
            uY: jump.uY,
            segmentIndex: jump.segmentIndex,
            t: jump.t,
        }));

    return keptJumps.length > 0 ? keptJumps : undefined;
}

function getRouteSegmentJumps(routePoints, jumps, segmentIndex) {
    if (!Array.isArray(routePoints) || routePoints.length < 2) {
        return [];
    }
    return (jumps || [])
        .map((jump) => getJumpPointForRoute(routePoints, jump))
        .filter((jump) => jump?.segmentIndex === segmentIndex)
        .map((jump) => ({
            x: jump.x,
            y: jump.y,
            segmentIndex: jump.segmentIndex,
            t: jump.t,
        }));
}

function getDraftSegmentIndex(routePoints) {
    if (!Array.isArray(routePoints) || routePoints.length < 2) {
        return 0;
    }
    return routePoints.length - 2;
}

function filterJumpPointsForRoute(routePoints, jumpPoints) {
    if (!jumpPoints || jumpPoints.length === 0) {
        return undefined;
    }

    const keptJumpPoints = jumpPoints.filter((jumpPoint) => {
        const pointPx = getScreenPointFromUnits(jumpPoint.uX, jumpPoint.uY);
        for (let index = 0; index < routePoints.length - 1; index += 1) {
            if (window.AuraRouting?.isPointOnSegment?.(pointPx, routePoints[index], routePoints[index + 1])) {
                return true;
            }
        }
        return false;
    });

    return keptJumpPoints.length > 0 ? keptJumpPoints : undefined;
}

function splitRoutePointsAtPoint(routePoints, splitPoint) {
    const normalizedPoints = routePoints.filter((point, index) => {
        if (index === 0) {
            return true;
        }
        return !(window.AuraRouting?.pointsAlmostEqual?.(point, routePoints[index - 1]) ?? false);
    });

    for (let index = 0; index < normalizedPoints.length - 1; index += 1) {
        const start = normalizedPoints[index];
        const end = normalizedPoints[index + 1];

        const onHorizontalSegment =
            Math.abs(start.y - end.y) < 0.01
            && Math.abs(splitPoint.y - start.y) < 0.01
            && splitPoint.x >= Math.min(start.x, end.x) - 0.01
            && splitPoint.x <= Math.max(start.x, end.x) + 0.01;
        const onVerticalSegment =
            Math.abs(start.x - end.x) < 0.01
            && Math.abs(splitPoint.x - start.x) < 0.01
            && splitPoint.y >= Math.min(start.y, end.y) - 0.01
            && splitPoint.y <= Math.max(start.y, end.y) + 0.01;

        if (!onHorizontalSegment && !onVerticalSegment) {
            continue;
        }

        if (
            window.AuraRouting?.pointsAlmostEqual?.(splitPoint, start)
            || window.AuraRouting?.pointsAlmostEqual?.(splitPoint, end)
        ) {
            return null;
        }

        return {
            firstRoute: [...normalizedPoints.slice(0, index + 1), splitPoint],
            secondRoute: [splitPoint, ...normalizedPoints.slice(index + 1)],
        };
    }

    return null;
}

function nextSplitWireId(baseId, existingIds) {
    let index = 1;
    let candidate = `${baseId}_${index}`;
    while (existingIds.has(candidate)) {
        index += 1;
        candidate = `${baseId}_${index}`;
    }
    existingIds.add(candidate);
    return candidate;
}

function nextGeneratedWireId(existingIds = new Set(wires.map((wire) => String(wire.id)))) {
    let index = 1;
    let candidate = `wire_${index}`;
    while (existingIds.has(candidate)) {
        index += 1;
        candidate = `wire_${index}`;
    }
    existingIds.add(candidate);
    return candidate;
}

function resolveWireEndpoint(endpoint) {
    const normalizedEndpoint = normalizeEndpoint(endpoint);
    if (!normalizedEndpoint) {
        return null;
    }

    if (normalizedEndpoint.kind === "junction") {
        const junction = getJunctionById(normalizedEndpoint.junctionId);
        if (!junction) {
            return null;
        }
        const point = getJunctionScreenPoint(junction);
        return {
            kind: "junction",
            junction,
            junctionId: junction.id,
            label: junction.id,
            uX: junction.uX,
            uY: junction.uY,
            point,
            direction: undefined,
        };
    }

    const comp = findComponentById(normalizedEndpoint.compId);
    const pin = comp ? findPinById(comp, normalizedEndpoint.pinId) : null;
    if (!comp || !pin) {
        return null;
    }

    const pinScreen = getPinScreenGeometry(comp, pin);
    return {
        kind: "pin",
        comp,
        pin,
        compId: normalizedEndpoint.compId,
        pinId: normalizedEndpoint.pinId,
        label: pinScreen.label,
        uX: pinScreen.uX,
        uY: pinScreen.uY,
        point: { x: pinScreen.screenX, y: pinScreen.screenY },
        direction: getPinRoutingDirection(comp, pin),
    };
}

function findHoveredPin(uX, uY) {
    const maxDistance = (currentTool === "wire" || activeWire) ? 5 : 3;
    let bestHit = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const comp of components) {
        const def = COMPONENT_DEFS[comp.type];
        if (!def?.pins?.length) {
            continue;
        }
        for (const pin of def.pins) {
            const pinWorld = getPinWorldGeometry(comp, pin);
            const distance = Math.hypot(uX - pinWorld.uX, uY - pinWorld.uY);
            if (distance <= maxDistance && distance < bestDistance) {
                bestHit = pinWorld;
                bestDistance = distance;
            }
        }
    }

    for (const wire of wires) {
        const endpoints = [resolveWireEndpoint(wire.from), resolveWireEndpoint(wire.to)];
        for (const endpoint of endpoints) {
            if (!endpoint) {
                continue;
            }
            const distance = Math.hypot(uX - endpoint.uX, uY - endpoint.uY);
            if (distance <= maxDistance && distance < bestDistance) {
                bestHit = endpoint;
                bestDistance = distance;
            }
        }
    }

    return bestHit;
}

function buildRoutedPath(startEndpoint, endPoint, endDirection, obstacles, penaltySegments, startAnchor = null, endAnchor = null) {
    const router = window.AuraRouting;
    if (!startEndpoint || !endPoint) {
        return [];
    }
    const fromAnchor = startAnchor ?? startEndpoint.point;
    const toAnchor = endAnchor ?? endPoint;
    const fallbackAnchoredPath = [
        fromAnchor,
        { x: toAnchor.x, y: fromAnchor.y },
        toAnchor,
    ];
    if (!router?.getAutoroutePath) {
        return [startEndpoint.point, ...fallbackAnchoredPath, endPoint].filter((point, index, points) => {
            if (index === 0) {
                return true;
            }
            return !(router?.pointsAlmostEqual?.(points[index - 1], point) ?? false);
        });
    }
    const anchoredRoute = router.getAutoroutePath(
        fromAnchor,
        toAnchor,
        startEndpoint.direction,
        endDirection,
        obstacles,
        penaltySegments,
    );
    const route = Array.isArray(anchoredRoute) && anchoredRoute.length >= 2 ? anchoredRoute : fallbackAnchoredPath;
    return [startEndpoint.point, ...route, endPoint].filter((point, index, points) => {
        if (index === 0) {
            return true;
        }
        return !(router?.pointsAlmostEqual?.(points[index - 1], point) ?? false);
    });
}

function getMagneticToleranceUnits() {
    return 12 / (pixelsPerUnit * zoom);
}

function applyOrthogonalAssistUnits(point, anchorPoints, toleranceUnits) {
    let nextUX = point.uX;
    let nextUY = point.uY;
    let bestXDistance = toleranceUnits;
    let bestYDistance = toleranceUnits;

    anchorPoints.forEach((anchor) => {
        const xDistance = Math.abs(anchor.uX - point.uX);
        if (xDistance < bestXDistance) {
            bestXDistance = xDistance;
            nextUX = anchor.uX;
        }

        const yDistance = Math.abs(anchor.uY - point.uY);
        if (yDistance < bestYDistance) {
            bestYDistance = yDistance;
            nextUY = anchor.uY;
        }
    });

    return {
        uX: nextUX,
        uY: nextUY,
    };
}

function getActiveWireAnchorPoints() {
    if (!activeWire?.from) {
        return [];
    }
    const startEndpoint = resolveWireEndpoint(activeWire.from);
    return [
        ...(startEndpoint ? [{ uX: startEndpoint.uX, uY: startEndpoint.uY }] : []),
        ...(activeWire.routePoints ?? []),
    ];
}

function getAssistedActiveWirePoint(uX, uY) {
    if (!activeWire?.from) {
        return { uX, uY };
    }
    return applyOrthogonalAssistUnits(
        { uX, uY },
        getActiveWireAnchorPoints(),
        getMagneticToleranceUnits(),
    );
}

function getManualWirePoints(wire, endPoint = null) {
    const startEndpoint = resolveWireEndpoint(wire?.from);
    if (!startEndpoint) {
        return [];
    }
    const routePoints = Array.isArray(wire?.routePoints) ? wire.routePoints : [];
    const screenPoints = [
        startEndpoint.point,
        ...routePoints.map((point) => getScreenPointFromUnits(point.uX, point.uY)),
    ];
    if (endPoint) {
        screenPoints.push(endPoint);
    }
    return screenPoints;
}

function getExplicitWirePoints(renderedRoutes) {
    return [
        ...junctions.map((junction) => getJunctionScreenPoint(junction)),
        ...renderedRoutes.flatMap((route) => [
            route.start.point,
            route.end.point,
            ...getResolvedJumpPointsForRoute(route.routePoints, getWireJumps(route.connection)).map((jump) => ({
                x: jump.x,
                y: jump.y,
                segmentIndex: jump.segmentIndex,
            })),
        ]),
    ];
}

function inflateBounds(bounds, padding) {
    return {
        left: bounds.left - padding,
        top: bounds.top - padding,
        right: bounds.right + padding,
        bottom: bounds.bottom + padding,
    };
}

function boundsIntersect(first, second) {
    return !(
        first.right < second.left
        || first.left > second.right
        || first.bottom < second.top
        || first.top > second.bottom
    );
}

function getBoundsDistance(first, second) {
    const dx = Math.max(0, first.left - second.right, second.left - first.right);
    const dy = Math.max(0, first.top - second.bottom, second.top - first.bottom);
    return Math.hypot(dx, dy);
}

function buildLocalAutorouteContext(targetWire, renderedRoutes, start, end, startAnchor, endAnchor) {
    const targetRoute = renderedRoutes.find((route) => String(route.connection.id) === String(targetWire.id));
    const targetRoutePoints = targetRoute?.routePoints?.length
        ? targetRoute.routePoints
        : [start.point, startAnchor, endAnchor, end.point].filter(Boolean);
    const targetBounds = getWireBounds(targetRoutePoints);
    const manhattanDistance =
        Math.abs(start.point.x - end.point.x)
        + Math.abs(start.point.y - end.point.y);
    const localPadding = clampNumber(
        manhattanDistance * 0.8,
        AUTOROUTE_LOCAL_PADDING_MIN,
        AUTOROUTE_LOCAL_PADDING_MAX,
    );
    const localBounds = inflateBounds(targetBounds, localPadding);
    const obstacleBounds = inflateBounds(localBounds, AUTOROUTE_LOCAL_OBSTACLE_PADDING);

    const otherRoutes = renderedRoutes
        .filter((route) => String(route.connection.id) !== String(targetWire.id))
        .map((route) => ({
            ...route,
            bounds: getWireBounds(route.routePoints),
        }))
        .filter((route) => boundsIntersect(route.bounds, localBounds))
        .sort((left, right) => getBoundsDistance(left.bounds, localBounds) - getBoundsDistance(right.bounds, localBounds))
        .slice(0, AUTOROUTE_REFERENCE_ROUTE_LIMIT)
        .map(({ bounds, ...route }) => route);

    const routeObstacles = getAutorouteRoutingObstacles(targetWire)
        .filter((rect) => boundsIntersect(rect, obstacleBounds));
    const explicitPoints = [
        ...getExplicitWirePoints(otherRoutes),
        start.point,
        startAnchor,
        endAnchor,
        end.point,
    ]
        .filter(Boolean)
        .filter((point) =>
            point.x >= obstacleBounds.left
            && point.x <= obstacleBounds.right
            && point.y >= obstacleBounds.top
            && point.y <= obstacleBounds.bottom,
        )
        .filter((point, index, entries) =>
            entries.findIndex((candidate) =>
                Math.abs(candidate.x - point.x) < 0.01
                && Math.abs(candidate.y - point.y) < 0.01,
            ) === index,
        );
    const penaltySegments = otherRoutes.flatMap((route) =>
        getConnectionSegments(route.routePoints).map((segment) => ({
            start: segment.start,
            end: segment.end,
            penalty: 340,
            radius: 14,
        })),
    );

    return {
        otherRoutes,
        routeObstacles,
        explicitPoints,
        penaltySegments,
    };
}

function buildRenderedWireRoutes() {
    const penaltySegments = [];
    const renderedRoutes = [];

    wires.forEach((wire) => {
        const start = resolveWireEndpoint(wire.from);
        const end = resolveWireEndpoint(wire.to);
        if (!start || !end) {
            return;
        }

        const hasManualRoute = Array.isArray(wire.routePoints) && wire.routePoints.length > 0;
        const routePoints = hasManualRoute
            ? getManualWirePoints(wire, end.point)
            : [start.point, end.point];
        if (routePoints.length < 2) {
            return;
        }

        renderedRoutes.push({
            connection: wire,
            start,
            end,
            routePoints,
        });
        penaltySegments.push(...getConnectionSegments(routePoints).map((segment) => ({
            start: segment.start,
            end: segment.end,
        })));
    });

    return renderedRoutes;
}

function isRouteTerminalPoint(routePoints, point) {
    if (!Array.isArray(routePoints) || routePoints.length < 2 || !point) {
        return false;
    }
    const pointsAlmostEqual = window.AuraRouting?.pointsAlmostEqual;
    return (pointsAlmostEqual?.(routePoints[0], point) ?? false)
        || (pointsAlmostEqual?.(routePoints[routePoints.length - 1], point) ?? false);
}

function buildJumpHintSegmentIndices(routePoints, hint) {
    if (!Array.isArray(routePoints) || routePoints.length < 2 || !hint) {
        return [];
    }
    if (Number.isInteger(hint.segmentIndex)) {
        return [hint.segmentIndex - 1, hint.segmentIndex, hint.segmentIndex + 1]
            .filter((segmentIndex) => segmentIndex >= 0 && segmentIndex < routePoints.length - 1)
            .filter((segmentIndex, index, entries) => entries.indexOf(segmentIndex) === index);
    }
    return Array.from({ length: routePoints.length - 1 }, (_, index) => index);
}

function buildPinLeadRoutes() {
    const routes = [];

    components.forEach((component) => {
        const def = COMPONENT_DEFS[component.type];
        if (!def?.pins?.length) {
            return;
        }

        def.pins.forEach((pin) => {
            const geometry = getPinScreenGeometry(component, pin);
            if (
                !Number.isFinite(geometry.screenX)
                || !Number.isFinite(geometry.screenY)
                || !Number.isFinite(geometry.innerScreenX)
                || !Number.isFinite(geometry.innerScreenY)
            ) {
                return;
            }

            if (Math.hypot(geometry.screenX - geometry.innerScreenX, geometry.screenY - geometry.innerScreenY) < 0.5) {
                return;
            }

            routes.push({
                connection: {
                    id: `__pinlead__:${component.id}:${getPinId(pin)}`,
                },
                start: {
                    point: { x: geometry.innerScreenX, y: geometry.innerScreenY },
                    uX: geometry.innerUX,
                    uY: geometry.innerUY,
                },
                end: {
                    point: { x: geometry.screenX, y: geometry.screenY },
                    uX: geometry.uX,
                    uY: geometry.uY,
                },
                routePoints: [
                    { x: geometry.innerScreenX, y: geometry.innerScreenY },
                    { x: geometry.screenX, y: geometry.screenY },
                ],
            });
        });
    });

    return routes;
}

function findBestLiveCrossing(route, otherRoutes, hint, candidateSegmentIndices, tolerancePx) {
    const routing = window.AuraRouting;
    if (!routing?.getSegmentIntersectionPoint) {
        return null;
    }

    let best = null;
    let bestDistance = tolerancePx;

    candidateSegmentIndices.forEach((segmentIndex) => {
        const segment = getRouteSegmentAtIndex(route.routePoints, segmentIndex);
        if (!segment) {
            return;
        }

        otherRoutes.forEach((otherRoute) => {
            for (let otherIndex = 0; otherIndex < otherRoute.routePoints.length - 1; otherIndex += 1) {
                const otherSegment = getRouteSegmentAtIndex(otherRoute.routePoints, otherIndex);
                if (!otherSegment) {
                    continue;
                }

                const intersection = routing.getSegmentIntersectionPoint(
                    segment.start,
                    segment.end,
                    otherSegment.start,
                    otherSegment.end,
                );
                if (!intersection) {
                    continue;
                }
                if (
                    isRouteTerminalPoint(route.routePoints, intersection)
                    || isRouteTerminalPoint(otherRoute.routePoints, intersection)
                ) {
                    continue;
                }

                const distance = Math.hypot(intersection.x - hint.x, intersection.y - hint.y);
                if (distance <= bestDistance) {
                    bestDistance = distance;
                    best = {
                        x: intersection.x,
                        y: intersection.y,
                        segmentIndex,
                    };
                }
            }
        });
    });

    return best;
}

function findNearestLiveCrossingForHint(route, otherRoutes, hint) {
    const localSegmentIndices = buildJumpHintSegmentIndices(route.routePoints, hint);
    const localMatch = findBestLiveCrossing(
        route,
        otherRoutes,
        hint,
        localSegmentIndices,
        LIVE_JUMP_LOCAL_TOLERANCE_PX,
    );
    if (localMatch) {
        return localMatch;
    }

    const fullSegmentIndices = Array.from({ length: Math.max(0, route.routePoints.length - 1) }, (_, index) => index);
    return findBestLiveCrossing(
        route,
        otherRoutes,
        hint,
        fullSegmentIndices,
        LIVE_JUMP_FALLBACK_TOLERANCE_PX,
    );
}

function getLiveJumpOverlaysForRoute(route, allRoutes, jumps) {
    const hintPoints = getResolvedJumpPointsForRoute(route.routePoints, jumps);
    if (!hintPoints.length) {
        return [];
    }

    const otherRoutes = allRoutes.filter((candidate) =>
        String(candidate.connection.id) !== String(route.connection.id),
    );
    const overlays = hintPoints
        .map((hint) => findNearestLiveCrossingForHint(route, otherRoutes, hint))
        .filter(Boolean);

    return overlays.filter((jump, index, entries) =>
        entries.findIndex((candidate) =>
            candidate.segmentIndex === jump.segmentIndex
            && Math.hypot(candidate.x - jump.x, candidate.y - jump.y) < 0.5
        ) === index,
    );
}

function getDynamicWireJumpOverlays(renderedRoutes) {
    const bridgeReferenceRoutes = [...renderedRoutes, ...buildPinLeadRoutes()];
    return new Map(renderedRoutes.map((route) => [
        String(route.connection.id),
        getLiveJumpOverlaysForRoute(route, bridgeReferenceRoutes, getWireJumps(route.connection)),
    ]));
}

function computeAutoroutedInteriorRoute(targetWire) {
    if (!targetWire) {
        return null;
    }

    const start = resolveWireEndpoint(targetWire.from);
    const end = resolveWireEndpoint(targetWire.to);
    if (!start || !end) {
        return null;
    }

    const startAnchor = getEndpointRouteAnchor(start) ?? start.point;
    const endAnchor = getEndpointRouteAnchor(end) ?? end.point;
    const renderedRoutes = buildRenderedWireRoutes();
    const {
        otherRoutes,
        routeObstacles,
        explicitPoints,
        penaltySegments,
    } = buildLocalAutorouteContext(targetWire, renderedRoutes, start, end, startAnchor, endAnchor);
    const candidate = window.AuraRouting?.buildAutoroutedConnectionRoute?.({
        startPoint: start.point,
        endPoint: end.point,
        startAnchor,
        endAnchor,
        preferredStartDirection: start.direction,
        preferredEndDirection: end.direction,
        obstacles: routeObstacles,
        routeReferenceRoutes: otherRoutes,
        explicitPoints,
        penaltySegments,
    });
    const routePoints = candidate?.routePoints ?? buildRoutedPath(
        start,
        end.point,
        end.direction,
        routeObstacles,
        penaltySegments,
        startAnchor,
        endAnchor,
    );

    return routePointsScreenToUnits(
        window.AuraRouting?.getConnectionInteriorRoutePoints?.(routePoints) ?? routePoints.slice(1, -1),
    );
}

function applyAutorouteToWire(wireId) {
    const targetWire = wires.find((wire) => String(wire.id) === String(wireId));
    if (!targetWire) {
        return false;
    }
    const interiorRoutePoints = computeAutoroutedInteriorRoute(targetWire);
    if (!interiorRoutePoints) {
        return false;
    }

    wires = wires.map((wire) =>
        String(wire.id) === String(wireId)
            ? {
                ...wire,
                routePoints: interiorRoutePoints,
                jumps: [],
            }
            : wire,
    );
    return true;
}

function waitForNextFrame() {
    return new Promise((resolve) => {
        window.requestAnimationFrame(() => resolve());
    });
}

function waitForMacrotask() {
    return new Promise((resolve) => {
        window.setTimeout(resolve, 0);
    });
}

function areJumpListsEquivalent(left, right) {
    if ((left?.length ?? 0) !== (right?.length ?? 0)) {
        return false;
    }

    return (left ?? []).every((jump, index) => {
        const other = right[index];
        return !!other
            && jump.segmentIndex === other.segmentIndex
            && Math.abs((jump.t ?? 0) - (other.t ?? 0)) < 0.0001
            && Math.abs((jump.uX ?? 0) - (other.uX ?? 0)) < 0.0001
            && Math.abs((jump.uY ?? 0) - (other.uY ?? 0)) < 0.0001;
    });
}

function refreshStoredWireJumpAnchors() {
    const routedById = new Map(buildRenderedWireRoutes().map((route) => [String(route.connection.id), route]));
    let changed = false;

    wires = wires.map((wire) => {
        const currentJumps = getWireJumps(wire);
        if (!currentJumps.length) {
            return wire;
        }

        const rendered = routedById.get(String(wire.id));
        if (!rendered) {
            return wire;
        }

        const nextJumps = reindexJumpsForRoute(rendered.routePoints, currentJumps);
        if (areJumpListsEquivalent(currentJumps, nextJumps ?? [])) {
            return wire;
        }

        changed = true;
        if (nextJumps?.length) {
            return {
                ...wire,
                jumps: nextJumps,
            };
        }

        const nextWire = { ...wire };
        delete nextWire.jumps;
        delete nextWire.jumpPoints;
        return nextWire;
    });

    return changed;
}

async function autorouteSelectedWires(wireIds) {
    const requestedIds = dedupeIds(wireIds).filter((wireId) =>
        wires.some((wire) => String(wire.id) === String(wireId)),
    );
    const targetIds = requestedIds.slice(0, AUTOROUTE_BATCH_LIMIT);
    if (!targetIds.length) {
        autorouteRequestWireId = null;
        autorouteBatchWireIds = [];
        autorouteBatchProgress = 0;
        autorouteBatchRequestedCount = 0;
        refreshWireAutoroutePanel();
        draw();
        return;
    }

    autorouteBatchWireIds = [...targetIds];
    autorouteBatchProgress = 0;
    autorouteBatchRequestedCount = requestedIds.length;
    let changed = false;

    for (let index = 0; index < targetIds.length; index += 1) {
        autorouteBatchProgress = index;
        autorouteRequestWireId = targetIds[index];
        refreshWireAutoroutePanel();
        changed = applyAutorouteToWire(targetIds[index]) || changed;
        draw();
        if (index < targetIds.length - 1) {
            await waitForNextFrame();
            if ((index + 1) % AUTOROUTE_BATCH_FRAME_YIELD_EVERY === 0) {
                await waitForMacrotask();
            }
        }
    }

    autorouteRequestWireId = null;
    autorouteBatchWireIds = [];
    autorouteBatchProgress = 0;
    autorouteBatchRequestedCount = 0;
    if (changed) {
        saveHistory();
    }
    refreshWireAutoroutePanel();
    draw();
}

function toSchematicInstancesFromPayload(payload) {
    if (payload?.schema === "aura.scene_state.v1") {
        return {
            sceneState: payload,
        };
    }

    if (payload?.schema === "aura.schematic_document.v1") {
        return {
            title: payload.metadata?.title || "Imported schematic",
            instances: payload.instances ?? [],
            nets: payload.nets ?? [],
        };
    }

    if (payload?.schema === "aura.circuit_ir.v1") {
        const componentPackageById = new Map((payload.components ?? []).map((component) => [
            String(component.id),
            String(component.packageId ?? ""),
        ]));
        const instances = (payload.components ?? []).map((component) => {
            const symbolKey = mapCircuitIrPackageToSymbolKey(component);
            return {
                id: component.id,
                symbolKey,
                reference: component.reference,
                value: component.attrs?.value ?? "",
                fields: component.attrs ?? {},
                placement: component.placement ?? {},
                packageId: component.packageId,
            };
        });
        const nets = (payload.nets ?? []).map((net) => ({
            id: net.id,
            label: net.label,
            connections: (net.connections ?? []).map((connection) => ({
                instanceId: connection.componentId,
                pinId: mapCircuitIrPinToSymbolPin(
                    componentPackageById.get(String(connection.componentId)),
                    connection.pinId,
                ),
            })),
        }));
        return {
            title: payload.metadata?.title || "Imported circuit IR",
            instances,
            nets,
        };
    }

    throw new Error("Unsupported schema. Use aura.scene_state.v1, aura.schematic_document.v1, or aura.circuit_ir.v1.");
}

function normalizeSceneStateImportEndpoint(endpoint, label) {
    if (!endpoint || typeof endpoint !== "object") {
        throw new Error(`${label} is required.`);
    }
    if (endpoint.kind === "pin") {
        if (!endpoint.componentId || !endpoint.pinId) {
            throw new Error(`${label} pin endpoint requires componentId and pinId.`);
        }
        return {
            kind: "pin",
            compId: String(endpoint.componentId),
            pinId: String(endpoint.pinId),
        };
    }
    if (endpoint.kind === "junction") {
        if (!endpoint.junctionId) {
            throw new Error(`${label} junction endpoint requires junctionId.`);
        }
        return {
            kind: "junction",
            junctionId: String(endpoint.junctionId),
        };
    }
    throw new Error(`${label} endpoint kind must be pin or junction.`);
}

function normalizeSceneStateImportRoutePoints(routePoints, label) {
    if (!Array.isArray(routePoints)) {
        throw new Error(`${label} routePoints must be an array.`);
    }
    return routePoints.map((point, index) => {
        if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) {
            throw new Error(`${label} routePoints[${index}] requires numeric x and y.`);
        }
        return {
            uX: Number(point.x),
            uY: Number(point.y),
        };
    });
}

async function buildStudioStateFromSceneStatePayload(payload) {
    const sceneComponents = Array.isArray(payload.components) ? payload.components : [];
    const uniqueSymbolKeys = Array.from(new Set(
        sceneComponents
            .map((component) => String(component?.symbolKey || ""))
            .filter(Boolean),
    ));
    await Promise.all(uniqueSymbolKeys.map((symbolKey) => ensureComponentDefByKey(symbolKey)));

    const importedComponents = sceneComponents.map((component, index) => {
        if (!component?.id || !component?.symbolKey) {
            throw new Error(`components[${index}] requires id and symbolKey.`);
        }
        const def = COMPONENT_DEFS[component.symbolKey];
        if (!def) {
            throw new Error(`Missing symbol definition for ${component.symbolKey}`);
        }
        const placement = normalizeImportedPlacement(component.placement);
        return {
            id: String(component.id),
            type: String(component.symbolKey),
            refdes: component.reference || nextReferenceFor(def),
            uX: placement.uX,
            uY: placement.uY,
            rotation: placement.rotation,
            properties: {
                ...(component.fields ?? {}),
                ...(component.properties ?? {}),
                ...(component.value ? { value: component.value } : {}),
            },
        };
    });

    const componentById = new Map(importedComponents.map((component) => [String(component.id), component]));
    const importedJunctions = (payload.junctions ?? []).map((junction, index) => {
        if (!junction?.id || !Number.isFinite(Number(junction.x)) || !Number.isFinite(Number(junction.y))) {
            throw new Error(`junctions[${index}] requires id, x, and y.`);
        }
        return {
            id: String(junction.id),
            uX: Number(junction.x),
            uY: Number(junction.y),
        };
    });
    const junctionById = new Map(importedJunctions.map((junction) => [String(junction.id), junction]));

    const importedWires = (payload.wires ?? []).map((wire, index) => {
        if (!wire?.id) {
            throw new Error(`wires[${index}] requires an id.`);
        }
        const from = normalizeSceneStateImportEndpoint(wire.from, `wires[${index}].from`);
        const to = normalizeSceneStateImportEndpoint(wire.to, `wires[${index}].to`);
        if (from.kind === "pin") {
            const component = componentById.get(String(from.compId));
            const resolvedPinId = component ? resolveImportPinId(component, from.pinId) : null;
            if (!component || !resolvedPinId) {
                throw new Error(`wires[${index}].from references missing pin ${from.compId}:${from.pinId}.`);
            }
            from.pinId = resolvedPinId;
        } else if (!junctionById.has(String(from.junctionId))) {
            throw new Error(`wires[${index}].from references missing junction ${from.junctionId}.`);
        }
        if (to.kind === "pin") {
            const component = componentById.get(String(to.compId));
            const resolvedPinId = component ? resolveImportPinId(component, to.pinId) : null;
            if (!component || !resolvedPinId) {
                throw new Error(`wires[${index}].to references missing pin ${to.compId}:${to.pinId}.`);
            }
            to.pinId = resolvedPinId;
        } else if (!junctionById.has(String(to.junctionId))) {
            throw new Error(`wires[${index}].to references missing junction ${to.junctionId}.`);
        }
        return {
            id: String(wire.id),
            from,
            to,
            color: currentWireColor,
            routePoints: normalizeSceneStateImportRoutePoints(wire.routePoints ?? [], `wires[${index}]`),
            jumps: [],
            properties: {
                ...(wire.properties ?? {}),
                ...(wire.netId ? { netId: String(wire.netId) } : {}),
                ...(wire.label ? { netLabel: String(wire.label) } : {}),
            },
        };
    });

    return {
        title: payload.metadata?.title || "Imported scene state",
        components: importedComponents,
        junctions: importedJunctions,
        wires: importedWires,
    };
}

async function buildStudioStateFromPayload(payload) {
    const normalized = toSchematicInstancesFromPayload(payload);
    if (normalized.sceneState) {
        return buildStudioStateFromSceneStatePayload(normalized.sceneState);
    }
    const unresolvedInstances = normalized.instances.filter((instance) => !instance.symbolKey);
    if (unresolvedInstances.length > 0) {
        throw new Error(`Unable to map symbol keys for: ${unresolvedInstances.map((instance) => instance.reference || instance.id).join(", ")}`);
    }

    const uniqueSymbolKeys = Array.from(new Set(normalized.instances.map((instance) => instance.symbolKey)));
    await Promise.all(uniqueSymbolKeys.map((symbolKey) => ensureComponentDefByKey(symbolKey)));

    const importedComponents = normalized.instances.map((instance) => {
        const def = COMPONENT_DEFS[instance.symbolKey];
        if (!def) {
            throw new Error(`Missing symbol definition for ${instance.symbolKey}`);
        }
        const placement = normalizeImportedPlacement(instance.placement);
        return {
            id: instance.id,
            type: instance.symbolKey,
            refdes: instance.reference || nextReferenceFor(def),
            uX: placement.uX,
            uY: placement.uY,
            rotation: placement.rotation,
            properties: {
                ...(instance.fields ?? {}),
                ...(instance.value ? { value: instance.value } : {}),
            },
        };
    });

    const componentById = new Map(importedComponents.map((component) => [String(component.id), component]));
    const importedJunctions = [];
    const importedWires = [];
    const resolveImportedEndpointPoint = (endpoint) => {
        if (!endpoint || endpoint.kind !== "pin") {
            return null;
        }
        const component = componentById.get(String(endpoint.compId));
        const pin = component ? findPinById(component, endpoint.pinId) : null;
        if (!component || !pin) {
            return null;
        }
        const pinWorld = getPinWorldGeometry(component, pin);
        return getScreenPointFromUnits(pinWorld.uX, pinWorld.uY);
    };

    normalized.nets.forEach((net) => {
        const resolvedConnections = (net.connections ?? [])
            .map((connection) => {
                const component = componentById.get(String(connection.instanceId));
                if (!component) {
                    return null;
                }
                const resolvedPinId = resolveImportPinId(component, connection.pinId);
                if (!resolvedPinId) {
                    return null;
                }
                return {
                    kind: "pin",
                    compId: component.id,
                    pinId: resolvedPinId,
                };
            })
            .filter(Boolean);

        if (resolvedConnections.length < 2) {
            return;
        }

        if (resolvedConnections.length === 2) {
            importedWires.push({
                id: buildImportWireId(net.id || "wire", 1),
                from: resolvedConnections[0],
                to: resolvedConnections[1],
                color: currentWireColor,
                routePoints: [],
                jumps: [],
                properties: net.label ? { netLabel: net.label } : {},
            });
            return;
        }

        const worldPoints = resolvedConnections
            .map((endpoint) => resolveImportedEndpointPoint(endpoint))
            .filter(Boolean);
        const centroid = worldPoints.reduce((acc, point) => ({
            x: acc.x + point.x / worldPoints.length,
            y: acc.y + point.y / worldPoints.length,
        }), { x: 0, y: 0 });
        const junctionUnits = getUnitsFromScreenPoint(centroid);
        const junctionId = `junction_import_${String(net.id || importedJunctions.length + 1)}`;
        const junction = {
            id: junctionId,
            uX: junctionUnits.uX,
            uY: junctionUnits.uY,
        };
        importedJunctions.push(junction);

        resolvedConnections.forEach((endpoint, index) => {
            importedWires.push({
                id: buildImportWireId(net.id || junctionId, index + 1),
                from: endpoint,
                to: { kind: "junction", junctionId },
                color: currentWireColor,
                routePoints: [],
                jumps: [],
                properties: net.label ? { netLabel: net.label } : {},
            });
        });
    });

    return {
        title: normalized.title,
        components: importedComponents,
        junctions: importedJunctions,
        wires: importedWires,
    };
}

async function applyJsonPayloadToCanvas(payload) {
    const importedState = await buildStudioStateFromPayload(payload);

    components = importedState.components;
    junctions = importedState.junctions;
    wires = importedState.wires;

    placingComponent = null;
    activeWire = null;
    handledActiveWireCrossings = [];
    pendingWireTurnCrossingDecision = null;
    clearStageSelection();
    selectedComponent = null;
    selectedComponentIds = [];
    clearWireSelection();
    selectedJunctionId = null;
    autorouteRequestWireId = null;
    closeInspector();
    fitViewportToCanvasContent();
    setJsonImportStatus(`Imported ${components.length} components and ${wires.length} wires.`, "success");
    saveHistory();
    refreshWireAutoroutePanel();
    updateShellStatus();
    draw();
}

function getPinLabelPlacement(pinHit) {
    const u = pixelsPerUnit * zoom;
    const tipScreenX = offsetX + pinHit.uX * u;
    const tipScreenY = offsetY - pinHit.uY * u;

    let outwardUX = pinHit.outwardUX;
    let outwardUY = pinHit.outwardUY;

    if (Math.abs(outwardUX) < 0.001 && Math.abs(outwardUY) < 0.001) {
        const side = String(pinHit.pin?.side || "").toLowerCase();
        if (side === "left") outwardUX = -1;
        else if (side === "right") outwardUX = 1;
        else if (side === "top") outwardUY = 1;
        else if (side === "bottom") outwardUY = -1;
        else outwardUX = 1;
    }

    const length = Math.hypot(outwardUX, outwardUY) || 1;
    const nx = outwardUX / length;
    const ny = outwardUY / length;
    const labelOffsetPx = Math.max(16, 18 * zoom);
    const labelX = tipScreenX + nx * labelOffsetPx;
    const labelY = tipScreenY - ny * labelOffsetPx;

    let textAlign = "center";
    let textBaseline = "middle";
    if (Math.abs(nx) > Math.abs(ny) + 0.1) {
        textAlign = nx >= 0 ? "left" : "right";
    } else if (ny > 0) {
        textBaseline = "bottom";
    } else {
        textBaseline = "top";
    }

    return {
        tipScreenX,
        tipScreenY,
        labelX,
        labelY,
        textAlign,
        textBaseline,
    };
}

function nextReferenceFor(def) {
    const prefix = def.referencePrefix || "U";
    let serial = 1;
    while (components.some((component) => component.refdes === `${prefix}${serial}`) || placingComponent?.refdes === `${prefix}${serial}`) {
        serial += 1;
    }
    return `${prefix}${serial}`;
}

function viewportCenterInUnits() {
    const rect = canvas.getBoundingClientRect();
    const unit = pixelsPerUnit * zoom;
    if (!rect.width || !rect.height || !unit) {
        return { uX: 0, uY: 0 };
    }
    return {
        uX: Math.round((rect.width / 2 - offsetX) / unit),
        uY: Math.round((offsetY - rect.height / 2) / unit),
    };
}

function getComponentWorldBounds(comp) {
    const def = COMPONENT_DEFS[comp.type];
    if (!def) {
        return null;
    }

    const localBounds = computeSymbolBounds(def.graphics ?? [], def.pins ?? []);
    const worldCorners = [
        localPointToWorld(comp, { uX: localBounds.minX, uY: localBounds.minY }),
        localPointToWorld(comp, { uX: localBounds.minX, uY: localBounds.maxY }),
        localPointToWorld(comp, { uX: localBounds.maxX, uY: localBounds.minY }),
        localPointToWorld(comp, { uX: localBounds.maxX, uY: localBounds.maxY }),
    ];

    return {
        left: Math.min(...worldCorners.map((point) => point.uX)),
        right: Math.max(...worldCorners.map((point) => point.uX)),
        top: Math.max(...worldCorners.map((point) => point.uY)),
        bottom: Math.min(...worldCorners.map((point) => point.uY)),
    };
}

function getCanvasContentBoundsInUnits() {
    const bounds = {
        minX: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
    };

    const includePoint = (uX, uY) => {
        if (!Number.isFinite(uX) || !Number.isFinite(uY)) {
            return;
        }
        bounds.minX = Math.min(bounds.minX, uX);
        bounds.maxX = Math.max(bounds.maxX, uX);
        bounds.minY = Math.min(bounds.minY, uY);
        bounds.maxY = Math.max(bounds.maxY, uY);
    };

    components.forEach((component) => {
        const componentBounds = getComponentWorldBounds(component);
        if (!componentBounds) {
            return;
        }
        includePoint(componentBounds.left, componentBounds.bottom);
        includePoint(componentBounds.right, componentBounds.top);
    });

    junctions.forEach((junction) => {
        includePoint(junction.uX, junction.uY);
    });

    wires.forEach((wire) => {
        const start = resolveWireEndpoint(wire.from);
        const end = resolveWireEndpoint(wire.to);
        if (start) {
            includePoint(start.uX, start.uY);
        }
        if (end) {
            includePoint(end.uX, end.uY);
        }
        (wire.routePoints ?? []).forEach((point) => includePoint(point.uX, point.uY));
    });

    if (!Number.isFinite(bounds.minX)) {
        return null;
    }

    return {
        minX: bounds.minX,
        maxX: bounds.maxX,
        minY: bounds.minY,
        maxY: bounds.maxY,
        width: Math.max(1, bounds.maxX - bounds.minX),
        height: Math.max(1, bounds.maxY - bounds.minY),
    };
}

function fitViewportToCanvasContent(paddingPx = 96) {
    const rect = canvas.getBoundingClientRect();
    const bounds = getCanvasContentBoundsInUnits();
    if (!bounds || !rect.width || !rect.height || !pixelsPerUnit) {
        return false;
    }

    const usableWidth = Math.max(80, rect.width - paddingPx * 2);
    const usableHeight = Math.max(80, rect.height - paddingPx * 2);
    const scaleX = usableWidth / bounds.width;
    const scaleY = usableHeight / bounds.height;
    const unitScale = Math.max(2, Math.min(scaleX, scaleY));
    zoom = Math.max(0.15, Math.min(4, unitScale / pixelsPerUnit));

    const renderedUnit = pixelsPerUnit * zoom;
    const centerUX = (bounds.minX + bounds.maxX) / 2;
    const centerUY = (bounds.minY + bounds.maxY) / 2;
    offsetX = rect.width / 2 - centerUX * renderedUnit;
    offsetY = rect.height / 2 + centerUY * renderedUnit;
    return true;
}

function internalSelectionScopeToScene(scope) {
    if (scope === "components") {
        return "parts";
    }
    if (scope === "wires") {
        return "wires";
    }
    return "both";
}

function sceneSelectionScopeToInternal(scope) {
    if (scope === "parts") {
        return "components";
    }
    if (scope === "wires") {
        return "wires";
    }
    return "both";
}

function cloneSceneSelectionState() {
    return {
        componentIds: [...selectedComponentIds],
        wireIds: [...selectedWireIds],
        junctionIds: selectedJunctionId ? [String(selectedJunctionId)] : [],
        scope: internalSelectionScopeToScene(selectionScope),
    };
}

function cloneCurrentStudioScene() {
    return {
        components: JSON.parse(JSON.stringify(components)),
        wires: JSON.parse(JSON.stringify(wires)),
        junctions: JSON.parse(JSON.stringify(junctions)),
        selection: cloneSceneSelectionState(),
    };
}

function findComponentByIdInScene(scene, compId) {
    return scene?.components?.find((comp) => String(comp.id) === String(compId)) ?? null;
}

function findJunctionByIdInScene(scene, junctionId) {
    return scene?.junctions?.find((junction) => String(junction.id) === String(junctionId)) ?? null;
}

function findPinByIdInScene(comp, pinId) {
    const def = comp ? COMPONENT_DEFS[comp.type] : null;
    return def?.pins?.find((pin) => getPinId(pin) === String(pinId)) ?? null;
}

function getComponentWorldBoundsForSceneComponent(comp) {
    const def = COMPONENT_DEFS[comp.type];
    if (!def) {
        return null;
    }

    const localBounds = def.bodyBounds ?? computeSymbolBounds(def.graphics ?? [], []);
    const worldCorners = [
        localPointToWorld(comp, { uX: localBounds.minX, uY: localBounds.minY }),
        localPointToWorld(comp, { uX: localBounds.minX, uY: localBounds.maxY }),
        localPointToWorld(comp, { uX: localBounds.maxX, uY: localBounds.minY }),
        localPointToWorld(comp, { uX: localBounds.maxX, uY: localBounds.maxY }),
    ];

    return {
        left: Math.min(...worldCorners.map((point) => point.uX)),
        right: Math.max(...worldCorners.map((point) => point.uX)),
        top: Math.max(...worldCorners.map((point) => point.uY)),
        bottom: Math.min(...worldCorners.map((point) => point.uY)),
    };
}

function resolveWireEndpointInScene(scene, endpoint) {
    const normalizedEndpoint = normalizeEndpoint(endpoint);
    if (!normalizedEndpoint) {
        return null;
    }

    if (normalizedEndpoint.kind === "junction") {
        const junction = findJunctionByIdInScene(scene, normalizedEndpoint.junctionId);
        if (!junction) {
            return null;
        }
        const point = getScreenPointFromUnits(junction.uX, junction.uY);
        return {
            kind: "junction",
            junction,
            junctionId: junction.id,
            label: junction.id,
            uX: junction.uX,
            uY: junction.uY,
            point,
            direction: undefined,
        };
    }

    const comp = findComponentByIdInScene(scene, normalizedEndpoint.compId);
    const pin = comp ? findPinByIdInScene(comp, normalizedEndpoint.pinId) : null;
    if (!comp || !pin) {
        return null;
    }

    const pinWorld = getPinWorldGeometry(comp, pin);
    const tipScreen = getScreenPointFromUnits(pinWorld.uX, pinWorld.uY);
    return {
        kind: "pin",
        comp,
        pin,
        compId: normalizedEndpoint.compId,
        pinId: normalizedEndpoint.pinId,
        label: pinWorld.label,
        uX: pinWorld.uX,
        uY: pinWorld.uY,
        point: tipScreen,
        direction: getPinRoutingDirection(comp, pin),
    };
}

function getManualWirePointsForScene(scene, wire, endPoint = null) {
    const startEndpoint = resolveWireEndpointInScene(scene, wire?.from);
    if (!startEndpoint) {
        return [];
    }
    const routePoints = Array.isArray(wire?.routePoints) ? wire.routePoints : [];
    const screenPoints = [
        startEndpoint.point,
        ...routePoints.map((point) => getScreenPointFromUnits(point.uX, point.uY)),
    ];
    if (endPoint) {
        screenPoints.push(endPoint);
    }
    return screenPoints;
}

function buildRenderedWireRoutesForScene(scene) {
    const renderedRoutes = [];
    (scene?.wires ?? []).forEach((wire) => {
        const start = resolveWireEndpointInScene(scene, wire.from);
        const end = resolveWireEndpointInScene(scene, wire.to);
        if (!start || !end) {
            return;
        }
        const routePoints = Array.isArray(wire.routePoints) && wire.routePoints.length > 0
            ? getManualWirePointsForScene(scene, wire, end.point)
            : [start.point, end.point];
        if (routePoints.length < 2) {
            return;
        }
        renderedRoutes.push({
            connection: wire,
            start,
            end,
            routePoints,
        });
    });
    return renderedRoutes;
}

function serializeWireEndpointForScene(endpoint) {
    const normalizedEndpoint = normalizeEndpoint(endpoint);
    if (!normalizedEndpoint) {
        return null;
    }
    if (normalizedEndpoint.kind === "junction") {
        return {
            kind: "junction",
            junctionId: String(normalizedEndpoint.junctionId),
        };
    }
    return {
        kind: "pin",
        componentId: String(normalizedEndpoint.compId),
        pinId: String(normalizedEndpoint.pinId),
    };
}

function serializeComponentForSceneState(comp) {
    const def = COMPONENT_DEFS[comp.type];
    const bodyBounds = getComponentWorldBoundsForSceneComponent(comp);
    const fields = Object.fromEntries(
        (def?.fields ?? [])
            .filter((field) => field.visible !== false)
            .map((field) => [field.key, getFieldDisplayText(field, comp, def)]),
    );

    return {
        id: String(comp.id),
        symbolKey: comp.type,
        reference: comp.refdes || def?.referencePrefix || "U?",
        ...(comp.properties?.value ? { value: String(comp.properties.value) } : {}),
        ...(comp.unitId ? { unitId: String(comp.unitId) } : {}),
        ...(Object.keys(fields).length ? { fields } : {}),
        ...(Object.keys(comp.properties ?? {}).length ? { properties: { ...comp.properties } } : {}),
        placement: {
            x: comp.uX,
            y: comp.uY,
            rotationDeg: comp.rotation || 0,
        },
        bodyBounds: bodyBounds ?? {
            left: comp.uX,
            top: comp.uY,
            right: comp.uX,
            bottom: comp.uY,
        },
        pins: (def?.pins ?? []).map((pin) => {
            const geometry = getPinWorldGeometry(comp, pin);
            const direction = getPinRoutingDirection(comp, pin);
            return {
                pinId: getPinId(pin),
                ...(pin.number ? { number: String(pin.number) } : {}),
                ...(pin.name ? { name: String(pin.name) } : {}),
                ...(pin.electricalType ? { electricalType: String(pin.electricalType) } : {}),
                ...(direction ? { direction } : {}),
                x: geometry.uX,
                y: geometry.uY,
            };
        }),
    };
}

function serializeWireForSceneState(wire) {
    return {
        id: String(wire.id),
        ...(wire.netId ? { netId: String(wire.netId) } : {}),
        ...(wire.label ? { label: String(wire.label) } : {}),
        ...(wire.properties?.netLabel && !wire.label ? { label: String(wire.properties.netLabel) } : {}),
        from: serializeWireEndpointForScene(wire.from),
        to: serializeWireEndpointForScene(wire.to),
        routePoints: (wire.routePoints ?? []).map((point) => ({
            x: point.uX,
            y: point.uY,
        })),
    };
}

function buildSceneNetSummary(scene) {
    const adjacency = new Map();
    const wireByNodeKey = new Map();
    const pinMembers = [];
    const junctionMembers = [];

    const ensureNode = (nodeKey) => {
        if (!nodeKey || adjacency.has(nodeKey)) {
            return;
        }
        adjacency.set(nodeKey, new Set());
    };

    const connectNodes = (firstKey, secondKey) => {
        if (!firstKey || !secondKey || firstKey === secondKey) {
            return;
        }
        ensureNode(firstKey);
        ensureNode(secondKey);
        adjacency.get(firstKey)?.add(secondKey);
        adjacency.get(secondKey)?.add(firstKey);
    };

    (scene.components ?? []).forEach((comp) => {
        const def = COMPONENT_DEFS[comp.type];
        (def?.pins ?? []).forEach((pin) => {
            const nodeKey = getGraphNodeKeyForEndpoint({ kind: "pin", compId: comp.id, pinId: getPinId(pin) });
            ensureNode(nodeKey);
            pinMembers.push({
                nodeKey,
                member: {
                    kind: "component_pin",
                    id: String(comp.id),
                    pinId: getPinId(pin),
                },
            });
        });
    });

    (scene.junctions ?? []).forEach((junction) => {
        const nodeKey = getGraphNodeKeyForEndpoint({ kind: "junction", junctionId: junction.id });
        ensureNode(nodeKey);
        junctionMembers.push({
            nodeKey,
            member: {
                kind: "junction",
                id: String(junction.id),
            },
        });
    });

    (scene.wires ?? []).forEach((wire) => {
        const wireNodeKey = `wire:${String(wire.id)}`;
        ensureNode(wireNodeKey);
        wireByNodeKey.set(wireNodeKey, wire);
        connectNodes(wireNodeKey, getGraphNodeKeyForEndpoint(wire.from));
        connectNodes(wireNodeKey, getGraphNodeKeyForEndpoint(wire.to));
    });

    const memberByNodeKey = new Map();
    pinMembers.forEach(({ nodeKey, member }) => memberByNodeKey.set(nodeKey, member));
    junctionMembers.forEach(({ nodeKey, member }) => memberByNodeKey.set(nodeKey, member));

    const nets = [];
    const visited = new Set();
    let fallbackIndex = 1;

    adjacency.forEach((_, nodeKey) => {
        if (visited.has(nodeKey)) {
            return;
        }
        const queue = [nodeKey];
        const cluster = [];
        const labels = [];
        const netIds = [];
        visited.add(nodeKey);

        while (queue.length > 0) {
            const currentNodeKey = queue.shift();
            const wire = wireByNodeKey.get(currentNodeKey);
            const member = memberByNodeKey.get(currentNodeKey);
            if (wire) {
                cluster.push({ kind: "wire", id: String(wire.id) });
                if (wire.label || wire.properties?.netLabel) {
                    labels.push(String(wire.label || wire.properties.netLabel));
                }
                if (wire.netId) {
                    netIds.push(String(wire.netId));
                }
            } else if (member) {
                cluster.push(member);
            }

            (adjacency.get(currentNodeKey) ?? []).forEach((neighbor) => {
                if (visited.has(neighbor)) {
                    return;
                }
                visited.add(neighbor);
                queue.push(neighbor);
            });
        }

        if (!cluster.length) {
            return;
        }
        const hasWire = cluster.some((member) => member.kind === "wire");
        if (!hasWire && cluster.length < 2) {
            return;
        }

        cluster.sort((left, right) => {
            const leftKey = `${left.kind}:${left.id}:${left.pinId ?? ""}`;
            const rightKey = `${right.kind}:${right.id}:${right.pinId ?? ""}`;
            return leftKey.localeCompare(rightKey);
        });

        nets.push({
            id: netIds[0] ?? `net_${fallbackIndex}`,
            ...(labels[0] ? { label: labels[0] } : {}),
            members: cluster,
        });
        fallbackIndex += 1;
    });

    return nets;
}

function exportSceneState(captureSource = "studio_canvas") {
    const scene = cloneCurrentStudioScene();
    return {
        schema: "aura.scene_state.v1",
        metadata: {
            title: "Studio Canvas Scene",
            description: "Live Studio scene export for AI context and patch preview.",
            captureSource,
            sourceSchematicId: "studio-canvas",
            sourceRevision: Math.max(0, historyIndex),
            standard: "iec",
        },
        canvas: {
            grid: {
                unitMm: BASE_UNIT_MM,
                pixelsPerUnit,
            },
            viewport: {
                zoom,
                offsetX,
                offsetY,
            },
        },
        components: scene.components.map(serializeComponentForSceneState),
        wires: scene.wires.map(serializeWireForSceneState),
        junctions: scene.junctions.map((junction) => ({
            id: String(junction.id),
            x: junction.uX,
            y: junction.uY,
        })),
        selection: scene.selection,
        netSummary: buildSceneNetSummary(scene),
        issues: [],
    };
}

function buildAllowedSymbolKeys() {
    return dedupeIds([
        ...COMMON_COMPONENTS.map((entry) => `${entry.libraryId}:${entry.symbolId}`),
        ...components.map((component) => String(component.type)),
    ]).sort((left, right) => left.localeCompare(right));
}

function buildAiProjectKeyFromScene(sceneState) {
    return String(sceneState?.metadata?.sourceSchematicId || "").trim() || "studio-canvas";
}

function buildSelectionContextSummary() {
    const componentSummary = selectedComponentIds.length
        ? `components=${selectedComponentIds.join(", ")}`
        : "components=none";
    const wireSummary = selectedWireIds.length
        ? `wires=${selectedWireIds.join(", ")}`
        : "wires=none";
    const junctionSummary = selectedJunctionId
        ? `junction=${selectedJunctionId}`
        : "junction=none";
    return `${componentSummary}; ${wireSummary}; ${junctionSummary}; scope=${internalSelectionScopeToScene(selectionScope)}`;
}

function buildExternalAiPromptPack(userRequest) {
    const trimmedRequest = String(userRequest ?? "").trim();
    if (!trimmedRequest) {
        throw new Error("Enter a user request before generating the prompt pack.");
    }

    const sceneState = exportSceneState();
    const allowedSymbols = buildAllowedSymbolKeys();
    const examplePatch = {
        ...AI_PATCH_EXAMPLE,
        metadata: {
            ...AI_PATCH_EXAMPLE.metadata,
            title: "Example only",
        },
    };

    return [
        "You are generating a deterministic circuit patch for AURA Studio.",
        "",
        "Hard rules:",
        "- Output valid JSON only.",
        "- Do not wrap the JSON in markdown fences.",
        "- Do not include explanation text before or after the JSON.",
        "- The JSON must match schema `aura.circuit_patch.v1`.",
        "- The patch target scene schema must be `aura.scene_state.v1`.",
        "- Preserve existing ids unless you are adding new items.",
        "- Use only the allowed symbol keys listed below for new components.",
        "- Prefer patching the current circuit instead of regenerating it.",
        "- If a component, wire, or junction is not meant to change, leave it untouched.",
        "",
        "User request:",
        trimmedRequest,
        "",
        "Current selection context:",
        buildSelectionContextSummary(),
        "",
        "Allowed symbol keys for new components:",
        JSON.stringify(allowedSymbols, null, 2),
        "",
        "Required patch shape summary:",
        JSON.stringify({
            schema: "aura.circuit_patch.v1",
            metadata: {
                title: "short patch title",
                mode: "preview",
                requestedBy: "external_ai",
            },
            target: {
                sceneSchema: "aura.scene_state.v1",
                sourceSchematicId: "studio-canvas",
                sourceRevision: Math.max(0, historyIndex),
            },
            operations: [
                { op: "add_component", component: { id: "new_id", symbolKey: getPreferredSymbolKey("Device:R"), reference: "R9", placement: { x: 0, y: 0, rotationDeg: 0 } } },
            ],
        }, null, 2),
        "",
        "Current scene state JSON:",
        JSON.stringify(sceneState, null, 2),
        "",
        "Example valid patch JSON:",
        JSON.stringify(examplePatch, null, 2),
        "",
        "Return only one JSON object matching `aura.circuit_patch.v1`.",
    ].join("\n");
}

async function sendBuiltInAiRequest() {
    if (aiRequestInFlight) {
        return;
    }
    const {
        providerSelect,
        modelSelect,
        geminiKeyInput,
        sceneOutput,
        userRequest,
        patchInput,
    } = getAiToolsElements();
    const requestText = String(userRequest?.value ?? "").trim();
    if (!requestText) {
        throw new Error("Enter a request for the built-in AI first.");
    }

    const provider = providerSelect?.value || "ollama";
    const model = String(modelSelect?.value ?? "").trim() || getAiDefaultModelForProvider(provider);
    const sceneState = exportSceneState();
    const projectKey = buildAiProjectKeyFromScene(sceneState);
    const nextConversation = [
        ...aiConversation,
        { role: "user", content: requestText },
    ];

    aiConversation = nextConversation;
    renderAiChatLog();
    openAiPanel("chat");
    openAiPanel("canvas");
    if (sceneOutput) {
        sceneOutput.value = JSON.stringify(sceneState, null, 2);
    }

    setAiControlsBusy(true);
    setAiResponseOutput("");
    setAiToolsStatus(`Preparing patch request for ${provider}...`);
    setAiRunStatus(`Preparing scene export and patch request for ${provider}:${model}...`, "busy");

    try {
        setAiToolsStatus(`Sending patch request to ${provider}:${model}...`);
        setAiRunStatus(`Waiting for ${provider}:${model}. First local response can take time while Ollama loads the model...`, "busy");
        const result = await apiPostWithTimeout("/ai/generate-patch", {
            provider,
            model,
            projectKey,
            apiKey: provider === "gemini" ? String(geminiKeyInput?.value ?? "").trim() : "",
            sceneState,
            allowedSymbolKeys: buildAllowedSymbolKeys(),
            conversation: nextConversation,
        });

        aiConversation = [
            ...nextConversation,
            { role: "assistant", content: String(result.assistantMessage || "AI returned a response.") },
        ];
        renderAiChatLog();
        setAiResponseOutput(formatAiDetails(result, "patch"));
        if (userRequest) {
            userRequest.value = "";
        }

        if (result.patch && patchInput) {
            patchInput.value = JSON.stringify(result.patch, null, 2);
            setAiRunStatus("AI returned a valid patch. Building canvas preview...", "busy");
            await previewCircuitPatch(result.patch);
            setAiRunStatus("Patch preview is ready. Review the canvas, then Apply Patch if it looks correct.", "success");
            setAiToolsStatus(`Built-in AI responded with a patch using ${result.provider}:${result.model}. The patch is now previewed on canvas.`, "success");
            return;
        }

        clearAiPatchPreview();
        const noPatchSummary = summarizeAiMessage(result.assistantMessage, "AI did not return a patch.");
        setAiRunStatus(`No patch returned: ${noPatchSummary}`, "success");
        setAiToolsStatus(`Built-in AI responded without a patch using ${result.provider}:${result.model}. ${noPatchSummary}`, "success");
    } catch (error) {
        setAiRunStatus(error?.message || "AI request failed.", "error");
        throw error;
    } finally {
        setAiControlsBusy(false);
    }
}

async function sendBuiltInAiGenerateCircuitRequest() {
    if (aiRequestInFlight) {
        return;
    }
    const {
        providerSelect,
        modelSelect,
        geminiKeyInput,
        userRequest,
        sceneOutput,
    } = getAiToolsElements();
    const requestText = String(userRequest?.value ?? "").trim();
    if (!requestText) {
        throw new Error("Enter a circuit request first.");
    }

    const provider = providerSelect?.value || "ollama";
    const model = String(modelSelect?.value ?? "").trim() || getAiDefaultModelForProvider(provider);
    const nextConversation = [
        ...aiConversation,
        { role: "user", content: requestText },
    ];

    aiConversation = nextConversation;
    renderAiChatLog();
    openAiPanel("chat");
    openAiPanel("canvas");

    setAiControlsBusy(true);
    setAiResponseOutput("");
    clearAiPatchPreview();
    setAiToolsStatus(`Generating circuit from ${provider}:${model}...`);
    setAiRunStatus("Generating circuit intent, resolving trusted packages, and compiling circuit IR...", "busy");

    try {
        const result = await apiPostWithTimeout("/ai/generate-circuit", {
            provider,
            model,
            apiKey: provider === "gemini" ? String(geminiKeyInput?.value ?? "").trim() : "",
            prompt: requestText,
            allowDeterministicFallback: true,
        });

        await applyJsonPayloadToCanvas(result.circuitIr);
        if (sceneOutput) {
            sceneOutput.value = JSON.stringify(exportSceneState("ai_generated_circuit"), null, 2);
        }
        setAiResponseOutput(JSON.stringify({
            ...JSON.parse(formatAiDetails(result, "generate_circuit")),
            intent: result.intent,
            resolution: result.resolution,
            circuitIr: result.circuitIr,
            validations: result.validations,
        }, null, 2));
        aiConversation = [
            ...nextConversation,
            {
                role: "assistant",
                content: result.warning
                    ? `Generated a deterministic circuit. Note: ${result.warning}`
                    : `Generated a circuit with ${result.circuitIr.components.length} components and ${result.circuitIr.nets.length} nets.`,
            },
        ];
        renderAiChatLog();
        if (userRequest) {
            userRequest.value = "";
        }
        setAiRunStatus(`Generated ${result.circuitIr.components.length} components and ${result.circuitIr.nets.length} nets.`, "success");
        setAiToolsStatus(`Circuit generated from ${result.intentSource} intent and compiled through trusted packages.`, "success");
    } catch (error) {
        setAiRunStatus(error?.message || "Circuit generation failed.", "error");
        throw error;
    } finally {
        setAiControlsBusy(false);
    }
}

async function sendBuiltInAiChatRequest() {
    if (aiRequestInFlight) {
        return;
    }
    const {
        providerSelect,
        modelSelect,
        geminiKeyInput,
        chatRequest,
    } = getAiToolsElements();
    const requestText = String(chatRequest?.value ?? "").trim();
    if (!requestText) {
        throw new Error("Enter a chat prompt first.");
    }

    const provider = providerSelect?.value || "ollama";
    const model = String(modelSelect?.value ?? "").trim() || getAiDefaultModelForProvider(provider);
    const sceneState = exportSceneState();
    const projectKey = buildAiProjectKeyFromScene(sceneState);
    const nextConversation = [
        ...aiConversation,
        { role: "user", content: requestText },
    ];

    aiConversation = nextConversation;
    renderAiChatLog();
    openAiPanel("chat");
    setAiControlsBusy(true);
    setAiResponseOutput("");
    setAiChatStatus(`Sending to ${provider}:${model}...`, "busy");
    setAiToolsStatus(`Preparing normal chat request for ${provider}...`);
    setAiRunStatus(`Sending normal chat request to ${provider}:${model}...`, "busy");

    try {
        const result = await apiPostWithTimeout("/ai/chat", {
            provider,
            model,
            projectKey,
            apiKey: provider === "gemini" ? String(geminiKeyInput?.value ?? "").trim() : "",
            sceneState,
            conversation: nextConversation,
        });

        aiConversation = [
            ...nextConversation,
            { role: "assistant", content: String(result.assistantMessage || "AI returned a response.") },
        ];
        renderAiChatLog();
        setAiResponseOutput(formatAiDetails(result, "chat"));
        if (chatRequest) {
            chatRequest.value = "";
        }
        setAiChatStatus(`Reply received from ${result.provider}:${result.model}.`, "success");
        setAiRunStatus(`Normal chat reply received from ${result.provider}:${result.model}.`, "success");
        setAiToolsStatus("Normal chat worked. This confirms the model can answer without patch generation.", "success");
    } catch (error) {
        setAiChatStatus(error?.message || "AI chat request failed.", "error");
        setAiRunStatus(error?.message || "AI chat request failed.", "error");
        throw error;
    } finally {
        setAiControlsBusy(false);
    }
}

function createPatchError(message) {
    return new Error(`Patch invalid: ${message}`);
}

function normalizePatchPlacement(placement, label) {
    if (!placement || typeof placement !== "object") {
        throw createPatchError(`${label} requires placement.`);
    }
    if (![placement.x, placement.y, placement.rotationDeg].every((value) => Number.isFinite(Number(value)))) {
        throw createPatchError(`${label} placement requires numeric x, y, and rotationDeg.`);
    }
    return {
        x: Number(placement.x),
        y: Number(placement.y),
        rotationDeg: Number(placement.rotationDeg),
        ...(placement.mirrorX != null ? { mirrorX: !!placement.mirrorX } : {}),
        ...(placement.mirrorY != null ? { mirrorY: !!placement.mirrorY } : {}),
    };
}

function normalizePatchEndpointRecord(endpoint, label) {
    if (!endpoint || typeof endpoint !== "object") {
        throw createPatchError(`${label} endpoint is missing.`);
    }
    if (endpoint.kind === "pin") {
        if (!endpoint.componentId || !endpoint.pinId) {
            throw createPatchError(`${label} pin endpoint requires componentId and pinId.`);
        }
        return {
            kind: "pin",
            compId: String(endpoint.componentId),
            pinId: String(endpoint.pinId),
        };
    }
    if (endpoint.kind === "junction") {
        if (!endpoint.junctionId) {
            throw createPatchError(`${label} junction endpoint requires junctionId.`);
        }
        return {
            kind: "junction",
            junctionId: String(endpoint.junctionId),
        };
    }
    throw createPatchError(`${label} endpoint kind must be pin or junction.`);
}

function normalizePatchRoutePoints(routePoints, label) {
    if (!Array.isArray(routePoints)) {
        throw createPatchError(`${label} routePoints must be an array.`);
    }
    return routePoints.map((point, index) => {
        if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) {
            throw createPatchError(`${label} routePoints[${index}] requires numeric x and y.`);
        }
        return {
            uX: Number(point.x),
            uY: Number(point.y),
        };
    });
}

function normalizePatchSelectionRecord(selection) {
    if (!selection || typeof selection !== "object") {
        throw createPatchError("set_selection requires a selection object.");
    }
    if (!["parts", "wires", "both"].includes(selection.scope)) {
        throw createPatchError("set_selection.scope must be parts, wires, or both.");
    }
    const normalizeIds = (ids) => {
        if (!Array.isArray(ids)) {
            throw createPatchError("selection ids must be arrays.");
        }
        return dedupeIds(ids);
    };
    return {
        componentIds: normalizeIds(selection.componentIds),
        wireIds: normalizeIds(selection.wireIds),
        junctionIds: normalizeIds(selection.junctionIds),
        scope: selection.scope,
    };
}

function normalizePatchComponentRecord(component, label) {
    if (!component || typeof component !== "object") {
        throw createPatchError(`${label} requires a component record.`);
    }
    if (!component.id || !component.symbolKey || !component.reference) {
        throw createPatchError(`${label} requires id, symbolKey, and reference.`);
    }
    return {
        id: String(component.id),
        type: String(component.symbolKey),
        refdes: String(component.reference),
        uX: Number(component.placement?.x),
        uY: Number(component.placement?.y),
        rotation: Number(component.placement?.rotationDeg),
        properties: {
            ...(component.properties ?? {}),
            ...(component.value != null ? { value: String(component.value) } : {}),
        },
        ...(component.unitId ? { unitId: String(component.unitId) } : {}),
        ...(component.fields ? { fields: { ...component.fields } } : {}),
    };
}

function normalizePatchWireRecord(wire, label) {
    if (!wire || typeof wire !== "object") {
        throw createPatchError(`${label} requires a wire record.`);
    }
    if (!wire.id) {
        throw createPatchError(`${label} requires an id.`);
    }
    return {
        id: String(wire.id),
        from: normalizePatchEndpointRecord(wire.from, `${label}.from`),
        to: normalizePatchEndpointRecord(wire.to, `${label}.to`),
        routePoints: normalizePatchRoutePoints(wire.routePoints ?? [], `${label}.routePoints`),
        color: currentWireColor,
        ...(wire.netId ? { netId: String(wire.netId) } : {}),
        ...(wire.label ? { label: String(wire.label) } : {}),
        ...(wire.label ? { properties: { netLabel: String(wire.label) } } : {}),
    };
}

function normalizeCircuitPatchPayload(payload) {
    if (!payload || typeof payload !== "object") {
        throw createPatchError("Payload must be an object.");
    }
    if (payload.schema !== "aura.circuit_patch.v1") {
        throw createPatchError("schema must be aura.circuit_patch.v1.");
    }
    if (!payload.metadata?.title || !["preview", "apply"].includes(payload.metadata?.mode)) {
        throw createPatchError("metadata.title and metadata.mode are required.");
    }
    if (payload.target?.sceneSchema !== "aura.scene_state.v1") {
        throw createPatchError("target.sceneSchema must be aura.scene_state.v1.");
    }
    if (!Array.isArray(payload.operations) || payload.operations.length === 0) {
        throw createPatchError("operations must contain at least one operation.");
    }
    return payload;
}

async function ensurePatchComponentDefinitions(payload) {
    const symbolKeys = [];
    payload.operations.forEach((operation) => {
        if (operation.op === "add_component" && operation.component?.symbolKey) {
            symbolKeys.push(String(operation.component.symbolKey));
        }
    });
    for (const symbolKey of dedupeIds(symbolKeys)) {
        const def = await ensureComponentDefByKey(symbolKey);
        if (!def) {
            throw createPatchError(`unknown symbolKey ${symbolKey}.`);
        }
    }
}

function requireComponentInScene(scene, componentId, label) {
    const component = findComponentByIdInScene(scene, componentId);
    if (!component) {
        throw createPatchError(`${label} references missing component ${componentId}.`);
    }
    return component;
}

function requireJunctionInScene(scene, junctionId, label) {
    const junction = findJunctionByIdInScene(scene, junctionId);
    if (!junction) {
        throw createPatchError(`${label} references missing junction ${junctionId}.`);
    }
    return junction;
}

function validateEndpointAgainstScene(scene, endpoint, label) {
    if (endpoint.kind === "junction") {
        requireJunctionInScene(scene, endpoint.junctionId, label);
        return;
    }
    const component = requireComponentInScene(scene, endpoint.compId, label);
    const pin = findPinByIdInScene(component, endpoint.pinId);
    if (!pin) {
        throw createPatchError(`${label} references missing pin ${endpoint.pinId} on ${endpoint.compId}.`);
    }
}

function applyPatchOperationsToScene(scene, payload) {
    payload.operations.forEach((operation, index) => {
        const label = `operations[${index}]`;
        if (!operation || typeof operation !== "object" || !operation.op) {
            throw createPatchError(`${label} is missing op.`);
        }

        if (operation.op === "add_component") {
            const placement = normalizePatchPlacement(operation.component?.placement, `${label}.component`);
            const component = normalizePatchComponentRecord({
                ...operation.component,
                placement,
            }, `${label}.component`);
            if (findComponentByIdInScene(scene, component.id)) {
                throw createPatchError(`${label} component id ${component.id} already exists.`);
            }
            scene.components.push(component);
            return;
        }

        if (operation.op === "update_component") {
            const component = requireComponentInScene(scene, operation.id, label);
            const changes = operation.changes;
            if (!changes || typeof changes !== "object" || !Object.keys(changes).length) {
                throw createPatchError(`${label} requires changes.`);
            }
            if (changes.reference != null) {
                component.refdes = String(changes.reference);
            }
            if (changes.value != null) {
                component.properties = {
                    ...(component.properties ?? {}),
                    value: String(changes.value),
                };
            }
            if (changes.unitId != null) {
                component.unitId = String(changes.unitId);
            }
            if (changes.fields) {
                component.fields = { ...changes.fields };
            }
            if (changes.properties) {
                component.properties = { ...(changes.properties ?? {}) };
                if (changes.value != null) {
                    component.properties.value = String(changes.value);
                }
            }
            if (changes.placement) {
                const placement = normalizePatchPlacement(changes.placement, `${label}.changes.placement`);
                component.uX = placement.x;
                component.uY = placement.y;
                component.rotation = placement.rotationDeg;
            }
            return;
        }

        if (operation.op === "delete_component") {
            const componentId = String(operation.id || "");
            requireComponentInScene(scene, componentId, label);
            scene.components = scene.components.filter((component) => String(component.id) !== componentId);
            scene.wires = scene.wires.filter((wire) => {
                const from = normalizeEndpoint(wire.from);
                const to = normalizeEndpoint(wire.to);
                return !((from?.kind === "pin" && String(from.compId) === componentId)
                    || (to?.kind === "pin" && String(to.compId) === componentId));
            });
            return;
        }

        if (operation.op === "add_junction") {
            const junction = operation.junction;
            if (!junction?.id || !Number.isFinite(Number(junction.x)) || !Number.isFinite(Number(junction.y))) {
                throw createPatchError(`${label}.junction requires id, x, and y.`);
            }
            if (findJunctionByIdInScene(scene, junction.id)) {
                throw createPatchError(`${label} junction id ${junction.id} already exists.`);
            }
            scene.junctions.push({
                id: String(junction.id),
                uX: Number(junction.x),
                uY: Number(junction.y),
            });
            return;
        }

        if (operation.op === "update_junction") {
            const junction = requireJunctionInScene(scene, operation.id, label);
            if (!operation.changes || !Number.isFinite(Number(operation.changes.x)) || !Number.isFinite(Number(operation.changes.y))) {
                throw createPatchError(`${label}.changes requires numeric x and y.`);
            }
            junction.uX = Number(operation.changes.x);
            junction.uY = Number(operation.changes.y);
            return;
        }

        if (operation.op === "delete_junction") {
            const junctionId = String(operation.id || "");
            requireJunctionInScene(scene, junctionId, label);
            scene.junctions = scene.junctions.filter((junction) => String(junction.id) !== junctionId);
            scene.wires = scene.wires.filter((wire) => {
                const from = normalizeEndpoint(wire.from);
                const to = normalizeEndpoint(wire.to);
                return !((from?.kind === "junction" && String(from.junctionId) === junctionId)
                    || (to?.kind === "junction" && String(to.junctionId) === junctionId));
            });
            return;
        }

        if (operation.op === "add_wire") {
            const wire = normalizePatchWireRecord(operation.wire, `${label}.wire`);
            if (scene.wires.some((entry) => String(entry.id) === wire.id)) {
                throw createPatchError(`${label} wire id ${wire.id} already exists.`);
            }
            validateEndpointAgainstScene(scene, wire.from, `${label}.wire.from`);
            validateEndpointAgainstScene(scene, wire.to, `${label}.wire.to`);
            scene.wires.push(wire);
            return;
        }

        if (operation.op === "update_wire") {
            const wire = scene.wires.find((entry) => String(entry.id) === String(operation.id));
            if (!wire) {
                throw createPatchError(`${label} references missing wire ${operation.id}.`);
            }
            const changes = operation.changes;
            if (!changes || typeof changes !== "object" || !Object.keys(changes).length) {
                throw createPatchError(`${label} requires changes.`);
            }
            if (changes.from) {
                wire.from = normalizePatchEndpointRecord(changes.from, `${label}.changes.from`);
                validateEndpointAgainstScene(scene, wire.from, `${label}.changes.from`);
            }
            if (changes.to) {
                wire.to = normalizePatchEndpointRecord(changes.to, `${label}.changes.to`);
                validateEndpointAgainstScene(scene, wire.to, `${label}.changes.to`);
            }
            if (changes.routePoints) {
                wire.routePoints = normalizePatchRoutePoints(changes.routePoints, `${label}.changes.routePoints`);
            }
            if (changes.netId != null) {
                wire.netId = String(changes.netId);
            }
            if (changes.label != null) {
                wire.label = String(changes.label);
                wire.properties = {
                    ...(wire.properties ?? {}),
                    netLabel: String(changes.label),
                };
            }
            return;
        }

        if (operation.op === "delete_wire") {
            const wireId = String(operation.id || "");
            if (!scene.wires.some((entry) => String(entry.id) === wireId)) {
                throw createPatchError(`${label} references missing wire ${wireId}.`);
            }
            scene.wires = scene.wires.filter((wire) => String(wire.id) !== wireId);
            return;
        }

        if (operation.op === "set_selection") {
            const selection = normalizePatchSelectionRecord(operation.selection);
            selection.componentIds.forEach((id) => requireComponentInScene(scene, id, `${label}.selection.componentIds`));
            selection.wireIds.forEach((id) => {
                if (!scene.wires.some((wire) => String(wire.id) === String(id))) {
                    throw createPatchError(`${label}.selection references missing wire ${id}.`);
                }
            });
            selection.junctionIds.forEach((id) => requireJunctionInScene(scene, id, `${label}.selection.junctionIds`));
            scene.selection = selection;
            return;
        }

        throw createPatchError(`${label} has unsupported op ${operation.op}.`);
    });

    scene.selection = scene.selection ?? {
        componentIds: [],
        wireIds: [],
        junctionIds: [],
        scope: "both",
    };
    scene.selection.componentIds = scene.selection.componentIds
        .filter((id) => !!findComponentByIdInScene(scene, id));
    scene.selection.wireIds = scene.selection.wireIds
        .filter((id) => scene.wires.some((wire) => String(wire.id) === String(id)));
    scene.selection.junctionIds = scene.selection.junctionIds
        .filter((id) => !!findJunctionByIdInScene(scene, id));
}

function diffSceneCollection(currentItems, nextItems) {
    const currentById = new Map(currentItems.map((item) => [String(item.id), item]));
    const nextById = new Map(nextItems.map((item) => [String(item.id), item]));
    const added = [];
    const updated = [];
    const deleted = [];

    nextById.forEach((item, id) => {
        if (!currentById.has(id)) {
            added.push(item);
            return;
        }
        if (JSON.stringify(currentById.get(id)) !== JSON.stringify(item)) {
            updated.push({
                before: currentById.get(id),
                after: item,
            });
        }
    });

    currentById.forEach((item, id) => {
        if (!nextById.has(id)) {
            deleted.push(item);
        }
    });

    return { added, updated, deleted };
}

function buildPatchPreviewState(payload) {
    const currentScene = cloneCurrentStudioScene();
    const nextScene = cloneCurrentStudioScene();
    applyPatchOperationsToScene(nextScene, payload);
    return {
        title: payload.metadata.title,
        currentScene,
        nextScene,
        components: diffSceneCollection(currentScene.components, nextScene.components),
        wires: diffSceneCollection(currentScene.wires, nextScene.wires),
        junctions: diffSceneCollection(currentScene.junctions, nextScene.junctions),
    };
}

async function prepareCircuitPatchPayload(rawPayload) {
    const payload = normalizeCircuitPatchPayload(rawPayload);
    await ensurePatchComponentDefinitions(payload);
    return payload;
}

function applySceneSelectionToStudio(selectionRecord) {
    selectionScope = sceneSelectionScopeToInternal(selectionRecord?.scope);
    selectedComponentIds = dedupeIds(selectionRecord?.componentIds ?? []);
    selectedWireIds = dedupeIds(selectionRecord?.wireIds ?? []);
    selectedJunctionId = selectionRecord?.junctionIds?.[0] ? String(selectionRecord.junctionIds[0]) : null;
}

function applyPreviewSceneToStudio(scene) {
    components = JSON.parse(JSON.stringify(scene.components));
    wires = JSON.parse(JSON.stringify(scene.wires));
    junctions = JSON.parse(JSON.stringify(scene.junctions));
    applySceneSelectionToStudio(scene.selection);
    placingComponent = null;
    activeWire = null;
    handledActiveWireCrossings = [];
    pendingWireTurnCrossingDecision = null;
    pendingWireCanvasAction = null;
    syncSelectionPresentation();
    refreshWireAutoroutePanel();
}

function drawPreviewWireRoutes(routes, color, options = {}) {
    const {
        opacity = 1,
        lineWidth = Math.max(1.5, wireWidth * zoom),
        dashed = false,
    } = options;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (dashed) {
        ctx.setLineDash([10, 6]);
    }
    routes.forEach((route) => {
        if (!route?.routePoints?.length) {
            return;
        }
        ctx.beginPath();
        ctx.moveTo(route.routePoints[0].x, route.routePoints[0].y);
        route.routePoints.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
        ctx.stroke();
    });
    ctx.restore();
}

function drawPreviewComponentBounds(componentEntries, color, options = {}) {
    const {
        opacity = 1,
        dashed = false,
        fill = false,
    } = options;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    if (dashed) {
        ctx.setLineDash([8, 6]);
    }
    componentEntries.forEach((component) => {
        const bounds = getComponentBodyBounds(component);
        if (!bounds) {
            return;
        }
        const width = Math.max(1, bounds.right - bounds.left);
        const height = Math.max(1, bounds.bottom - bounds.top);
        if (fill) {
            ctx.fillRect(bounds.left, bounds.top, width, height);
        } else {
            ctx.strokeRect(bounds.left, bounds.top, width, height);
        }
        ctx.font = '11px "IBM Plex Sans", "Segoe UI", sans-serif';
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        ctx.fillText(component.refdes || component.id, bounds.left + 4, bounds.top - 4);
    });
    ctx.restore();
}

function drawPreviewJunctions(junctionEntries, color, options = {}) {
    const {
        opacity = 1,
        radius = Math.max(4, 4 * zoom),
    } = options;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = color;
    junctionEntries.forEach((junction) => {
        const point = getScreenPointFromUnits(junction.uX, junction.uY);
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.restore();
}

function drawPatchPreviewOverlay() {
    if (!aiPatchPreviewState) {
        return;
    }

    const red = "#ff6b6b";
    const green = "#58d26a";
    const deletedRoutes = buildRenderedWireRoutesForScene({
        components: aiPatchPreviewState.currentScene.components,
        wires: aiPatchPreviewState.wires.deleted,
        junctions: aiPatchPreviewState.currentScene.junctions,
    });
    const addedRoutes = buildRenderedWireRoutesForScene({
        components: aiPatchPreviewState.nextScene.components,
        wires: aiPatchPreviewState.wires.added,
        junctions: aiPatchPreviewState.nextScene.junctions,
    });
    const updatedBeforeRoutes = buildRenderedWireRoutesForScene({
        components: aiPatchPreviewState.currentScene.components,
        wires: aiPatchPreviewState.wires.updated.map((entry) => entry.before),
        junctions: aiPatchPreviewState.currentScene.junctions,
    });
    const updatedAfterRoutes = buildRenderedWireRoutesForScene({
        components: aiPatchPreviewState.nextScene.components,
        wires: aiPatchPreviewState.wires.updated.map((entry) => entry.after),
        junctions: aiPatchPreviewState.nextScene.junctions,
    });

    drawPreviewWireRoutes(deletedRoutes, red, { opacity: 0.92, dashed: true });
    drawPreviewWireRoutes(updatedBeforeRoutes, red, { opacity: 0.5, dashed: true });
    drawPreviewWireRoutes(addedRoutes, green, { opacity: 0.95 });
    drawPreviewWireRoutes(updatedAfterRoutes, green, { opacity: 0.95 });

    drawPreviewComponentBounds(aiPatchPreviewState.components.deleted, red, { opacity: 0.9, dashed: true });
    drawPreviewComponentBounds(aiPatchPreviewState.components.updated.map((entry) => entry.before), red, { opacity: 0.5, dashed: true });
    drawPreviewComponentBounds(aiPatchPreviewState.components.added, green, { opacity: 0.95 });
    drawPreviewComponentBounds(aiPatchPreviewState.components.updated.map((entry) => entry.after), green, { opacity: 0.95 });

    drawPreviewJunctions(aiPatchPreviewState.junctions.deleted, red, { opacity: 0.85 });
    drawPreviewJunctions(aiPatchPreviewState.junctions.updated.map((entry) => entry.before), red, { opacity: 0.45 });
    drawPreviewJunctions(aiPatchPreviewState.junctions.added, green, { opacity: 0.95 });
    drawPreviewJunctions(aiPatchPreviewState.junctions.updated.map((entry) => entry.after), green, { opacity: 0.95 });
}

async function previewCircuitPatch(rawPayload) {
    const payload = await prepareCircuitPatchPayload(rawPayload);
    aiPatchPreviewState = buildPatchPreviewState(payload);
    setAiToolsStatus(`Preview ready: ${payload.operations.length} operation(s) from "${payload.metadata.title}".`, "success");
    draw();
}

async function applyCircuitPatch(rawPayload) {
    const payload = await prepareCircuitPatchPayload(rawPayload);
    const previewState = buildPatchPreviewState(payload);
    aiPatchPreviewState = null;
    applyPreviewSceneToStudio(previewState.nextScene);
    saveHistory();
    draw();
    return previewState;
}

function startPlacement(type, def) {
    clearStageSelection();
    const position = viewportCenterInUnits();
    placingComponent = {
        type,
        refdes: nextReferenceFor(def),
        uX: Number.isFinite(mouseUx) ? mouseUx : position.uX,
        uY: Number.isFinite(mouseUy) ? mouseUy : position.uY,
        rotation: 0,
        properties: {},
    };
    const status = document.getElementById("stage-mode-label");
    if (status) {
        status.textContent = `Placing ${placingComponent.refdes}. Click to place, Esc to stop.`;
    }
    draw();
}

function commitPlacement(uX, uY) {
    if (!placingComponent) {
        return null;
    }
    const def = COMPONENT_DEFS[placingComponent.type];
    const component = {
        ...placingComponent,
        uX,
        uY,
        id: Date.now(),
    };
    components.push(component);
    selectedComponent = component;
    selectedComponentIds = [String(component.id)];
    selectedJunctionId = null;
    clearWireSelection();
    saveHistory();
    openInspector(component);
    if (def) {
        placingComponent = {
            ...placingComponent,
            refdes: nextReferenceFor(def),
            uX,
            uY,
        };
    }
    const status = document.getElementById("stage-mode-label");
    if (status) {
        status.textContent = `Placed ${component.refdes}. Click again to place ${placingComponent?.refdes || ""}, Esc to stop.`;
    }
    draw();
    return component;
}

async function addComponent(type) {
    if (!backendOnline) { alert("Backend is offline."); await initLibrary(); return; }
    const def = await ensureComponentDefByKey(type);
    if (!def) return;

    selectedSymbolId = type;
    selectedSymbolSummary = currentLibrarySymbols.find((symbol) => symbol.id === type) ?? selectedSymbolSummary;
    selectedSymbolDefinition = def;
    renderLibraryBrowser();
    startPlacement(type, def);
}

function startWire(endpoint) {
    const normalizedEndpoint = normalizeEndpoint(endpoint);
    if (!normalizedEndpoint) {
        return;
    }
    selectedComponent = null;
    clearWireSelection();
    activeWire = {
        from: normalizedEndpoint,
        routePoints: [],
        jumps: [],
        color: currentWireColor,
    };
    handledActiveWireCrossings = [];
    pendingWireTurnCrossingDecision = null;
}

function addActiveWireRoutePoint(uX, uY) {
    if (!activeWire) {
        return;
    }
    const nextPoint = { uX, uY };
    const lastPoint = activeWire.routePoints?.[activeWire.routePoints.length - 1];
    if (lastPoint && lastPoint.uX === nextPoint.uX && lastPoint.uY === nextPoint.uY) {
        return;
    }
    activeWire.routePoints = [...(activeWire.routePoints ?? []), nextPoint];
}

function addActiveWireJumpPoint(uX, uY, segmentIndex = null) {
    if (!activeWire) {
        return;
    }
    const nextPoint = { uX, uY, ...(Number.isInteger(segmentIndex) ? { segmentIndex } : {}) };
    const alreadyExists = getWireJumps(activeWire).some((point) => point.uX === nextPoint.uX && point.uY === nextPoint.uY);
    if (alreadyExists) {
        return;
    }
    activeWire.jumps = [...getWireJumps(activeWire), nextPoint];
}

function isEndpointEqual(left, right) {
    const normalizedLeft = normalizeEndpoint(left);
    const normalizedRight = normalizeEndpoint(right);
    if (!normalizedLeft || !normalizedRight || normalizedLeft.kind !== normalizedRight.kind) {
        return false;
    }
    if (normalizedLeft.kind === "junction") {
        return String(normalizedLeft.junctionId) === String(normalizedRight.junctionId);
    }
    return String(normalizedLeft.compId) === String(normalizedRight.compId)
        && String(normalizedLeft.pinId) === String(normalizedRight.pinId);
}

function completeWire(endpoint) {
    const normalizedEndpoint = normalizeEndpoint(endpoint);
    if (!activeWire || !normalizedEndpoint) {
        return;
    }
    if (isEndpointEqual(activeWire.from, normalizedEndpoint)) {
        activeWire = null;
        handledActiveWireCrossings = [];
        pendingWireTurnCrossingDecision = null;
        return;
    }

    const duplicateWire = wires.some((wire) =>
        (isEndpointEqual(wire.from, activeWire.from) && isEndpointEqual(wire.to, normalizedEndpoint))
        || (isEndpointEqual(wire.to, activeWire.from) && isEndpointEqual(wire.from, normalizedEndpoint))
    );
    if (!duplicateWire) {
        const wireId = `wire_${Date.now()}`;
        const endpointPoint = resolveWireEndpoint(normalizedEndpoint)?.point ?? null;
        const fullRoute = getManualWirePoints(activeWire, endpointPoint);
        const committedJumps = reindexJumpsForRoute(fullRoute, getWireJumps(activeWire));
        wires.push({
            id: wireId,
            from: normalizeEndpoint(activeWire.from),
            to: normalizedEndpoint,
            color: activeWire.color || currentWireColor,
            routePoints: [...(activeWire.routePoints ?? [])],
            ...(committedJumps ? { jumps: committedJumps } : {}),
        });
        if (normalizeEndpoint(activeWire.from)?.kind === "pin" && normalizedEndpoint.kind === "pin") {
            selectWire(wireId);
        } else {
            clearWireSelection();
        }
        saveHistory();
    }

    activeWire = null;
    handledActiveWireCrossings = [];
    pendingWireTurnCrossingDecision = null;
}

function getPendingActionTargetPoint(action) {
    if (!action) {
        return null;
    }
    if (action.kind === "turn") {
        return getScreenPointFromUnits(action.routePoint.uX, action.routePoint.uY);
    }
    return resolveWireEndpoint(action.endpoint)?.point ?? null;
}

function commitPendingActiveWireAction(action) {
    if (!action) {
        return;
    }
    if (action.kind === "turn") {
        addActiveWireRoutePoint(action.routePoint.uX, action.routePoint.uY);
        return;
    }
    completeWire(action.endpoint);
}

function buildConnectedCrossingState(crossing) {
    const crossingPoint = { x: crossing.x, y: crossing.y };
    const routedById = new Map(buildRenderedWireRoutes().map((route) => [route.connection.id, route]));
    const nextWires = [];
    const existingIds = new Set(wires.map((wire) => wire.id));
    const junction = createJunctionAtScreenPoint(crossingPoint);
    const junctionEndpoint = { kind: "junction", junctionId: junction.id };

    wires.forEach((wire) => {
        if (!crossing.connectionIds.includes(wire.id)) {
            nextWires.push(wire);
            return;
        }

        const rendered = routedById.get(wire.id);
        if (!rendered) {
            nextWires.push(wire);
            return;
        }

        const split = splitRoutePointsAtPoint(rendered.routePoints, crossingPoint);
        if (!split) {
            nextWires.push(wire);
            return;
        }

        const firstInterior = routePointsScreenToUnits(
            window.AuraRouting?.getConnectionInteriorRoutePoints?.(split.firstRoute) ?? [],
        );
        const secondInterior = routePointsScreenToUnits(
            window.AuraRouting?.getConnectionInteriorRoutePoints?.(split.secondRoute) ?? [],
        );
        const firstJumpPoints = reindexJumpsForRoute(split.firstRoute, getWireJumps(wire), { excludePoint: crossingPoint });
        const secondJumpPoints = reindexJumpsForRoute(split.secondRoute, getWireJumps(wire), { excludePoint: crossingPoint });

        nextWires.push({
            id: nextSplitWireId(`${wire.id}_a`, existingIds),
            from: normalizeEndpoint(wire.from),
            to: junctionEndpoint,
            color: wire.color,
            ...(firstInterior.length > 0 ? { routePoints: firstInterior } : {}),
            ...(firstJumpPoints ? { jumps: firstJumpPoints } : {}),
        });
        nextWires.push({
            id: nextSplitWireId(`${wire.id}_b`, existingIds),
            from: junctionEndpoint,
            to: normalizeEndpoint(wire.to),
            color: wire.color,
            ...(secondInterior.length > 0 ? { routePoints: secondInterior } : {}),
            ...(secondJumpPoints ? { jumps: secondJumpPoints } : {}),
        });
    });

    return {
        junction,
        junctionEndpoint,
        wires: nextWires,
    };
}

function queuePendingActiveWireDecision(action, targetPoint, extraExplicitPoints = []) {
    if (!activeWire || !targetPoint) {
        return;
    }
    const previewRoute = getManualWirePoints(activeWire, targetPoint);
    const activeStartPoint = previewRoute[previewRoute.length - 2] ?? previewRoute[0];
    if (!activeStartPoint || (window.AuraRouting?.pointsAlmostEqual?.(activeStartPoint, targetPoint) ?? false)) {
        commitPendingActiveWireAction(action);
        return;
    }

    const renderedRoutes = buildRenderedWireRoutes();
    const explicitPoints = [
        ...getExplicitWirePoints(renderedRoutes),
        ...jumpsUnitsToScreen(getWireJumps(activeWire)),
        ...handledActiveWireCrossings,
        ...extraExplicitPoints,
        ...(action.kind === "complete" ? [targetPoint] : []),
    ];
    const crossing = window.AuraRouting?.findCrossingOnActiveSegment?.(
        activeStartPoint,
        targetPoint,
        renderedRoutes,
        explicitPoints,
        action.kind === "turn",
    );

    if (!crossing) {
        commitPendingActiveWireAction(action);
        return;
    }

    pendingWireTurnCrossingDecision = {
        crossing,
        action,
        targetPoint,
        activeSegmentIndex: getDraftSegmentIndex(previewRoute),
    };
}

function pushHandledActiveWireCrossing(point) {
    handledActiveWireCrossings = [...handledActiveWireCrossings, point].filter(
        (candidate, index, points) =>
            points.findIndex((entry) => window.AuraRouting?.pointsAlmostEqual?.(entry, candidate) ?? (entry.x === candidate.x && entry.y === candidate.y))
            === index,
    );
}

function handlePendingWireJumpDecision() {
    if (!pendingWireTurnCrossingDecision) {
        return;
    }

    const crossingPoint = {
        x: pendingWireTurnCrossingDecision.crossing.x,
        y: pendingWireTurnCrossingDecision.crossing.y,
    };
    const action = pendingWireTurnCrossingDecision.action;
    const targetPoint = getPendingActionTargetPoint(action);
    const crossingUnits = getUnitsFromScreenPoint(crossingPoint);

    pushHandledActiveWireCrossing(crossingPoint);
    addActiveWireJumpPoint(
        crossingUnits.uX,
        crossingUnits.uY,
        pendingWireTurnCrossingDecision.activeSegmentIndex,
    );
    pendingWireTurnCrossingDecision = null;

    if (targetPoint) {
        queuePendingActiveWireDecision(action, targetPoint, [crossingPoint]);
        return;
    }

    commitPendingActiveWireAction(action);
}

function handlePendingWireConnectDecision() {
    if (!pendingWireTurnCrossingDecision || !activeWire) {
        pendingWireTurnCrossingDecision = null;
        return;
    }

    const crossingPoint = {
        x: pendingWireTurnCrossingDecision.crossing.x,
        y: pendingWireTurnCrossingDecision.crossing.y,
    };
    const action = pendingWireTurnCrossingDecision.action;
    const targetPoint = getPendingActionTargetPoint(action);
    const nextCrossingState = buildConnectedCrossingState(pendingWireTurnCrossingDecision.crossing);
    const nextWireIds = new Set(nextCrossingState.wires.map((wire) => String(wire.id)));
    const committedSegment = {
        id: nextGeneratedWireId(nextWireIds),
        from: normalizeEndpoint(activeWire.from),
        to: nextCrossingState.junctionEndpoint,
        color: activeWire.color || currentWireColor,
        ...(activeWire.routePoints?.length ? { routePoints: [...activeWire.routePoints] } : {}),
        ...(() => {
            const committedFullRoute = getManualWirePoints(activeWire, crossingPoint);
            const committedJumps = reindexJumpsForRoute(committedFullRoute, getWireJumps(activeWire), { excludePoint: crossingPoint });
            return committedJumps ? { jumps: committedJumps } : {};
        })(),
    };

    junctions = [...junctions, nextCrossingState.junction];
    wires = [...nextCrossingState.wires, committedSegment];
    activeWire = {
        from: nextCrossingState.junctionEndpoint,
        routePoints: [],
        jumps: [],
        color: committedSegment.color,
    };
    handledActiveWireCrossings = [];
    pendingWireCanvasAction = null;
    pendingWireTurnCrossingDecision = null;
    saveHistory();

    if (targetPoint) {
        queuePendingActiveWireDecision(action, targetPoint, [crossingPoint]);
    }
}

function closeInspector() {
    const summary = document.getElementById("selection-summary");
    const content = document.getElementById("inspector-content");
    if (summary) {
        summary.innerHTML = `<div class="empty-state">No placed symbol selected.</div>`;
    }
    if (content) {
        content.innerHTML = `<div class="empty-state">Select a symbol on the stage to inspect its reference, pins, fields, and source metadata.</div>`;
    }
    updateShellStatus();
}

function openWireInspector(wire) {
    const summary = document.getElementById("selection-summary");
    const content = document.getElementById("inspector-content");
    if (!summary || !content) {
        return;
    }

    const start = resolveWireEndpoint(wire?.from);
    const end = resolveWireEndpoint(wire?.to);
    summary.innerHTML = `
        <div class="selection-metrics">
            <div class="selection-metric">
                <div class="metric-label">Wire</div>
                <strong>${escapeHtml(String(wire?.id || "").toUpperCase())}</strong>
            </div>
            <div class="selection-metric">
                <div class="metric-label">From</div>
                <strong>${escapeHtml(start?.label || start?.junctionId || "-")}</strong>
            </div>
            <div class="selection-metric">
                <div class="metric-label">To</div>
                <strong>${escapeHtml(end?.label || end?.junctionId || "-")}</strong>
            </div>
            <div class="selection-metric">
                <div class="metric-label">Jumps</div>
                <strong>${escapeHtml(String(getWireJumps(wire).length))}</strong>
            </div>
        </div>
    `;
    content.innerHTML = `
        <section class="inspector-section">
            <h4 class="inspector-section-title">Wire</h4>
            <div class="inspector-list">
                <div class="inspector-row"><span>ID</span><strong>${escapeHtml(String(wire?.id || "").toUpperCase())}</strong></div>
                <div class="inspector-row"><span>From</span><strong>${escapeHtml(start?.label || start?.junctionId || "-")}</strong></div>
                <div class="inspector-row"><span>To</span><strong>${escapeHtml(end?.label || end?.junctionId || "-")}</strong></div>
                <div class="inspector-row"><span>Stored bends</span><strong>${escapeHtml(String((wire?.routePoints ?? []).length))}</strong></div>
                <div class="inspector-row"><span>Jump points</span><strong>${escapeHtml(String(getWireJumps(wire).length))}</strong></div>
            </div>
        </section>
    `;
}

function openJunctionInspector(junction) {
    const summary = document.getElementById("selection-summary");
    const content = document.getElementById("inspector-content");
    if (!summary || !content) {
        return;
    }

    summary.innerHTML = `
        <div class="selection-metrics">
            <div class="selection-metric">
                <div class="metric-label">Junction</div>
                <strong>${escapeHtml(junction?.id || "-")}</strong>
            </div>
            <div class="selection-metric">
                <div class="metric-label">Position</div>
                <strong>${escapeHtml(`${Math.round(junction?.uX || 0)}, ${Math.round(junction?.uY || 0)}`)}</strong>
            </div>
        </div>
    `;
    content.innerHTML = `
        <section class="inspector-section">
            <h4 class="inspector-section-title">Junction</h4>
            <div class="inspector-list">
                <div class="inspector-row"><span>ID</span><strong>${escapeHtml(junction?.id || "-")}</strong></div>
                <div class="inspector-row"><span>Position</span><strong>${escapeHtml(`${Math.round(junction?.uX || 0)}, ${Math.round(junction?.uY || 0)}`)}</strong></div>
            </div>
        </section>
    `;
}

function dedupeIds(ids) {
    return Array.from(new Set((ids ?? []).map((id) => String(id))));
}

function refreshWireAutoroutePanel() {
    const panel = document.getElementById("wire-autoroute-panel");
    const panelLabel = document.getElementById("wire-autoroute-label");
    const label = document.getElementById("wire-autoroute-id");
    const button = document.getElementById("wire-autoroute-btn");
    const dismiss = document.getElementById("wire-autoroute-dismiss");
    if (!panel || !panelLabel || !label || !button || !dismiss) {
        return;
    }

    const selectedWire = wires.find((wire) => String(wire.id) === String(selectedWireId));
    const selectedWireCount = selectedWireIds.length;
    const isRouting = autorouteBatchWireIds.length > 0 || !!autorouteRequestWireId;
    const showPanel = selectedWireCount > 0 && !activeWire;
    panel.hidden = !showPanel;
    if (!showPanel) {
        return;
    }

    panelLabel.textContent = selectedWireCount > 1 ? "Selected Wires" : "Selected Wire";
    label.textContent = selectedWireCount > 1
        ? selectedWireCount > AUTOROUTE_BATCH_LIMIT
            ? `${selectedWireCount} WIRES · FIRST ${AUTOROUTE_BATCH_LIMIT}`
            : `${selectedWireCount} WIRES`
        : String(selectedWire?.id || selectedWireId).toUpperCase();
    if (isRouting) {
        const total = autorouteBatchWireIds.length || 1;
        const current = autorouteBatchWireIds.length
            ? Math.min(autorouteBatchProgress + 1, total)
            : 1;
        button.textContent = autorouteBatchRequestedCount > total
            ? `Routing ${current}/${total} of ${autorouteBatchRequestedCount}`
            : total > 1
                ? `Routing ${current}/${total}`
                : "Routing";
    } else {
        button.textContent = selectedWireCount > AUTOROUTE_BATCH_LIMIT
            ? `Autoroute First ${AUTOROUTE_BATCH_LIMIT}`
            : selectedWireCount > 1
                ? "Autoroute Selected"
                : "Autoroute";
    }
    button.disabled = isRouting;
}

function syncSelectionPresentation() {
    selectedComponent = selectedComponentIds.length
        ? components.find((entry) => String(entry.id) === selectedComponentIds[selectedComponentIds.length - 1]) ?? null
        : null;
    selectedWireId = selectedWireIds[selectedWireIds.length - 1] ?? null;
    if (selectedJunctionId && (selectedComponentIds.length || selectedWireIds.length)) {
        selectedJunctionId = null;
    }

    if (selectedJunctionId && !selectedComponentIds.length && !selectedWireIds.length) {
        openJunctionInspector(junctions.find((entry) => String(entry.id) === selectedJunctionId));
    } else if (selectedComponent && selectedComponentIds.length === 1 && selectedWireIds.length === 0) {
        openInspector(selectedComponent);
    } else if (selectedWireId && selectedWireIds.length === 1 && selectedComponentIds.length === 0) {
        const wire = wires.find((entry) => String(entry.id) === selectedWireId);
        if (wire) {
            openWireInspector(wire);
        } else {
            closeInspector();
        }
    } else {
        closeInspector();
    }

    refreshWireAutoroutePanel();
    updateShellStatus();
    updateSelectionScopeControls();
}

function selectWire(wireId) {
    selectedWireIds = wireId ? [String(wireId)] : [];
    selectedComponentIds = [];
    selectedJunctionId = null;
    syncSelectionPresentation();
}

function clearWireSelection() {
    selectedWireId = null;
    selectedWireIds = [];
    autorouteRequestWireId = null;
    autorouteBatchWireIds = [];
    autorouteBatchProgress = 0;
    autorouteBatchRequestedCount = 0;
    refreshWireAutoroutePanel();
}

function toggleWireSelection(wireId) {
    const id = String(wireId);
    const exists = selectedWireIds.includes(id);
    selectedWireIds = exists
        ? selectedWireIds.filter((entry) => entry !== id)
        : dedupeIds([...selectedWireIds, id]);
    selectedJunctionId = null;
    syncSelectionPresentation();
}

function selectComponentById(componentId, append = false) {
    selectedComponentIds = append
        ? dedupeIds([...selectedComponentIds, String(componentId)])
        : (componentId ? [String(componentId)] : []);
    if (!append) {
        clearWireSelection();
    }
    selectedJunctionId = null;
    syncSelectionPresentation();
}

function toggleComponentSelection(componentId) {
    const id = String(componentId);
    const exists = selectedComponentIds.includes(id);
    selectedComponentIds = exists
        ? selectedComponentIds.filter((entry) => entry !== id)
        : dedupeIds([...selectedComponentIds, id]);
    selectedJunctionId = null;
    syncSelectionPresentation();
}

function selectJunction(junctionId) {
    selectedJunctionId = junctionId ? String(junctionId) : null;
    selectedComponent = null;
    selectedComponentIds = [];
    clearWireSelection();
    syncSelectionPresentation();
}

function selectMixedSelection(componentIds, wireIds, append = false) {
    selectedComponentIds = append ? dedupeIds([...selectedComponentIds, ...componentIds]) : dedupeIds(componentIds);
    selectedWireIds = append ? dedupeIds([...selectedWireIds, ...wireIds]) : dedupeIds(wireIds);
    selectedJunctionId = null;
    syncSelectionPresentation();
}

function clearStageSelection() {
    selectedComponent = null;
    selectedComponentIds = [];
    selectedJunctionId = null;
    selectionBox = null;
    clearWireSelection();
    closeInspector();
}

function clearStageSelectionPreserveBox() {
    selectedComponent = null;
    selectedComponentIds = [];
    selectedJunctionId = null;
    clearWireSelection();
    closeInspector();
}

function bindWireAutoroutePanel() {
    const button = document.getElementById("wire-autoroute-btn");
    const dismiss = document.getElementById("wire-autoroute-dismiss");
    if (!button || !dismiss) {
        return;
    }

    button.onclick = async () => {
        if (!selectedWireIds.length || autorouteRequestWireId || autorouteBatchWireIds.length) {
            return;
        }
        refreshWireAutoroutePanel();
        await autorouteSelectedWires(selectedWireIds);
    };

    dismiss.onclick = () => {
        clearWireSelection();
        draw();
    };

    refreshWireAutoroutePanel();
}


function setTool(tool) {
    currentTool = tool;
    selectionBox = null;
    if (tool !== 'wire') {
        activeWire = null;
        pendingWireCanvasAction = null;
        handledActiveWireCrossings = [];
        pendingWireTurnCrossingDecision = null;
    }
    
    const modeLabel = document.getElementById("stage-mode-label");
    if (modeLabel) modeLabel.innerText = (tool === 'wire') ? "Wire" : "Select";

    const selectButton = document.getElementById("tool-btn-select");
    const wireButton = document.getElementById("tool-btn-wire");
    selectButton?.classList.toggle("active", tool === 'select');
    selectButton?.setAttribute("aria-pressed", tool === 'select' ? "true" : "false");
    wireButton?.classList.toggle("active-wire", tool === 'wire');
    wireButton?.setAttribute("aria-pressed", tool === 'wire' ? "true" : "false");

    updateSelectionScopeControls();
    refreshWireAutoroutePanel();
    draw();
}

function bindToolButtons() {
    const toolButtons = document.querySelectorAll(".right-toolbar [data-tool]");
    toolButtons.forEach((button) => {
        button.addEventListener("click", () => {
            const tool = button.getAttribute("data-tool");
            if (tool) {
                if (tool === "wire" && currentTool === "wire") {
                    setTool("select");
                } else {
                    setTool(tool);
                }
            }
        });
    });
}

function getMouseInUnits(e) {
    const rect = canvas.getBoundingClientRect();
    const uX = Math.round((e.clientX - rect.left - offsetX) / (zoom * pixelsPerUnit));
    const uY = Math.round((offsetY - (e.clientY - rect.top)) / (zoom * pixelsPerUnit));
    return { uX, uY };
}

function findTopComponentAtPoint(uX, uY) {
    for (let index = components.length - 1; index >= 0; index -= 1) {
        const component = components[index];
        if (isMouseOverComponent(uX, uY, component)) {
            return component;
        }
    }
    return null;
}

function isMouseOverComponent(uX, uY, comp) {
    const def = COMPONENT_DEFS[comp.type]; if (!def) return false;
    const rad = (comp.rotation || 0) * Math.PI / 180;
    const dx = uX - comp.uX; const dy = uY - comp.uY;
    const rx = dx * Math.cos(rad) - dy * Math.sin(rad); 
    const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
    const bounds = def.bodyBounds ?? def.hitBounds ?? def.bounds ?? { minX: -(def.uW || 40) / 2, maxX: (def.uW || 40) / 2, minY: -(def.uH || 40) / 2, maxY: (def.uH || 40) / 2 };
    return rx >= bounds.minX && rx <= bounds.maxX && ry >= bounds.minY && ry <= bounds.maxY;
}

function getComponentSelectionBounds(comp) {
    return getComponentBodyBounds(comp);
}

function getDistanceToSegment(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (dx === 0 && dy === 0) {
        return Math.hypot(point.x - start.x, point.y - start.y);
    }
    const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
    const projection = {
        x: start.x + t * dx,
        y: start.y + t * dy,
    };
    return Math.hypot(point.x - projection.x, point.y - projection.y);
}

function projectPointOntoSegment(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (dx === 0 && dy === 0) {
        return {
            x: start.x,
            y: start.y,
            t: 0,
        };
    }
    const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
    return {
        x: start.x + t * dx,
        y: start.y + t * dy,
        t,
    };
}

function findWireHitAtScreenPoint(screenX, screenY) {
    const point = { x: screenX, y: screenY };
    const threshold = 10;
    let bestHit = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const route of buildRenderedWireRoutes()) {
        for (let index = 0; index < route.routePoints.length - 1; index += 1) {
            const start = route.routePoints[index];
            const end = route.routePoints[index + 1];
            const projection = projectPointOntoSegment(point, start, end);
            const distance = Math.hypot(point.x - projection.x, point.y - projection.y);
            if (distance <= threshold && distance < bestDistance) {
                bestHit = {
                    route,
                    segmentIndex: index,
                    point: {
                        x: projection.x,
                        y: projection.y,
                    },
                    t: projection.t,
                };
                bestDistance = distance;
            }
        }
    }

    return bestHit;
}

function findWireAtScreenPoint(screenX, screenY) {
    return findWireHitAtScreenPoint(screenX, screenY)?.route ?? null;
}

function splitWireAtScreenPoint(wireId, screenPoint) {
    const routedById = new Map(buildRenderedWireRoutes().map((route) => [String(route.connection.id), route]));
    const rendered = routedById.get(String(wireId));
    if (!rendered) {
        return null;
    }

    const split = splitRoutePointsAtPoint(rendered.routePoints, screenPoint);
    if (!split) {
        return null;
    }

    const sourceWire = wires.find((wire) => String(wire.id) === String(wireId));
    if (!sourceWire) {
        return null;
    }

    const existingIds = new Set(wires.map((wire) => String(wire.id)));
    const junction = createJunctionAtScreenPoint(screenPoint);
    const junctionEndpoint = { kind: "junction", junctionId: junction.id };
    const firstInterior = routePointsScreenToUnits(
        window.AuraRouting?.getConnectionInteriorRoutePoints?.(split.firstRoute) ?? [],
    );
    const secondInterior = routePointsScreenToUnits(
        window.AuraRouting?.getConnectionInteriorRoutePoints?.(split.secondRoute) ?? [],
    );
    const firstJumpPoints = reindexJumpsForRoute(split.firstRoute, getWireJumps(sourceWire), { excludePoint: screenPoint });
    const secondJumpPoints = reindexJumpsForRoute(split.secondRoute, getWireJumps(sourceWire), { excludePoint: screenPoint });

    const firstWire = {
        id: nextSplitWireId(`${sourceWire.id}_a`, existingIds),
        from: normalizeEndpoint(sourceWire.from),
        to: junctionEndpoint,
        color: sourceWire.color,
        ...(firstInterior.length > 0 ? { routePoints: firstInterior } : {}),
        ...(firstJumpPoints ? { jumps: firstJumpPoints } : {}),
    };
    const secondWire = {
        id: nextSplitWireId(`${sourceWire.id}_b`, existingIds),
        from: junctionEndpoint,
        to: normalizeEndpoint(sourceWire.to),
        color: sourceWire.color,
        ...(secondInterior.length > 0 ? { routePoints: secondInterior } : {}),
        ...(secondJumpPoints ? { jumps: secondJumpPoints } : {}),
    };

    wires = wires.flatMap((wire) =>
        String(wire.id) === String(sourceWire.id)
            ? [firstWire, secondWire]
            : [wire],
    );
    junctions = [...junctions, junction];

    return {
        junction,
        junctionEndpoint,
        point: screenPoint,
    };
}

function buildSelectionTargetsAtPoint(uX, uY, screenX, screenY) {
    if (currentTool !== "select") {
        return [];
    }

    const activeSelectionScope = getActiveSelectionScope();
    const targets = [];
    const junctionHit = activeSelectionScope !== "components" ? findJunctionAtScreenPoint(screenX, screenY) : null;
    const componentHit = activeSelectionScope !== "wires" ? findTopComponentAtPoint(uX, uY) : null;
    const wireHit = activeSelectionScope !== "components" && !junctionHit ? findWireAtScreenPoint(screenX, screenY) : null;

    if (junctionHit) {
        targets.push({ kind: "junction", id: String(junctionHit.id) });
    }
    if (componentHit) {
        targets.push({ kind: "component", id: String(componentHit.id) });
    }
    if (wireHit) {
        targets.push({ kind: "wire", id: String(wireHit.connection.id) });
    }
    return targets;
}

function pickSelectionTarget(targets, screenX, screenY) {
    if (!targets.length) {
        lastSelectionCycle = null;
        return null;
    }

    const cycleKey = targets.map((target) => `${target.kind}:${target.id}`).join("|");
    const canCycle = lastSelectionCycle
        && lastSelectionCycle.key === cycleKey
        && Math.abs(lastSelectionCycle.screenX - screenX) <= 8
        && Math.abs(lastSelectionCycle.screenY - screenY) <= 8;
    const nextIndex = canCycle ? (lastSelectionCycle.index + 1) % targets.length : 0;
    lastSelectionCycle = {
        key: cycleKey,
        index: nextIndex,
        screenX,
        screenY,
    };
    return targets[nextIndex];
}

function toggleSelectionTarget(target) {
    if (!target) {
        return;
    }
    if (target.kind === "component") {
        toggleComponentSelection(target.id);
        return;
    }
    if (target.kind === "wire") {
        toggleWireSelection(target.id);
        return;
    }
    if (target.kind === "junction") {
        selectJunction(target.id);
    }
}

function findJunctionAtScreenPoint(screenX, screenY) {
    const threshold = 10;
    let bestJunction = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const junction of junctions) {
        const point = getJunctionScreenPoint(junction);
        const distance = Math.hypot(screenX - point.x, screenY - point.y);
        if (distance <= threshold && distance < bestDistance) {
            bestJunction = junction;
            bestDistance = distance;
        }
    }

    return bestJunction;
}

function getWireBounds(routePoints) {
    return {
        left: Math.min(...routePoints.map((point) => point.x)),
        top: Math.min(...routePoints.map((point) => point.y)),
        right: Math.max(...routePoints.map((point) => point.x)),
        bottom: Math.max(...routePoints.map((point) => point.y)),
    };
}


function refreshInspectorSummary(comp, def) {
    const refdes = document.getElementById("inspector-summary-refdes");
    const symbol = document.getElementById("inspector-summary-symbol");
    const position = document.getElementById("inspector-summary-position");
    const library = document.getElementById("inspector-summary-library");
    if (refdes) refdes.textContent = comp.refdes || def?.referencePrefix || "U?";
    if (symbol) symbol.textContent = def?.label || comp.type;
    if (position) position.textContent = `${Math.round(comp.uX)}, ${Math.round(comp.uY)}`;
    if (library) library.textContent = def?.sourceLibrary || "Unknown";
}

function getInspectorEditableEntries(comp, def) {
    const entries = [
        {
            key: "Reference",
            label: "Reference",
            value: comp.refdes || def?.referencePrefix || "U?",
        },
        {
            key: "Value",
            label: "Value",
            value: comp.properties?.value ?? getFieldValue(def?.fields, "Value") ?? def?.sourceSymbol ?? "",
        },
    ];

    for (const [key, value] of Object.entries(comp.properties ?? {})) {
        if (key === "value") {
            continue;
        }
        entries.push({
            key,
            label: key === "netLabel" ? "Net Label" : key,
            value: value ?? "",
        });
    }

    return entries;
}

function setInspectorEntryValue(comp, key, value) {
    if (key === "Reference") {
        comp.refdes = String(value || "").trim() || comp.refdes || "U?";
        return;
    }

    if (!comp.properties) {
        comp.properties = {};
    }

    if (key === "Value") {
        comp.properties.value = value;
        return;
    }

    comp.properties[key] = value;
}

function bindInspectorInputs(comp, def) {
    document.querySelectorAll("[data-inspector-field]").forEach((input) => {
        const key = input.getAttribute("data-inspector-field");
        if (!key) {
            return;
        }
        input.addEventListener("input", (event) => {
            setInspectorEntryValue(comp, key, event.target.value);
            refreshInspectorSummary(comp, def);
            draw();
        });
        input.addEventListener("change", (event) => {
            setInspectorEntryValue(comp, key, event.target.value);
            refreshInspectorSummary(comp, def);
            saveHistory();
            draw();
        });
    });
}

function openInspector(comp) {
    const summary = document.getElementById("selection-summary");
    const content = document.getElementById("inspector-content");
    if (!summary || !content) {
        return;
    }
    if (!comp) {
        closeInspector();
        return;
    }

    const def = COMPONENT_DEFS[comp.type];
    const pinRows = (def?.pins ?? []).map((pin) => `
        <div class="inspector-row">
            <span>${escapeHtml(pin.number)} ${escapeHtml(pin.name && pin.name !== "~" ? pin.name : "")}</span>
            <strong>${escapeHtml(pin.electricalType || "passive")}</strong>
        </div>
    `).join("");

    const editableRows = getInspectorEditableEntries(comp, def).map((entry) => `
        <div class="inspector-row">
            <span>${escapeHtml(entry.label)}</span>
            <input type="text" data-inspector-field="${escapeHtml(entry.key)}" value="${escapeHtml(entry.value)}">
        </div>
    `).join("");

    const fieldRows = (def?.fields ?? [])
        .filter((field) => field.key !== "Footprint" && field.key !== "ki_fp_filters")
        .map((field) => `
            <div class="inspector-row">
                <span>${escapeHtml(field.key)}</span>
                <strong>${escapeHtml(field.value || "-")}</strong>
            </div>
        `).join("");

    summary.innerHTML = `
        <div class="selection-metrics">
            <div class="selection-metric">
                <div class="metric-label">Placed</div>
                <strong id="inspector-summary-refdes">${escapeHtml(comp.refdes || def?.referencePrefix || "U?")}</strong>
            </div>
            <div class="selection-metric">
                <div class="metric-label">Symbol</div>
                <strong id="inspector-summary-symbol">${escapeHtml(def?.label || comp.type)}</strong>
            </div>
            <div class="selection-metric">
                <div class="metric-label">Position</div>
                <strong id="inspector-summary-position">${escapeHtml(`${Math.round(comp.uX)}, ${Math.round(comp.uY)}`)}</strong>
            </div>
            <div class="selection-metric">
                <div class="metric-label">Library</div>
                <strong id="inspector-summary-library">${escapeHtml(def?.sourceLibrary || "Unknown")}</strong>
            </div>
        </div>
    `;

    content.innerHTML = `
        <div class="inspector-sections-grid">
            <section class="inspector-section">
                <h4 class="inspector-section-title">Schematic Symbol</h4>
                <div class="inspector-list">
                    <div class="inspector-row"><span>Source</span><strong>${escapeHtml(def?.symbolKey || comp.type)}</strong></div>
                    <div class="inspector-row"><span>Description</span><strong>${escapeHtml(def?.description || "No description")}</strong></div>
                    <div class="inspector-row"><span>Unit</span><strong>${escapeHtml(def?.activeUnitId || "primary")}</strong></div>
                </div>
            </section>
            <section class="inspector-section">
                <h4 class="inspector-section-title">Symbol Fields</h4>
                <div class="inspector-list">
                    ${fieldRows || `<div class="empty-state">No visible schematic fields.</div>`}
                </div>
            </section>
            <section class="inspector-section">
                <h4 class="inspector-section-title">Properties</h4>
                <div class="inspector-list">
                    ${editableRows || `<div class="empty-state">No editable schematic properties.</div>`}
                </div>
            </section>
            <section class="inspector-section">
                <h4 class="inspector-section-title">Pins</h4>
                <div class="inspector-list">
                    ${pinRows || `<div class="empty-state">No pins available for this symbol unit.</div>`}
                </div>
            </section>
        </div>
    `;
    bindInspectorInputs(comp, def);
    refreshInspectorSummary(comp, def);
    updateShellStatus();
}

function draw() {
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    if (useTextureBackground && texture.complete) { ctx.save(); ctx.translate(texOffsetX, texOffsetY); ctx.scale(texZoom, texZoom); ctx.drawImage(texture, 0, 0); ctx.restore(); }
    if (showGrid) drawGrid(); drawWires(); drawAllComponents(); drawPatchPreviewOverlay(); if (placingComponent) drawGhost(); if (showAllPinLabels) drawAllPinLabels(); if (hoveredPin) drawPinLabel(hoveredPin, { emphasized: true, showMarker: true }); drawSelectionBox(); drawRulers(); updateShellStatus();
    refreshWireAutoroutePanel();
}

function drawGrid() {
    const step = pixelsPerUnit * zoom; const width = canvas.width / dpr; const height = canvas.height / dpr;
    const colorBase = textureIsDark ? 255 : 0; ctx.lineWidth = 1 / dpr;
    if (step > 5) {
        ctx.strokeStyle = `rgba(${colorBase}, ${colorBase}, ${colorBase}, ${gridOpacity * 0.15})`;
        ctx.beginPath();
        for(let x = offsetX % step; x < width; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
        for(let y = offsetY % step; y < height; y += step) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
        ctx.stroke();
    }
    const majorStep = step * 8;
    if (majorStep > 5) {
        ctx.strokeStyle = `rgba(${colorBase}, ${colorBase}, ${colorBase}, ${gridOpacity * 0.4})`;
        ctx.beginPath();
        for(let x = offsetX % majorStep; x < width; x += majorStep) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
        for(let y = offsetY % majorStep; y < height; y += majorStep) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
        ctx.stroke();
    }
    ctx.strokeStyle = `rgba(${colorBase}, ${colorBase}, ${colorBase}, ${gridOpacity})`;
    ctx.beginPath();
    if (offsetX >= 0 && offsetX <= width) { ctx.moveTo(offsetX, 0); ctx.lineTo(offsetX, height); }
    if (offsetY >= 0 && offsetY <= height) { ctx.moveTo(0, offsetY); ctx.lineTo(width, offsetY); }
    ctx.stroke();
}

function drawWires() {
    const lineWidth = Math.max(1.5, wireWidth * zoom);
    const endpointRadius = Math.max(2.5, (wireWidth / 2 + 1) * zoom);
    const radius = Math.max(5, 6 * zoom);
    const height = Math.max(4, 5 * zoom);
    const selectedWireColor = "#63d77e";
    const pointsAlmostEqual = window.AuraRouting?.pointsAlmostEqual;
    const underStroke = textureIsDark ? "rgba(12, 12, 12, 0.92)" : "rgba(255, 255, 255, 0.92)";

    const strokeLineSegment = (startPoint, endPoint, color, strokeWidth, opacity = 1) => {
        if (pointsAlmostEqual?.(startPoint, endPoint)) {
            return;
        }
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.strokeStyle = color;
        ctx.lineWidth = strokeWidth;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(startPoint.x, startPoint.y);
        ctx.lineTo(endPoint.x, endPoint.y);
        ctx.stroke();
        ctx.restore();
    };

    const strokeJumpArc = (startPoint, controlPoint, endPoint, color, strokeWidth, opacity = 1, withUnderlay = true) => {
        if (withUnderlay) {
            ctx.save();
            ctx.globalAlpha = opacity;
            ctx.strokeStyle = underStroke;
            ctx.lineWidth = strokeWidth + 3;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.beginPath();
            ctx.moveTo(startPoint.x, startPoint.y);
            ctx.quadraticCurveTo(controlPoint.x, controlPoint.y, endPoint.x, endPoint.y);
            ctx.stroke();
            ctx.restore();
        }

        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.strokeStyle = color;
        ctx.lineWidth = strokeWidth;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(startPoint.x, startPoint.y);
        ctx.quadraticCurveTo(controlPoint.x, controlPoint.y, endPoint.x, endPoint.y);
        ctx.stroke();
        ctx.restore();
    };

    const drawRoute = (routePoints, jumps, color, opacity = 1, strokeWidth = lineWidth, withUnderlay = true) => {
        if (!Array.isArray(routePoints) || routePoints.length < 2) {
            return;
        }
        for (let segmentIndex = 0; segmentIndex < routePoints.length - 1; segmentIndex += 1) {
            const start = routePoints[segmentIndex];
            const end = routePoints[segmentIndex + 1];
            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const segmentLength = Math.hypot(dx, dy);
            const margin = radius + 0.01;
            const segmentJumps = segmentLength > 0.01 ? getRouteSegmentJumps(routePoints, jumps, segmentIndex) : [];
            const sortedJumps = segmentJumps.sort((a, b) => {
                const distA = ((a.x - start.x) * dx + (a.y - start.y) * dy) / segmentLength;
                const distB = ((b.x - start.x) * dx + (b.y - start.y) * dy) / segmentLength;
                return distA - distB;
            });

            if (segmentLength <= 0.01 || sortedJumps.length === 0) {
                strokeLineSegment(start, end, color || "#2196F3", strokeWidth, opacity);
                continue;
            }

            const tangent = { x: dx / segmentLength, y: dy / segmentLength };
            let normal = { x: -tangent.y, y: tangent.x };
            if (Math.abs(normal.y) >= Math.abs(normal.x)) {
                if (normal.y > 0) {
                    normal = { x: -normal.x, y: -normal.y };
                }
            } else if (normal.x < 0) {
                normal = { x: -normal.x, y: -normal.y };
            }

            let cursor = { ...start };
            sortedJumps.forEach((jump) => {
                const projection = ((jump.x - start.x) * dx + (jump.y - start.y) * dy) / segmentLength;
                const hasClearance = projection > margin && projection < segmentLength - margin;
                if (!hasClearance) {
                    strokeLineSegment(cursor, jump, color || "#2196F3", strokeWidth, opacity);
                    cursor = { ...jump };
                    return;
                }

                const jumpStart = {
                    x: jump.x - tangent.x * radius,
                    y: jump.y - tangent.y * radius,
                };
                const jumpEnd = {
                    x: jump.x + tangent.x * radius,
                    y: jump.y + tangent.y * radius,
                };
                const controlPoint = {
                    x: jump.x + normal.x * height,
                    y: jump.y + normal.y * height,
                };
                strokeLineSegment(cursor, jumpStart, color || "#2196F3", strokeWidth, opacity);
                strokeJumpArc(
                    jumpStart,
                    controlPoint,
                    jumpEnd,
                    color || "#2196F3",
                    strokeWidth,
                    opacity,
                    withUnderlay,
                );
                cursor = jumpEnd;
            });

            strokeLineSegment(cursor, end, color || "#2196F3", strokeWidth, opacity);
        }
    };

    const renderedRoutes = buildRenderedWireRoutes();
    const pinLeadRoutes = buildPinLeadRoutes();
    const dynamicJumpOverlays = getDynamicWireJumpOverlays(renderedRoutes);

    renderedRoutes.forEach((route) => {
        const isSelectedWire = selectedWireIds.includes(String(route.connection.id));
        const dynamicJumps = dynamicJumpOverlays.get(String(route.connection.id)) ?? [];
        const renderedJumps = dynamicJumps;

        if (isSelectedWire) {
            drawRoute(
                route.routePoints,
                renderedJumps,
                selectedWireColor,
                0.22,
                lineWidth + 5,
                false,
            );
        }
        drawRoute(
            route.routePoints,
            renderedJumps,
            isSelectedWire ? selectedWireColor : (route.connection.color || "#2196F3"),
            1,
            isSelectedWire ? lineWidth + 1 : lineWidth,
            true,
        );

        ctx.fillStyle = isSelectedWire ? selectedWireColor : (route.connection.color || "#2196F3");
        ctx.beginPath();
        ctx.arc(route.start.point.x, route.start.point.y, endpointRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(route.end.point.x, route.end.point.y, endpointRadius, 0, Math.PI * 2);
        ctx.fill();
    });

    junctions.forEach((junction) => {
        const point = getJunctionScreenPoint(junction);
        ctx.beginPath();
        const isSelectedJunction = String(junction.id) === String(selectedJunctionId);
        ctx.fillStyle = isSelectedJunction ? (accentColor || "#7aceff") : (textureIsDark ? "#efe48b" : "#111111");
        ctx.arc(point.x, point.y, Math.max(3, 3 * zoom), 0, Math.PI * 2);
        ctx.fill();
        if (isSelectedJunction) {
            ctx.beginPath();
            ctx.strokeStyle = accentColor || "#7aceff";
            ctx.lineWidth = 2;
            ctx.arc(point.x, point.y, Math.max(6, 6 * zoom), 0, Math.PI * 2);
            ctx.stroke();
        }
    });

    if (activeWire?.from) {
        const startEndpoint = resolveWireEndpoint(activeWire.from);
        if (!startEndpoint) {
            return;
        }

        const assistedPoint = getAssistedActiveWirePoint(mouseUx, mouseUy);
        let endPoint = getScreenPointFromUnits(assistedPoint.uX, assistedPoint.uY);
        if (hoveredPin) {
            endPoint = getScreenPointFromUnits(hoveredPin.uX, hoveredPin.uY);
        }

        const previewRoute = getManualWirePoints(activeWire, endPoint);
        const previewRenderedRoute = {
            connection: { id: "__active_wire_preview__" },
            start: startEndpoint,
            end: {
                point: endPoint,
                uX: assistedPoint.uX,
                uY: assistedPoint.uY,
            },
            routePoints: previewRoute,
        };
        const previewJumps = getLiveJumpOverlaysForRoute(
            previewRenderedRoute,
            [...renderedRoutes, ...pinLeadRoutes, previewRenderedRoute],
            getWireJumps(activeWire),
        );
        drawRoute(
            previewRoute,
            previewJumps,
            activeWire.color || "#2196F3",
            0.72,
            lineWidth,
            true,
        );

        ctx.fillStyle = activeWire.color || "#2196F3";
        ctx.beginPath();
        ctx.arc(startEndpoint.point.x, startEndpoint.point.y, endpointRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(endPoint.x, endPoint.y, endpointRadius, 0, Math.PI * 2);
        ctx.fill();
    }

    if (pendingWireTurnCrossingDecision) {
        ctx.save();
        ctx.strokeStyle = accentColor || "#7aceff";
        ctx.fillStyle = textureIsDark ? "#111111" : "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(
            pendingWireTurnCrossingDecision.crossing.x,
            pendingWireTurnCrossingDecision.crossing.y,
            Math.max(6, 6 * zoom),
            0,
            Math.PI * 2,
        );
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = accentColor || "#7aceff";
        ctx.font = `bold ${Math.max(11, 11 * zoom)}px "IBM Plex Sans"`;
        ctx.textAlign = "center";
        ctx.fillText(
            "J / C",
            pendingWireTurnCrossingDecision.crossing.x,
            pendingWireTurnCrossingDecision.crossing.y - 12,
        );
        ctx.restore();
    }
}

function drawAllComponents() {
    components.forEach((comp) => {
        try {
            const isSelected = selectedComponentIds.includes(String(comp.id));
            drawComponent(comp, isSelected ? 1.0 : 0.9);
        } catch (err) {
            console.error(`Error drawing component ${comp.type}:`, err);
        }
    });
}
function drawGhost() { if (placingComponent) { try { drawComponent(placingComponent, 0.5); } catch (err) { console.error("Error drawing ghost component:", err); } } }

function drawAllPinLabels() {
    for (const comp of components) {
        const def = COMPONENT_DEFS[comp.type];
        if (!def?.pins?.length) {
            continue;
        }
        for (const pin of def.pins) {
            drawPinLabel(getPinWorldGeometry(comp, pin), { persistent: true });
        }
    }
}

function drawArcOnCanvas(graphic, scale) {
    const x1 = graphic.x1 * scale;
    const y1 = graphic.y1 * scale;
    const x2 = graphic.x2 * scale;
    const y2 = graphic.y2 * scale;
    const x3 = graphic.cx * scale;
    const y3 = graphic.cy * scale;

    const determinant = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));
    if (Math.abs(determinant) < 0.01) {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(x2, y2, x3, y3);
        ctx.stroke();
        return;
    }

    const ux = ((x1 * x1 + y1 * y1) * (y2 - y3) + (x2 * x2 + y2 * y2) * (y3 - y1) + (x3 * x3 + y3 * y3) * (y1 - y2)) / determinant;
    const uy = ((x1 * x1 + y1 * y1) * (x3 - x2) + (x2 * x2 + y2 * y2) * (x1 - x3) + (x3 * x3 + y3 * y3) * (x2 - x1)) / determinant;
    const radius = Math.hypot(x1 - ux, y1 - uy);
    const startAngle = Math.atan2(y1 - uy, x1 - ux);
    const endAngle = Math.atan2(y3 - uy, x3 - ux);
    const anticlockwise = ((x2 - x1) * (y3 - y2) - (y2 - y1) * (x3 - x2)) < 0;

    ctx.beginPath();
    ctx.arc(ux, uy, radius, startAngle, endAngle, anticlockwise);
    ctx.stroke();
}

function drawSchematicFallback(comp, def, opacity, screenX, screenY, scale) {
    const bounds = def.hitBounds ?? def.bounds ?? { minX: -200, maxX: 200, minY: -150, maxY: 150, width: 400, height: 300 };
    const bodyBounds = def.bodyBounds ?? bounds;
    const schematicInk = textureIsDark ? "#efe48b" : "#111111";
    ctx.save();
    try {
        ctx.translate(screenX, screenY);
        ctx.rotate((comp.rotation || 0) * Math.PI / 180);
        ctx.globalAlpha = opacity;
        ctx.strokeStyle = schematicInk;
        ctx.fillStyle = schematicInk;
        ctx.lineCap = "square";
        ctx.lineJoin = "miter";

        for (const graphic of def.graphics ?? []) {
            ctx.lineWidth = Math.max(1.4, graphic.strokeWidth * SYMBOL_UNIT_SCALE * scale * 0.8);
            if (graphic.kind === "rectangle") {
                const x = Math.min(graphic.x1, graphic.x2) * scale;
                const y = Math.min(graphic.y1, graphic.y2) * scale;
                const width = Math.abs(graphic.x2 - graphic.x1) * scale;
                const height = Math.abs(graphic.y2 - graphic.y1) * scale;
                ctx.strokeRect(x, y, width, height);
            } else if (graphic.kind === "polyline") {
                const points = graphic.points ?? [];
                if (points.length > 1) {
                    ctx.beginPath();
                    ctx.moveTo(points[0].x * scale, points[0].y * scale);
                    for (const point of points.slice(1)) {
                        ctx.lineTo(point.x * scale, point.y * scale);
                    }
                    ctx.stroke();
                }
            } else if (graphic.kind === "circle") {
                ctx.beginPath();
                ctx.arc(graphic.cx * scale, graphic.cy * scale, graphic.radius * scale, 0, Math.PI * 2);
                ctx.stroke();
            } else if (graphic.kind === "arc") {
                drawArcOnCanvas(graphic, scale);
            } else if (graphic.kind === "text") {
                ctx.font = `${Math.max(10, graphic.fontSize * scale * 0.65)}px "IBM Plex Sans"`;
                ctx.fillText(graphic.text, graphic.x1 * scale, graphic.y1 * scale);
            }
        }

        ctx.strokeStyle = schematicInk;
        ctx.fillStyle = schematicInk;
        ctx.lineWidth = Math.max(1.5, 0.12 * scale);
        for (const pin of def.pins ?? []) {
            ctx.beginPath();
            ctx.moveTo(pin.x * scale, pin.y * scale);
            ctx.lineTo(pin.innerX * scale, pin.innerY * scale);
            ctx.stroke();
            if (currentTool === "wire" || selectedComponentIds.includes(String(comp.id))) {
                const markerSize = Math.max(3, 0.22 * scale);
                ctx.fillRect(pin.x * scale - markerSize / 2, pin.y * scale - markerSize / 2, markerSize, markerSize);
            }
        }

        const labels = getCanvasComponentLabels(comp, def);
        const labelFontSize = Math.max(10, 0.5 * scale);
        const labelGap = Math.max(10, 0.45 * scale);
        const topLabelY = Math.min(bodyBounds.minY, bounds.minY) * scale - labelGap;
        const bottomLabelY = Math.max(bodyBounds.maxY, bounds.maxY) * scale + labelGap;
        ctx.fillStyle = schematicInk;
        ctx.font = `${labelFontSize}px "IBM Plex Sans"`;
        ctx.textAlign = "center";
        if (labels.reference) {
            ctx.textBaseline = "bottom";
            ctx.fillText(labels.reference, 0, topLabelY);
        }
        if (labels.value) {
            ctx.textBaseline = "top";
            ctx.fillText(labels.value, 0, bottomLabelY);
        }
        ctx.textAlign = "start";
        ctx.textBaseline = "alphabetic";

        if (selectedComponentIds.includes(String(comp.id)) && currentTool !== "wire" && !activeWire) {
            ctx.strokeStyle = accentColor || "#7aceff";
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 5]);
            ctx.strokeRect(bounds.minX * scale - 8, bounds.minY * scale - 8, bounds.width * scale + 16, bounds.height * scale + 16);
            ctx.setLineDash([]);
        }
    } finally {
        ctx.restore();
    }
}

function drawComponent(comp, opacity) {
    const def = COMPONENT_DEFS[comp.type];
    if (!def) return;
    const u = pixelsPerUnit * zoom;
    const screenX = offsetX + comp.uX * u;
    const screenY = offsetY - comp.uY * u;
    drawSchematicFallback(comp, def, opacity, screenX, screenY, u);
}

function drawPinLabel(pinHit, options = {}) {
    const { persistent = false, emphasized = false, showMarker = false } = options;
    const text = String(pinHit?.label || "").trim();
    if (!text) {
        return;
    }

    const placement = getPinLabelPlacement(pinHit);
    const fontSize = Math.max(10, (persistent ? 10.5 : 11.5) * zoom);
    const paddingX = persistent ? 5 : 7;
    const paddingY = persistent ? 3 : 4;

    ctx.save();
    ctx.font = `${persistent ? "" : "bold "}${fontSize}px "IBM Plex Sans"`;
    ctx.textAlign = placement.textAlign;
    ctx.textBaseline = placement.textBaseline;

    const metrics = ctx.measureText(text);
    const textWidth = metrics.width;
    const textHeight = fontSize;
    let boxX = placement.labelX - textWidth / 2 - paddingX;
    let boxY = placement.labelY - textHeight / 2 - paddingY;

    if (placement.textAlign === "left") {
        boxX = placement.labelX - paddingX;
    } else if (placement.textAlign === "right") {
        boxX = placement.labelX - textWidth - paddingX;
    }

    if (placement.textBaseline === "top") {
        boxY = placement.labelY - paddingY;
    } else if (placement.textBaseline === "bottom") {
        boxY = placement.labelY - textHeight - paddingY;
    }

    const boxWidth = textWidth + paddingX * 2;
    const boxHeight = textHeight + paddingY * 2;
    ctx.fillStyle = persistent
        ? (textureIsDark ? "rgba(7, 10, 14, 0.72)" : "rgba(255, 255, 255, 0.86)")
        : "rgba(0, 0, 0, 0.84)";
    ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

    ctx.fillStyle = persistent
        ? (textureIsDark ? "#efe48b" : "#111111")
        : (accentColor || "#7aceff");
    ctx.fillText(text, placement.labelX, placement.labelY);

    if (showMarker) {
        ctx.strokeStyle = emphasized ? (accentColor || "#7aceff") : (textureIsDark ? "#efe48b" : "#111111");
        ctx.lineWidth = emphasized ? 2 : 1.4;
        ctx.beginPath();
        ctx.arc(placement.tipScreenX, placement.tipScreenY, Math.max(4, 4 * zoom), 0, Math.PI * 2);
        ctx.stroke();
    }
    ctx.restore();
}

function drawSelectionBox() {
    if (!selectionBox) {
        return;
    }

    const rect = canvas.getBoundingClientRect();
    const left = Math.min(selectionBox.startClientX, selectionBox.currentClientX) - rect.left;
    const top = Math.min(selectionBox.startClientY, selectionBox.currentClientY) - rect.top;
    const width = Math.abs(selectionBox.currentClientX - selectionBox.startClientX);
    const height = Math.abs(selectionBox.currentClientY - selectionBox.startClientY);

    ctx.save();
    ctx.fillStyle = "rgba(122, 206, 255, 0.14)";
    ctx.strokeStyle = accentColor || "#7aceff";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.fillRect(left, top, width, height);
    ctx.strokeRect(left, top, width, height);
    ctx.restore();
}

function getSelectionBoxBounds() {
    if (!selectionBox) {
        return null;
    }
    const rect = canvas.getBoundingClientRect();
    return {
        left: Math.min(selectionBox.startClientX, selectionBox.currentClientX) - rect.left,
        top: Math.min(selectionBox.startClientY, selectionBox.currentClientY) - rect.top,
        right: Math.max(selectionBox.startClientX, selectionBox.currentClientX) - rect.left,
        bottom: Math.max(selectionBox.startClientY, selectionBox.currentClientY) - rect.top,
    };
}

function applySelectionBox() {
    const bounds = getSelectionBoxBounds();
    if (!bounds) {
        return;
    }

    const activeSelectionScope = getActiveSelectionScope();
    const componentIds = activeSelectionScope === "wires"
        ? []
        : components
            .filter((component) => {
                const componentBounds = getComponentSelectionBounds(component);
                return componentBounds
                    && componentBounds.left >= bounds.left
                    && componentBounds.top >= bounds.top
                    && componentBounds.right <= bounds.right
                    && componentBounds.bottom <= bounds.bottom;
            })
            .map((component) => String(component.id));

    const wireIds = activeSelectionScope === "components"
        ? []
        : buildRenderedWireRoutes()
            .filter((route) => {
                const wireBounds = getWireBounds(route.routePoints);
                return wireBounds.left >= bounds.left
                    && wireBounds.top >= bounds.top
                    && wireBounds.right <= bounds.right
                    && wireBounds.bottom <= bounds.bottom;
            })
            .map((route) => String(route.connection.id));

    selectMixedSelection(componentIds, wireIds, selectionBox.append);
    selectionBox = null;
}

function updatePinLabelToggleButton() {
    const button = document.getElementById("pin-label-toggle-btn");
    if (!button) {
        return;
    }
    button.classList.toggle("active", showAllPinLabels);
    button.setAttribute("aria-pressed", showAllPinLabels ? "true" : "false");
    button.title = showAllPinLabels ? "Hide Pin Labels" : "Show Pin Labels";
}

function drawRulers() {
    const frame = document.getElementById("workspace-frame"); 
    const container = document.getElementById("workspace-container"); 
    if (!frame || !container) return;
    
    const rect = frame.getBoundingClientRect(); 
    const contRect = container.getBoundingClientRect();
    
    // START HUD POSITION (Top-Left of Canvas)
    const hudX = rect.left - contRect.left + 16;
    const hudY = rect.top - contRect.top + 25; 

    scaleCtx.clearRect(0, 0, scaleCanvas.width / dpr, scaleCanvas.height / dpr);
    
    // Status text
    scaleCtx.textAlign = "left"; 
    scaleCtx.font = "bold 12px 'JetBrains Mono', Monospace";
    scaleCtx.fillStyle = backendOnline ? "#4caf50" : "#f44336";
    scaleCtx.fillText(backendOnline ? "● BACKEND: ONLINE" : "● BACKEND: OFFLINE", hudX, hudY);
    
    scaleCtx.fillStyle = (frame.style.background === "rgb(255, 255, 255)") ? "#111" : (accentColor || "#4a90e2"); 
    scaleCtx.font = "bold 14px 'JetBrains Mono', Monospace";
    scaleCtx.fillText("AURA | VIRTUAL GRID SYSTEM", hudX, hudY + 20);
    
    scaleCtx.fillStyle = "rgba(128,128,128,0.7)"; 
    scaleCtx.font = "12px 'JetBrains Mono', Monospace";
    scaleCtx.fillText(`UNIT: ${BASE_UNIT_MM}mm | CAL: ${pixelsPerUnit}px/u | ZOOM: ${zoom.toFixed(2)}x`, hudX, hudY + 36);

    const pxPerU = pixelsPerUnit * zoom;
    const potentialSteps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
    let unitStep = potentialSteps.find(s => s * pxPerU >= 55) || 1000;
    const spacing = unitStep * pxPerU;
    
    // Rulers
    scaleCtx.fillStyle = "rgba(128,128,128,0.5)"; 
    scaleCtx.font = "11px 'JetBrains Mono', Monospace";
    scaleCtx.textAlign = "center";
    for(let x = Math.ceil(-offsetX / spacing) * spacing + offsetX; x < rect.width; x += spacing) {
        if (x < -1) continue;
        scaleCtx.fillText(Math.round((x - offsetX) / pxPerU) + "u", rect.left - contRect.left + x, rect.top - contRect.top + rect.height + 16);
    }
}

let dragStarted = false;
let isInteractingMechanism = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
let lastX = 0;
let lastY = 0;
let isPanning = false;
let mechanismDragState = null;
let pendingWireCanvasAction = null;
let draggedComponentGroup = null;

canvas.onmousedown = (e) => {
    if (e.button === 2) {
        pendingWireCanvasAction = null;
        if (activeWire) {
            handledActiveWireCrossings = [];
            pendingWireTurnCrossingDecision = null;
            activeWire = null;
            draw();
            return;
        }
        if (placingComponent) {
            placingComponent = null;
            const status = document.getElementById("stage-mode-label");
            if (status) status.textContent = "Placement cancelled.";
            draw();
            return;
        }
        return;
    }
    const { uX, uY } = getMouseInUnits(e);
    const canvasRect = canvas.getBoundingClientRect();
    const screenX = e.clientX - canvasRect.left;
    const screenY = e.clientY - canvasRect.top;
    if (currentTool === 'wire') {
        if (pendingWireTurnCrossingDecision && e.button === 0) {
            draw();
            return;
        }
        if (!activeWire?.from) {
            const wireHit = !hoveredPin ? findWireHitAtScreenPoint(screenX, screenY) : null;
            if (!hoveredPin) {
                if (wireHit?.route) {
                    const nextTap = splitWireAtScreenPoint(String(wireHit.route.connection.id), wireHit.point);
                    if (nextTap) {
                        startWire(nextTap.junctionEndpoint);
                        saveHistory();
                        draw();
                        return;
                    }
                }
                dragging = true;
                isPanning = true;
                lastX = e.clientX;
                lastY = e.clientY;
                draw();
                return;
            }

            startWire(
                hoveredPin.kind === "junction"
                    ? { kind: "junction", junctionId: hoveredPin.junctionId }
                    : { kind: "pin", compId: hoveredPin.comp.id, pinId: getPinId(hoveredPin.pin) },
            );
            draw();
            return;
        }

        const wireHit = !hoveredPin ? findWireHitAtScreenPoint(screenX, screenY) : null;
        if (!hoveredPin) {
            if (wireHit?.route) {
                const nextTap = splitWireAtScreenPoint(String(wireHit.route.connection.id), wireHit.point);
                if (nextTap) {
                    pendingWireCanvasAction = null;
                    saveHistory();
                    queuePendingActiveWireDecision(
                        { kind: "complete", endpoint: nextTap.junctionEndpoint },
                        nextTap.point,
                    );
                    draw();
                    return;
                }
            }
            pendingWireCanvasAction = {
                startClientX: e.clientX,
                startClientY: e.clientY,
                uX,
                uY,
                moved: false,
            };
            draw();
            return;
        }

        const targetEndpoint = hoveredPin.kind === "junction"
            ? { kind: "junction", junctionId: hoveredPin.junctionId }
            : { kind: "pin", compId: hoveredPin.comp.id, pinId: getPinId(hoveredPin.pin) };
        const isSameEndpoint = isEndpointEqual(activeWire.from, targetEndpoint);
        if (isSameEndpoint) {
            draw();
            return;
        }

        pendingWireCanvasAction = null;
        queuePendingActiveWireDecision(
            { kind: "complete", endpoint: targetEndpoint },
            resolveWireEndpoint(targetEndpoint)?.point ?? null,
        );
        draw();
        return;
    }
    if (e.button === 1) {
        dragging = true;
        isPanning = true;
        lastX = e.clientX;
        lastY = e.clientY;
        draw();
        return;
    }

    if (currentTool === 'select' && e.button === 0 && selectionMode) {
        lastSelectionCycle = null;
        selectionBox = {
            startClientX: e.clientX,
            startClientY: e.clientY,
            currentClientX: e.clientX,
            currentClientY: e.clientY,
            append: e.ctrlKey || e.metaKey,
        };
        if (!selectionBox.append) {
            clearStageSelectionPreserveBox();
        }
        draw();
        return;
    }

    const selectionTarget = currentTool === "select"
        ? pickSelectionTarget(buildSelectionTargetsAtPoint(uX, uY, screenX, screenY), screenX, screenY)
        : null;
    draggedComponent = selectionTarget?.kind === "component"
        ? components.find((component) => String(component.id) === selectionTarget.id) ?? null
        : null;

    if (currentTool === 'select' && e.button === 0 && (e.ctrlKey || e.metaKey)) {
        if (selectionTarget) {
            toggleSelectionTarget(selectionTarget);
            draw();
            return;
        }
    }

    if (currentTool === 'select' && e.button === 0 && selectionTarget?.kind === "junction") {
        selectJunction(selectionTarget.id);
        draw();
        return;
    }

    if (currentTool === 'select' && e.button === 0 && selectionTarget?.kind === "wire" && !draggedComponent) {
        const preserveMultiWireSelection = selectedWireIds.includes(selectionTarget.id)
            && selectedWireIds.length > 1
            && selectedComponentIds.length === 0;
        if (!preserveMultiWireSelection) {
            selectMixedSelection([], [selectionTarget.id]);
        } else {
            syncSelectionPresentation();
        }
        draw();
        return;
    }

    if (draggedComponent) {
        const preserveMultiComponentSelection = selectedComponentIds.includes(String(draggedComponent.id))
            && selectedComponentIds.length > 1
            && selectedWireIds.length === 0
            && !selectedJunctionId;
        if (!preserveMultiComponentSelection) {
            selectComponentById(draggedComponent.id);
        } else {
            syncSelectionPresentation();
        }
        draggedComponentGroup = preserveMultiComponentSelection
            ? selectedComponentIds
                .map((id) => components.find((component) => String(component.id) === String(id)))
                .filter(Boolean)
                .map((component) => ({
                    component,
                    offsetX: component.uX - uX,
                    offsetY: component.uY - uY,
                }))
            : null;
        const def = COMPONENT_DEFS[draggedComponent.type];
        const interactiveRule = def && def.interactive ? def.interactive.find(i => i.type === 'rotate' || i.type === 'translate') : null;
        if (interactiveRule) {
            const rad = (draggedComponent.rotation || 0) * Math.PI / 180;
            const dx = uX - draggedComponent.uX; const dy = uY - draggedComponent.uY;
            const lx = dx * Math.cos(rad) - dy * Math.sin(rad); 
            const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
            
            let clickedMechanism = false;
            if (interactiveRule.type === 'rotate') {
                // Keep rotate hitbox tight around the dial center so body drags still move component.
                const dialRadius = Math.max(2, Math.min(10, ((Math.min(def.uW || 16, def.uH || 16)) * 0.22)));
                if (Math.hypot(lx, ly) <= dialRadius) clickedMechanism = true;
            } 
            else if (interactiveRule.type === 'translate') {
                // Keep translate hitbox focused around the expected knob/plunger location.
                const axis = interactiveRule.axis || 'x';
                const rMin = (interactiveRule.range && interactiveRule.range.length === 2) ? interactiveRule.range[0] : 0;
                const rMax = (interactiveRule.range && interactiveRule.range.length === 2) ? interactiveRule.range[1] : 100;
                const currentVal = parseFloat(draggedComponent.properties[interactiveRule.property || 'value']);
                const safeVal = Number.isFinite(currentVal) ? currentVal : rMin;
                const ratio = Math.max(0, Math.min(1, (safeVal - rMin) / ((rMax - rMin) || 1)));

                const spanX = Math.max(1, def.uW || 40);
                const spanY = Math.max(1, def.uH || 20);
                const tRange = interactiveRule.translateRange;
                const hasTranslateRange = Array.isArray(tRange) && tRange.length === 2 && Number.isFinite(tRange[0]) && Number.isFinite(tRange[1]);
                const travelAura = hasTranslateRange ? Math.abs(tRange[1] - tRange[0]) / 12.5 : 0;
                const isStepped = !!interactiveRule.snapSteps || interactiveRule.control === 'select';
                const travel = isStepped && travelAura > 0
                    ? Math.max(2, Math.min((axis === 'x' ? spanX : spanY) * 0.8, travelAura))
                    : (axis === 'x' ? spanX : spanY);
                const knobCenterAxis = -travel / 2 + ratio * travel;

                const knobAxisSize = axis === 'x'
                    ? (interactiveRule.knobWidth || Math.max(4, spanX * 0.2))
                    : (interactiveRule.knobHeight || Math.max(4, spanY * 0.2));
                const knobCrossSize = axis === 'x'
                    ? (interactiveRule.knobHeight || Math.max(4, spanY * 0.5))
                    : (interactiveRule.knobWidth || Math.max(4, spanX * 0.5));

                // General rule: only mechanism area + up to 20% surrounding region is grabbable.
                const mechanismPad = 0.2; // 20%
                const tolAxis = Math.max(3, (knobAxisSize * 0.5) * (1 + mechanismPad));
                const tolCross = Math.max(3, (knobCrossSize * 0.5) * (1 + mechanismPad));

                // Global guard: do not allow mechanism grabbing far outside component silhouette.
                const partPad = 0.2; // allow up to 20% outside part bounds
                const maxX = (spanX * 0.5) * (1 + partPad);
                const maxY = (spanY * 0.5) * (1 + partPad);
                const withinPartEnvelope = Math.abs(lx) <= maxX && Math.abs(ly) <= maxY;

                if (axis === 'x') {
                    const hit = Math.abs(lx - knobCenterAxis) <= tolAxis && Math.abs(ly) <= tolCross;
                    if (hit && withinPartEnvelope) clickedMechanism = true;
                } else {
                    const hit = Math.abs(ly - knobCenterAxis) <= tolAxis && Math.abs(lx) <= tolCross;
                    if (hit && withinPartEnvelope) clickedMechanism = true;
                }
            }
            
            if (clickedMechanism) {
                const propName = interactiveRule.property || 'value';
                if (draggedComponent.properties[propName] === undefined) { draggedComponent.properties[propName] = 0; }
                mechanismDragState = null;
                if (interactiveRule.type === 'translate') {
                    const axis = interactiveRule.axis || 'x';
                    const rMin = (interactiveRule.range && interactiveRule.range.length === 2) ? interactiveRule.range[0] : 0;
                    const rMax = (interactiveRule.range && interactiveRule.range.length === 2) ? interactiveRule.range[1] : 100;
                    const currentVal = parseFloat(draggedComponent.properties[propName]) || rMin;
                    const mouseLocalAura = (axis === 'x' ? lx : -ly);
                    const spanFallback = axis === 'x' ? (def.uW || 40) : (def.uH || 20);
                    const knobSize = axis === 'x' ? interactiveRule.knobWidth : interactiveRule.knobHeight;
                    const baseSpan = Math.max(1, spanFallback - (typeof knobSize === 'number' ? knobSize : 0));
                    const tRange = interactiveRule.translateRange;
                    const hasTranslateRange = Array.isArray(tRange) && tRange.length === 2 && Number.isFinite(tRange[0]) && Number.isFinite(tRange[1]);
                    const travelAura = hasTranslateRange ? Math.abs(tRange[1] - tRange[0]) / 12.5 : 0;
                    const isStepped = !!interactiveRule.snapSteps || interactiveRule.control === 'select';
                    const interactionSpan = isStepped && travelAura > 0
                        ? Math.max(2, Math.min(24, travelAura))
                        : baseSpan;
                    mechanismDragState = {
                        startMouseLocalAura: mouseLocalAura,
                        startValue: currentVal,
                        interactionSpan
                    };
                }
                isInteractingMechanism = true; dragStarted = true; lastX = e.clientX; lastY = e.clientY; return;
            }
        }
        dragOffsetX = draggedComponent.uX - uX; dragOffsetY = draggedComponent.uY - uY;
    } else if (currentTool === 'select' && e.button === 0) {
        lastSelectionCycle = null;
        if (e.shiftKey) {
            selectionBox = {
                startClientX: e.clientX,
                startClientY: e.clientY,
                currentClientX: e.clientX,
                currentClientY: e.clientY,
                append: e.ctrlKey || e.metaKey,
            };
            if (!selectionBox.append) {
                clearStageSelectionPreserveBox();
            }
            draw();
            return;
        }
        clearStageSelection();
        isPanning = true;
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        draw();
        return;
    } else {
        lastSelectionCycle = null;
        clearStageSelection();
    }
    isPanning = !draggedComponent; dragging = true; lastX = e.clientX; lastY = e.clientY; draw();
};

window.onmouseup = () => {
    if (selectionBox) {
        applySelectionBox();
        draw();
    }
    if (pendingWireCanvasAction && activeWire) {
        if (!pendingWireCanvasAction.moved) {
            const startEndpoint = resolveWireEndpoint(activeWire.from);
            const nextPoint = getAssistedActiveWirePoint(
                pendingWireCanvasAction.uX,
                pendingWireCanvasAction.uY,
            );
            const lastPoint = activeWire.routePoints?.[activeWire.routePoints.length - 1]
                ?? (startEndpoint ? { uX: startEndpoint.uX, uY: startEndpoint.uY } : null);
            if (lastPoint && (lastPoint.uX !== nextPoint.uX || lastPoint.uY !== nextPoint.uY)) {
                queuePendingActiveWireDecision(
                    { kind: "turn", routePoint: nextPoint },
                    getScreenPointFromUnits(nextPoint.uX, nextPoint.uY),
                );
            }
        }
        pendingWireCanvasAction = null;
        draw();
    }
    if (dragging && dragStarted && draggedComponent) {
        refreshStoredWireJumpAnchors();
        saveHistory();
    }
    if (isInteractingMechanism) { saveHistory(); }
    dragging = false;
    draggedComponent = null;
    draggedComponentGroup = null;
    dragStarted = false;
    isInteractingMechanism = false;
    isPanning = false;
    mechanismDragState = null;
};

window.onmousemove = (e) => {
    const { uX, uY } = getMouseInUnits(e); mouseUx = uX; mouseUy = uY;
    const coordEl = document.getElementById("coord-display"); if (coordEl) coordEl.innerText = `${uX}u, ${uY}u`;
    hoveredPin = findHoveredPin(uX, uY);

    if (selectionBox) {
        selectionBox = {
            ...selectionBox,
            currentClientX: e.clientX,
            currentClientY: e.clientY,
        };
        draw();
        return;
    }

    if (pendingWireCanvasAction && activeWire) {
        const dx = e.clientX - pendingWireCanvasAction.startClientX;
        const dy = e.clientY - pendingWireCanvasAction.startClientY;
        if (!pendingWireCanvasAction.moved && Math.hypot(dx, dy) >= 6) {
            pendingWireCanvasAction.moved = true;
            dragging = true;
            isPanning = true;
            lastX = pendingWireCanvasAction.startClientX;
            lastY = pendingWireCanvasAction.startClientY;
        }
    }

    if (isPanning && dragging) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        if (isEditingTexture) {
            texOffsetX += dx;
            texOffsetY += dy;
        } else {
            offsetX += dx;
            offsetY += dy;
        }
        lastX = e.clientX;
        lastY = e.clientY;
        draw();
        return;
    }

    if (currentTool === 'wire' && activeWire) { draw(); return; }
    if (placingComponent) { placingComponent.uX = uX; placingComponent.uY = uY; draw(); return; }
    
    if (isInteractingMechanism && draggedComponent) {
        const def = COMPONENT_DEFS[draggedComponent.type];
        const interactiveRule = def && def.interactive ? def.interactive.find(i => i.type === 'rotate' || i.type === 'translate') : null;
        if (interactiveRule) {
            const rad = (draggedComponent.rotation || 0) * Math.PI / 180;
            const dx = uX - draggedComponent.uX; const dy = uY - draggedComponent.uY;
            const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
            const ly = dx * Math.sin(rad) + dy * Math.cos(rad);

            if (interactiveRule.type === 'translate') {
                const axis = interactiveRule.axis || 'x';
                const mousePosLocalAura = (axis === 'x' ? lx : -ly);
                const rMin = (interactiveRule.range && interactiveRule.range.length === 2) ? interactiveRule.range[0] : 0;
                const rMax = (interactiveRule.range && interactiveRule.range.length === 2) ? interactiveRule.range[1] : 100;
                const startMouse = mechanismDragState ? mechanismDragState.startMouseLocalAura : mousePosLocalAura;
                const startValue = mechanismDragState ? mechanismDragState.startValue : rMin;
                const span = mechanismDragState ? mechanismDragState.interactionSpan : Math.max(1, (axis === 'x' ? (def.uW || 40) : (def.uH || 20)));
                const deltaAura = mousePosLocalAura - startMouse;
                let val = startValue + (deltaAura / span) * (rMax - rMin);
                val = Math.max(rMin, Math.min(rMax, val));

                if (interactiveRule.snapSteps) {
                    const stepSize = (rMax - rMin) / (interactiveRule.snapSteps || 1);
                    val = Math.round((val - rMin) / stepSize) * stepSize + rMin;
                }

                const propName = interactiveRule.property || 'value';
                draggedComponent.properties[propName] = parseFloat(val.toFixed(2));

                // Update Inspector UI if open
                const sliderInput = document.getElementById(`inspector-slider-${propName}`);
                const sliderDisp = document.getElementById(`inspector-disp-${propName}`);
                const selectBox = document.getElementById(`inspector-input-${propName}`);
                if (sliderInput) sliderInput.value = val;
                if (selectBox) selectBox.value = val;
                if (sliderDisp) {
                    if (interactiveRule.labels) {
                        const stepSize = (rMax - rMin) / (interactiveRule.snapSteps || 1);
                        const labelIdx = Math.round((val - rMin) / stepSize);
                        sliderDisp.innerText = interactiveRule.labels[labelIdx] || val;
                    } else { sliderDisp.innerText = Math.round(val) + (interactiveRule.unit === '%' ? "%" : ""); }
                }
            } else {
                // Fallback for rotate type or other simple interactions
                const delta = lastY - e.clientY;
                let val = parseFloat(draggedComponent.properties.value) || 0;
                val = Math.max(0, Math.min(100, val + delta * 0.5));
                draggedComponent.properties.value = parseFloat(val.toFixed(2));
                const sliderInput = document.getElementById(`inspector-slider-value`);
                const sliderDisp = document.getElementById(`inspector-disp-value`);
                if (sliderInput) sliderInput.value = val;
                if (sliderDisp) sliderDisp.innerText = Math.round(val) + "%";
            }
            draw();
        }
        lastX = e.clientX; lastY = e.clientY; return;
    }
    
    if (!dragging) { if (currentTool === 'wire' || hoveredPin) draw(); return; }
    if (draggedComponent && currentTool === 'select') {
        dragStarted = true;
        if (draggedComponentGroup?.length > 1) {
            draggedComponentGroup.forEach((entry) => {
                entry.component.uX = uX + entry.offsetX;
                entry.component.uY = uY + entry.offsetY;
            });
        } else {
            const dragDef = COMPONENT_DEFS[draggedComponent.type]; let snapOffset = { x: 0, y: 0 }; let activeSnap = false;
            if (dragDef && dragDef.pins) {
                for (const dragPin of dragDef.pins) {
                    const rad = (draggedComponent.rotation || 0) * Math.PI / 180;
                    const rx = dragPin.uX * Math.cos(rad) - (-dragPin.uY) * Math.sin(rad); const ry = dragPin.uX * Math.sin(rad) + (-dragPin.uY) * Math.cos(rad);
                    const myPinX = uX + rx; const myPinY = uY + (-ry);
                    for (const otherComp of components) {
                        if (otherComp === draggedComponent) continue;
                        const otherDef = COMPONENT_DEFS[otherComp.type]; if (!otherDef || !otherDef.pins) continue;
                        for (const otherPin of otherDef.pins) {
                            const orad = (otherComp.rotation || 0) * Math.PI / 180;
                            const orx = otherPin.uX * Math.cos(orad) - (-otherPin.uY) * Math.sin(orad); const ory = otherPin.uX * Math.sin(orad) + (-otherPin.uY) * Math.cos(orad);
                            const targetX = otherComp.uX + orx; const targetY = otherComp.uY + (-ory);
                            if (Math.sqrt((myPinX - targetX)**2 + (myPinY - targetY)**2) < 4) { activeSnap = true; snapOffset.x = targetX - rx; snapOffset.y = targetY - (-ry); break; }
                        }
                        if (activeSnap) break;
                    }
                    if (activeSnap) break;
                }
            }
            if (activeSnap) { draggedComponent.uX = snapOffset.x; draggedComponent.uY = snapOffset.y; } else { draggedComponent.uX = uX + dragOffsetX; draggedComponent.uY = uY + dragOffsetY; }
        }
    } else if (isPanning) { const dx = e.clientX - lastX; const dy = e.clientY - lastY; if (isEditingTexture) { texOffsetX += dx; texOffsetY += dy; } else { offsetX += dx; offsetY += dy; } }
    lastX = e.clientX; lastY = e.clientY; draw();
};

window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) || document.activeElement.isContentEditable;
    const importModal = document.getElementById("json-import-modal");
    const aiChatPanel = document.getElementById("ai-chat-panel");
    const aiCanvasPanel = document.getElementById("ai-canvas-panel");
    if (key === 'escape' && importModal && !importModal.hidden) {
        e.preventDefault();
        closeJsonImportModal();
        return;
    }
    if (key === 'escape' && ((aiChatPanel && !aiChatPanel.hidden) || (aiCanvasPanel && !aiCanvasPanel.hidden))) {
        e.preventDefault();
        closeAiToolsModal();
        return;
    }
    if (e.ctrlKey && key === 'z') { e.preventDefault(); e.stopImmediatePropagation(); undo(); return; }
    if (e.ctrlKey && key === 'y') { e.preventDefault(); e.stopImmediatePropagation(); redo(); return; }
    if (isTyping) { if (key === 'backspace' || key === 'delete') { e.stopPropagation(); } return; }
    if (pendingWireTurnCrossingDecision) {
        if (key === 'j') {
            e.preventDefault();
            handlePendingWireJumpDecision();
            draw();
            return;
        }
        if (key === 'c') {
            e.preventDefault();
            handlePendingWireConnectDecision();
            draw();
            return;
        }
        if (key === 'escape') {
            e.preventDefault();
            pendingWireTurnCrossingDecision = null;
            draw();
            return;
        }
    }
    if (key === 'w') { setTool(currentTool === 'wire' ? 'select' : 'wire'); }
    if (key === 'escape') {
        if (selectionBox) {
            selectionBox = null;
            draw();
            return;
        }
        if (activeWire) {
            pendingWireCanvasAction = null;
            handledActiveWireCrossings = [];
            pendingWireTurnCrossingDecision = null;
            activeWire = null;
            draw();
        } else if (placingComponent) {
            placingComponent = null;
            const status = document.getElementById("stage-mode-label");
            if (status) status.textContent = "Placement cancelled.";
            draw();
        } else {
            setTool('select');
        }
    }
    if (key === 'r') { if (selectedComponent) { saveHistory(); selectedComponent.rotation = (selectedComponent.rotation + 90) % 360; draw(); } else if (placingComponent) { placingComponent.rotation = (placingComponent.rotation + 90) % 360; draw(); } }
    if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedComponentIds.length || selectedWireIds.length || selectedJunctionId) {
            saveHistory();
            if (selectedComponentIds.length) {
                const removedComponentIds = new Set(selectedComponentIds.map((id) => String(id)));
                components = components.filter((component) => !removedComponentIds.has(String(component.id)));
                wires = wires.filter((wire) => {
                    const from = normalizeEndpoint(wire.from);
                    const to = normalizeEndpoint(wire.to);
                    return !((from?.kind === "pin" && removedComponentIds.has(String(from.compId)))
                        || (to?.kind === "pin" && removedComponentIds.has(String(to.compId))));
                });
            }
            if (selectedWireIds.length) {
                const removedWireIds = new Set(selectedWireIds.map((id) => String(id)));
                wires = wires.filter((wire) => !removedWireIds.has(String(wire.id)));
            }
            if (selectedJunctionId) {
                const junctionId = String(selectedJunctionId);
                junctions = junctions.filter((junction) => String(junction.id) !== junctionId);
                wires = wires.filter((wire) => {
                    const from = normalizeEndpoint(wire.from);
                    const to = normalizeEndpoint(wire.to);
                    return !((from?.kind === "junction" && String(from.junctionId) === junctionId)
                        || (to?.kind === "junction" && String(to.junctionId) === junctionId));
                });
            }
            clearStageSelection();
            draw();
        }
    }
}, true);

canvas.onclick = (e) => {
    if (placingComponent) {
        const { uX, uY } = getMouseInUnits(e);
        commitPlacement(uX, uY);
    }
};
canvas.oncontextmenu = (e) => { e.preventDefault(); };
canvas.onwheel = (e) => {
    e.preventDefault(); const isTex = isEditingTexture; let currentZoom = isTex ? texZoom : zoom; let newZoom = currentZoom * (e.deltaY < 0 ? 1.1 : 0.9); newZoom = Math.max(0.1, Math.min(50, newZoom));
    const mouseX = e.offsetX; const mouseY = e.offsetY;
    if (isTex) { const wx = (mouseX - texOffsetX) / texZoom; const wy = (mouseY - texOffsetY) / texZoom; texZoom = newZoom; texOffsetX = mouseX - wx * texZoom; texOffsetY = mouseY - wy * texZoom; }
    else { const wx = (mouseX - offsetX) / zoom; const wy = (mouseY - offsetY) / zoom; zoom = newZoom; offsetX = mouseX - wx * zoom; offsetY = mouseY - wy * zoom; }
    draw();
};

function isDarkHexColor(hex) {
    const value = String(hex || "").replace("#", "");
    if (value.length !== 6) {
        return true;
    }
    const r = Number.parseInt(value.slice(0, 2), 16);
    const g = Number.parseInt(value.slice(2, 4), 16);
    const b = Number.parseInt(value.slice(4, 6), 16);
    return ((r * 299) + (g * 587) + (b * 114)) / 1000 < 128;
}

function applyCanvasSurface() {
    const frame = document.getElementById("workspace-frame");
    const container = document.getElementById("workspace-container");
    if (!frame || !container) return;

    if (currentCanvasTheme === "blueprint") {
        container.style.background = "radial-gradient(circle at center, #002244 0%, #001122 100%)";
    } else if (currentCanvasTheme === "light") {
        container.style.background = "#dcdcdc";
    } else {
        container.style.background = "radial-gradient(circle at center, #14181d 0%, #090b0f 100%)";
    }

    if (useTextureBackground) {
        frame.style.background = "#000000";
    } else {
        frame.style.background = canvasSolidColor;
        textureIsDark = isDarkHexColor(canvasSolidColor);
    }
    draw();
}

function bindCanvasSettings() {
    const toggle = document.getElementById("canvas-settings-toggle");
    const panel = document.getElementById("canvas-settings-panel");
    const bgMode = document.getElementById("canvas-bg-mode");
    const bgColor = document.getElementById("canvas-bg-color");
    const textureSelect = document.getElementById("canvas-texture");
    const themeSelect = document.getElementById("canvas-theme");
    const gridOpacityInput = document.getElementById("canvas-grid-opacity");
    const resetView = document.getElementById("canvas-reset-view");
    if (!toggle || !panel || !bgMode || !bgColor || !textureSelect || !themeSelect || !gridOpacityInput || !resetView) {
        return;
    }

    panel.hidden = true;

    toggle.onclick = (event) => {
        event.stopPropagation();
        panel.hidden = !panel.hidden;
    };

    panel.onclick = (event) => {
        event.stopPropagation();
    };

    document.addEventListener("click", () => {
        panel.hidden = true;
    });

    bgMode.value = useTextureBackground ? "texture" : "solid";
    bgColor.value = canvasSolidColor;
    themeSelect.value = currentCanvasTheme;
    gridOpacityInput.value = String(Math.round(gridOpacity * 100));

    bgMode.onchange = (event) => {
        useTextureBackground = event.target.value === "texture";
        applyCanvasSurface();
    };
    bgColor.oninput = (event) => {
        canvasSolidColor = event.target.value;
        if (!useTextureBackground) {
            applyCanvasSurface();
        }
    };
    textureSelect.onchange = (event) => {
        setTexture(event.target.value);
    };
    themeSelect.onchange = (event) => {
        setTheme(event.target.value);
    };
    gridOpacityInput.oninput = (event) => {
        setGridOpacity(event.target.value);
    };
    resetView.onclick = () => {
        resetOrigin();
    };
}

function bindPinLabelToggleButton() {
    const button = document.getElementById("pin-label-toggle-btn");
    if (!button) {
        return;
    }
    updatePinLabelToggleButton();
    button.onclick = () => {
        showAllPinLabels = !showAllPinLabels;
        updatePinLabelToggleButton();
        draw();
    };
}

function setGridOpacity(v) { gridOpacity = v/100; draw(); }
function toggleGrid() { showGrid = !showGrid; const btn = document.getElementById("grid-toggle-btn"); if (btn) btn.classList.toggle("active", showGrid); draw(); }
function toggleTextureLock() { isEditingTexture = !isEditingTexture; const btn = document.getElementById("bg-lock-btn"); const sg = document.getElementById("status-group"); const st = document.getElementById("status-text"); if (btn) btn.classList.toggle("active", isEditingTexture); if (sg) sg.classList.toggle("editing", isEditingTexture); if (st) st.innerText = isEditingTexture ? "ALIGN" : "GRID"; }
function resetOrigin() { const rect = canvas.getBoundingClientRect(); zoom = 1.0; offsetX = 0; offsetY = rect.height; draw(); }
function setGridResolution(v) { pixelsPerUnit = parseFloat(v); const display = document.getElementById("grid-val-display"); if (display) display.innerText = v + "px/u"; draw(); }
function setAccentColor(c) { accentColor = c; document.documentElement.style.setProperty('--accent-color', c); const light = document.getElementById("status-light"); const text = document.getElementById("status-text"); if (light) { light.style.background = c; light.style.boxShadow = `0 0 8px ${c}`; } if (text) text.style.color = c; draw(); }
function setTheme(theme) { currentCanvasTheme = theme; applyCanvasSurface(); }
function setTexture(n) { texture.src = "assets/textures/" + n; texture.onload = () => { analyzeTextureBrightness(); applyCanvasSurface(); }; }
function analyzeTextureBrightness() { if (!texture.complete || texture.width === 0) return; const tc = document.createElement('canvas'); tc.width = tc.height = 1; const tctx = tc.getContext('2d'); tctx.drawImage(texture, 0, 0, 1, 1); const d = tctx.getImageData(0, 0, 1, 1).data; textureIsDark = ((d[0] * 299 + d[1] * 587 + d[2] * 114) / 1000) < 128; }
function resizeWorkspace() {
    const frame = document.getElementById("workspace-frame"); const container = document.getElementById("workspace-container"); dpr = window.devicePixelRatio || 1; const rect = frame.getBoundingClientRect(); const contRect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr; canvas.height = rect.height * dpr; canvas.style.width = rect.width + "px"; canvas.style.height = rect.height + "px"; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scaleCanvas.width = contRect.width * dpr; scaleCanvas.height = contRect.height * dpr; scaleCanvas.style.width = contRect.width + "px"; scaleCanvas.style.height = contRect.height + "px"; scaleCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (isFirstLoad) { offsetX = 0; offsetY = rect.height; isFirstLoad = false; initLibrary(); }
    applyCanvasSurface();
    draw();
}
function setWireWidth(w) { wireWidth = parseFloat(w); const display = document.getElementById("wire-width-display"); if (display) display.innerText = w + "px"; draw(); }
function setWireColor(c) { currentWireColor = c; if (activeWire) activeWire.color = c; draw(); }
function generateNetlist() {
    const allPins = [];
    const pinByNodeKey = new Map();
    const adjacency = new Map();

    const ensureNode = (nodeKey) => {
        if (!nodeKey || adjacency.has(nodeKey)) {
            return;
        }
        adjacency.set(nodeKey, new Set());
    };

    const connectNodes = (firstKey, secondKey) => {
        if (!firstKey || !secondKey || firstKey === secondKey) {
            return;
        }
        ensureNode(firstKey);
        ensureNode(secondKey);
        adjacency.get(firstKey)?.add(secondKey);
        adjacency.get(secondKey)?.add(firstKey);
    };

    components.forEach((comp) => {
        const def = COMPONENT_DEFS[comp.type];
        if (!def?.pins?.length) {
            return;
        }
        def.pins.forEach((pin) => {
            const geometry = getPinWorldGeometry(comp, pin);
            const pinRecord = {
                comp,
                pinDef: pin,
                nodeKey: getGraphNodeKeyForEndpoint({ kind: "pin", compId: comp.id, pinId: getPinId(pin) }),
                worldX: Math.round(geometry.uX),
                worldY: Math.round(geometry.uY),
                netId: null,
            };
            allPins.push(pinRecord);
            pinByNodeKey.set(pinRecord.nodeKey, pinRecord);
            ensureNode(pinRecord.nodeKey);
        });
    });

    junctions.forEach((junction) => {
        ensureNode(getGraphNodeKeyForEndpoint({ kind: "junction", junctionId: junction.id }));
    });

    for (let firstIndex = 0; firstIndex < allPins.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < allPins.length; secondIndex += 1) {
            const firstPin = allPins[firstIndex];
            const secondPin = allPins[secondIndex];
            if (firstPin.worldX === secondPin.worldX && firstPin.worldY === secondPin.worldY) {
                connectNodes(firstPin.nodeKey, secondPin.nodeKey);
            }
        }
    }

    wires.forEach((wire) => {
        connectNodes(
            getGraphNodeKeyForEndpoint(wire.from),
            getGraphNodeKeyForEndpoint(wire.to),
        );
    });

    const nets = [];
    const visited = new Set();
    let netCounter = 1;

    for (const nodeKey of adjacency.keys()) {
        if (visited.has(nodeKey)) {
            continue;
        }
        const currentNet = { id: `Net_${netCounter}`, nodes: [] };
        const queue = [nodeKey];
        visited.add(nodeKey);

        while (queue.length > 0) {
            const currentKey = queue.shift();
            const pinData = pinByNodeKey.get(currentKey);
            if (pinData) {
                pinData.netId = currentNet.id;
                currentNet.nodes.push({
                    componentId: pinData.comp.id,
                    componentType: pinData.comp.type,
                    pinName: pinData.pinDef.id,
                    pinLabel: pinData.pinDef.label,
                    worldCoords: `(${pinData.worldX}, ${pinData.worldY})`,
                });
            }
            for (const neighbor of adjacency.get(currentKey) ?? []) {
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    queue.push(neighbor);
                }
            }
        }

        if (currentNet.nodes.length > 1) {
            currentNet.nodes.sort((a, b) => {
                if (a.componentId === b.componentId) {
                    return String(a.pinName).localeCompare(String(b.pinName));
                }
                return String(a.componentId).localeCompare(String(b.componentId));
            });
            nets.push(currentNet);
            netCounter += 1;
        }
    }

    const netlistPayload = { timestamp: Date.now(), totalNets: nets.length, nets };
    console.log("=== AURA NETLIST GENERATED ===");
    console.log(JSON.stringify(netlistPayload, null, 2));
    alert(`Netlist generated with ${nets.length} active nets! Check the browser console (F12) to view the JSON output.`);
    return netlistPayload;
}

window.onresize = resizeWorkspace;
window.onload = resizeWorkspace;
