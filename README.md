# AURA Node Studio

Fresh restart for the Studio-side AURA product.

Current scope:
- `Circuit Studio`
- `Component Lab`
- curated component package library
- deterministic circuit IR
- AI generation pipeline

Out of scope for now:
- host hardware
- node/locator system
- phone app
- inventory backend
- full simulation platform

## Workspace Shape

- `apps/studio_web/`
  Main browser app for Circuit Studio and Component Lab.
- `apps/studio_api/`
  Small local/backend API for AI requests, validation, and package/circuit persistence.
- `packages/contracts/`
  Shared JSON schemas and contract docs.
- `packages/circuit_ir/`
  Canonical circuit intent and circuit IR references.
- `packages/component_library/`
  Curated package metadata and library indexing rules.
- `library/curated_packages/`
  Reviewed `component.json + scene.svg` package artifacts.
- `vendor_reference/fritzing_paired/`
  Full local Fritzing source mirror for Component Lab correction work.
- `database/`
  SQLite schema, migrations, and local database notes.
- `docs/`
  Product, architecture, and roadmap docs.

## Database Choice

This restart uses `SQLite`.

Why:
- easiest serious database to learn
- one file on disk
- simple backup story
- easy to inspect manually
- good enough for the current Studio-only phase

Read:
- `docs/DATABASE.md`
- `docs/UI_SYSTEM_SPEC.md`
- `docs/SCREEN_LAYOUT_MAP.md`
- `docs/BLOCK_WEIGHT_MAP.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `database/schema.sql`
- `database/migrations/0001_init.sql`

## Quick Start

Requirements:
- Node.js 24 or newer
- `npm`

Install once from the repo root:

```bash
npm install
```

Run the API in one terminal:

```bash
npm run dev:api
```

Run the web UI in a second terminal:

```bash
npm run dev:web
```

Open the UI at:

```text
http://127.0.0.1:5173
```

The web app expects the API at:

```text
http://127.0.0.1:8787
```

Production build for the current web shell:

```bash
npm run build:web
```
