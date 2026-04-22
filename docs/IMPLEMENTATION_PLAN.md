# Implementation Plan

Date: 2026-03-30

## Purpose

This file is the authoritative build plan for the Studio-only restart.

It exists so the project does not drift back into:
- platform sprawl
- mixed product scope
- AI-overreach
- simulation-first complexity
- cluttered UI

This plan is intentionally practical.
It is ordered by execution priority, not by ambition.

## Product Definition

AURA Studio is a deterministic AI-assisted circuit builder that turns user intent into editable circuit data using a small trusted component package library.

## Scope

### In Scope

- `Circuit Studio`
- `Component Lab`
- curated component package library
- deterministic circuit intent
- deterministic circuit IR
- AI-to-intent generation
- deterministic package matching
- deterministic circuit compilation
- simple runtime preview for selected parts

### Out Of Scope For This Phase

- host firmware
- node/locator system
- phone app
- inventory system
- full analog simulation
- full digital simulation
- MCU code execution
- giant vendor-wide import automation
- broad review/proposal platform features

## Non-Negotiable Rules

1. AI does not produce the final circuit canvas directly.
2. `circuit_ir` is the canonical circuit truth.
3. `component.json + scene.svg` is the canonical package truth.
4. Fritzing is visual/connectivity reference only.
5. AURA owns behavior semantics.
6. Most parts remain static.
7. Component Lab is a correction workflow, not a second full CAD app.
8. Circuit Studio is the main user-facing product.

## The Core Pipeline

Every shipped feature must support this pipeline:

1. user prompt
2. AI generates `circuit_intent`
3. deterministic matcher resolves parts against curated library
4. deterministic compiler creates `circuit_ir`
5. UI renders editable circuit
6. user makes small fixes
7. system exports deterministic data

If a feature does not clearly improve this pipeline, it must be deferred.

## Product Systems

### 1. Circuit Intent Layer

Purpose:
- AI-facing structured representation of what the user wants
- smaller and less rigid than final circuit IR
- safe place for ambiguity and review hints

Required outputs:
- requested parts
- roles
- connection intentions
- value hints
- basic constraints

Must not include:
- final placement geometry
- guessed package internals
- hidden UI repair data

### 2. Circuit IR Layer

Purpose:
- canonical deterministic circuit model
- the source of truth for rendering and export

Required fields:
- components
- package ids
- attrs
- nets
- placements
- labels or annotations

Must be:
- deterministic
- stable
- exportable
- compilable

### 3. Component Package Layer

Purpose:
- reusable reviewed component unit

Shape:
- `component.json`
- `scene.svg`

Required truths:
- metadata
- pins
- aliases
- source provenance
- named scene nodes
- optional runtime profile reference
- optional bindings

### 4. Curated Library Layer

Purpose:
- trusted package set used by AI matcher and Circuit Studio

Rules:
- small first
- reviewed first
- quality over quantity
- no giant raw vendor catalogs in runtime

### 5. Component Lab

Purpose:
- correct imported packages

Allowed tasks:
- import source
- inspect visual source
- fix pin names
- fix pin anchors
- fix snap points
- fix aliases
- fix named scene nodes
- assign optional runtime profile
- export package

Must not become:
- giant authoring sandbox
- simulation lab
- mixed-mode canvas dumping ground

### 6. Circuit Studio

Purpose:
- create circuits from intent and allow small edits

Main tools:
- prompt box
- generate action
- canvas
- package browser
- selected-part inspector
- small edit tools
- import/export

## Behavior Strategy

### Static By Default

These should remain static first:
- resistors
- capacitors
- connectors
- headers
- IC packages
- most modules
- most sensors
- most boards

### Simple Runtime Profiles Only

Initial runtime profile set:
- `light_output`
- `push_button`
- `toggle_switch`
- `slide_switch`
- `potentiometer`
- `servo_angle`

These exist for:
- preview
- user inspection
- teachable semantics

They do not imply full electrical simulation.

### Deferred Runtime Classes

Later only:
- segment displays
- motors beyond simple angle/speed preview
- logic truth models
- analog devices
- programmable devices
- full display rendering

## Why Fritzing Stays Important

Fritzing remains valuable because it gives:
- many parts
- breadboard visuals
- schematic visuals
- pcb/icon references
- connector information
- free source material for correction

But Fritzing does not define:
- trustworthy runtime behavior
- simulation semantics
- final AURA package truth

So the correct model is:

- Fritzing -> import source
- AURA package -> final reviewed product artifact

## Database Plan

Database choice: `SQLite`

Why:
- easiest serious database to learn
- one file on disk
- no extra server
- easy backup and inspection
- strong enough for current scope

Current database tables:
- `component_packages`
- `component_package_revisions`
- `component_aliases`
- `circuit_projects`
- `circuit_revisions`
- `import_jobs`
- `ai_generation_runs`

Database rule:
- keep schema understandable
- use plain SQL
- prefer explicit tables and small stable relationships
- store evolving contract payloads as JSON text until fully stable

## Build Phases

## Phase 0: Foundation Freeze

Goal:
- lock product scope and architecture before writing more feature code

Deliverables:
- root docs
- database docs
- AI project context
- failure-history file
- agent instructions
- contract schemas
- example payloads

Exit condition:
- future sessions can orient without chat history

Status:
- started

## Phase 1: Contract Validation Layer

Goal:
- make the contract files executable instead of decorative

Build:
- JSON schema validation helpers
- package loader for examples
- validation scripts for:
  - `circuit_intent`
  - `circuit_ir`
  - `component_package`
  - `runtime_profile`
  - `library_index`

Deliverables:
- `packages/contracts` validation utilities
- CLI or simple test command to validate sample files

Exit condition:
- schemas are machine-checked locally

## Phase 2: Studio API Skeleton

Goal:
- create the smallest useful backend

Build:
- health endpoint
- schema validation endpoint
- package list endpoint
- circuit project save/load endpoint
- SQLite connection and migration runner

Do not build yet:
- AI compare lab
- proposal review platform
- broad auth system
- cloud sync

Exit condition:
- API can validate and persist basic payloads

## Phase 3: Library Index And Curated Package Loader

Goal:
- make the runtime depend on a trusted library, not raw assets

Build:
- library index loader
- alias normalization
- package metadata reader
- trusted status filtering

Start with:
- 20-30 core parts

First package targets:
- Arduino Uno
- Arduino Nano
- resistor
- capacitor
- red LED
- green LED
- push button
- potentiometer
- servo
- 555 timer
- 74HC595
- HC-SR04
- DHT22
- header strips
- power symbols
- ground and supply symbols

Exit condition:
- system can load curated trusted packages deterministically

## Phase 4: Component Lab Minimal MVP

Goal:
- make package correction practical

UI shape:
- source/import panel
- visual preview
- selected pin/node inspector
- package metadata editor
- export/save controls

Actions:
- load source
- fix names
- fix pin anchors
- fix aliases
- assign runtime profile if justified
- export package

Remove or hide:
- large multi-mode editing systems
- unrelated experimental authoring tools
- duplicate runtime UIs

Exit condition:
- one part can be imported, corrected, and saved cleanly

## Phase 5: AI Intent Generation

Goal:
- AI reliably creates structured intent, not messy final circuits

Build:
- prompt pipeline using `prompts/circuit_intent_generator.system.md`
- intent validator
- unresolved review hints support

Rules:
- AI outputs JSON only
- AI does not choose unsupported packages blindly
- ambiguity stays visible

Exit condition:
- prompt to validated `circuit_intent` works for common beginner requests

## Phase 6: Deterministic Package Matching

Goal:
- map user intent to trusted library packages

Build:
- alias matcher
- exact match rules
- beginner-friendly substitutions
- unresolved result handling

Inputs:
- `circuit_intent`
- curated library index

Outputs:
- matched package candidates
- confidence and reasons

Exit condition:
- system can resolve most core beginner parts deterministically

## Phase 7: Circuit Compiler

Goal:
- convert matched intent into `circuit_ir`

Build:
- reference generation
- net creation
- value normalization
- initial placement strategy
- breadboard/schematic view strategy

Rules:
- deterministic first
- simple layouts first
- no hidden repair state

Exit condition:
- compiler can generate valid `circuit_ir` from matched intent

## Phase 8: Circuit Studio MVP

Goal:
- expose the core user workflow

Main UI:
- prompt entry
- generate action
- canvas
- package panel
- selected-part inspector
- import/export controls

Allowed manual edits:
- move
- rotate
- replace package
- edit value
- delete
- duplicate
- simple wire adjustment

Must not include:
- giant mode matrix
- cluttered helper panels
- duplicate editors
- mixed product concerns

Exit condition:
- user can generate a simple circuit and fix small mistakes manually

## Phase 9: Runtime Preview Layer

Goal:
- make selected parts visually meaningful without full simulation

Initial preview support:
- LED glow
- push button pressed state
- toggle and slide state
- potentiometer angle/value
- servo angle

Rules:
- preview is not electrical proof
- preview uses explicit runtime profiles only

Exit condition:
- preview works for the initial runtime set

## Phase 10: Quality Expansion

Goal:
- expand trust, not chaos

Work:
- add more reviewed packages
- improve match quality
- improve compile quality
- add user correction flows
- improve package import review

Only after success:
- bring in segment displays
- richer previews
- better layout strategies

## Phase 11: Simulation Later

Goal:
- add simulation only after creation and editing are reliable

Possible future layers:
- simple deterministic calculators
- netlist export
- CircuitJS1 bridge
- ngspice adapter

Rule:
- simulation must read the same `circuit_ir`
- simulation must not create a second product model

## UI Rules

Read with:
- `docs/UI_SYSTEM_SPEC.md`

### Circuit Studio

Must feel:
- simple
- focused
- inspectable
- reliable

Must not feel:
- like a developer console
- like a research lab
- like a modal dump

### Component Lab

Must feel:
- like a correction workstation
- like a focused review flow

Must not feel:
- like a giant multipurpose editor
- like a hidden power-user maze

## What To Cut Immediately If It Reappears

- giant sidebars with unrelated tools
- duplicate runtime editors
- speculative behavior systems
- broad backend platform features
- compare-run AI labs
- proposal/revision bureaucracy
- large raw vendor data in runtime bundle
- host/node/inventory features

## Fastest Route To Value

The first commercial-grade win is not “AI does everything.”

The first win is:
- AI creates good `circuit_intent`
- deterministic systems turn that into a trusted editable circuit
- user can correct mistakes easily

That is enough to beat more generic tools in the target use case.

## Milestone Checklist

### Milestone A

- contracts validated
- SQLite schema active
- package loader works

### Milestone B

- 20+ trusted curated packages
- Component Lab can correct and export packages

### Milestone C

- prompt -> valid `circuit_intent`
- deterministic matcher works

### Milestone D

- compiler -> valid `circuit_ir`
- Circuit Studio can render and edit

### Milestone E

- preview runtime works for initial six runtime profiles

### Milestone F

- beginner circuit generation works reliably end-to-end

## Final Rule

Do not broaden the product until:
- Milestone F is real
- users can trust the core flow
- the library is small but dependable

If that core is not strong, more features only create another failed version.
