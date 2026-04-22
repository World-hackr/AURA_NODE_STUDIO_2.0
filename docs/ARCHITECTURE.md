# Architecture

## Main Systems

### 1. Circuit Intent

AI-facing structured request/result layer.

Purpose:
- express user circuit goals
- stay smaller and simpler than final circuit IR
- let the resolver map fuzzy requests into trusted parts

### 2. Circuit IR

Canonical deterministic circuit data.

Must include:
- components
- package ids
- values and attrs
- nets
- placements
- labels and annotations

### 3. Component Package

Reusable reviewed component unit:
- `component.json`
- `scene.svg`

### 4. Component Library

Curated index over trusted packages.

### 5. Component Lab

Correction workflow only:
- import source
- fix names
- fix pins
- fix snap points
- assign optional runtime profile
- export package

### 6. Circuit Studio

Main user workflow:
- prompt
- generate
- inspect
- fix
- export

## Core Rule

AI never paints the final circuit directly.

Correct flow:
- AI -> `circuit_intent`
- resolver -> trusted package matches
- compiler -> `circuit_ir`
- UI renders the result
