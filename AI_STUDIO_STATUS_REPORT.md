# AURA Node Studio Status Report

Updated: 2026-04-24

## Purpose

This file is the current Studio-side handoff summary. It complements `AI_CONTINUITY_LOG.md` by keeping the durable product state, what is already solid enough to build on, and what should happen next.

## Product Scope

Active scope:
- Circuit Studio
- Component Lab
- curated package library
- deterministic `circuit_intent -> resolver -> circuit_ir` flow
- AI-assisted generation and editing

Out of scope:
- host firmware
- node/locator work
- phone app
- inventory backend
- simulation-first platform work

## Current Product Rule

Everything in the repo should support this flow:
1. user intent
2. AI produces structured `circuit_intent` or editing intent
3. deterministic resolver/compiler maps to trusted packages and `circuit_ir`
4. Studio renders editable circuit data
5. user makes small fixes
6. system exports deterministic data

AI is not allowed to paint final truth directly. Final circuit/package/pin truth stays in deterministic Studio systems.

## What Has Been Achieved

### 1. Core Studio Shell Is Stable Enough To Build On

The current web app can:
- open and run reliably with the local API
- import and render structured circuit data
- edit components, wires, and junctions on canvas
- preserve history/state through the existing editor flow
- export deterministic scene state for AI/tooling use

The editor now has a workable baseline for:
- panning
- selection scopes
- marquee selection
- wire interaction
- preview/apply flows

### 2. Library/Browser UI Was Restructured

The component browser is no longer a single overgrown left column.

What is now in place:
- simpler search vs browse structure
- improved symbol browsing flow
- better preview docking
- better mode clarity
- more usable quick access to package/symbol lookup

This is not the final information architecture, but it is no longer blocking the main Studio workflow.

### 3. Deterministic AI Editing Foundation Exists

Structured AI-related contracts now exist for:
- `scene_state.v1`
- `layout_intent.v1`
- `circuit_patch.v1`
- `circuit_intent.v1`
- `circuit_ir.v1`

The backend can now:
- validate structured AI payloads
- convert `layout_intent` into deterministic patch geometry
- keep AI patch/chat history in SQLite
- expose AI provider status/models
- run normal AI chat
- run patch generation
- run first-pass circuit generation

### 4. First Deterministic Circuit Generation Path Exists

The app now has a real backend path for:

`prompt -> circuit_intent -> trusted package resolution -> circuit_ir`

What is implemented:
- new circuit pipeline module
- deterministic fallback intent generation
- trusted package resolution against the curated library
- `circuit_ir` compilation
- API route: `POST /ai/generate-circuit`
- frontend import of generated `circuit_ir` directly onto the canvas

This is the first real version of the intended product loop.

### 5. Package/Contract Reliability Improved

Completed:
- added missing `led_red_5mm` to the curated library index
- added `layout_intent.v1` to contracts and examples
- fixed concurrent validator initialization in contracts
- tightened Gemini status reporting so missing selected models are not reported as ready

### 6. SQLite Reliability Was Repaired

Completed:
- recovered the database from journal failure state
- switched to WAL mode
- added safer transaction rollback behavior
- verified `integrity_check = ok`
- confirmed database status endpoint works again

The current database state is usable for continued Studio-side AI/context work.

## Current Runtime Surfaces

### API

Stable routes relevant to the current product:
- `/health`
- `/database/status`
- `/database/migrate`
- `/library/packages`
- `/ai/providers`
- `/ai/models`
- `/ai/status`
- `/ai/chat`
- `/ai/generate-patch`
- `/ai/generate-circuit`
- `/ai/context`
- `/ai/context/memory`

### AI Modes Implemented

1. Normal chat
- AI sees conversation plus retrieved project context
- returns assistant text only

2. Patch generation
- AI sees conversation, scene state, selection/layout summary, allowed symbol keys, and retrieved project context
- returns `message`, `patch`, and optional `layoutIntent`

3. Circuit generation
- AI sees user prompt plus a simplified curated package list
- returns `circuit_intent`
- backend then resolves/compiles deterministic outputs

## Known Limitations

### 1. Circuit Generator Still Sees Too Little

The circuit-generation model currently sees:
- user prompt
- only the simplified curated package list

It does not yet see:
- full package details
- pin maps
- resolver feedback
- unresolved-item feedback
- compiler failure reasons
- repair-loop state

This is the main reason current generation quality caps out quickly.

### 2. Board Rendering Is Still Incomplete

The generated Arduino example is semantically closer to correct than it looks, but the frontend still maps Arduino to a connector-style proxy.

Current consequence:
- the backend may resolve an Arduino package
- the UI may still show a simplified connector symbol

So visible output currently understates what the backend resolved.

### 3. AI Loop Is Still Too Thin

The project now has the first deterministic AI pipeline, but not yet the full multi-step loop.

Missing next-stage pieces:
- explicit resolver report surfaced to AI
- unresolved-item repair pass
- compile-review-repair loop
- render substitution reporting
- stronger explainability in the UI

### 4. The Repo Still Contains Out-of-Scope Firmware Work

There is unrelated firmware/host work present in the working tree. That should not drive current Studio design decisions and should not be mixed into Studio commits by accident.

## Verification Snapshot

Verified during the current Studio stabilization work:
- contracts validation passes
- API syntax checks pass
- web syntax checks pass
- web production build passes
- database status works
- SQLite integrity check is clean
- AI generate-circuit route returns valid `circuit_intent` and `circuit_ir`

## What Should Happen Next

### Immediate Next Goal

Strengthen the AI toolchain around the model before expanding model ambition.

That means:
1. enrich what circuit-generation AI can see
2. expose deterministic resolver/compiler feedback
3. add review/repair loops
4. improve board/package rendering fidelity

### Concrete Next Work Items

#### A. Expand AI-Visible Context

Add structured context for:
- full trusted package metadata
- pin definitions and role hints
- resolver candidates
- unresolved roles
- unresolved connections
- compiler validation feedback
- render substitutions/proxies

#### B. Add Deterministic Intermediate Reports

Introduce stable machine-readable reports for:
- `resolver_result`
- `unresolved_parts`
- `unresolved_connections`
- `compiler_validation`
- `render_report`
- `final_summary`

#### C. Add A Multi-Step AI Loop

Target flow:
1. parse prompt into `circuit_intent`
2. resolve against trusted packages
3. inspect unresolved/ambiguous items
4. run AI repair or clarification pass
5. compile `circuit_ir`
6. inspect compile/render validation
7. return final result plus explanation

#### D. Fix Board Rendering Contracts

A resolved board package should not silently collapse into a generic connector representation without the UI making that explicit.

#### E. Keep The System Deterministic

Maintain this boundary:
- AI may propose intent, preferences, and repairs
- engine owns package truth, pin truth, net truth, compile truth, and export truth

## Recommended Working Rule For Future Changes

When choosing the next feature, prefer:
- better deterministic contracts
- better AI/tool feedback loops
- better trusted-library quality

Avoid:
- broad platform sprawl
- simulation-first detours
- firmware work mixed into Studio milestones
- relying on bigger models before the toolchain is strong enough

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
