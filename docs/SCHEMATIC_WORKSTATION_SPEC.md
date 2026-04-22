# Schematic Workstation Spec

Date: 2026-04-21

## Purpose

This document freezes the exact desktop workstation model for `Circuit Studio`.

It exists to stop the repeated failure pattern:
- rebuild the UI from scratch
- patch it visually
- discover later that space ownership is wrong
- add more blocks to compensate
- lose the workstation shape again

This is not a style guide.
This is a placement, sizing, and control-count guide for the schematic editor shell.

Read with:
- `docs/UI_SYSTEM_SPEC.md`
- `docs/SCREEN_LAYOUT_MAP.md`
- `docs/BLOCK_WEIGHT_MAP.md`

## Scope

This file covers only:
- `Circuit Studio`
- schematic-symbol workflow
- desktop-first authoring shell

This file does not cover:
- PCB
- simulation panels
- Component Lab
- mobile-first behavior

## Core Rule

The shell must behave like a disciplined schematic workstation:

1. left side finds and places symbols
2. center edits the schematic
3. right side edits the current selection
4. bottom shows secondary support only
5. top shows global state only

No zone may own two primary jobs.

## Allowed Top-Level Zones

Exactly 5 zones are allowed in desktop Circuit Studio:

1. Top Bar
2. Left Rail
3. Center Stage
4. Right Inspector
5. Bottom Tray

No additional floating primary panel is allowed.

## Canonical Desktop Geometry

Use these baseline constants:

- outer padding: `10px`
- shell gap: `10px`
- top bar height: `64px`
- bottom tray height:
  - expanded: `200px`
  - collapsed: `40px`
- left rail width:
  - large desktop: `320px`
  - standard desktop: `300px`
  - tight desktop: `280px`
- right inspector width:
  - large desktop: `360px`
  - standard desktop: `340px`
  - tight desktop: `320px`

Desktop shell height equation:

`work_area_height = viewport_height - (2 * outer_padding) - top_bar_height - bottom_tray_height - (2 * shell_gap)`

Desktop shell width equation:

`work_area_width = viewport_width - (2 * outer_padding) - left_rail_width - right_inspector_width - (3 * shell_gap)`

The center stage always gets:

`stage_width = work_area_width`

`stage_height = work_area_height`

## Baseline Screen Calculations

### 1920 x 1080

Use:
- left rail: `320px`
- right inspector: `360px`
- bottom tray: `220px`

Math:
- horizontal usable width: `1920 - 20 - 30 - 320 - 360 = 1190`
- vertical usable height: `1080 - 20 - 64 - 220 - 20 = 756`

Result:
- stage = `1190 x 756`

### 1536 x 864

Use:
- left rail: `300px`
- right inspector: `340px`
- bottom tray: `180px`

Math:
- horizontal usable width: `1536 - 20 - 30 - 300 - 340 = 846`
- vertical usable height: `864 - 20 - 64 - 180 - 20 = 580`

Result:
- stage = `846 x 580`

### 1440 x 900

Use:
- left rail: `300px`
- right inspector: `340px`
- bottom tray: `200px`

Math:
- horizontal usable width: `1440 - 20 - 30 - 300 - 340 = 750`
- vertical usable height: `900 - 20 - 64 - 200 - 20 = 596`

Result:
- stage = `750 x 596`

## Hard Minimums

Desktop must never let the stage fall below:

- width: `680px`
- height: `520px`

If the layout would go below those values:

1. reduce right inspector width first
2. reduce left rail width second
3. collapse the bottom tray third
4. only after that allow breakpoint behavior

Do not keep full rails and punish the stage.

## Breakpoint Rules

### Large Desktop

Condition:
- viewport width `>= 1600`

Use:
- left `320px`
- right `360px`
- bottom `220px`

### Standard Desktop

Condition:
- viewport width `1366 - 1599`

Use:
- left `300px`
- right `340px`
- bottom `200px`

### Tight Desktop

Condition:
- viewport width `1200 - 1365`

Use:
- left `280px`
- right `320px`
- bottom `180px`

### Compact Authoring

Condition:
- viewport width `< 1200`

Behavior:
- bottom tray defaults collapsed
- only one side rail may be open at once
- stage remains the priority

## Exact DOM Zones

Recommended root structure:

```text
body
  app-shell
    top-bar
    main-shell
      left-rail
      center-stage
      right-inspector
    bottom-tray
```

Recommended left rail structure:

```text
left-rail
  tool-strip
  library-browser
    library-search
    library-list
    symbol-search
    symbol-list
  placement-context
```

Recommended center stage structure:

```text
center-stage
  stage-toolbar-minimal
  schematic-canvas
  stage-status-strip
```

Recommended right inspector structure:

```text
right-inspector
  selection-summary
  selection-properties
  selection-pins-fields
```

Recommended bottom tray structure:

```text
bottom-tray
  tray-tab-bar
  tray-panel
```

## Zone Ownership

### Top Bar

Owns only:
- product identity
- mode
- file/project state
- global actions

Must not own:
- symbol search
- placement tools
- inspector controls
- large status blocks

Visible global actions count:
- `New`
- `Open`
- `Save`
- `Undo`
- `Redo`

That is 5 actions.

Maximum visible top-bar controls:
- 8 total interactive items

### Left Rail

Owns only:
- active stage tools
- library browsing
- symbol selection
- placement entrypoint

Must not own:
- project browser
- selection property edits
- debug JSON
- tray tabs

Left rail internal blocks:

1. Tool Strip
2. Library Browser
3. Placement Context

Height allocation:
- tool strip: `72px` to `96px`
- placement context: `140px` to `180px`
- library browser: all remaining height

### Center Stage

Owns only:
- schematic canvas
- selection visuals
- wire previews
- placement ghost
- small stage readouts

Must not own:
- library browser
- inspector forms
- project tabs
- large dashboards

### Right Inspector

Owns only:
- current selection summary
- current selection properties
- pins and fields

Must not own:
- library browsing
- global settings
- project views
- prompt tools

### Bottom Tray

Owns only secondary support:
- projects
- intent
- IR
- diagnostics

Must not own:
- main tools
- primary inspector fields
- library browser

## Exact Visible Tool Count

The MVP stage tool set must stay at 6 visible tools:

1. `Select`
2. `Place Symbol`
3. `Wire`
4. `Label`
5. `Power`
6. `Delete`

Do not add more visible stage tools until:
- symbol placement is stable
- wire placement is stable
- selection editing is stable

Everything else is hidden or deferred.

## Library Browser Model

The library browser must be list-first, not card-first.

Internal structure:

1. library search
2. library list
3. symbol search
4. symbol list

Do not use:
- category chips
- icon clouds
- tile galleries
- oversized preview cards inside the main browser

The browser is a dense working surface.

Recommended width split inside the left rail:
- library sub-pane: `38%`
- symbol sub-pane: `62%`

## Placement Context Model

This is the only compact summary block under the browser.

It may show:
- selected library
- selected symbol
- preview
- `Add to schematic`

It must not become:
- another browser
- another inspector
- a large help panel

## Center Stage Overlay Budget

Allowed visible overlays:
- one compact stage toolbar row
- one compact status row
- cursor/zoom/grid readout

Overlay rule:
- no overlay may consume more than `56px` height
- no overlay may cover more than `20%` of stage width

No large floating cards are allowed by default.

## Right Inspector Internal Allocation

Use exactly 3 sections:

1. Selection Summary
2. Main Properties
3. Pins and Fields

Suggested height split:
- summary: `96px` to `120px`
- main properties: `45%` of remaining height
- pins and fields: `55%` of remaining height

Pins and fields section may scroll internally.

## Bottom Tray Model

Tray tabs:

1. `Projects`
2. `Intent`
3. `IR`
4. `Diagnostics`

Rules:
- only one tray tab visible at a time
- tray defaults expanded on large and standard desktop
- tray defaults collapsed on compact authoring
- tray content scrolls internally

## Overlap Rules

These are hard bans:

- no floating inspector over the stage
- no floating library over the stage
- no duplicated search inputs in top bar and left rail
- no duplicate selection metadata in left rail and right inspector
- no bottom tray block that duplicates the right inspector
- no primary controls hidden behind decorative cards

## Hidden Surfaces Allowed

These may exist but must be hidden until explicitly requested:

- simulation controls
- advanced wire styling
- import tools
- JSON raw views
- batch replacement tools
- settings
- AI prompt tools
- hotkey help

Hidden is acceptable.
Overlap is not.

## Implementation Order

The next implementation pass must follow this order:

1. implement shell grid and exact zone sizes
2. implement left rail internal split
3. implement right inspector internal split
4. implement bottom tray collapse/expand behavior
5. verify stage minimums at target screen sizes
6. then connect library browser data
7. then connect symbol placement
8. then connect wire behavior

Do not reverse this order.

## Acceptance Checks

The shell is acceptable only if all are true:

- the stage remains the largest visible area
- the left rail contains all browsing
- the right rail contains all selection edits
- the bottom tray is secondary and optional
- no major block overlaps another
- no primary workflow requires page scrolling
- all three target resolutions satisfy the size math above

## Final Rule

The target is not "looks inspired by KiCad".

The target is:
- space discipline like KiCad
- ownership clarity like KiCad
- density without clutter
- no duplicate control surfaces
- no dashboard drift
