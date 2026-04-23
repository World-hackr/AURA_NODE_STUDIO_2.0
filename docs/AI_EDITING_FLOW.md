# AI Editing Flow

Updated: 2026-04-22

## Purpose

Define the deterministic contract layer needed before building the full Studio AI workspace.

The goal is not "AI draws directly on canvas".

The goal is:

1. Studio exports structured scene truth
2. AI proposes a deterministic patch
3. Studio validates and previews the patch
4. User accepts or rejects it

## Core Contracts

### 1. `scene_state.v1`

Studio -> AI

Use this when AI needs to understand the current canvas.

It includes:

- canvas grid and viewport basics
- placed components
- body bounds
- pin locations
- wires and routed geometry
- junctions
- current selection
- net summary
- deterministic issue list

This is the primary anti-hallucination contract.

## 2. `circuit_patch.v1`

AI -> Studio

Use this when AI proposes changes.

It is patch-based, not full-scene regeneration.

Operations currently support:

- add/update/delete component
- add/update/delete junction
- add/update/delete wire
- set selection

This keeps AI output reviewable and previewable.

## Preview Model

The intended preview layer should classify patch operations like this:

- `add_*` -> green overlay
- `delete_*` -> red overlay
- `update_*` -> amber move/change overlay
- `set_selection` -> blue or accent selection overlay

That preview must render on top of the current canvas before apply.

## Why This Matters

The AI may reason from net/connectivity more than raw routed wires, but the user judges the result visually.

So Studio must own:

- deterministic scene export
- deterministic routing
- deterministic patch preview
- deterministic apply

## Recommended Implementation Order

1. add runtime exporters from Studio state to `scene_state.v1`
2. add validator and parser for `circuit_patch.v1`
3. add preview overlay renderer for patch operations
4. add apply/reject flow
5. then build the AI chat/workspace on top

## Current Status

Contracts are now defined in:

- `packages/contracts/scene_state.v1.schema.json`
- `packages/contracts/circuit_patch.v1.schema.json`

Example payloads are in:

- `packages/contracts/examples/scene_state.resistor_divider.json`
- `packages/contracts/examples/circuit_patch.add_indicator_led.json`
