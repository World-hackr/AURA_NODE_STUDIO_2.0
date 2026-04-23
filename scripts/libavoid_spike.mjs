import {
    getLibavoidRouterStatus,
    initLibavoidRouter,
    runLibavoidBenchmark,
} from "../apps/studio_web/js/libavoid_adapter.js";

function formatNumber(value) {
    return Number(value).toFixed(2);
}

async function main() {
    console.log("libavoid router status before load:", getLibavoidRouterStatus());
    await initLibavoidRouter();
    console.log("libavoid router status after load:", getLibavoidRouterStatus());

    const benchmark = await runLibavoidBenchmark({
        gridSize: 10,
        options: {
            penaltyBuffer: 10,
            idealNudgingDistance: 10,
        },
    });

    console.log("libavoid benchmark:");
    console.log(JSON.stringify({
        ...benchmark,
        elapsedMs: formatNumber(benchmark.elapsedMs),
        secondElapsedMs: formatNumber(benchmark.secondElapsedMs),
    }, null, 2));

    if (!benchmark.allOnGrid || benchmark.anyObstacleViolations || !benchmark.deterministic) {
        process.exitCode = 2;
    }
}

main().catch((error) => {
    console.error("libavoid spike failed");
    console.error(error);
    process.exitCode = 1;
});
