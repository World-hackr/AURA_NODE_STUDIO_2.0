# UI System Spec

Date: 2026-03-30

## Purpose

This document freezes the design rules for `AURA Studio` before more UI work is added.

It exists to stop the project from repeating these mistakes:
- adding blocks before deciding their purpose
- mixing unrelated tools into one rail
- making layouts that only work by scrolling the whole page
- using color decoratively instead of semantically
- building "cool-looking" panels that do not support the actual workflow

This spec is the control layer for both:
- `Circuit Studio`
- `Component Lab`

No new Studio UI block should be added unless it fits this document.

Read with:
- `docs/SCREEN_LAYOUT_MAP.md`
- `docs/SCHEMATIC_WORKSTATION_SPEC.md`

## Design References

This UI should learn from:
- older AURA versions for product intent and failure history
- KiCad for workstation discipline, tool density, and panel seriousness
- EasyEDA for approachable flow and readable block grouping

This UI should not copy those tools directly.
It should keep:
- the discipline of an EDA workstation
- the clarity of a guided browser app
- the restraint needed for a deterministic AI-assisted product

## Product Model

The UI exists to support one product pipeline:

1. user intent
2. AI creates `circuit_intent`
3. deterministic matcher resolves trusted packages
4. deterministic compiler creates `circuit_ir`
5. user inspects and fixes small issues
6. system exports deterministic data

The UI is not a general-purpose electronics sandbox.

## Primary UX Principles

1. One block, one job.
2. The center of the product is always the active stage.
3. Rails support the stage. They do not compete with it.
4. Color communicates meaning, not decoration.
5. Default workflow must fit in one viewport on desktop.
6. Long explanations belong in secondary surfaces, not in the main working area.
7. Normal-user actions outrank power-user tools.
8. A user should understand the current mode in under 3 seconds.

## Global Layout Rule

Desktop-first baseline:
- the main product surface must fit inside `100vh`
- page-level scrolling is not allowed for the primary workflow
- scrolling is allowed only inside specific panels and lists

Main shell:
- top bar
- left rail
- center stage
- right inspector
- bottom tray

The stage is always the primary visual focus.

## Canonical Desktop Geometry

These are baseline targets, not optional suggestions:

- app padding: `10px`
- shell gaps: `10px`
- top bar height: `64px`
- bottom tray height: `220px` to `240px`
- left rail width: `296px` to `320px`
- right rail width: `320px` to `360px`
- panel radius: `10px` to `14px`

Center stage gets all remaining width.

Do not introduce a new major panel unless one existing panel is removed or split.

## Responsive Rule

Desktop is the main authoring target.

Tablet/mobile behavior:
- layout may stack
- page scrolling is acceptable on smaller breakpoints
- tool density must reduce
- stage interaction should degrade gracefully

Do not let the mobile fallback dictate the desktop workstation layout.

## Surface Inventory

Only these top-level blocks are allowed in the main workstation shell.

### Top Bar

Purpose:
- show product identity
- show current mode
- show system state
- expose only the highest-level controls

Allowed contents:
- AURA Studio identity
- mode switch: `Circuit Studio | Component Lab`
- API/library/status indicators
- very small set of global actions

Not allowed:
- long helper text
- mode-specific tool dumps
- large search blocks
- project detail forms

### Left Rail

Purpose:
- drive the current workflow forward

Circuit Studio allowed blocks:
- prompt/composer block
- curated library block
- tool shelf block

Component Lab allowed blocks:
- import source block
- package structure block
- correction tool shelf

Not allowed:
- saved projects mixed with package editing
- debug output
- giant note walls
- duplicated inspector controls

### Center Stage

Purpose:
- show the active artifact

Circuit Studio:
- circuit stage
- placement preview
- compile status overlays

Component Lab:
- imported part preview
- anchor/node overlay
- scene correction stage

The center stage must never become a dashboard.

### Right Inspector

Purpose:
- show details of the current selection
- expose small precise edits

Allowed:
- selected package metadata
- selected node/pin details
- small value edits
- rotation/state/runtime controls when justified

Not allowed:
- global settings
- project list
- duplicate library browser
- AI prompt tools

### Bottom Tray

Purpose:
- hold secondary supporting views without stealing the stage

Allowed tabs:
- projects
- intent
- IR
- imports/jobs
- diagnostics later if still justified

Not allowed:
- primary editing controls
- giant explanatory tutorials
- a second inspector

## Block Inventory By Mode

### Circuit Studio

Only these major blocks should exist in the MVP:

1. Prompt Composer
2. Trusted Library Browser
3. Tool Shelf
4. Circuit Stage
5. Selection Inspector
6. Supporting Bottom Tray

Everything else is secondary or deferred.

### Component Lab

Only these major blocks should exist in the MVP:

1. Source Import
2. Source/Scene Preview
3. Node and Pin Correction
4. Metadata and Alias Editor
5. Runtime Assignment Editor
6. Export Summary

If a UI element does not fit one of those six jobs, it should not exist yet.

## Color System

The base UI should stay dark and restrained.
Accent colors should be brighter and intentional.

### Core Palette Roles

- `Cyan`
  Active selection, current mode, focus, live system state
- `Green`
  Success, valid, applied, ready, healthy
- `Baby Pink`
  AI assistance, import/correction, proposed or editable creative states
- `Amber`
  Warning, incomplete, review needed
- `Red`
  Error, destructive, invalid
- `Neutral Dark`
  Panels, stage chrome, inactive tools, separators

### Color Rule

Bright colors must appear only when they mean something.

Do not:
- tint every panel differently
- use accent colors as generic decoration
- make multiple strong colors compete in the same zone

### Zone Guidance

- top bar: mostly neutral with one active accent
- left rail: mostly neutral, accent only for selected section or important actions
- stage: mostly neutral, circuit objects carry the visual focus
- inspector: neutral, with semantic highlights only
- tray: subdued by default

## Typography Rule

The current UI should not feel playful or toy-like.

Typography should feel:
- technical
- calm
- readable
- tool-oriented

Use:
- one main UI family
- uppercase micro-labels for section types only
- medium-weight headers
- compact body text

Do not:
- overuse giant titles
- use marketing-style hero typography
- use decorative type for functional surfaces

## Shape Rule

The UI should feel engineered, not bubbly.

Use:
- restrained corner radii
- clean rectangular grouping
- strong alignment
- repeated panel geometry

Avoid:
- oversized round cards
- random pill usage
- soft dashboard shapes everywhere

Pills are allowed only for:
- mode tags
- status tags
- compact semantic labels

## Spacing Rule

Spacing must be tokenized and repeated.

Preferred spacing set:
- `4px`
- `8px`
- `10px`
- `12px`
- `16px`
- `20px`

Do not use arbitrary spacing values unless the layout truly needs them.

## Scroll Rule

Only these areas may scroll independently:
- library lists
- project lists
- inspector sections when content exceeds height
- bottom tray content
- long JSON/code previews

The stage itself should not create accidental nested scrolling.

## Visual Hierarchy Rule

Priority order on screen:

1. active mode
2. active stage
3. active selection
4. current action
5. supporting metadata
6. archived/secondary information

If a lower-priority block is visually louder than a higher-priority block, the design is wrong.

## Intent Rule For Every Block

Before adding a new UI block, write down:

1. What exact user problem does it solve?
2. In which mode does it belong?
3. Why can it not live in an existing block?
4. Is it primary, secondary, or tertiary?
5. What user action does it directly improve?
6. What clutter or overlap risk does it introduce?

If those answers are weak, the block should not be added.

## Anti-Patterns

These patterns are banned unless there is a strong written reason:

- giant mixed sidebars
- duplicate editors for the same data
- static helper text occupying prime space
- dashboards pretending to be workstations
- too many color accents at once
- overlapping cards with unclear ownership
- panels whose job changes by accident
- controls appearing in multiple places "for convenience"

## Circuit Studio Panel Responsibilities

### Prompt Composer

Owns:
- user prompt text
- generate action
- prompt presets later
- unresolved hint summary later

Does not own:
- project management
- package metadata
- pin editing

### Trusted Library Browser

Owns:
- curated package search/filter
- package quick-select
- package category status

Does not own:
- selected part property editing
- saved projects

### Tool Shelf

Owns:
- current stage tool mode
- tool toggles

Does not own:
- detailed parameters for the current selection

### Selection Inspector

Owns:
- selected object details
- small precise edits
- per-selection runtime/value controls

Does not own:
- project lists
- import queue
- AI pipeline controls

## Component Lab Panel Responsibilities

### Source Import

Owns:
- source file intake
- source type
- import state

### Scene Preview

Owns:
- visible source/normalized scene
- visual anchor overlays

### Correction Inspector

Owns:
- selected pin
- selected node
- alias edits
- snap/anchor corrections

### Export Summary

Owns:
- resulting package metadata
- export readiness
- warnings and missing requirements

## Implementation Guardrails

Before the next UI refactor:
- update the design tokens first
- update the block inventory second
- update layout geometry third
- only then add behavior

Never do this order:
- add a feature
- try to fit it later
- add another panel because it no longer fits

That order created the earlier failures.

## Immediate Correction To Current UI

The current placeholder UI should be treated as structurally temporary.

What must change next:
- replace amber-heavy accenting with a semantic multi-accent system
- reduce visual overlap and decorative panel styling
- tighten block heights and ownership
- remove any panel that does not clearly map to the allowed inventory
- redesign the shell using this document before adding more functionality

## Final Rule

`AURA Studio` must feel like a disciplined electronics workstation with approachable AI help.

It must not feel like:
- a toy
- a generic dark dashboard
- a prototype with every idea visible at once
