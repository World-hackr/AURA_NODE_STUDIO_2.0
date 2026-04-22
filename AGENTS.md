# AURA Node Studio Agent Instructions

Updated: 2026-03-30

## Product Scope

This workspace is Studio-only for now.

Active product areas:
- `Circuit Studio`
- `Component Lab`
- curated component package library
- deterministic circuit intent and circuit IR
- AI generation pipeline

Out of scope:
- host firmware
- node/locator system
- phone app
- inventory backend
- full simulation platform

## Read Order

Before doing substantial work, read:

1. `README.md`
2. `WORKSPACE_GUIDE.md`
3. `docs/PRODUCT_SCOPE.md`
4. `docs/ARCHITECTURE.md`
5. `docs/DATABASE.md`
6. `AI_PROJECT_CONTEXT.md`
7. `AI_FAILURE_HISTORY.md`
8. `AI_CONTINUITY_LOG.md`

Then read the relevant package or prompt file for the task.

## Core Product Rule

Everything must support one flow:

1. user intent
2. AI creates `circuit_intent`
3. deterministic resolver maps intent to trusted packages
4. compiler builds `circuit_ir`
5. Studio renders editable circuit
6. user makes small fixes
7. export deterministic data

If a feature does not support this flow, it should be deferred.

## Non-Negotiable Design Rules

- AI does not paint the final circuit directly.
- `Fritzing` is visual/connectivity reference, not behavior truth.
- AURA owns runtime behavior semantics.
- Most parts are static.
- Only a small set of parts get runtime profiles at first.
- Component Lab is a correction tool, not a second full CAD app.
- Circuit Studio is the main user-facing surface.
- Use the curated package library, not giant raw vendor dumps, as runtime truth.

## Database Rule

Use `SQLite` for this stage.

- keep schema understandable
- use plain SQL migrations
- prefer small stable tables
- allow JSON text columns while contracts are still evolving

## Continuity Rule

This repo uses `AI_CONTINUITY_LOG.md`.

For every assistant reply in this workspace:

- append a new log entry
- never delete old entries
- record what changed
- record what files were touched
- record decisions made
- record next recommended step

If no files changed, state that explicitly.

## Working Style

- keep the product deterministic
- optimize for simplicity over feature count
- do not reintroduce platform sprawl
- do not build simulation-first
- do not rebuild host/node work here
- prefer small trusted systems over broad speculative systems
