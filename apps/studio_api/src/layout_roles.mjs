const ROLE_DEFAULTS = {
  connector: {
    size: { width: 100, height: 80 },
    rotationDeg: 0,
  },
  power_symbol: {
    size: { width: 60, height: 60 },
    rotationDeg: 0,
  },
  switch: {
    size: { width: 120, height: 60 },
    rotationDeg: 0,
  },
  controller: {
    size: { width: 140, height: 90 },
    rotationDeg: 0,
  },
  filter: {
    size: { width: 110, height: 45 },
    rotationDeg: 0,
  },
  passive_inline: {
    size: { width: 90, height: 40 },
    rotationDeg: 0,
  },
  passive_shunt: {
    size: { width: 40, height: 90 },
    rotationDeg: 90,
  },
  feedback: {
    size: { width: 75, height: 40 },
    rotationDeg: 0,
  },
  indicator: {
    size: { width: 80, height: 40 },
    rotationDeg: 0,
  },
  load: {
    size: { width: 60, height: 90 },
    rotationDeg: 90,
  },
  support: {
    size: { width: 80, height: 50 },
    rotationDeg: 0,
  },
  generic: {
    size: { width: 90, height: 50 },
    rotationDeg: 0,
  },
};

const SYMBOL_ROLE_HINTS = [
  { test: /^power:/i, role: "power_symbol" },
  { test: /^connector/i, role: "connector" },
  { test: /^device:(r|r_us|r_small|r_small_us)$/i, role: "passive_inline" },
  { test: /^device:c/i, role: "passive_shunt" },
  { test: /^device:l$/i, role: "filter" },
  { test: /^device:led$/i, role: "indicator" },
  { test: /^device:d$/i, role: "support" },
  { test: /^switch:/i, role: "switch" },
  { test: /^transistor_/i, role: "switch" },
  { test: /^regulator_/i, role: "controller" },
];

export function getRoleDefaults(role) {
  return ROLE_DEFAULTS[role] || ROLE_DEFAULTS.generic;
}

export function inferLayoutRole(symbolKey, explicitRole = "") {
  const normalizedExplicitRole = String(explicitRole || "").trim();
  if (normalizedExplicitRole && ROLE_DEFAULTS[normalizedExplicitRole]) {
    return normalizedExplicitRole;
  }

  const normalizedSymbolKey = String(symbolKey || "").trim();
  if (!normalizedSymbolKey) {
    return "generic";
  }

  const match = SYMBOL_ROLE_HINTS.find((entry) => entry.test.test(normalizedSymbolKey));
  return match?.role || "generic";
}
