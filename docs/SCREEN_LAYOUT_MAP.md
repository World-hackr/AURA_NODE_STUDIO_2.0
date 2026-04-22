# Screen Layout Map

Date: 2026-03-30

## Purpose

This document defines the exact screen responsibilities for the Studio UI.

It exists because having the right blocks is not enough.
The blocks must also be:
- in the right place
- sized by importance
- grouped by purpose
- visible only when they help the current task

This file is the practical companion to:
- `docs/UI_SYSTEM_SPEC.md`

Use this document before resizing, moving, adding, or removing any Studio block.

Read with:
- `docs/BLOCK_WEIGHT_MAP.md`
- `docs/SCHEMATIC_WORKSTATION_SPEC.md`

## Core Rule

Every visible block must answer two questions clearly:

1. Why is this block on screen right now?
2. Why is this block in this zone instead of another one?

If those answers are weak, the block is misplaced.

## Priority Model

All Studio UI blocks must fit one of these levels.

### Level 1: Always Visible

These are the core workflow blocks.
They deserve prime space.

### Level 2: Context Visible

These appear because of:
- current mode
- current selection
- current task

They should not compete with Level 1 blocks.

### Level 3: Secondary Support

These belong in the bottom tray or temporary drawers.

### Level 4: Hidden Until Needed

These should not occupy normal screen space.

## Circuit Studio

The purpose of Circuit Studio is:
- create a circuit from prompt or library
- inspect it
- make small fixes

It is not:
- a general dashboard
- a JSON viewer first
- a debug console

### Zone A: Top Bar

Purpose:
- identify the current product surface
- expose current mode
- show system health
- allow a very small number of global actions

Allowed blocks:
- AURA Studio identity
- mode switch
- API/library status
- save state later

Must not contain:
- prompt editor
- library browser
- selection details
- project browser

Priority:
- Level 1

### Zone B: Left Rail

Purpose:
- user input and circuit-building tools

This rail owns:
1. Prompt Composer
2. Trusted Library Browser
3. Tool Shelf

#### B1. Prompt Composer

Purpose:
- capture or refine the user's request

Owns:
- prompt text
- generate button
- prompt presets later
- model chooser later if still justified

Does not own:
- project loading
- selected part editing
- compile output

Priority:
- Level 1

Recommended height:
- compact but prominent
- large enough for one real prompt
- not large enough to dominate the screen

#### B2. Trusted Library Browser

Purpose:
- add trusted packages or inspect available package choices

Owns:
- package search
- category filter later
- package quick add
- trusted status

Does not own:
- selected package property editing
- project browsing

Priority:
- Level 1

Sizing rule:
- this block can be tall because browsing lists legitimately need scroll

#### B3. Tool Shelf

Purpose:
- set the active editing tool for the stage

Owns:
- select
- move
- rotate
- wire
- replace
- inspect

Does not own:
- detailed tool settings
- selected object properties

Priority:
- Level 2

Sizing rule:
- compact
- never oversized

### Zone C: Center Stage

Purpose:
- the circuit itself

This is the main work area.
It should visually dominate the screen.

Owns:
- placed components
- wiring
- stage navigation controls
- visible selection focus

May also contain:
- small compile overlays
- placement guides

Must not contain:
- stacked dashboards
- long text
- secondary metadata panels

Priority:
- Level 1

Sizing rule:
- largest area on screen
- always larger than any rail

### Zone D: Right Inspector

Purpose:
- edit the current selection only

Owns:
- selected item summary
- value edit
- package replace
- orientation
- part-specific properties
- runtime preview controls later if justified

Must not own:
- prompt controls
- library browser
- global settings
- project list

Priority:
- Level 2

Sizing rule:
- narrower than the left rail if possible
- dense and precise
- scrollable internally

### Zone E: Bottom Tray

Purpose:
- hold secondary information that supports the main workflow

Allowed tabs:
- projects
- intent
- IR
- imports
- diagnostics later only if still justified

This zone owns:
- project browsing
- project snapshots
- generated intent preview
- IR preview
- import logs later

Must not own:
- main prompt actions
- selection editing
- main library controls

Priority:
- Level 3

Sizing rule:
- fixed height
- useful but visually quieter than the main shell

## Component Lab

The purpose of Component Lab is:
- import a source part
- correct it
- export a clean package

It is not:
- a second CAD product
- a giant experimental editor

### Zone A: Top Bar

Same global role as Circuit Studio.

Only mode-specific difference:
- status may reference current import/export state

### Zone B: Left Rail

Purpose:
- define the correction session

This rail owns:
1. Source Import
2. Package Structure
3. Correction Tool Shelf

#### B1. Source Import

Purpose:
- start or change the source artifact under correction

Owns:
- source type
- import action
- import session state

Does not own:
- detailed node edits
- export summary

Priority:
- Level 1

#### B2. Package Structure

Purpose:
- remind the user what the output package is made of

Owns:
- `component.json`
- `scene.svg`
- runtime profile presence later
- source provenance summary

Does not own:
- source preview itself
- selected pin/node details

Priority:
- Level 2

#### B3. Correction Tool Shelf

Purpose:
- switch correction lane

Owns:
- select
- pin
- node
- alias
- runtime
- export

Does not own:
- actual detail editing fields

Priority:
- Level 2

### Zone C: Center Stage

Purpose:
- compare source and normalized result visually

Owns:
- source preview
- normalized scene preview
- anchors
- nodes
- correction overlays

Must not contain:
- long prose
- metadata forms
- project browsing

Priority:
- Level 1

### Zone D: Right Inspector

Purpose:
- show and edit the currently selected correction target

Owns:
- selected pin/node
- anchor data
- alias edits
- metadata edits
- runtime assignment
- export readiness

This zone is denser than the Circuit Studio inspector.

Priority:
- Level 2

### Zone E: Bottom Tray

Purpose:
- hold source notes, package previews, and warnings

Allowed tabs:
- imports/jobs
- source notes
- package JSON preview
- scene/bindings preview

Priority:
- Level 3

## What Is Too Big Right Now

These are the usual reasons a block becomes too large incorrectly:

1. it is filling empty space without deserving it
2. it is showing secondary data in a prime zone
3. it is large only because it can scroll
4. it mixes multiple jobs in one box

That must be corrected by purpose first, not by cosmetic shrinking.

## Sizing Rules By Block Type

### Prompt/Input Blocks

Should be:
- clearly visible
- moderately tall
- not dominant

### Browser/List Blocks

Can be tall if:
- they are true browsing surfaces
- they scroll internally

### Inspector Blocks

Should be:
- compact
- dense
- split into clear subsections

### JSON/Code Preview Blocks

Should be:
- pushed to tray by default
- never take prime stage space
- shown only when explicitly useful

### Status Blocks

Should be:
- small
- precise
- never treated like feature panels

## Visibility Rules

### Always Visible In Circuit Studio

- top bar
- prompt composer
- library browser
- tool shelf
- stage
- inspector
- tray tabs

### Selection-Dependent In Circuit Studio

- detailed property groups
- runtime controls
- package-specific edit rows

### Tray Only In Circuit Studio

- project browser
- intent JSON
- IR JSON
- import logs

### Always Visible In Component Lab

- top bar
- source import
- package structure
- correction tool shelf
- source/normalized preview stage
- correction inspector
- tray tabs

### Tray Only In Component Lab

- import logs
- source notes
- package previews
- binding previews

## Tool Ownership Summary

### Circuit Studio

- Left:
  input + build tools
- Center:
  circuit itself
- Right:
  selected object edits
- Bottom:
  supporting data

### Component Lab

- Left:
  import setup + correction modes
- Center:
  visual comparison and anchors
- Right:
  correction details and export readiness
- Bottom:
  package previews and logs

## Refactor Rule

When reorganizing the current UI:

1. move blocks to the correct zone first
2. remove duplicated or weak blocks second
3. resize by importance third
4. restyle after the structure is correct

Do not do styling first when the block ownership is still wrong.

## Immediate Next Refactor Target

The current UI should be adjusted using this order:

1. shrink or simplify any oversized non-primary block
2. move JSON-heavy content deeper into the tray
3. make the left rail strictly input/build only
4. make the right rail strictly selection/correction only
5. let the center stage dominate visually

## Final Rule

The user should be able to look at the screen and immediately know:

- left side: what I can do
- center: what I am working on
- right side: what is selected
- bottom: supporting information
