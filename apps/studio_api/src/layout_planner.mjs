import { validateContractPayload } from "@aura/contracts";

import { getRoleDefaults, inferLayoutRole } from "./layout_roles.mjs";

const GRID_SNAP = 10;
const DEFAULT_MAIN_LANE_GAP = 140;
const DEFAULT_SUPPORT_OFFSET = 110;
const DEFAULT_NEAR_OFFSET = 90;
const DEFAULT_CLUSTER_GAP = 100;
const ZONE_ORDER = ["left", "center_left", "center", "center_right", "right"];

function includesText(value, needle) {
  return String(value || "").toUpperCase().includes(String(needle || "").toUpperCase());
}

function normalizeNetName(value) {
  return String(value || "").trim().toUpperCase();
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function snap(value, step = GRID_SNAP) {
  return Math.round(Number(value || 0) / step) * step;
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function getSceneBounds(sceneState) {
  const boxes = Array.isArray(sceneState?.components) ? sceneState.components
    .map((component) => component?.bodyBounds)
    .filter((bounds) => bounds && ["left", "top", "right", "bottom"].every((key) => isFiniteNumber(bounds[key])))
    : [];

  if (!boxes.length) {
    return {
      left: 120,
      top: 120,
      right: 680,
      bottom: 320,
    };
  }

  return {
    left: Math.min(...boxes.map((bounds) => Number(bounds.left))),
    top: Math.min(...boxes.map((bounds) => Number(bounds.top))),
    right: Math.max(...boxes.map((bounds) => Number(bounds.right))),
    bottom: Math.max(...boxes.map((bounds) => Number(bounds.bottom))),
  };
}

function getSceneComponentMap(sceneState) {
  const map = new Map();
  for (const component of sceneState?.components ?? []) {
    const bodyBounds = component?.bodyBounds;
    const width = bodyBounds && isFiniteNumber(bodyBounds.right) && isFiniteNumber(bodyBounds.left)
      ? Math.max(20, Number(bodyBounds.right) - Number(bodyBounds.left))
      : null;
    const height = bodyBounds && isFiniteNumber(bodyBounds.bottom) && isFiniteNumber(bodyBounds.top)
      ? Math.max(20, Number(bodyBounds.bottom) - Number(bodyBounds.top))
      : null;
    map.set(String(component.id), {
      source: "scene",
      id: String(component.id),
      symbolKey: String(component.symbolKey || ""),
      reference: String(component.reference || component.id),
      value: typeof component.value === "string" ? component.value : "",
      fields: component.fields && typeof component.fields === "object" ? cloneJson(component.fields) : {},
      properties: component.properties && typeof component.properties === "object" ? cloneJson(component.properties) : {},
      placement: {
        x: Number(component.placement?.x || 0),
        y: Number(component.placement?.y || 0),
        rotationDeg: Number(component.placement?.rotationDeg || 0),
      },
      size: {
        width: width || getRoleDefaults(inferLayoutRole(component.symbolKey)).size.width,
        height: height || getRoleDefaults(inferLayoutRole(component.symbolKey)).size.height,
      },
    });
  }
  return map;
}

function getPatchComponentOperationMaps(patch) {
  const addMap = new Map();
  const updateMap = new Map();
  const operations = Array.isArray(patch?.operations) ? patch.operations : [];

  operations.forEach((operation, index) => {
    if (operation?.op === "add_component" && operation.component?.id) {
      addMap.set(String(operation.component.id), { index, operation });
    }
    if (operation?.op === "update_component" && operation.id) {
      updateMap.set(String(operation.id), { index, operation });
    }
  });

  return { addMap, updateMap };
}

function mergePatchComponentsIntoMap(componentMap, patch) {
  const operations = Array.isArray(patch?.operations) ? patch.operations : [];
  for (const operation of operations) {
    if (operation?.op === "add_component" && operation.component?.id) {
      const component = operation.component;
      const role = inferLayoutRole(component.symbolKey);
      const defaults = getRoleDefaults(role);
      componentMap.set(String(component.id), {
        source: "patch_add",
        id: String(component.id),
        symbolKey: String(component.symbolKey || ""),
        reference: String(component.reference || component.id),
        value: typeof component.value === "string" ? component.value : "",
        fields: component.fields && typeof component.fields === "object" ? cloneJson(component.fields) : {},
        properties: component.properties && typeof component.properties === "object" ? cloneJson(component.properties) : {},
        placement: {
          x: Number(component.placement?.x || 0),
          y: Number(component.placement?.y || 0),
          rotationDeg: Number(component.placement?.rotationDeg || defaults.rotationDeg || 0),
        },
        size: cloneJson(defaults.size),
      });
    }
  }

  for (const operation of operations) {
    if (operation?.op !== "update_component" || !operation.id) {
      continue;
    }
    const entry = componentMap.get(String(operation.id));
    if (!entry) {
      continue;
    }
    if (operation.changes?.reference) {
      entry.reference = String(operation.changes.reference);
    }
    if (typeof operation.changes?.value === "string") {
      entry.value = operation.changes.value;
    }
    if (operation.changes?.fields && typeof operation.changes.fields === "object") {
      entry.fields = cloneJson(operation.changes.fields);
    }
    if (operation.changes?.properties && typeof operation.changes.properties === "object") {
      entry.properties = cloneJson(operation.changes.properties);
    }
    if (operation.changes?.placement) {
      entry.placement = {
        x: Number(operation.changes.placement.x || entry.placement.x || 0),
        y: Number(operation.changes.placement.y || entry.placement.y || 0),
        rotationDeg: Number(operation.changes.placement.rotationDeg || entry.placement.rotationDeg || 0),
      };
    }
  }
}

function createComponentRecordFromIntent(intentItem) {
  const create = intentItem?.create;
  if (!create) {
    return null;
  }
  const role = inferLayoutRole(create.symbolKey, intentItem.role);
  const defaults = getRoleDefaults(role);
  return {
    source: "intent_create",
    id: String(create.id),
    symbolKey: String(create.symbolKey || ""),
    reference: String(create.reference || create.id),
    value: typeof create.value === "string" ? create.value : "",
    fields: create.fields && typeof create.fields === "object" ? cloneJson(create.fields) : {},
    properties: create.properties && typeof create.properties === "object" ? cloneJson(create.properties) : {},
    placement: {
      x: 0,
      y: 0,
      rotationDeg: defaults.rotationDeg || 0,
    },
    size: cloneJson(defaults.size),
  };
}

function getClusterMemberMap(layoutIntent) {
  const map = new Map();
  for (const cluster of layoutIntent?.clusters ?? []) {
    const members = Array.isArray(cluster?.members) ? cluster.members.map((value) => String(value)) : [];
    members.forEach((memberId, index) => {
      map.set(memberId, {
        id: String(cluster.id || ""),
        zone: typeof cluster.zone === "string" ? cluster.zone : null,
        index,
      });
    });
  }
  return map;
}

function buildAnchorZoneMap(layoutIntent) {
  const map = new Map();
  for (const anchor of layoutIntent?.anchors ?? []) {
    const net = normalizeNetName(anchor?.net);
    const zone = typeof anchor?.zone === "string" ? anchor.zone : null;
    if (net && zone) {
      map.set(net, zone);
    }
  }
  return map;
}

function inferNetAnchorZone(netName, anchorZoneMap) {
  const normalized = normalizeNetName(netName);
  if (!normalized) {
    return null;
  }
  if (anchorZoneMap?.has(normalized)) {
    return anchorZoneMap.get(normalized);
  }
  if (includesText(normalized, "GND")) {
    return "bottom_support";
  }
  if (includesText(normalized, "OUT")) {
    return "right";
  }
  if (includesText(normalized, "VIN") || includesText(normalized, "IN")) {
    return "left";
  }
  if (includesText(normalized, "VCC") || includesText(normalized, "VDD") || includesText(normalized, "3V") || includesText(normalized, "5V") || includesText(normalized, "12V")) {
    return "top_support";
  }
  return null;
}

function getRoleAwareDefaults(intentItem) {
  const role = String(intentItem?.role || "generic");
  const anchorNet = String(intentItem?.anchorNet || intentItem?.nearNet || "").toUpperCase();
  const defaults = {};

  if (!intentItem.orientationPreference) {
    if (role === "connector") {
      defaults.orientationPreference = "face_inward";
    } else if (role === "power_symbol") {
      defaults.orientationPreference = "upright";
    } else if (role === "passive_shunt") {
      defaults.orientationPreference = "shunt_vertical";
    } else if (["filter", "passive_inline", "switch", "controller", "feedback"].includes(role)) {
      defaults.orientationPreference = "inline";
    }
  }

  if (!intentItem.zone) {
    if (role === "connector") {
      if (anchorNet.includes("OUT")) {
        defaults.zone = "right";
      } else if (anchorNet.includes("IN") || anchorNet.includes("VIN")) {
        defaults.zone = "left";
      }
    } else if (role === "power_symbol") {
      defaults.zone = anchorNet.includes("GND") ? "bottom_support" : "top_support";
    } else if (["passive_shunt", "load", "indicator", "support"].includes(role)) {
      defaults.zone = "bottom_support";
    } else if (role === "feedback") {
      defaults.zone = "top_support";
    } else if (["filter", "passive_inline"].includes(role)) {
      defaults.zone = "center";
    }
  }

  return defaults;
}

function clampMainZone(zone) {
  return ZONE_ORDER.includes(zone) ? zone : "center";
}

function shiftZone(zone, delta) {
  const currentIndex = ZONE_ORDER.indexOf(clampMainZone(zone));
  const nextIndex = Math.max(0, Math.min(ZONE_ORDER.length - 1, currentIndex + delta));
  return ZONE_ORDER[nextIndex];
}

function applyLayoutHeuristics(layoutIntent) {
  const clusterMemberMap = getClusterMemberMap(layoutIntent);
  const normalizedPlacements = (layoutIntent?.placements ?? []).map((placement) => {
    const normalized = cloneJson(placement);
    const componentId = String(normalized.componentId || normalized.create?.id || "");
    const clusterEntry = clusterMemberMap.get(componentId);
    const roleDefaults = getRoleAwareDefaults(normalized);
    const merged = {
      ...normalized,
      ...roleDefaults,
    };

    if (clusterEntry?.zone && !normalized.zone) {
      merged.zone = clusterEntry.zone;
    }

    if (clusterEntry && ["filter", "switch", "controller", "passive_inline"].includes(String(merged.role || ""))) {
      const baseZone = clampMainZone(merged.zone);
      merged.zone = shiftZone(baseZone, clusterEntry.index);
    }

    if (String(merged.role || "") === "feedback" && !merged.nearComponentId && !merged.nearNet) {
      merged.zone = merged.zone || "top_support";
    }

    if (String(merged.role || "") === "indicator" && !merged.above && !merged.below && !merged.nearComponentId) {
      merged.zone = merged.zone || "top_support";
    }

    return merged;
  });

  applyFamilyHeuristics(normalizedPlacements);

  return {
    ...layoutIntent,
    placements: normalizedPlacements,
  };
}

function applyFamilyHeuristics(placements) {
  const byId = new Map();
  const byCluster = new Map();
  placements.forEach((placement) => {
    const id = String(placement.componentId || placement.create?.id || "");
    if (id) {
      byId.set(id, placement);
    }
    if (placement.clusterId) {
      const bucket = byCluster.get(placement.clusterId) || [];
      bucket.push(placement);
      byCluster.set(placement.clusterId, bucket);
    }
  });

  for (const bucket of byCluster.values()) {
    applyBuckLikeClusterHeuristics(bucket, byId);
    applyIndicatorClusterHeuristics(bucket, byId);
    applyFeedbackClusterHeuristics(bucket, byId);
  }

  applyGlobalFeedbackHeuristics(placements, byId);
  applyGroundRailHeuristics(placements, byId);
}

function applyBuckLikeClusterHeuristics(bucket, byId) {
  const switchEntry = bucket.find((entry) => String(entry.role || "") === "switch");
  const filterEntry = bucket.find((entry) => String(entry.role || "") === "filter");
  const outputLikeEntry = bucket.find((entry) => includesText(entry.anchorNet, "OUT") || includesText(entry.nearNet, "OUT"));

  bucket.forEach((entry) => {
    const role = String(entry.role || "");
    const symbolKey = String(entry.create?.symbolKey || "");
    if (role === "support" && (includesText(symbolKey, "DEVICE:D") || includesText(symbolKey, "DIODE"))) {
      if (!entry.below && !entry.nearComponentId && switchEntry) {
        entry.below = String(switchEntry.componentId || switchEntry.create?.id || "");
      }
      entry.zone = entry.zone || "bottom_support";
      entry.orientationPreference = entry.orientationPreference || "shunt_vertical";
    }

    if (role === "passive_shunt" && !entry.below && !entry.nearComponentId) {
      const anchorTarget = outputLikeEntry || filterEntry || switchEntry;
      if (anchorTarget) {
        entry.below = String(anchorTarget.componentId || anchorTarget.create?.id || "");
        entry.zone = entry.zone || "bottom_support";
      }
    }

    if (role === "load" && !entry.below && !entry.nearComponentId && (outputLikeEntry || filterEntry)) {
      const anchorTarget = outputLikeEntry || filterEntry;
      entry.below = String(anchorTarget.componentId || anchorTarget.create?.id || "");
      entry.zone = entry.zone || "bottom_support";
    }
  });
}

function applyIndicatorClusterHeuristics(bucket) {
  const indicatorEntries = bucket.filter((entry) => String(entry.role || "") === "indicator");
  if (!indicatorEntries.length) {
    return;
  }

  const outputAnchor = bucket.find((entry) => includesText(entry.anchorNet, "OUT") || includesText(entry.nearNet, "OUT"))
    || bucket.find((entry) => ["connector", "load", "filter"].includes(String(entry.role || "")));

  indicatorEntries.forEach((entry) => {
    if (!entry.above && !entry.below && !entry.nearComponentId && outputAnchor) {
      entry.above = String(outputAnchor.componentId || outputAnchor.create?.id || "");
    }
    entry.zone = entry.zone || "top_support";
    entry.orientationPreference = entry.orientationPreference || "inline";
  });
}

function applyFeedbackClusterHeuristics(bucket, byId) {
  const feedbackEntries = bucket.filter((entry) => String(entry.role || "") === "feedback");
  if (!feedbackEntries.length) {
    return;
  }

  const controllerEntry = bucket.find((entry) => String(entry.role || "") === "controller");
  const outputEntry = bucket.find((entry) => includesText(entry.anchorNet, "OUT") || includesText(entry.nearNet, "OUT"))
    || bucket.find((entry) => ["filter", "connector"].includes(String(entry.role || "")));

  feedbackEntries.forEach((entry, index) => {
    if (!entry.nearComponentId && controllerEntry) {
      entry.nearComponentId = String(controllerEntry.componentId || controllerEntry.create?.id || "");
    }
    if (!entry.nearNet && outputEntry) {
      entry.nearNet = String(outputEntry.anchorNet || outputEntry.nearNet || "");
    }
    if (!entry.above && !entry.below && controllerEntry) {
      entry.above = String(controllerEntry.componentId || controllerEntry.create?.id || "");
    }
    entry.zone = entry.zone || "top_support";
    entry.orientationPreference = entry.orientationPreference || (index === 0 ? "inline" : "shunt_vertical");
  });

  if (feedbackEntries.length >= 2) {
    const [upper, lower] = feedbackEntries;
    const upperId = String(upper.componentId || upper.create?.id || "");
    if (!lower.below && upperId) {
      lower.below = upperId;
    }
    if (!lower.nearComponentId && upper.nearComponentId) {
      lower.nearComponentId = upper.nearComponentId;
    }
  }
}

function applyGlobalFeedbackHeuristics(placements, byId) {
  const controllers = placements.filter((entry) => String(entry.role || "") === "controller");
  const outputCandidates = placements.filter((entry) =>
    includesText(entry.anchorNet, "OUT")
    || includesText(entry.nearNet, "OUT")
    || ["filter", "connector", "load"].includes(String(entry.role || "")));

  placements.forEach((entry) => {
    if (String(entry.role || "") !== "feedback") {
      return;
    }

    if (!entry.nearComponentId && controllers.length) {
      const preferredController = controllers.find((controller) => controller.clusterId && controller.clusterId === entry.clusterId) || controllers[0];
      entry.nearComponentId = String(preferredController.componentId || preferredController.create?.id || "");
    }

    if (!entry.nearNet && outputCandidates.length) {
      const preferredOutput = outputCandidates.find((candidate) => candidate.clusterId && candidate.clusterId === entry.clusterId) || outputCandidates[0];
      entry.nearNet = String(preferredOutput.anchorNet || preferredOutput.nearNet || "VOUT");
    }

    if (!entry.above && !entry.below && entry.nearComponentId && byId.has(entry.nearComponentId)) {
      entry.above = entry.nearComponentId;
    }

    entry.zone = entry.zone || "top_support";
    entry.orientationPreference = entry.orientationPreference || "inline";
  });
}

function applyGroundRailHeuristics(placements, byId) {
  const groundTargets = placements.filter((entry) =>
    includesText(entry.anchorNet, "GND")
    || includesText(entry.nearNet, "GND")
    || String(entry.role || "") === "power_symbol");

  placements.forEach((entry) => {
    const role = String(entry.role || "");
    const anchorNet = normalizeNetName(entry.anchorNet || entry.nearNet || "");

    if (anchorNet.includes("GND")) {
      entry.zone = entry.zone || "bottom_support";
      if (!entry.orientationPreference && role === "power_symbol") {
        entry.orientationPreference = "upright";
      }

      if (!entry.below && !entry.nearComponentId && role !== "power_symbol") {
        const supportingTarget = groundTargets.find((candidate) => candidate !== entry && !includesText(candidate.anchorNet, "GND"))
          || placements.find((candidate) => ["passive_shunt", "load", "support", "connector", "filter"].includes(String(candidate.role || "")));
        if (supportingTarget) {
          entry.below = String(supportingTarget.componentId || supportingTarget.create?.id || "");
        }
      }
    }

    if (role === "power_symbol" && anchorNet.includes("GND") && !entry.below && !entry.nearComponentId) {
      const relatedTarget = placements.find((candidate) =>
        candidate !== entry
        && ["passive_shunt", "load", "support"].includes(String(candidate.role || ""))
        && (includesText(candidate.anchorNet, "OUT") || includesText(candidate.nearNet, "OUT") || includesText(candidate.anchorNet, "GND")));
      if (relatedTarget) {
        entry.nearComponentId = String(relatedTarget.componentId || relatedTarget.create?.id || "");
      }
    }
  });
}

function getLaneGeometry(sceneState) {
  const bounds = getSceneBounds(sceneState);
  const width = Math.max(560, bounds.right - bounds.left);
  const laneGap = Math.max(DEFAULT_MAIN_LANE_GAP, Math.round(width / 4));
  const baseX = snap(bounds.left);
  const mainY = snap((bounds.top + bounds.bottom) / 2);

  return {
    laneGap,
    baseX,
    mainY,
    supportOffset: DEFAULT_SUPPORT_OFFSET,
    zoneX: {
      left: baseX,
      center_left: baseX + laneGap,
      center: baseX + laneGap * 2,
      center_right: baseX + laneGap * 3,
      right: baseX + laneGap * 4,
    },
  };
}

function buildNetCenters(sceneState) {
  const componentMap = getSceneComponentMap(sceneState);
  const junctionMap = new Map((sceneState?.junctions ?? []).map((junction) => [String(junction.id), junction]));
  const result = new Map();

  for (const net of sceneState?.netSummary ?? []) {
    const points = [];
    for (const member of net.members ?? []) {
      if (member.kind === "component_pin") {
        const component = componentMap.get(String(member.id));
        const pin = sceneState?.components
          ?.find((entry) => String(entry.id) === String(member.id))
          ?.pins?.find((entry) => String(entry.pinId) === String(member.pinId));
        if (component && pin) {
          points.push({ x: Number(pin.x), y: Number(pin.y) });
        } else if (component) {
          points.push({ x: component.placement.x, y: component.placement.y });
        }
      }
      if (member.kind === "junction") {
        const junction = junctionMap.get(String(member.id));
        if (junction) {
          points.push({ x: Number(junction.x), y: Number(junction.y) });
        }
      }
    }
    if (points.length) {
      const avgX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
      const avgY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
      result.set(String(net.label || net.id), { x: avgX, y: avgY });
      result.set(String(net.id), { x: avgX, y: avgY });
    }
  }

  return result;
}

function resolveZoneY(intentItem, metrics, references) {
  if (intentItem.above && references.has(intentItem.above)) {
    return references.get(intentItem.above).y - metrics.supportOffset;
  }
  if (intentItem.below && references.has(intentItem.below)) {
    return references.get(intentItem.below).y + metrics.supportOffset;
  }
  if (intentItem.zone === "top_support") {
    return metrics.mainY - metrics.supportOffset;
  }
  if (intentItem.zone === "bottom_support") {
    return metrics.mainY + metrics.supportOffset;
  }
  return metrics.mainY;
}

function resolveOrientation(intentItem, component, zone) {
  const preference = String(intentItem.orientationPreference || "").trim();
  if (preference === "preserve" && component?.source === "scene") {
    return Number(component.placement?.rotationDeg || 0);
  }
  if (preference === "inline") {
    return 0;
  }
  if (preference === "shunt_vertical") {
    return 90;
  }
  if (preference === "face_inward") {
    return zone === "right" ? 180 : 0;
  }
  if (preference === "face_outward") {
    return zone === "right" ? 0 : 180;
  }
  if (preference === "upright") {
    return 0;
  }

  const inferredRole = inferLayoutRole(component?.symbolKey, intentItem.role);
  return getRoleDefaults(inferredRole).rotationDeg || 0;
}

function resolveNetAnchorPoint(intentItem, metrics, anchorZoneMap, netName) {
  const inferredZone = inferNetAnchorZone(netName, anchorZoneMap);
  if (!inferredZone) {
    return null;
  }
  const effectiveZone = ["top_support", "bottom_support"].includes(String(intentItem.zone || ""))
    ? intentItem.zone
    : inferredZone;

  const xZone = ["left", "center_left", "center", "center_right", "right"].includes(inferredZone)
    ? inferredZone
    : clampMainZone(intentItem.zone || "center");

  return {
    x: metrics.zoneX[xZone] ?? metrics.zoneX.center,
    y: effectiveZone === "top_support"
      ? metrics.mainY - metrics.supportOffset
      : effectiveZone === "bottom_support"
        ? metrics.mainY + metrics.supportOffset
        : metrics.mainY,
  };
}

function resolvePlacement(intentItem, component, metrics, placedMap, netCenters, anchorZoneMap) {
  const zone = intentItem.zone || "center";
  let x = metrics.zoneX[zone] ?? metrics.zoneX.center;
  let y = resolveZoneY(intentItem, metrics, placedMap);
  const netAnchorName = intentItem.nearNet || intentItem.anchorNet || "";

  if (intentItem.after && placedMap.has(intentItem.after)) {
    x = placedMap.get(intentItem.after).x + metrics.laneGap;
  } else if (intentItem.before && placedMap.has(intentItem.before)) {
    x = placedMap.get(intentItem.before).x - metrics.laneGap;
  } else if (intentItem.nearComponentId && placedMap.has(intentItem.nearComponentId)) {
    const nearComponent = placedMap.get(intentItem.nearComponentId);
    x = nearComponent.x;
    if (!intentItem.zone || intentItem.zone === "center") {
      x = nearComponent.x + DEFAULT_NEAR_OFFSET;
      y = nearComponent.y;
    } else if (zone === "top_support") {
      y = nearComponent.y - metrics.supportOffset;
    } else if (zone === "bottom_support") {
      y = nearComponent.y + metrics.supportOffset;
    }
  } else if (intentItem.nearNet && netCenters.has(intentItem.nearNet)) {
    const netCenter = netCenters.get(intentItem.nearNet);
    x = netCenter.x;
    y = netCenter.y;
  } else if (intentItem.anchorNet && netCenters.has(intentItem.anchorNet)) {
    const anchor = netCenters.get(intentItem.anchorNet);
    x = anchor.x;
    if (!intentItem.zone || zone === "center") {
      y = anchor.y;
    }
  }

  if (netAnchorName) {
    const netAnchorPoint = resolveNetAnchorPoint(intentItem, metrics, anchorZoneMap, netAnchorName);
    if (netAnchorPoint) {
      if (!netCenters.has(intentItem.nearNet) && !netCenters.has(intentItem.anchorNet)) {
        x = netAnchorPoint.x;
      }
      if (!intentItem.above && !intentItem.below && !intentItem.nearComponentId && (zone === "top_support" || zone === "bottom_support" || !intentItem.zone)) {
        y = netAnchorPoint.y;
      }
    }
  }

  return {
    x: snap(x),
    y: snap(y),
    rotationDeg: resolveOrientation(intentItem, component, zone),
  };
}

function compactClusterPlacements(sortedPlacements, placedMap) {
  const clusterBuckets = new Map();
  sortedPlacements.forEach((placement) => {
    if (!placement.clusterId) {
      return;
    }
    const id = String(placement.componentId || placement.create?.id || "");
    if (!placedMap.has(id)) {
      return;
    }
    const bucket = clusterBuckets.get(placement.clusterId) || [];
    bucket.push({
      placement,
      id,
      resolved: placedMap.get(id),
    });
    clusterBuckets.set(placement.clusterId, bucket);
  });

  for (const bucket of clusterBuckets.values()) {
    if (bucket.length < 2) {
      continue;
    }

    const mainLane = bucket.filter((entry) => !["top_support", "bottom_support"].includes(String(entry.placement.zone || "")));
    mainLane.sort((left, right) => left.resolved.x - right.resolved.x);
    for (let index = 1; index < mainLane.length; index += 1) {
      const previous = mainLane[index - 1];
      const current = mainLane[index];
      current.resolved.x = snap(previous.resolved.x + DEFAULT_CLUSTER_GAP);
    }

    const supportLane = bucket.filter((entry) => ["top_support", "bottom_support"].includes(String(entry.placement.zone || "")));
    supportLane.forEach((entry) => {
      if (entry.placement.below && placedMap.has(entry.placement.below)) {
        entry.resolved.x = snap(placedMap.get(entry.placement.below).x);
      } else if (entry.placement.above && placedMap.has(entry.placement.above)) {
        entry.resolved.x = snap(placedMap.get(entry.placement.above).x);
      } else if (entry.placement.nearComponentId && placedMap.has(entry.placement.nearComponentId)) {
        entry.resolved.x = snap(placedMap.get(entry.placement.nearComponentId).x);
      }
    });
  }
}

function compactBottomSupportRail(sortedPlacements, placedMap) {
  const entries = sortedPlacements
    .map((placement) => ({
      placement,
      id: String(placement.componentId || placement.create?.id || ""),
      resolved: placedMap.get(String(placement.componentId || placement.create?.id || "")),
    }))
    .filter((entry) => entry.resolved && String(entry.placement.zone || "") === "bottom_support")
    .sort((left, right) => left.resolved.x - right.resolved.x);

  let lastX = null;
  entries.forEach((entry) => {
    if (entry.placement.below && placedMap.has(entry.placement.below)) {
      entry.resolved.x = snap(placedMap.get(entry.placement.below).x);
      lastX = entry.resolved.x;
      return;
    }
    if (entry.placement.nearComponentId && placedMap.has(entry.placement.nearComponentId)) {
      entry.resolved.x = snap(placedMap.get(entry.placement.nearComponentId).x);
      lastX = entry.resolved.x;
      return;
    }
    if (lastX != null && entry.resolved.x <= lastX) {
      entry.resolved.x = snap(lastX + DEFAULT_CLUSTER_GAP);
    }
    lastX = entry.resolved.x;
  });
}

function compactTopSupportRail(sortedPlacements, placedMap) {
  const entries = sortedPlacements
    .map((placement) => ({
      placement,
      id: String(placement.componentId || placement.create?.id || ""),
      resolved: placedMap.get(String(placement.componentId || placement.create?.id || "")),
    }))
    .filter((entry) => entry.resolved && String(entry.placement.zone || "") === "top_support")
    .sort((left, right) => left.resolved.x - right.resolved.x || left.resolved.y - right.resolved.y);

  const usedColumns = new Map();
  entries.forEach((entry) => {
    const currentX = snap(entry.resolved.x);
    const count = usedColumns.get(currentX) || 0;
    if (count > 0) {
      entry.resolved.y = snap(entry.resolved.y + (DEFAULT_SUPPORT_OFFSET * count));
    }
    usedColumns.set(currentX, count + 1);
  });
}

function spreadGroundSymbols(sortedPlacements, placedMap) {
  const entries = sortedPlacements
    .map((placement) => ({
      placement,
      id: String(placement.componentId || placement.create?.id || ""),
      resolved: placedMap.get(String(placement.componentId || placement.create?.id || "")),
    }))
    .filter((entry) => entry.resolved
      && String(entry.placement.role || "") === "power_symbol"
      && includesText(entry.placement.anchorNet, "GND"));

  entries.sort((left, right) => left.resolved.x - right.resolved.x);
  let lastX = null;
  entries.forEach((entry) => {
    if (lastX != null && entry.resolved.x <= lastX) {
      entry.resolved.x = snap(lastX + DEFAULT_CLUSTER_GAP);
    }
    lastX = entry.resolved.x;
  });
}

function ensurePatchSkeleton(patch, layoutIntent, sceneState) {
  if (patch && typeof patch === "object" && !Array.isArray(patch)) {
    return patch;
  }
  return {
    schema: "aura.circuit_patch.v1",
    metadata: {
      title: `${layoutIntent.metadata?.title || "Layout intent"} patch`,
      description: `Generated from ${layoutIntent.schema}.`,
      mode: "preview",
      requestedBy: layoutIntent.metadata?.requestedBy || "assistant",
    },
    target: {
      sceneSchema: "aura.scene_state.v1",
      sourceSchematicId: layoutIntent.target?.sourceSchematicId || sceneState?.metadata?.sourceSchematicId || "studio-canvas",
      sourceRevision: Number.isInteger(layoutIntent.target?.sourceRevision)
        ? layoutIntent.target.sourceRevision
        : (Number.isInteger(sceneState?.metadata?.sourceRevision) ? sceneState.metadata.sourceRevision : 0),
    },
    operations: [],
  };
}

function insertComponentOperation(operations, operation) {
  const insertionIndex = operations.findIndex((entry) => String(entry?.op || "").startsWith("add_wire")
    || String(entry?.op || "").startsWith("update_wire")
    || String(entry?.op || "").startsWith("delete_wire")
    || entry?.op === "set_selection");
  if (insertionIndex < 0) {
    operations.push(operation);
    return;
  }
  operations.splice(insertionIndex, 0, operation);
}

export async function validateLayoutIntent(layoutIntent) {
  const validation = await validateContractPayload("layout_intent.v1", layoutIntent);
  if (!validation.ok) {
    const message = validation.errors?.[0]?.message || "Layout intent payload is invalid.";
    const error = new Error(message);
    error.validation = validation;
    throw error;
  }
  return validation;
}

export async function planLayoutPatch({ sceneState, layoutIntent, patch = null }) {
  await validateLayoutIntent(layoutIntent);

  const normalizedLayoutIntent = applyLayoutHeuristics(layoutIntent);
  const plannedPatch = ensurePatchSkeleton(cloneJson(patch), normalizedLayoutIntent, sceneState);
  const componentMap = getSceneComponentMap(sceneState);
  mergePatchComponentsIntoMap(componentMap, plannedPatch);

  for (const intentItem of normalizedLayoutIntent.placements ?? []) {
    if (intentItem.create) {
      const createdComponent = createComponentRecordFromIntent(intentItem);
      componentMap.set(createdComponent.id, createdComponent);
    }
  }

  const metrics = getLaneGeometry(sceneState);
  const netCenters = buildNetCenters(sceneState);
  const anchorZoneMap = buildAnchorZoneMap(normalizedLayoutIntent);
  const placedMap = new Map();

  const sortedPlacements = [...(normalizedLayoutIntent.placements ?? [])].sort((left, right) => {
    const leftPriority = Number.isInteger(left.priority) ? left.priority : 100;
    const rightPriority = Number.isInteger(right.priority) ? right.priority : 100;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    const leftKey = String(left.componentId || left.create?.id || "");
    const rightKey = String(right.componentId || right.create?.id || "");
    return leftKey.localeCompare(rightKey);
  });

  const pending = [...sortedPlacements];
  let safety = pending.length * 4;
  while (pending.length && safety-- > 0) {
    const current = pending.shift();
    const id = String(current.componentId || current.create?.id || "");
    const component = componentMap.get(id);
    if (!component) {
      continue;
    }

    const dependencyIds = [current.after, current.before, current.nearComponentId, current.above, current.below]
      .filter(Boolean)
      .map(String);
    const unresolvedDependency = dependencyIds.find((dependencyId) => !placedMap.has(dependencyId) && componentMap.has(dependencyId));
    if (unresolvedDependency) {
      pending.push(current);
      continue;
    }

    const placement = resolvePlacement(current, component, metrics, placedMap, netCenters, anchorZoneMap);
    placedMap.set(id, placement);
  }

  for (const current of pending) {
    const id = String(current.componentId || current.create?.id || "");
    const component = componentMap.get(id);
    if (!component) {
      continue;
    }
    placedMap.set(id, resolvePlacement(current, component, metrics, placedMap, netCenters, anchorZoneMap));
  }

  compactClusterPlacements(sortedPlacements, placedMap);
  compactBottomSupportRail(sortedPlacements, placedMap);
  compactTopSupportRail(sortedPlacements, placedMap);
  spreadGroundSymbols(sortedPlacements, placedMap);

  const { addMap, updateMap } = getPatchComponentOperationMaps(plannedPatch);

  for (const current of sortedPlacements) {
    const id = String(current.componentId || current.create?.id || "");
    const component = componentMap.get(id);
    const placement = placedMap.get(id);
    if (!component || !placement) {
      continue;
    }

    if (addMap.has(id)) {
      addMap.get(id).operation.component.placement = placement;
      continue;
    }

    if (component.source === "scene") {
      if (updateMap.has(id)) {
        updateMap.get(id).operation.changes = {
          ...(updateMap.get(id).operation.changes || {}),
          placement,
        };
      } else {
        insertComponentOperation(plannedPatch.operations, {
          op: "update_component",
          id,
          changes: { placement },
        });
      }
      continue;
    }

    if (component.source === "intent_create") {
      insertComponentOperation(plannedPatch.operations, {
        op: "add_component",
        component: {
          id: component.id,
          symbolKey: component.symbolKey,
          reference: component.reference,
          ...(component.value ? { value: component.value } : {}),
          ...(Object.keys(component.fields || {}).length ? { fields: component.fields } : {}),
          ...(Object.keys(component.properties || {}).length ? { properties: component.properties } : {}),
          placement,
        },
      });
    }
  }

  return plannedPatch;
}
