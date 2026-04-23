"use strict";

import {
    getLibavoidRouterStatus,
    initLibavoidRouter,
    routeConnectionWithLibavoid,
    runLibavoidBenchmark,
} from "./libavoid_adapter.js";

const DEFAULT_STUB_LENGTH = 20;
const GUIDE_CHANNEL_OFFSET = 30;
const GUIDE_WIDE_CHANNEL_OFFSET = 60;
const CROWDING_MARGIN = 24;
const CROWDING_PENALTY = 54;
const LIBAVOID_GRID_SIZE = 10;

let libavoidInitError = null;

try {
    await initLibavoidRouter();
} catch (error) {
    libavoidInitError = error instanceof Error ? error.message : String(error);
    console.error("Failed to initialize libavoid router", error);
}

function nudgePoint(point, direction, distance) {
    switch (direction) {
        case "left":
            return { x: point.x - distance, y: point.y };
        case "right":
            return { x: point.x + distance, y: point.y };
        case "up":
            return { x: point.x, y: point.y - distance };
        case "down":
            return { x: point.x, y: point.y + distance };
        default:
            return { x: point.x, y: point.y };
    }
}

function pointKey(point) {
    return `${point.x.toFixed(2)}:${point.y.toFixed(2)}`;
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

function getSegmentCrowdingPenalty(start, end, obstacles) {
    let penalty = 0;

    obstacles.forEach((rect) => {
        if (Math.abs(start.x - end.x) < 0.01) {
            const x = start.x;
            const top = Math.min(start.y, end.y);
            const bottom = Math.max(start.y, end.y);
            const overlapsVertically =
                bottom > rect.top - CROWDING_MARGIN
                && top < rect.bottom + CROWDING_MARGIN;
            if (!overlapsVertically) {
                return;
            }

            const clearance =
                x < rect.left
                    ? rect.left - x
                    : x > rect.right
                        ? x - rect.right
                        : 0;
            if (clearance < CROWDING_MARGIN) {
                penalty += (CROWDING_MARGIN - clearance) * CROWDING_PENALTY;
            }
            return;
        }

        if (Math.abs(start.y - end.y) < 0.01) {
            const y = start.y;
            const left = Math.min(start.x, end.x);
            const right = Math.max(start.x, end.x);
            const overlapsHorizontally =
                right > rect.left - CROWDING_MARGIN
                && left < rect.right + CROWDING_MARGIN;
            if (!overlapsHorizontally) {
                return;
            }

            const clearance =
                y < rect.top
                    ? rect.top - y
                    : y > rect.bottom
                        ? y - rect.bottom
                        : 0;
            if (clearance < CROWDING_MARGIN) {
                penalty += (CROWDING_MARGIN - clearance) * CROWDING_PENALTY;
            }
        }
    });

    return penalty;
}

function dedupeNumbers(values) {
    return Array.from(new Set(values.map((value) => Number(value.toFixed(2))))).sort((a, b) => a - b);
}

function dedupePoints(points) {
    const seen = new Set();
    return points.filter((point) => {
        const key = pointKey(point);
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function pointsToPath(points) {
    const deduped = points.filter((point, index) => {
        if (index === 0) {
            return true;
        }

        const previous = points[index - 1];
        return Math.abs(previous.x - point.x) > 0.01 || Math.abs(previous.y - point.y) > 0.01;
    });

    return deduped
        .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
        .join(" ");
}

function getPolylinePath(points) {
    return pointsToPath(points);
}

function dedupeSequentialPoints(points) {
    return points.filter((point, index) => {
        if (index === 0) {
            return true;
        }

        const previous = points[index - 1];
        return Math.abs(previous.x - point.x) > 0.01 || Math.abs(previous.y - point.y) > 0.01;
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

function getSegmentAxis(start, end) {
    if (Math.abs(start.x - end.x) < 0.01) {
        return "v";
    }
    if (Math.abs(start.y - end.y) < 0.01) {
        return "h";
    }
    return null;
}

function getSegmentDirection(start, end) {
    const axis = getSegmentAxis(start, end);
    if (axis === "h") {
        return end.x >= start.x ? "right" : "left";
    }
    if (axis === "v") {
        return end.y >= start.y ? "down" : "up";
    }
    return null;
}

function countRouteObstacleViolations(routePoints, obstacles = []) {
    let obstacleCount = 0;
    let obstacleLength = 0;

    for (let index = 0; index < routePoints.length - 1; index += 1) {
        const start = routePoints[index];
        const end = routePoints[index + 1];
        if (pointsAlmostEqual(start, end)) {
            continue;
        }

        const hitsObstacle = obstacles.some((obstacle) =>
            pointInsideRect(start, obstacle)
            || pointInsideRect(end, obstacle)
            || segmentIntersectsObstacle(start, end, obstacle),
        );
        if (!hitsObstacle) {
            continue;
        }

        obstacleCount += 1;
        obstacleLength += Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
    }

    return { obstacleCount, obstacleLength };
}

function countRouteBacktracks(routePoints) {
    let backtrackCount = 0;
    let backtrackDepth = 0;
    let overshootLength = 0;

    for (let index = 0; index < routePoints.length - 3; index += 1) {
        const first = routePoints[index];
        const second = routePoints[index + 1];
        const third = routePoints[index + 2];
        const fourth = routePoints[index + 3];
        const firstAxis = getSegmentAxis(first, second);
        const secondAxis = getSegmentAxis(second, third);
        const thirdAxis = getSegmentAxis(third, fourth);
        if (!firstAxis || !secondAxis || !thirdAxis) {
            continue;
        }
        if (firstAxis !== thirdAxis || firstAxis === secondAxis || secondAxis === thirdAxis) {
            continue;
        }

        const firstDirection = getSegmentDirection(first, second);
        const thirdDirection = getSegmentDirection(third, fourth);
        if (!firstDirection || !thirdDirection || firstDirection === thirdDirection) {
            continue;
        }

        backtrackCount += 1;
        overshootLength += firstAxis === "h"
            ? Math.abs(second.x - fourth.x)
            : Math.abs(second.y - fourth.y);
        backtrackDepth += firstAxis === "h"
            ? Math.abs(third.y - second.y)
            : Math.abs(third.x - second.x);
    }

    return {
        backtrackCount,
        backtrackDepth,
        overshootLength,
    };
}

function cleanupAutorouteRoute(routePoints, obstacles = []) {
    let cleaned = simplifyOrthogonalPoints(routePoints);
    let changed = true;

    while (changed && cleaned.length >= 4) {
        changed = false;

        for (let index = 0; index < cleaned.length - 3; index += 1) {
            const first = cleaned[index];
            const second = cleaned[index + 1];
            const third = cleaned[index + 2];
            const fourth = cleaned[index + 3];
            const firstAxis = getSegmentAxis(first, second);
            const secondAxis = getSegmentAxis(second, third);
            const thirdAxis = getSegmentAxis(third, fourth);
            if (!firstAxis || !secondAxis || !thirdAxis) {
                continue;
            }
            if (firstAxis !== thirdAxis || firstAxis === secondAxis || secondAxis === thirdAxis) {
                continue;
            }

            const firstDirection = getSegmentDirection(first, second);
            const thirdDirection = getSegmentDirection(third, fourth);
            if (!firstDirection || !thirdDirection || firstDirection === thirdDirection) {
                continue;
            }

            const replacement = firstAxis === "h"
                ? { x: fourth.x, y: first.y }
                : { x: first.x, y: fourth.y };
            const candidate = simplifyOrthogonalPoints([
                ...cleaned.slice(0, index + 1),
                replacement,
                ...cleaned.slice(index + 3),
            ]);
            const currentViolations = countRouteObstacleViolations(cleaned, obstacles);
            const nextViolations = countRouteObstacleViolations(candidate, obstacles);
            if (
                nextViolations.obstacleCount > currentViolations.obstacleCount
                || (nextViolations.obstacleCount === currentViolations.obstacleCount
                    && nextViolations.obstacleLength > currentViolations.obstacleLength + 0.01)
            ) {
                continue;
            }
            if (getRouteLength(candidate) > getRouteLength(cleaned) + 0.01) {
                continue;
            }

            cleaned = candidate;
            changed = true;
            break;
        }
    }

    return simplifyOrthogonalPoints(cleaned);
}

function rectIntersectsBounds(rect, left, top, right, bottom) {
    return rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom;
}

function snapDown(value, step) {
    return Math.floor(value / step) * step;
}

function snapUp(value, step) {
    return Math.ceil(value / step) * step;
}

function buildAxisValues(min, max, step, forced) {
    const values = [];
    for (let value = snapDown(min, step); value <= snapUp(max, step); value += step) {
        values.push(Number(value.toFixed(2)));
    }
    return dedupeNumbers([...values, ...forced]);
}

function segmentOverlapAmount(a1, a2, b1, b2) {
    return Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2));
}

function getSoftSegmentPenalty(start, end, segments) {
    let penalty = 0;

    segments.forEach((segment) => {
        const radius = segment.radius ?? 10;
        const basePenalty = segment.penalty ?? 220;

        if (Math.abs(start.x - end.x) < 0.01 && Math.abs(segment.start.x - segment.end.x) < 0.01) {
            const distance = Math.abs(start.x - segment.start.x);
            const overlap = segmentOverlapAmount(start.y, end.y, segment.start.y, segment.end.y);
            if (overlap > 0 && distance < radius) {
                penalty += basePenalty * (1 + (radius - distance) / radius);
            }
            return;
        }

        if (Math.abs(start.y - end.y) < 0.01 && Math.abs(segment.start.y - segment.end.y) < 0.01) {
            const distance = Math.abs(start.y - segment.start.y);
            const overlap = segmentOverlapAmount(start.x, end.x, segment.start.x, segment.end.x);
            if (overlap > 0 && distance < radius) {
                penalty += basePenalty * (1 + (radius - distance) / radius);
            }
            return;
        }

        if (Math.abs(start.x - end.x) < 0.01 && Math.abs(segment.start.y - segment.end.y) < 0.01) {
            const minY = Math.min(start.y, end.y);
            const maxY = Math.max(start.y, end.y);
            const minX = Math.min(segment.start.x, segment.end.x);
            const maxX = Math.max(segment.start.x, segment.end.x);
            const crossingLike =
                start.x >= minX - radius
                && start.x <= maxX + radius
                && segment.start.y >= minY - radius
                && segment.start.y <= maxY + radius;
            if (crossingLike) {
                penalty += basePenalty * 0.8;
            }
            return;
        }

        if (Math.abs(start.y - end.y) < 0.01 && Math.abs(segment.start.x - segment.end.x) < 0.01) {
            const minX = Math.min(start.x, end.x);
            const maxX = Math.max(start.x, end.x);
            const minY = Math.min(segment.start.y, segment.end.y);
            const maxY = Math.max(segment.start.y, segment.end.y);
            const crossingLike =
                segment.start.x >= minX - radius
                && segment.start.x <= maxX + radius
                && start.y >= minY - radius
                && start.y <= maxY + radius;
            if (crossingLike) {
                penalty += basePenalty * 0.8;
            }
        }
    });

    return penalty;
}

function getRoutePointsViaGridSearch(start, end, obstacles, penaltySegments, step = 8) {
    void step;
    if (!getLibavoidRouterStatus().ready) {
        return null;
    }

    try {
        const routed = routeConnectionWithLibavoid({
            start,
            end,
            obstacles,
            penaltySegments,
            gridSize: LIBAVOID_GRID_SIZE,
        });
        return routed?.routePoints ?? null;
    } catch {
        return null;
    }
}

function getFallbackRoutePoints(start, end, startDirection, endDirection) {
    if (!startDirection && !endDirection) {
        const midX = start.x + (end.x - start.x) / 2;
        return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
    }

    const stubLength = DEFAULT_STUB_LENGTH;
    const startStub = startDirection ? nudgePoint(start, startDirection, stubLength) : start;
    const endStub = endDirection ? nudgePoint(end, endDirection, stubLength) : end;
    const horizontalStart =
        startDirection === "left" || startDirection === "right" || startDirection == null;
    const horizontalEnd =
        endDirection === "left" || endDirection === "right" || endDirection == null;

    if (horizontalStart && horizontalEnd) {
        const midX = startStub.x + (endStub.x - startStub.x) / 2;
        return [
            start,
            startStub,
            { x: midX, y: startStub.y },
            { x: midX, y: endStub.y },
            endStub,
            end,
        ];
    }

    if (!horizontalStart && !horizontalEnd) {
        const midY = startStub.y + (endStub.y - startStub.y) / 2;
        return [
            start,
            startStub,
            { x: startStub.x, y: midY },
            { x: endStub.x, y: midY },
            endStub,
            end,
        ];
    }

    if (horizontalStart) {
        return [start, startStub, { x: endStub.x, y: startStub.y }, endStub, end];
    }

    return [start, startStub, { x: startStub.x, y: endStub.y }, endStub, end];
}

function getOrthogonalRoutePoints(
    x1,
    y1,
    x2,
    y2,
    startDirection,
    endDirection,
    obstacles = [],
    lockedRoutePoints = [],
) {
    const start = { x: x1, y: y1 };
    const end = { x: x2, y: y2 };

    if (lockedRoutePoints.length > 0) {
        return dedupeSequentialPoints([start, ...lockedRoutePoints, end]);
    }

    if (obstacles.length === 0) {
        return getFallbackRoutePoints(start, end, startDirection, endDirection);
    }

    const stubLength = DEFAULT_STUB_LENGTH;
    const startStub = startDirection ? nudgePoint(start, startDirection, stubLength) : start;
    const endStub = endDirection ? nudgePoint(end, endDirection, stubLength) : end;
    const usableObstacles = obstacles.filter(
        (rect) =>
            !pointInsideRect(start, rect)
            && !pointInsideRect(startStub, rect)
            && !pointInsideRect(endStub, rect)
            && !pointInsideRect(end, rect),
    );

    const xs = dedupeNumbers([
        start.x,
        startStub.x,
        endStub.x,
        end.x,
        ...usableObstacles.flatMap((rect) => [
            rect.left,
            rect.right,
            rect.left - GUIDE_CHANNEL_OFFSET,
            rect.right + GUIDE_CHANNEL_OFFSET,
            rect.left - GUIDE_WIDE_CHANNEL_OFFSET,
            rect.right + GUIDE_WIDE_CHANNEL_OFFSET,
        ]),
    ]);
    const ys = dedupeNumbers([
        start.y,
        startStub.y,
        endStub.y,
        end.y,
        ...usableObstacles.flatMap((rect) => [
            rect.top,
            rect.bottom,
            rect.top - GUIDE_CHANNEL_OFFSET,
            rect.bottom + GUIDE_CHANNEL_OFFSET,
            rect.top - GUIDE_WIDE_CHANNEL_OFFSET,
            rect.bottom + GUIDE_WIDE_CHANNEL_OFFSET,
        ]),
    ]);

    const points = dedupePoints([
        start,
        startStub,
        endStub,
        end,
        ...xs.flatMap((x) =>
            ys.map((y) => ({ x, y })).filter(
                (point) => !usableObstacles.some((rect) => pointInsideRect(point, rect)),
            ),
        ),
    ]);
    const indexByKey = new Map(points.map((point, index) => [pointKey(point), index]));
    const adjacency = new Map();

    const connect = (first, second, axis) => {
        if (usableObstacles.some((rect) => segmentIntersectsRect(first, second, rect))) {
            return;
        }

        const firstIndex = indexByKey.get(pointKey(first));
        const secondIndex = indexByKey.get(pointKey(second));
        if (firstIndex == null || secondIndex == null || firstIndex === secondIndex) {
            return;
        }

        const distance = Math.abs(first.x - second.x) + Math.abs(first.y - second.y);
        const firstEdges = adjacency.get(firstIndex) ?? [];
        const secondEdges = adjacency.get(secondIndex) ?? [];
        firstEdges.push({ to: secondIndex, distance, axis });
        secondEdges.push({ to: firstIndex, distance, axis });
        adjacency.set(firstIndex, firstEdges);
        adjacency.set(secondIndex, secondEdges);
    };

    xs.forEach((x) => {
        const linePoints = points
            .filter((point) => Math.abs(point.x - x) < 0.01)
            .sort((a, b) => a.y - b.y);
        for (let index = 0; index < linePoints.length - 1; index += 1) {
            connect(linePoints[index], linePoints[index + 1], "v");
        }
    });

    ys.forEach((y) => {
        const linePoints = points
            .filter((point) => Math.abs(point.y - y) < 0.01)
            .sort((a, b) => a.x - b.x);
        for (let index = 0; index < linePoints.length - 1; index += 1) {
            connect(linePoints[index], linePoints[index + 1], "h");
        }
    });

    const startIndex = indexByKey.get(pointKey(start));
    const endIndex = indexByKey.get(pointKey(end));
    if (startIndex == null || endIndex == null) {
        return getFallbackRoutePoints(start, end, startDirection, endDirection);
    }

    const queue = [{ node: startIndex, axis: null, cost: 0 }];
    const best = new Map([[`${startIndex}:none`, 0]]);
    const parent = new Map([[`${startIndex}:none`, { previousKey: null, node: startIndex }]]);
    const bendPenalty = 24;
    const startAxis =
        startDirection === "left" || startDirection === "right"
            ? "h"
            : startDirection === "up" || startDirection === "down"
                ? "v"
                : null;
    const endAxis =
        endDirection === "left" || endDirection === "right"
            ? "h"
            : endDirection === "up" || endDirection === "down"
                ? "v"
                : null;

    while (queue.length > 0) {
        queue.sort((a, b) => a.cost - b.cost);
        const current = queue.shift();
        if (!current) {
            break;
        }

        const currentAxisKey = current.axis ?? "none";
        const currentKey = `${current.node}:${currentAxisKey}`;
        const currentBest = best.get(currentKey);
        if (currentBest == null || current.cost > currentBest) {
            continue;
        }

        if (current.node === endIndex) {
            const route = [];
            let walkerKey = currentKey;
            while (walkerKey) {
                const walker = parent.get(walkerKey);
                if (!walker) {
                    break;
                }
                route.push(points[walker.node]);
                walkerKey = walker.previousKey;
            }

            return route.reverse();
        }

        const edges = adjacency.get(current.node) ?? [];
        edges.forEach((edge) => {
            const axisPenalty = current.axis != null && current.axis !== edge.axis ? bendPenalty : 0;
            const endpointAxisPenalty =
                current.node === startIndex && startAxis != null && edge.axis !== startAxis
                    ? bendPenalty * 5
                    : 0;
            const destinationAxisPenalty =
                edge.to === endIndex && endAxis != null && edge.axis !== endAxis
                    ? bendPenalty * 5
                    : 0;
            const crowdingPenalty = getSegmentCrowdingPenalty(
                points[current.node],
                points[edge.to],
                usableObstacles,
            );
            const nextCost =
                current.cost
                + edge.distance
                + axisPenalty
                + endpointAxisPenalty
                + destinationAxisPenalty
                + crowdingPenalty;
            const nextKey = `${edge.to}:${edge.axis}`;
            const existingCost = best.get(nextKey);

            if (existingCost != null && existingCost <= nextCost) {
                return;
            }

            best.set(nextKey, nextCost);
            parent.set(nextKey, { previousKey: currentKey, node: edge.to });
            queue.push({ node: edge.to, axis: edge.axis, cost: nextCost });
        });
    }

    return getFallbackRoutePoints(start, end, startDirection, endDirection);
}

function getSmartOrthogonalRoutePoints(
    x1,
    y1,
    x2,
    y2,
    startDirection,
    endDirection,
    obstacles = [],
    penaltySegments = [],
) {
    const start = { x: x1, y: y1 };
    const end = { x: x2, y: y2 };
    const stubLength = DEFAULT_STUB_LENGTH + 4;
    const startStub = startDirection ? nudgePoint(start, startDirection, stubLength) : start;
    const endStub = endDirection ? nudgePoint(end, endDirection, stubLength) : end;

    if (obstacles.length === 0 && penaltySegments.length === 0) {
        return simplifyOrthogonalPoints(
            getFallbackRoutePoints(start, end, startDirection, endDirection),
        );
    }

    const middleRoute = getRoutePointsViaGridSearch(startStub, endStub, obstacles, penaltySegments);
    if (!middleRoute) {
        return simplifyOrthogonalPoints(
            getFallbackRoutePoints(start, end, startDirection, endDirection),
        );
    }

    return simplifyOrthogonalPoints([
        start,
        startStub,
        ...middleRoute.slice(1, -1),
        endStub,
        end,
    ]);
}

function getOrthogonalPath(
    x1,
    y1,
    x2,
    y2,
    startDirection,
    endDirection,
    obstacles = [],
    lockedRoutePoints = [],
) {
    return pointsToPath(
        getOrthogonalRoutePoints(
            x1,
            y1,
            x2,
            y2,
            startDirection,
            endDirection,
            obstacles,
            lockedRoutePoints,
        ),
    );
}

function getEditableBendPoints(routePoints) {
    return routePoints.slice(1, -1).map((point, index) => ({
        index: index + 1,
        point,
    }));
}

function getConnectionInteriorRoutePoints(routePoints) {
    return dedupeSequentialPoints(routePoints).slice(1, -1);
}

function pointsAlmostEqual(left, right, tolerance = 0.01) {
    return Math.abs(left.x - right.x) <= tolerance && Math.abs(left.y - right.y) <= tolerance;
}

function isPointOnSegment(point, start, end, tolerance = 0.01) {
    const cross = (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
    if (Math.abs(cross) > tolerance) {
        return false;
    }

    return (
        point.x >= Math.min(start.x, end.x) - tolerance
        && point.x <= Math.max(start.x, end.x) + tolerance
        && point.y >= Math.min(start.y, end.y) - tolerance
        && point.y <= Math.max(start.y, end.y) + tolerance
    );
}

function getSegmentIntersectionPoint(firstStart, firstEnd, secondStart, secondEnd, tolerance = 0.01) {
    const dx1 = firstEnd.x - firstStart.x;
    const dy1 = firstEnd.y - firstStart.y;
    const dx2 = secondEnd.x - secondStart.x;
    const dy2 = secondEnd.y - secondStart.y;
    const denominator = dx1 * dy2 - dy1 * dx2;

    if (Math.abs(denominator) <= tolerance) {
        const sharedPoints = [firstStart, firstEnd, secondStart, secondEnd];
        return (
            sharedPoints.find((point) =>
                isPointOnSegment(point, firstStart, firstEnd, tolerance)
                && isPointOnSegment(point, secondStart, secondEnd, tolerance),
            ) ?? null
        );
    }

    const offsetX = secondStart.x - firstStart.x;
    const offsetY = secondStart.y - firstStart.y;
    const firstT = (offsetX * dy2 - offsetY * dx2) / denominator;
    const secondT = (offsetX * dy1 - offsetY * dx1) / denominator;

    if (
        firstT < -tolerance
        || firstT > 1 + tolerance
        || secondT < -tolerance
        || secondT > 1 + tolerance
    ) {
        return null;
    }

    return {
        x: firstStart.x + firstT * dx1,
        y: firstStart.y + firstT * dy1,
    };
}

function getConnectionSegments(routePoints) {
    const segments = [];

    for (let index = 0; index < routePoints.length - 1; index += 1) {
        const point = routePoints[index];
        const next = routePoints[index + 1];
        if (pointsAlmostEqual(point, next)) {
            continue;
        }

        if (Math.abs(point.y - next.y) < 0.01) {
            segments.push({
                axis: "h",
                start: point,
                end: next,
                left: Math.min(point.x, next.x),
                right: Math.max(point.x, next.x),
                y: point.y,
            });
            continue;
        }

        if (Math.abs(point.x - next.x) < 0.01) {
            segments.push({
                axis: "v",
                start: point,
                end: next,
                top: Math.min(point.y, next.y),
                bottom: Math.max(point.y, next.y),
                x: point.x,
            });
        }
    }

    return segments;
}

function getWireCrossingCandidates(routes, explicitPoints) {
    const crossings = new Map();

    routes.forEach((route, routeIndex) => {
        const currentSegments = getConnectionSegments(route.routePoints);

        routes.slice(routeIndex + 1).forEach((otherRoute) => {
            const otherSegments = getConnectionSegments(otherRoute.routePoints);

            currentSegments.forEach((segment) => {
                otherSegments.forEach((otherSegment) => {
                    if (segment.axis === otherSegment.axis) {
                        return;
                    }

                    const horizontal = segment.axis === "h" ? segment : otherSegment;
                    const vertical = segment.axis === "v" ? segment : otherSegment;
                    if (horizontal.axis !== "h" || vertical.axis !== "v") {
                        return;
                    }
                    const x = vertical.x;
                    const y = horizontal.y;

                    if (
                        x <= horizontal.left + 0.01
                        || x >= horizontal.right - 0.01
                        || y <= vertical.top + 0.01
                        || y >= vertical.bottom - 0.01
                    ) {
                        return;
                    }

                    const intersection = { x, y };
                    if (explicitPoints.some((point) => pointsAlmostEqual(point, intersection))) {
                        return;
                    }

                    const key = `${x.toFixed(2)}:${y.toFixed(2)}`;
                    const jumpConnectionId =
                        horizontal === segment ? route.connection.id : otherRoute.connection.id;
                    const connectionIds = [route.connection.id, otherRoute.connection.id].sort();
                    const existing = crossings.get(key);

                    if (existing) {
                        existing.connectionIds = Array.from(
                            new Set([...existing.connectionIds, ...connectionIds]),
                        );
                        existing.jumpConnectionIds = Array.from(
                            new Set([...(existing.jumpConnectionIds ?? []), jumpConnectionId]),
                        );
                        return;
                    }

                    crossings.set(key, {
                        x,
                        y,
                        connectionIds,
                        jumpConnectionId,
                        jumpConnectionIds: [jumpConnectionId],
                    });
                });
            });
        });
    });

    return Array.from(crossings.values());
}

function findCrossingOnActiveSegment(
    start,
    end,
    routes,
    explicitPoints,
    includeTargetPointIntersection = false,
) {
    if (pointsAlmostEqual(start, end)) {
        return null;
    }

    const crossings = new Map();

    routes.forEach((route) => {
        for (let index = 0; index < route.routePoints.length - 1; index += 1) {
            const segmentStart = route.routePoints[index];
            const segmentEnd = route.routePoints[index + 1];
            if (pointsAlmostEqual(segmentStart, segmentEnd)) {
                continue;
            }
            const intersection = getSegmentIntersectionPoint(start, end, segmentStart, segmentEnd);
            if (!intersection) {
                continue;
            }
            if (pointsAlmostEqual(intersection, start)) {
                continue;
            }
            if (!includeTargetPointIntersection && pointsAlmostEqual(intersection, end)) {
                continue;
            }
            if (explicitPoints.some((point) => pointsAlmostEqual(point, intersection))) {
                continue;
            }

            const key = `${intersection.x.toFixed(2)}:${intersection.y.toFixed(2)}`;
            const existing = crossings.get(key);
            if (existing) {
                existing.connectionIds = Array.from(
                    new Set([...existing.connectionIds, route.connection.id]),
                );
                existing.jumpConnectionIds = Array.from(
                    new Set([...(existing.jumpConnectionIds ?? []), route.connection.id]),
                );
                continue;
            }

            crossings.set(key, {
                x: intersection.x,
                y: intersection.y,
                connectionIds: [route.connection.id],
                jumpConnectionId: route.connection.id,
                jumpConnectionIds: [route.connection.id],
            });
        }
    });

    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    crossings.forEach((crossing) => {
        const distance = Math.hypot(crossing.x - start.x, crossing.y - start.y);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = crossing;
        }
    });

    return best;
}

function getWireJumpOverlaysByConnection(routes, crossings) {
    return new Map(
        routes.map((route) => [
            route.connection.id,
            [
                ...crossings
                    .filter((crossing) =>
                        (crossing.jumpConnectionIds ?? [crossing.jumpConnectionId]).includes(
                            route.connection.id,
                        ),
                    )
                    .map((crossing) => ({
                        connectionId: route.connection.id,
                        x: crossing.x,
                        y: crossing.y,
                    })),
                ...(((route.connection.jumps ?? route.connection.jumpPoints) ?? []).map((point) => ({
                    connectionId: route.connection.id,
                    x: point.x,
                    y: point.y,
                    ...(Number.isInteger(point?.segmentIndex) ? { segmentIndex: point.segmentIndex } : {}),
                }))),
            ].filter((jump, index, jumps) =>
                jumps.findIndex((candidate) => pointsAlmostEqual(candidate, jump)) === index,
            ),
        ]),
    );
}

function getWireJumpedPath(routePoints, jumps, radius = 7, height = 6) {
    if (routePoints.length === 0 || jumps.length === 0) {
        return getPolylinePath(routePoints);
    }

    let path = `M ${routePoints[0].x} ${routePoints[0].y}`;

    for (let index = 1; index < routePoints.length; index += 1) {
        const previous = routePoints[index - 1];
        const current = routePoints[index];

        if (Math.abs(previous.y - current.y) < 0.01) {
            const direction = current.x >= previous.x ? 1 : -1;
            const segmentLeft = Math.min(previous.x, current.x);
            const segmentRight = Math.max(previous.x, current.x);
            const segmentJumps = jumps
                .filter(
                    (jump) =>
                        Math.abs(jump.y - previous.y) < 0.01
                        && jump.x > segmentLeft + radius + 0.01
                        && jump.x < segmentRight - radius - 0.01,
                )
                .sort((left, right) => (direction === 1 ? left.x - right.x : right.x - left.x));
            const endJump = jumps.find(
                (jump) =>
                    Math.abs(jump.y - previous.y) < 0.01
                    && Math.abs(jump.x - current.x) < 0.01
                    && Math.abs(current.x - previous.x) > radius + 2,
            );

            let cursorX = previous.x;
            segmentJumps.forEach((jump) => {
                const jumpStartX = jump.x - radius * direction;
                const jumpEndX = jump.x + radius * direction;
                if (Math.abs(jumpStartX - cursorX) > 0.01) {
                    path += ` L ${jumpStartX} ${previous.y}`;
                }
                path += ` Q ${jump.x} ${previous.y - height} ${jumpEndX} ${previous.y}`;
                cursorX = jumpEndX;
            });

            if (
                endJump
                && Math.abs(current.x - cursorX) > radius * 0.75
            ) {
                const jumpStartX = current.x - radius * direction;
                if (Math.abs(jumpStartX - cursorX) > 0.01) {
                    path += ` L ${jumpStartX} ${previous.y}`;
                }
                path += ` Q ${current.x} ${previous.y - height} ${current.x} ${current.y}`;
                cursorX = current.x;
            }

            if (Math.abs(current.x - cursorX) > 0.01) {
                path += ` L ${current.x} ${current.y}`;
            }
            continue;
        }

        if (Math.abs(previous.x - current.x) < 0.01) {
            const direction = current.y >= previous.y ? 1 : -1;
            const segmentTop = Math.min(previous.y, current.y);
            const segmentBottom = Math.max(previous.y, current.y);
            const segmentJumps = jumps
                .filter(
                    (jump) =>
                        Math.abs(jump.x - previous.x) < 0.01
                        && jump.y > segmentTop + radius + 0.01
                        && jump.y < segmentBottom - radius - 0.01,
                )
                .sort((left, right) => (direction === 1 ? left.y - right.y : right.y - left.y));
            const endJump = jumps.find(
                (jump) =>
                    Math.abs(jump.x - previous.x) < 0.01
                    && Math.abs(jump.y - current.y) < 0.01
                    && Math.abs(current.y - previous.y) > radius + 2,
            );

            let cursorY = previous.y;
            segmentJumps.forEach((jump) => {
                const jumpStartY = jump.y - radius * direction;
                const jumpEndY = jump.y + radius * direction;
                if (Math.abs(jumpStartY - cursorY) > 0.01) {
                    path += ` L ${previous.x} ${jumpStartY}`;
                }
                path += ` Q ${previous.x + height} ${jump.y} ${previous.x} ${jumpEndY}`;
                cursorY = jumpEndY;
            });

            if (
                endJump
                && Math.abs(current.y - cursorY) > radius * 0.75
            ) {
                const jumpStartY = current.y - radius * direction;
                if (Math.abs(jumpStartY - cursorY) > 0.01) {
                    path += ` L ${previous.x} ${jumpStartY}`;
                }
                path += ` Q ${previous.x + height} ${current.y} ${current.x} ${current.y}`;
                cursorY = current.y;
            }

            if (Math.abs(current.y - cursorY) > 0.01) {
                path += ` L ${current.x} ${current.y}`;
            }
            continue;
        }

        path += ` L ${current.x} ${current.y}`;
    }

    return path;
}

function getRouteLength(routePoints) {
    let length = 0;
    for (let index = 0; index < routePoints.length - 1; index += 1) {
        const start = routePoints[index];
        const end = routePoints[index + 1];
        length += Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
    }
    return length;
}

function getRouteBendCount(routePoints) {
    let bends = 0;

    for (let index = 1; index < routePoints.length - 1; index += 1) {
        const previous = routePoints[index - 1];
        const current = routePoints[index];
        const next = routePoints[index + 1];
        if (pointsAlmostEqual(previous, current) || pointsAlmostEqual(current, next)) {
            continue;
        }

        const previousAxis = Math.abs(previous.x - current.x) < 0.01 ? "v" : "h";
        const nextAxis = Math.abs(current.x - next.x) < 0.01 ? "v" : "h";
        if (previousAxis !== nextAxis) {
            bends += 1;
        }
    }

    return bends;
}

function countRouteCrossings(routePoints, existingRoutes, explicitPoints) {
    const crossings = new Set();

    for (let index = 0; index < routePoints.length - 1; index += 1) {
        const start = routePoints[index];
        const end = routePoints[index + 1];
        if (pointsAlmostEqual(start, end)) {
            continue;
        }

        existingRoutes.forEach((route) => {
            for (let segmentIndex = 0; segmentIndex < route.routePoints.length - 1; segmentIndex += 1) {
                const otherStart = route.routePoints[segmentIndex];
                const otherEnd = route.routePoints[segmentIndex + 1];
                if (pointsAlmostEqual(otherStart, otherEnd)) {
                    continue;
                }

                const intersection = getSegmentIntersectionPoint(start, end, otherStart, otherEnd);
                if (!intersection) {
                    continue;
                }
                if (
                    pointsAlmostEqual(intersection, start)
                    || pointsAlmostEqual(intersection, end)
                    || pointsAlmostEqual(intersection, otherStart)
                    || pointsAlmostEqual(intersection, otherEnd)
                ) {
                    continue;
                }
                if (explicitPoints.some((point) => pointsAlmostEqual(point, intersection))) {
                    continue;
                }

                crossings.add(`${intersection.x.toFixed(2)}:${intersection.y.toFixed(2)}`);
            }
        });
    }

    return crossings.size;
}

function countRouteOverlaps(routePoints, existingRoutes, explicitPoints) {
    const overlaps = new Set();
    let overlapLength = 0;

    for (let index = 0; index < routePoints.length - 1; index += 1) {
        const start = routePoints[index];
        const end = routePoints[index + 1];
        if (pointsAlmostEqual(start, end)) {
            continue;
        }

        existingRoutes.forEach((route) => {
            for (let segmentIndex = 0; segmentIndex < route.routePoints.length - 1; segmentIndex += 1) {
                const otherStart = route.routePoints[segmentIndex];
                const otherEnd = route.routePoints[segmentIndex + 1];
                if (pointsAlmostEqual(otherStart, otherEnd)) {
                    continue;
                }

                const bothHorizontal =
                    Math.abs(start.y - end.y) < 0.01
                    && Math.abs(otherStart.y - otherEnd.y) < 0.01
                    && Math.abs(start.y - otherStart.y) < 0.01;
                const bothVertical =
                    Math.abs(start.x - end.x) < 0.01
                    && Math.abs(otherStart.x - otherEnd.x) < 0.01
                    && Math.abs(start.x - otherStart.x) < 0.01;

                if (!bothHorizontal && !bothVertical) {
                    continue;
                }

                const axis = bothHorizontal ? "h" : "v";
                const overlapStart = bothHorizontal
                    ? Math.max(Math.min(start.x, end.x), Math.min(otherStart.x, otherEnd.x))
                    : Math.max(Math.min(start.y, end.y), Math.min(otherStart.y, otherEnd.y));
                const overlapEnd = bothHorizontal
                    ? Math.min(Math.max(start.x, end.x), Math.max(otherStart.x, otherEnd.x))
                    : Math.min(Math.max(start.y, end.y), Math.max(otherStart.y, otherEnd.y));
                const span = overlapEnd - overlapStart;

                if (span <= 0.5) {
                    continue;
                }

                const samplePoint = axis === "h"
                    ? { x: overlapStart + span / 2, y: start.y }
                    : { x: start.x, y: overlapStart + span / 2 };
                if (explicitPoints.some((point) => pointsAlmostEqual(point, samplePoint))) {
                    continue;
                }

                overlaps.add(
                    axis === "h"
                        ? `${start.y.toFixed(2)}:${overlapStart.toFixed(2)}:${overlapEnd.toFixed(2)}`
                        : `${start.x.toFixed(2)}:${overlapStart.toFixed(2)}:${overlapEnd.toFixed(2)}`,
                );
                overlapLength += span;
            }
        });
    }

    return {
        overlapCount: overlaps.size,
        overlapLength,
    };
}

function segmentIntersectsObstacle(start, end, obstacle) {
    if (Math.abs(start.x - end.x) < 0.01) {
        const x = start.x;
        const top = Math.min(start.y, end.y);
        const bottom = Math.max(start.y, end.y);
        return x > obstacle.left && x < obstacle.right && bottom > obstacle.top && top < obstacle.bottom;
    }

    if (Math.abs(start.y - end.y) < 0.01) {
        const y = start.y;
        const left = Math.min(start.x, end.x);
        const right = Math.max(start.x, end.x);
        return y > obstacle.top && y < obstacle.bottom && right > obstacle.left && left < obstacle.right;
    }

    return false;
}

function isCompactAnchorRouteClear(routePoints, obstacles) {
    for (let index = 0; index < routePoints.length - 1; index += 1) {
        const start = routePoints[index];
        const end = routePoints[index + 1];
        if (pointsAlmostEqual(start, end)) {
            continue;
        }
        if (obstacles.some((obstacle) => segmentIntersectsObstacle(start, end, obstacle))) {
            return false;
        }
    }

    return true;
}

function buildCompactOrthogonalRoutes(start, end) {
    const candidates = [];

    if (pointsAlmostEqual(start, end)) {
        return [[start]];
    }

    if (Math.abs(start.x - end.x) < 0.01 || Math.abs(start.y - end.y) < 0.01) {
        return [[start, end]];
    }

    candidates.push([start, { x: end.x, y: start.y }, end]);
    candidates.push([start, { x: start.x, y: end.y }, end]);

    const seen = new Set();
    return candidates.filter((candidate) => {
        const key = candidate
            .map((point) => `${point.x.toFixed(2)}:${point.y.toFixed(2)}`)
            .join("|");
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function buildSkeletonChannelRoutes(start, end, obstacles) {
    const corridorLeft = Math.min(start.x, end.x) - 40;
    const corridorRight = Math.max(start.x, end.x) + 40;
    const corridorTop = Math.min(start.y, end.y) - 40;
    const corridorBottom = Math.max(start.y, end.y) + 40;
    const relevantObstacles = obstacles.filter(
        (obstacle) =>
            obstacle.right >= corridorLeft
            && obstacle.left <= corridorRight
            && obstacle.bottom >= corridorTop
            && obstacle.top <= corridorBottom,
    );
    const corridorXs = Array.from(
        new Set([
            Number(((start.x + end.x) / 2).toFixed(2)),
            ...relevantObstacles.flatMap((obstacle) => [
                Number((obstacle.left - 18).toFixed(2)),
                Number((obstacle.right + 18).toFixed(2)),
            ]),
        ]),
    );
    const corridorYs = Array.from(
        new Set([
            Number(((start.y + end.y) / 2).toFixed(2)),
            ...relevantObstacles.flatMap((obstacle) => [
                Number((obstacle.top - 18).toFixed(2)),
                Number((obstacle.bottom + 18).toFixed(2)),
            ]),
        ]),
    );
    const candidates = [];

    corridorXs.forEach((x) => {
        candidates.push([
            start,
            { x, y: start.y },
            { x, y: end.y },
            end,
        ]);
    });

    corridorYs.forEach((y) => {
        candidates.push([
            start,
            { x: start.x, y },
            { x: end.x, y },
            end,
        ]);
    });

    const seen = new Set();
    return candidates.filter((candidate) => {
        const key = candidate
            .map((point) => `${point.x.toFixed(2)}:${point.y.toFixed(2)}`)
            .join("|");
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function scoreAutorouteCandidate(
    routePoints,
    routeReferenceRoutes,
    explicitPoints,
    directionPenalty = 0,
    bendWeight = 34,
    obstacles = [],
) {
    const routeLength = getRouteLength(routePoints);
    const bendCount = getRouteBendCount(routePoints);
    const crossingCount = countRouteCrossings(routePoints, routeReferenceRoutes, explicitPoints);
    const { overlapCount, overlapLength } = countRouteOverlaps(
        routePoints,
        routeReferenceRoutes,
        explicitPoints,
    );
    const { obstacleCount, obstacleLength } = countRouteObstacleViolations(routePoints, obstacles);
    const { backtrackCount, backtrackDepth, overshootLength } = countRouteBacktracks(routePoints);

    return {
        routeLength,
        bendCount,
        crossingCount,
        overlapCount,
        overlapLength,
        obstacleCount,
        obstacleLength,
        backtrackCount,
        backtrackDepth,
        overshootLength,
        score:
            routeLength
            + bendCount * bendWeight
            + obstacleCount * 5000
            + obstacleLength * 18
            + crossingCount * 180
            + overlapCount * 340
            + overlapLength * 4
            + backtrackCount * 920
            + backtrackDepth * 10
            + overshootLength * 12
            + directionPenalty,
    };
}

function normalizeRoutePoints(points) {
    return points.filter((point, index) => {
        if (index === 0) {
            return true;
        }
        return !pointsAlmostEqual(points[index - 1], point);
    });
}

function buildAutoroutedConnectionRoute({
    startPoint,
    endPoint,
    startAnchor = startPoint,
    endAnchor = endPoint,
    preferredStartDirection,
    preferredEndDirection,
    obstacles = [],
    routeReferenceRoutes = [],
    explicitPoints = [],
    penaltySegments = [],
} = {}) {
    if (!startPoint || !endPoint || !startAnchor || !endAnchor) {
        return null;
    }

    const anchoredRoutePoints = getSmartOrthogonalRoutePoints(
        startAnchor.x,
        startAnchor.y,
        endAnchor.x,
        endAnchor.y,
        preferredStartDirection,
        preferredEndDirection,
        obstacles,
        penaltySegments,
    );
    const routePoints = normalizeRoutePoints([
        startPoint,
        ...anchoredRoutePoints,
        endPoint,
    ]);
    const cleanedRoutePoints = cleanupAutorouteRoute(routePoints, obstacles);
    return {
        routePoints: cleanedRoutePoints,
        ...scoreAutorouteCandidate(
            cleanedRoutePoints,
            routeReferenceRoutes,
            explicitPoints,
            0,
            26,
            obstacles,
        ),
    };
}

function removeRoutePointAtIndex(routePoints, pointIndex) {
    const nextPoints = routePoints.filter((_, index) => index !== pointIndex);
    return getConnectionInteriorRoutePoints(nextPoints);
}

function insertRoutePointOnSegment(routePoints, segmentIndex, point) {
    const nextPoints = [
        ...routePoints.slice(0, segmentIndex + 1),
        point,
        ...routePoints.slice(segmentIndex + 1),
    ];

    return getConnectionInteriorRoutePoints(nextPoints);
}

function getAutoroutePath(startPoint, endPoint, startDirection, endDirection, obstacles = [], penaltySegments = []) {
    return getSmartOrthogonalRoutePoints(
        startPoint.x,
        startPoint.y,
        endPoint.x,
        endPoint.y,
        startDirection,
        endDirection,
        obstacles,
        penaltySegments,
    );
}

window.AuraRouting = {
    nudgePoint,
    getAutoroutePath,
    getPolylinePath,
    getOrthogonalRoutePoints,
    getSmartOrthogonalRoutePoints,
    getOrthogonalPath,
    getEditableBendPoints,
    getConnectionInteriorRoutePoints,
    pointsAlmostEqual,
    isPointOnSegment,
    getSegmentIntersectionPoint,
    getConnectionSegments,
    getWireCrossingCandidates,
    findCrossingOnActiveSegment,
    getWireJumpOverlaysByConnection,
    getWireJumpedPath,
    getRouteLength,
    getRouteBendCount,
    countRouteCrossings,
    countRouteOverlaps,
    buildAutoroutedConnectionRoute,
    removeRoutePointAtIndex,
    insertRoutePointOnSegment,
    cleanupAutorouteRoute,
    getLibavoidRouterStatus,
    initLibavoidRouter,
    routeConnectionWithLibavoid,
    runLibavoidBenchmark,
    libavoidInitError,
};
