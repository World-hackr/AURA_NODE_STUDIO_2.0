# Studio API

Thin local/backend API for the Studio restart.

Current responsibilities:
- contract validation
- SQLite migration/bootstrap
- curated package library listing
- circuit project save/load
- KiCad symbol library discovery
- symbol-based schematic project save/load

Current endpoints:
- `GET /health`
- `GET /contracts`
- `GET /ai/providers`
- `GET /ai/models`
- `GET /ai/status`
- `POST /ai/generate-patch`
- `POST /validate/:contractId`
- `GET /database/status`
- `POST /database/migrate`
- `GET /library/packages`
- `GET /symbol-sources/kicad/status`
- `GET /symbol-sources/kicad/libraries`
- `GET /symbol-sources/kicad/libraries/:libraryId`
- `GET /symbol-sources/kicad/libraries/:libraryId/symbols/:symbolId/definition`
- `GET /projects`
- `GET /projects/:slug`
- `POST /projects`
- `GET /schematics`
- `GET /schematics/:slug`
- `POST /schematics`

Keep this service small and deterministic.

## AI Provider Notes

- `Ollama` uses the local Ollama HTTP API at `http://127.0.0.1:11434` by default.
- Override Ollama defaults with:
  - `AURA_OLLAMA_BASE_URL`
  - `AURA_OLLAMA_MODEL`
- `Gemini` uses the Google Gemini REST API.
- Provide the Gemini key either per request from the Studio UI or via:
  - `AURA_GEMINI_API_KEY`
  - `GEMINI_API_KEY`
- Override the default Gemini model with:
  - `AURA_GEMINI_MODEL`
