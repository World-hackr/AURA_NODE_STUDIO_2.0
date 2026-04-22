# Workspace Guide

Use this repo as a small Studio-only monorepo.

## First Reads

1. `README.md`
2. `docs/PRODUCT_SCOPE.md`
3. `docs/ARCHITECTURE.md`
4. `docs/DATABASE.md`
5. `docs/IMPLEMENTATION_PLAN.md`
6. `packages/contracts/README.md`

## Product Rule

Everything in this repo must support one flow:

1. user intent
2. AI builds `circuit_intent`
3. deterministic resolver builds `circuit_ir`
4. Studio renders editable circuit
5. user makes small fixes
6. system exports deterministic data

## Important Constraint

Do not reintroduce:
- host work
- inventory work
- broad platform features
- simulation-first architecture
- giant all-purpose editors
