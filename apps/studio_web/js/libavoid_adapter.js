import { AvoidLib } from "libavoid-js";

const DEFAULT_GRID_SIZE = 10;
const DEFAULT_WIRE_BUFFER = 10;
const DEFAULT_ROUTING_OPTIONS = {
    segmentPenalty: 18,
    anglePenalty: 120,
    crossingPenalty: 640,
    shapeBufferDistance: 0,
    idealNudgingDistance: 10,
    reverseDirectionPenalty: 240,
    nudgeOrthogonalSegmentsConnectedToShapes: true,
    nudgeOrthogonalTouchingColinearSegments: false,
    performUnifyingNudgingPreprocessingStep: true,
    improveHyperedgeRoutesMovingJunctions: false,
    improveHyperedgeRoutesMovingAddingAndDeletingJunctions: false,
    nudgeSharedPathsWithCommonEndPoint: false,
};

let loadState = {
    ready: false,
    loading: false,
    error: null,
    loadPromise: null,
};

function toNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function normalizePoint(point) {
    return {
        x: toNumber(point?.x),
        y: toNumber(point?.y),
    };
}

function pointKey(point) {
    return `${point.x.toFixed(2)}:${point.y.toFixed(2)}`;
}

function pointsAlmostEqual(left, right, tolerance = 0.01) {
    return (
        Math.abs((left?.x ?? 0) - (right?.x ?? 0)) <= tolerance
        && Math.abs((left?.y ?? 0) - (right?.y ?? 0)) <= tolerance
    );
}

function dedupeSequentialPoints(points) {
    return points.filter((point, index) => {
        if (index === 0) {
            return true;
        }
        return !pointsAlmostEqual(points[index - 1], point);
    });
}

function simplifyOrthogonalPoints(points) {
    const deduped = dedupeSequentialPoints(points);
    if (deduped.length <= 2) {
        return deduped;
    }

    const simplified = [deduped[0]];
    for (let index = 1; index < deduped.length - 1; index += 1) {
        const previous = simplified[simplified.length - 1];
        const current = deduped[index];
        const next = deduped[index + 1];
        const sameVertical =
            Math.abs(previous.x - current.x) < 0.01
            && Math.abs(current.x - next.x) < 0.01;
        const sameHorizontal =
            Math.abs(previous.y - current.y) < 0.01
            && Math.abs(current.y - next.y) < 0.01;
        if (sameVertical || sameHorizontal) {
            continue;
        }
        simplified.push(current);
    }
    simplified.push(deduped[deduped.length - 1]);
    return simplified;
}

function snapValue(value, gridSize) {
    return Math.round(value / gridSize) * gridSize;
}

function snapPoint(point, gridSize) {
    return {
        x: snapValue(point.x, gridSize),
        y: snapValue(point.y, gridSize),
    };
}

function pointInsideRect(point, rect) {
    return (
        point.x > rect.left
        && point.x < rect.right
        && point.y > rect.top
        && point.y < rect.bottom
    );
}

function segmentIntersectsRect(start, end, rect) {
    if (Math.abs(start.x - end.x) < 0.01) {
        const x = start.x;
        const top = Math.min(start.y, end.y);
        const bottom = Math.max(start.y, end.y);
        return x > rect.left && x < rect.right && bottom > rect.top && top < rect.bottom;
    }

    if (Math.abs(start.y - end.y) < 0.01) {
        const y = start.y;
        const left = Math.min(start.x, end.x);
        const right = Math.max(start.x, end.x);
        return y > rect.top && y < rect.bottom && right > rect.left && left < rect.right;
    }

    return false;
}

function getRouteObstacleViolationCount(routePoints, obstacles) {
    let violations = 0;

    for (let index = 0; index < routePoints.length - 1; index += 1) {
        const start = routePoints[index];
        const end = routePoints[index + 1];
        if (pointsAlmostEqual(start, end)) {
            continue;
        }
        if (
            obstacles.some((obstacle) =>
                pointInsideRect(start, obstacle)
                || pointInsideRect(end, obstacle)
                || segmentIntersectsRect(start, end, obstacle),
            )
        ) {
            violations += 1;
        }
    }

    return violations;
}

function routeIsOnGrid(routePoints, gridSize) {
    return routePoints.every((point, index, entries) => {
        if (index === 0 || index === entries.length - 1) {
            return true;
        }
        return (
            Math.abs(point.x - snapValue(point.x, gridSize)) < 0.01
            && Math.abs(point.y - snapValue(point.y, gridSize)) < 0.01
        );
    });
}

function snapInteriorRoutePoints(routePoints, gridSize, obstacles) {
    if (!routePoints.length) {
        return routePoints;
    }

    const snapped = routePoints.map((point, index, entries) =>
        index === 0 || index === entries.length - 1
            ? point
            : snapPoint(point, gridSize),
    );
    const simplified = simplifyOrthogonalPoints(snapped);
    return getRouteObstacleViolationCount(simplified, obstacles) === 0
        ? simplified
        : simplifyOrthogonalPoints(routePoints);
}

function normalizeExtractedRoute(rawPoints, start, end, gridSize, obstacles) {
    if (!rawPoints.length) {
        return [start, end];
    }

    const normalized = rawPoints.map((point, index, entries) =>
        index === 0
            ? { x: start.x, y: start.y }
            : index === entries.length - 1
                ? { x: end.x, y: end.y }
                : point,
    );

    return simplifyOrthogonalPoints(
        snapInteriorRoutePoints(normalized, gridSize, obstacles),
    );
}

function makeRect(left, top, right, bottom) {
    return {
        left: Math.min(left, right),
        top: Math.min(top, bottom),
        right: Math.max(left, right),
        bottom: Math.max(top, bottom),
    };
}

function normalizeRect(rect) {
    return makeRect(
        toNumber(rect?.left),
        toNumber(rect?.top),
        toNumber(rect?.right),
        toNumber(rect?.bottom),
    );
}

function segmentToBufferedRect(segment, fallbackBuffer = DEFAULT_WIRE_BUFFER) {
    const start = normalizePoint(segment?.start);
    const end = normalizePoint(segment?.end);
    const radius = Math.max(2, toNumber(segment?.radius, fallbackBuffer));

    if (Math.abs(start.x - end.x) < 0.01) {
        return makeRect(start.x - radius, Math.min(start.y, end.y) - radius, start.x + radius, Math.max(start.y, end.y) + radius);
    }

    if (Math.abs(start.y - end.y) < 0.01) {
        return makeRect(Math.min(start.x, end.x) - radius, start.y - radius, Math.max(start.x, end.x) + radius, start.y + radius);
    }

    return makeRect(
        Math.min(start.x, end.x) - radius,
        Math.min(start.y, end.y) - radius,
        Math.max(start.x, end.x) + radius,
        Math.max(start.y, end.y) + radius,
    );
}

function normalizeObstacleSet(obstacles = [], penaltySegments = [], buffer = DEFAULT_WIRE_BUFFER) {
    const rects = [
        ...obstacles.map(normalizeRect),
        ...penaltySegments.map((segment) => segmentToBufferedRect(segment, buffer)),
    ];
    const seen = new Set();
    return rects.filter((rect) => {
        const key = `${rect.left.toFixed(2)}:${rect.top.toFixed(2)}:${rect.right.toFixed(2)}:${rect.bottom.toFixed(2)}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return rect.right - rect.left > 0.5 && rect.bottom - rect.top > 0.5;
    });
}

function serializeRoute(routePoints) {
    return simplifyOrthogonalPoints(routePoints)
        .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
        .join("|");
}

function safeDelete(target, fallback = null) {
    if (!target) {
        return;
    }
    try {
        if (typeof fallback === "function") {
            fallback(target);
            return;
        }
        if (typeof target.delete === "function") {
            target.delete();
        }
    } catch {
        // best-effort cleanup only
    }
}

function configureRouter(avoid, router, gridSize, options = {}) {
    const merged = {
        ...DEFAULT_ROUTING_OPTIONS,
        ...options,
        idealNudgingDistance: toNumber(options.idealNudgingDistance, gridSize),
    };

    router.setRoutingParameter(avoid.RoutingParameter.segmentPenalty, merged.segmentPenalty);
    router.setRoutingParameter(avoid.RoutingParameter.anglePenalty, merged.anglePenalty);
    router.setRoutingParameter(avoid.RoutingParameter.crossingPenalty, merged.crossingPenalty);
    router.setRoutingParameter(avoid.RoutingParameter.shapeBufferDistance, merged.shapeBufferDistance);
    router.setRoutingParameter(avoid.RoutingParameter.idealNudgingDistance, merged.idealNudgingDistance);
    router.setRoutingParameter(avoid.RoutingParameter.reverseDirectionPenalty, merged.reverseDirectionPenalty);

    router.setRoutingOption(
        avoid.RoutingOption.nudgeOrthogonalSegmentsConnectedToShapes,
        !!merged.nudgeOrthogonalSegmentsConnectedToShapes,
    );
    router.setRoutingOption(
        avoid.RoutingOption.nudgeOrthogonalTouchingColinearSegments,
        !!merged.nudgeOrthogonalTouchingColinearSegments,
    );
    router.setRoutingOption(
        avoid.RoutingOption.performUnifyingNudgingPreprocessingStep,
        !!merged.performUnifyingNudgingPreprocessingStep,
    );
    router.setRoutingOption(
        avoid.RoutingOption.improveHyperedgeRoutesMovingJunctions,
        !!merged.improveHyperedgeRoutesMovingJunctions,
    );
    router.setRoutingOption(
        avoid.RoutingOption.improveHyperedgeRoutesMovingAddingAndDeletingJunctions,
        !!merged.improveHyperedgeRoutesMovingAddingAndDeletingJunctions,
    );
    router.setRoutingOption(
        avoid.RoutingOption.nudgeSharedPathsWithCommonEndPoint,
        !!merged.nudgeSharedPathsWithCommonEndPoint,
    );
}

function getOrthogonalRouterFlag(avoid) {
    return avoid.RouterFlag?.OrthogonalRouting?.value
        ?? avoid.OrthogonalRouting?.value
        ?? avoid.RouterFlag?.OrthogonalRouting
        ?? avoid.OrthogonalRouting
        ?? 2;
}

function getOrthogonalConnectionType(avoid) {
    return avoid.ConnType?.ConnType_Orthogonal?.value
        ?? avoid.OrthogonalRouting?.value
        ?? avoid.ConnType?.ConnType_Orthogonal
        ?? avoid.OrthogonalRouting
        ?? 2;
}

async function ensureLibavoidLoaded() {
    if (loadState.ready) {
        return AvoidLib.getInstance();
    }
    if (loadState.loadPromise) {
        await loadState.loadPromise;
        return AvoidLib.getInstance();
    }

    loadState.loading = true;
    loadState.error = null;
    const wasmUrl = typeof window === "undefined"
        ? undefined
        : new URL("../node_modules/libavoid-js/dist/libavoid.wasm", import.meta.url).href;

    loadState.loadPromise = AvoidLib.load(wasmUrl)
        .then(() => {
            loadState.ready = true;
            loadState.loading = false;
        })
        .catch((error) => {
            loadState.error = error instanceof Error ? error.message : String(error);
            loadState.loading = false;
            throw error;
        });

    await loadState.loadPromise;
    return AvoidLib.getInstance();
}

export function getLibavoidRouterStatus() {
    return {
        ready: loadState.ready,
        loading: loadState.loading,
        error: loadState.error,
    };
}

export async function initLibavoidRouter() {
    await ensureLibavoidLoaded();
    return getLibavoidRouterStatus();
}

export function routeConnectionWithLibavoid({
    start,
    end,
    obstacles = [],
    penaltySegments = [],
    gridSize = DEFAULT_GRID_SIZE,
    options = {},
} = {}) {
    if (!loadState.ready) {
        throw new Error("libavoid router is not initialized");
    }
    const avoid = AvoidLib.getInstance();
    const normalizedStart = normalizePoint(start);
    const normalizedEnd = normalizePoint(end);
    const allObstacles = normalizeObstacleSet(obstacles, penaltySegments, options.penaltyBuffer ?? DEFAULT_WIRE_BUFFER);
    const router = new avoid.Router(getOrthogonalRouterFlag(avoid));
    const shapes = [];
    let connection = null;
    let sourceEnd = null;
    let destEnd = null;

    try {
        configureRouter(avoid, router, gridSize, options);

        allObstacles.forEach((obstacle) => {
            const topLeft = new avoid.Point(obstacle.left, obstacle.top);
            const bottomRight = new avoid.Point(obstacle.right, obstacle.bottom);
            const rectangle = new avoid.Rectangle(topLeft, bottomRight);
            const shape = new avoid.ShapeRef(router, rectangle);
            shapes.push(shape);
        });

        sourceEnd = new avoid.ConnEnd(new avoid.Point(normalizedStart.x, normalizedStart.y));
        destEnd = new avoid.ConnEnd(new avoid.Point(normalizedEnd.x, normalizedEnd.y));
        connection = new avoid.ConnRef(router, sourceEnd, destEnd);
        connection.setRoutingType(getOrthogonalConnectionType(avoid));
        connection.setHateCrossings(true);
        router.processTransaction();

        const polyline = connection.displayRoute();
        const rawPoints = [];
        for (let index = 0; index < polyline.size(); index += 1) {
            const point = polyline.at(index);
            rawPoints.push({ x: toNumber(point.x), y: toNumber(point.y) });
        }

        const routePoints = normalizeExtractedRoute(
            rawPoints,
            normalizedStart,
            normalizedEnd,
            gridSize,
            allObstacles,
        );
        return {
            routePoints,
            rawRoutePoints: simplifyOrthogonalPoints(rawPoints),
            onGrid: routeIsOnGrid(routePoints, gridSize),
            obstacleViolations: getRouteObstacleViolationCount(routePoints, allObstacles),
            serialized: serializeRoute(routePoints),
        };
    } finally {
        if (connection) {
            safeDelete(connection, (target) => router.deleteConnector(target));
        }
        safeDelete(sourceEnd);
        safeDelete(destEnd);
        shapes.forEach((shape) => safeDelete(shape, (target) => router.deleteShape(target)));
        safeDelete(router);
    }
}

export function routeConnectionBatchWithLibavoid({
    connections = [],
    obstacles = [],
    existingPenaltySegments = [],
    gridSize = DEFAULT_GRID_SIZE,
    options = {},
} = {}) {
    if (!loadState.ready) {
        throw new Error("libavoid router is not initialized");
    }
    const avoid = AvoidLib.getInstance();
    const allObstacles = normalizeObstacleSet(
        obstacles,
        existingPenaltySegments,
        options.penaltyBuffer ?? DEFAULT_WIRE_BUFFER,
    );
    const startedAt = performance.now();
    const router = new avoid.Router(getOrthogonalRouterFlag(avoid));
    const shapes = [];
    const connectionEntries = [];

    try {
        configureRouter(avoid, router, gridSize, options);

        allObstacles.forEach((obstacle) => {
            const rectangle = new avoid.Rectangle(
                new avoid.Point(obstacle.left, obstacle.top),
                new avoid.Point(obstacle.right, obstacle.bottom),
            );
            shapes.push(new avoid.ShapeRef(router, rectangle));
        });

        connections.forEach((connection, index) => {
            const normalizedStart = normalizePoint(connection?.start);
            const normalizedEnd = normalizePoint(connection?.end);
            const sourceEnd = new avoid.ConnEnd(new avoid.Point(
                normalizedStart.x,
                normalizedStart.y,
            ));
            const destEnd = new avoid.ConnEnd(new avoid.Point(
                normalizedEnd.x,
                normalizedEnd.y,
            ));
            const connRef = new avoid.ConnRef(router, sourceEnd, destEnd);
            connRef.setRoutingType(getOrthogonalConnectionType(avoid));
            connRef.setHateCrossings(true);
            connectionEntries.push({
                id: connection.id ?? `${index}`,
                start: normalizedStart,
                end: normalizedEnd,
                connRef,
                sourceEnd,
                destEnd,
            });
        });

        router.processTransaction();

        const results = connectionEntries.map((entry) => {
            const polyline = entry.connRef.displayRoute();
            const rawPoints = [];
            for (let index = 0; index < polyline.size(); index += 1) {
                const point = polyline.at(index);
                rawPoints.push({ x: toNumber(point.x), y: toNumber(point.y) });
            }
            const routePoints = normalizeExtractedRoute(
                rawPoints,
                entry.start,
                entry.end,
                gridSize,
                allObstacles,
            );

            return {
                id: entry.id,
                routePoints,
                rawRoutePoints: simplifyOrthogonalPoints(rawPoints),
                onGrid: routeIsOnGrid(routePoints, gridSize),
                obstacleViolations: getRouteObstacleViolationCount(routePoints, allObstacles),
                serialized: serializeRoute(routePoints),
            };
        });

        return {
            elapsedMs: performance.now() - startedAt,
            results,
        };
    } finally {
        connectionEntries.forEach((entry) => {
            safeDelete(entry.connRef, (target) => router.deleteConnector(target));
            safeDelete(entry.sourceEnd);
            safeDelete(entry.destEnd);
        });
        shapes.forEach((shape) => safeDelete(shape, (target) => router.deleteShape(target)));
        safeDelete(router);
    }
}

function buildSyntheticSpikeFixture(gridSize) {
    const obstacles = [
        makeRect(10, 10, 80, 40),
        makeRect(10, 60, 80, 90),
        makeRect(10, 110, 80, 140),
        makeRect(110, 10, 180, 40),
        makeRect(110, 60, 180, 90),
        makeRect(110, 110, 180, 140),
        makeRect(210, 10, 280, 40),
        makeRect(210, 60, 280, 90),
        makeRect(210, 110, 280, 140),
        makeRect(310, 10, 380, 40),
        makeRect(310, 60, 380, 90),
        makeRect(310, 110, 380, 140),
    ].map((rect) => ({
        left: rect.left * gridSize,
        top: rect.top * gridSize,
        right: rect.right * gridSize,
        bottom: rect.bottom * gridSize,
    }));

    const connections = [];
    for (let index = 0; index < 24; index += 1) {
        const lane = index % 6;
        const band = Math.floor(index / 6);
        connections.push({
            id: `wire_${index + 1}`,
            start: {
                x: 0,
                y: (20 + lane * 24 + band * 2) * gridSize,
            },
            end: {
                x: 420 * gridSize,
                y: (128 - lane * 16 + band * 8) * gridSize,
            },
        });
    }

    return { obstacles, connections };
}

export async function runLibavoidBenchmark({
    gridSize = DEFAULT_GRID_SIZE,
    options = {},
} = {}) {
    await ensureLibavoidLoaded();
    const fixture = buildSyntheticSpikeFixture(gridSize);
    const firstRun = routeConnectionBatchWithLibavoid({
        connections: fixture.connections,
        obstacles: fixture.obstacles,
        gridSize,
        options,
    });
    const secondRun = routeConnectionBatchWithLibavoid({
        connections: fixture.connections,
        obstacles: fixture.obstacles,
        gridSize,
        options,
    });

    const firstSerialized = firstRun.results.map((route) => route.serialized);
    const secondSerialized = secondRun.results.map((route) => route.serialized);
    const deterministic = firstSerialized.length === secondSerialized.length
        && firstSerialized.every((route, index) => route === secondSerialized[index]);

    return {
        gridSize,
        connectionCount: fixture.connections.length,
        obstacleCount: fixture.obstacles.length,
        elapsedMs: firstRun.elapsedMs,
        secondElapsedMs: secondRun.elapsedMs,
        deterministic,
        allOnGrid: firstRun.results.every((route) => route.onGrid),
        anyObstacleViolations: firstRun.results.some((route) => route.obstacleViolations > 0),
        sampleRoutes: firstRun.results.slice(0, 3).map((route) => ({
            id: route.id,
            onGrid: route.onGrid,
            obstacleViolations: route.obstacleViolations,
            route: route.serialized,
        })),
    };
}
