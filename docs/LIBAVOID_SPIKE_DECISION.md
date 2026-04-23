# Libavoid Spike Decision

Updated: 2026-04-22

## Decision

Proceed with `libavoid-js` as the production autoroute engine.

The isolated spike passed the current gate:

- grid-disciplined output on the Studio `50 mil` screen grid after endpoint-preserving normalization
- deterministic repeated output on the same batch fixture
- no obstacle violations on the benchmark fixture
- near-instant batch routing for a synthetic `24 wire / 12 obstacle` case

## What Was Added

- `apps/studio_web/js/libavoid_adapter.js`
  - isolated async loader for `libavoid-js`
  - single-route spike API
  - batch-route spike API
  - synthetic benchmark helper
- `scripts/libavoid_spike.mjs`
  - runnable benchmark harness
- `apps/studio_web/js/routing.js`
  - initializes `libavoid-js` at module load
  - routes the production autoroute path through `libavoid-js`
  - keeps only simple orthogonal fallback behavior if the WASM router is unavailable

## Benchmark Result

Command:

```bash
npm --prefix apps/studio_web run bench:libavoid
```

Observed result on this workstation:

- first batch run: about `111 ms`
- second batch run: about `63 ms`
- batch size: `24` wires
- obstacle count: `12`
- deterministic: `true`
- all routes on grid: `true`
- obstacle violations: `false`

## Notes

- The old import-time freeze diagnosis is outdated because import no longer autoroutes on apply.
- The more relevant future benchmark targets are:
  - selected-wire batch autoroute
  - reroute after component movement
  - AI preview patch routing
- `libavoid-js` is async/WASM-based, so production now initializes it deliberately at routing-module load time.
- Production routing normalizes endpoints back onto exact Studio start/end points after libavoid route extraction.

## Remaining Risks

- The current spike proves viability on a synthetic benchmark, not full Studio production behavior.
- We still need to test:
  - routing against real Studio pin escape geometry
  - routing when nearby existing wires should act as soft pressure rather than hard blocks
  - behavior for moved components and local repair
  - preview consistency on the real canvas

## Recommended Next Step

Validate the production integration on real Studio scenes:

- selected-wire batch autoroute
- reroute after component movement
- AI preview patch routing
- real imported example circuits
