# AURA Node Studio Status Report

Updated: 2026-04-22

## Purpose

This file is a durable handoff and status summary for future work by Codex, Gemini, or any other assistant operating inside this workspace. It complements `AI_CONTINUITY_LOG.md` by summarizing the bigger picture, current behavior, important design decisions, and known gaps.

## Product Scope

Current active scope in this repo:
- Circuit Studio
- Component Lab
- curated package library
- deterministic circuit intent -> circuit IR -> Studio flow
- AI-assisted circuit generation and editing

Out of scope right now:
- host firmware
- phone app
- node/locator platform
- inventory backend
- full simulator-first platform

## Core Product Rule

Everything should support this flow:
1. user intent
2. AI produces structured circuit intent or patch
3. deterministic resolver/compiler maps to trusted packages and circuit IR
4. Studio renders an editable circuit
5. user makes small fixes
6. export deterministic data

This means AI should not freely paint the final circuit. AI should read structured state and emit structured intent or patch data that Studio validates before apply.

## Major Work Completed So Far

### 1. Import Modal and Import Flow

Completed:
- fixed the JSON import modal appearing open by default
- fixed modal close behavior
- made `Apply To Canvas` close the modal immediately after successful JSON parse
- removed hidden import-time autorouting from JSON apply
- import now places raw components, junctions, and wires directly
- added viewport auto-fit after import so the imported sketch is visible without manual zoom-out

Current import behavior:
- `Load Example` fills the modal text area
- `Apply To Canvas` parses JSON, closes the modal, places the scene, fits the viewport, updates history, and redraws
- import no longer pretends to produce final routed wiring

Important file:
- `apps/studio_web/js/main.js`

### 2. Canvas Navigation and Selection

Completed:
- fixed the regression where a modal overlay blocked panning
- changed empty-stage drag behavior so panning works normally
- added `SEL` toggle for explicit marquee mode
- added `PART / WIRE / BOTH` selection scopes
- fixed marquee rendering so the box actually appears while dragging
- improved multi-select behavior
- improved selected wire visibility with stronger green highlighting

Current interaction rules:
- `SEL` on: left drag marquee-selects
- `SEL` off: left drag pans
- `Shift+drag`: one-off marquee select
- repeated hit cycling in `BOTH` mode can distinguish overlapping body and wire targets

Important files:
- `apps/studio_web/js/main.js`
- `apps/studio_web/index.html`
- `apps/studio_web/css/main.css`

### 3. Wire Autoroute Work

Completed:
- added selected-wire autoroute action
- added capped batch autoroute behavior
- improved UI progress feedback for multi-wire autoroute
- reduced autoroute working set to local nearby geometry instead of scoring against the entire canvas for every selected wire

Current status:
- autoroute is still heuristic, not globally optimal
- it is good enough for bounded local use, but not the final routing architecture
- import no longer autoroutes automatically
- explicit autoroute is still the right place for heavier routing work

Important routing limitation:
- this is not yet a full libavoid-style incremental router
- monotonic cleanup and a more formal bridge / routing architecture are still future work

Important files:
- `apps/studio_web/js/main.js`
- `apps/studio_web/js/routing.js`

### 4. Wire Jump / Bridge Rendering

Completed:
- fixed several regressions around jump visibility
- replaced the old preview-vs-committed mismatch with a unified live crossing resolver
- jump arcs now render from current route geometry using stored jump points only as hints
- fixed the bug where jump arcs disappeared after completing a wire to a pin because preview and committed wires used different logic
- added a wider fallback search so jumps do not disappear as easily when a connected component is moved farther than before
- included pin lead stubs in jump-reference geometry so visual overlaps near exposed pins are more realistic

Current status:
- jump arcs are now much more stable
- if a crossing moves, the arc can follow
- if a crossing disappears, the arc can disappear
- this is functionally closer to a bridge-manager model than the earlier stale stored-point model

Known caveat:
- pin stubs are used in bridge / overlap logic, but not yet fully treated as wire semantics everywhere in the editor

Important files:
- `apps/studio_web/js/main.js`
- `apps/studio_web/js/routing.js`

### 5. Wire-to-Wire Attachment / Junction Tapping

Completed on 2026-04-22:
- added support for starting a wire from an existing wire segment by clicking the wire in wire mode
- added support for completing a wire onto an existing wire segment by clicking the wire in wire mode
- this works by projecting the click onto the nearest rendered wire segment, splitting that wire at the projected point, creating a junction, and then using that junction as the start or completion endpoint

Current behavior:
- wire tool + click on existing wire with no active wire: split wire, create junction, start new wire from that junction
- wire tool + active wire + click on existing wire: split target wire, create junction, complete current wire to that junction

Important file:
- `apps/studio_web/js/main.js`

### 6. Component Body-Only Selection

Completed:
- component selection hit testing now prefers body-only bounds derived from symbol graphics
- box selection also uses body bounds instead of the larger pin-inclusive area

Current rule:
- component body is for selection and dragging
- pin stubs are not the component selection target

Important caveat:
- user still wants broader pin-stub-as-wire semantics in more places, but that work was deferred

Important file:
- `apps/studio_web/js/main.js`

## AI Direction Agreed in Discussion

The next major feature direction is AI.

There are two desired AI modes:

### A. Built-In AI

Goal:
- user chats inside Studio
- AI reads the current circuit state
- AI proposes or produces structured changes
- Studio validates and applies them

Important requirement:
- AI should understand the current canvas through structured scene state, not only screenshots

The AI should be able to read:
- components
- wires
- junctions
- placements and rotations
- route points
- selection context
- connectivity summary
- layout / bounds summary

### B. Prompt Pack for External Free AI

Goal:
- user writes a request in Studio
- Studio generates a strict prompt package
- user pastes that prompt to a free external AI such as ChatGPT, Gemini, Claude, or similar
- external AI returns JSON
- user pastes the JSON back into Studio
- Studio validates and imports it

This path is important because:
- the user does not currently have API billing / card access
- it provides a free-user mode
- it is also a good development and testing harness for the future built-in AI

## Recommended AI Contract

These schemas should be defined before deeper AI implementation:

### 1. `scene_state.v1`

Read-only state from Studio to AI.

Should include:
- components
- wires
- junctions
- route geometry
- net labels
- current selection
- canvas bounds / viewport summary
- connectivity summary

### 2. `circuit_patch.v1`

Structured write format from AI to Studio.

Should allow:
- add / update / remove components
- add / update / remove wires
- add / update / remove junctions
- move / rotate parts
- preserve untouched ids when possible

### 3. `prompt_pack.v1`

Studio-generated external-AI prompt package.

Should include:
- user request
- allowed component catalog
- current scene state if editing an existing circuit
- strict output schema rules
- no-markdown / JSON-only final output requirements
- deterministic formatting rules

## Determinism Rules for AI

Strongly recommended:
- AI outputs valid JSON only
- no prose in the final payload
- use only allowed symbols / packages
- preserve existing ids where possible
- stable ordering of arrays and objects
- Studio validates before apply
- Studio rejects ambiguous or invalid structures rather than guessing too much

## Current Open Issues / Deferred Items

### Deferred: Pin Stub as Full Wire Semantics

The user still wants stronger pin-stub-as-wire behavior.

What is already done:
- pin stubs participate in jump / bridge reference geometry

What is not fully done:
- pin stubs behaving like full wire semantics everywhere the user expects
- examples may include routing, overlap ownership, or future autoroute behavior beyond current bridge logic

Status:
- deferred for now

### Deferred: Better Formal Autorouting

Still needed long-term:
- monotonic routing cleanup
- cleaner local repair model after part moves
- less heuristic zig-zag behavior
- more formal local obstacle graph approach
- potentially libavoid-style incremental routing architecture

Status:
- partially improved, not complete

## Important Local Files To Know

Primary Studio implementation:
- `apps/studio_web/js/main.js`
- `apps/studio_web/js/routing.js`
- `apps/studio_web/index.html`
- `apps/studio_web/css/main.css`

Project continuity:
- `AI_CONTINUITY_LOG.md`
- `AI_FAILURE_HISTORY.md`
- `AI_PROJECT_CONTEXT.md`

Architecture and product context:
- `README.md`
- `WORKSPACE_GUIDE.md`
- `docs/PRODUCT_SCOPE.md`
- `docs/ARCHITECTURE.md`
- `docs/DATABASE.md`

Sibling reference app used for comparison:
- `..\AURA Node Studio_1\studio_ui\src\components\Canvas.tsx`

## Practical Next Steps

Recommended order from here:
1. define `scene_state.v1`
2. define `circuit_patch.v1`
3. build `prompt_pack.v1` generator for free external AI workflow
4. add validator / preview-apply flow for AI-generated JSON or patches
5. later connect the built-in AI when API access is available

## Notes for Future Assistants

Be careful about these product rules:
- keep the system deterministic
- do not let AI directly paint uncontrolled final circuits
- do not add speculative platform sprawl
- keep import fast and routing explicit
- preserve body-only selection unless the user explicitly asks to revisit that rule
- append every assistant turn in this workspace to `AI_CONTINUITY_LOG.md`
