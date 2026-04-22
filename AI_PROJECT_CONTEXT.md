# AI Project Context

## Product In One Sentence

AURA Studio is a deterministic AI-assisted circuit builder that turns user intent into editable circuit data using a small trusted component package library.

## Canonical Planning File

The authoritative detailed execution plan is:

- `docs/IMPLEMENTATION_PLAN.md`

## What The Product Must Do

### Circuit Studio

Main workflow:
- accept a user prompt
- produce structured `circuit_intent`
- resolve intent against trusted component packages
- compile deterministic `circuit_ir`
- render an editable circuit
- allow small manual fixes
- export clean circuit JSON

### Component Lab

Support workflow:
- import a real part source
- fix pins
- fix snap points
- fix names and aliases
- fix named visual nodes
- assign optional simple runtime profile
- export `component.json + scene.svg`

### Curated Package Library

This is the runtime truth for the Studio product.

It should be:
- small
- reviewed
- deterministic
- AI-friendly

## Current Strategic Position

The user has already built multiple earlier versions and overexpanded them.

The current restart exists to avoid repeating these mistakes:
- too many systems at once
- AI doing too much implicit repair
- cluttered UI
- giant feature surface before the core flow works
- behavior systems designed before geometry and pin truth were stable

## Correct Technical Framing

### Fritzing

Use Fritzing for:
- breadboard visuals
- schematic visuals
- pcb/icon references
- connector metadata
- part properties and tags

Do not use Fritzing for:
- runtime behavior truth
- simulation semantics
- circuit reasoning semantics

### AURA Runtime Behavior

AURA owns runtime behavior.

Only a few runtime profiles should exist at first:
- `light_output`
- `push_button`
- `toggle_switch`
- `slide_switch`
- `potentiometer`
- `servo_angle`

Everything else should remain static until later.

### AI Strategy

AI should generate:
- `circuit_intent`
- package suggestions
- correction hints

Deterministic systems should handle:
- package resolution
- value normalization
- net building
- placement
- export

## Immediate Product Goal

Win the beginner-circuit use case first.

That means:
- small trusted library
- simple prompt-to-circuit path
- small manual edit surface
- correction-oriented Component Lab

## Not Building Now

- host workflows
- node/locator workflows
- inventory persistence
- broad backend platform features
- generalized AI SVG self-healing as the main product path
- high-resolution display simulation
- full analog/digital simulation platform
