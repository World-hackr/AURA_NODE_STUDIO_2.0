# Block Weight Map

Date: 2026-03-30

## Purpose

This document decides how much space each major UI block deserves.

It exists because correct placement is not enough.
Blocks also need the right visual weight relative to:
- what they contain
- how often they are used
- whether they are primary or supporting

Use this together with:
- `docs/UI_SYSTEM_SPEC.md`
- `docs/SCREEN_LAYOUT_MAP.md`

## Weight Classes

Every major block must fit one of these weights.

### `critical`

Use for:
- the main stage
- the primary browser block when browsing is core to the task

Behavior:
- gets the largest share of space
- should dominate visually

### `primary`

Use for:
- the main prompt/input block
- the main selection/correction editor block

Behavior:
- clearly visible
- large enough for real work
- smaller than `critical`

### `secondary`

Use for:
- compact tool shelves
- package structure summaries
- selection summaries

Behavior:
- visible
- intentionally compact
- not allowed to dominate

### `support`

Use for:
- tray previews
- JSON previews
- logs
- readiness summaries

Behavior:
- smaller or tray-only
- scrollable internally
- never prime layout space

## Circuit Studio Weights

### Left Rail

- Prompt Composer: `primary`
- Tool Shelf: `secondary`
- Trusted Library Browser: `critical`

Rationale:
- prompt starts the task
- tool shelf is compact control
- library browsing is a real repeated action and deserves the largest rail share

### Center

- Circuit Stage: `critical`
- Stage Sidecar: `secondary`

Rationale:
- the stage is the product
- compile/net summaries support the stage but should not compete with it

### Right Rail

- Selection Summary: `secondary`
- Main Selection Editor: `primary`
- Runtime/extra detail: `secondary`

Rationale:
- summary should be short
- real edit controls need the most inspector space
- extra detail should not balloon

### Bottom Tray

- project list: `support`
- intent/IR preview: `support`
- logs/imports: `support`

## Component Lab Weights

### Left Rail

- Source Import: `primary`
- Package Structure: `secondary`
- Correction Tool Shelf: `secondary`

Rationale:
- starting/changing the source is the most important left-rail action
- structure and tool mode should stay compact

### Center

- Source vs normalized scene: `critical`
- correction sidecar: `secondary`

### Right Rail

- Correction Summary: `secondary`
- Metadata and Alias Editor: `primary`
- Runtime and Export: `primary`

Rationale:
- Component Lab uses the inspector more heavily than Circuit Studio

## Sizing Rules

### Critical

- should expand first
- can legitimately own scrollable or visually dominant space

### Primary

- large enough for real editing
- should not be squeezed into a tiny card

### Secondary

- compact by default
- if large, there must be a written reason

### Support

- tray-first
- never main-shell dominant

## Immediate Application

The current `studio_web` shell should follow these rules:

- shrink the Circuit Studio tool shelf
- shrink the Circuit Studio selection summary
- enlarge the Circuit Studio library browser relative to other left-rail blocks
- enlarge the Circuit Studio main selection editor relative to the other inspector blocks
- reduce the right rail width slightly if it steals too much from the stage
- reduce tray height if it takes too much vertical value from the stage
- keep JSON previews as support blocks only

## Final Rule

If a block is large only because it can scroll, it is probably oversized.
