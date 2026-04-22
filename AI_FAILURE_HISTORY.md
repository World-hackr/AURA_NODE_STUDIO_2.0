# AI Failure History

This file exists so future AI sessions do not repeat the same product mistakes.

## Repeated Failure Pattern

The project repeatedly became too broad before the core workflow was stable.

The same failure cycle happened across prior versions:

1. define a strong core idea
2. add many adjacent systems
3. mix AI, editing, import, behavior, and simulation into one surface
4. hardcode many special cases
5. lose product clarity
6. restart

## Main Mistakes

### 1. Too Many Systems At Once

The project kept trying to build all of these together:
- AI circuit generation
- circuit editor
- component import system
- generalized behavior engine
- simulation platform
- inventory/host-related ideas

That was too much coupling.

### 2. Behavior Was Designed Too Early

A general behavior library for all components was attempted before:
- package geometry was stable
- pin truth was stable
- named node truth was stable

Result:
- confusing models
- hardcoded exceptions
- UI complexity

### 3. Circuit Studio Became A Tool Dump

Instead of one clear user flow, the main surface accumulated:
- prompt tools
- import helpers
- draft systems
- duplicate inspectors
- multiple behavior editors
- mixed modes

Result:
- users would not trust or enjoy the surface

### 4. Vendor Inputs Were Treated Like Product Truth

Fritzing and Wokwi were sometimes treated as if they might provide:
- full behavior truth
- final runtime semantics

That was wrong.

Correct rule:
- vendor assets are input references
- AURA packages are product truth

### 5. Simulation Was Pulled In Too Early

Simulation work repeatedly appeared before:
- circuit intent was stable
- circuit IR was stable
- curated package quality was stable

Result:
- complexity before product-market clarity

## What Actually Worked

Across old versions, the strongest ideas were:

- deterministic JSON-first compiler/editor
- local deterministic validation and analysis
- reviewed package library
- strict import review before package acceptance
- explicit runtime profiles only for a few component classes

## Hard Rules Going Forward

- Do not let AI directly create final canvas state.
- Do not create a second hidden source of truth beside `circuit_ir`.
- Do not broaden the runtime profile set until the first set is solid.
- Do not expose internal repair systems as first-class UI.
- Do not build host/node/inventory work into this repo phase.
- Do not expand the library faster than you can review package quality.
