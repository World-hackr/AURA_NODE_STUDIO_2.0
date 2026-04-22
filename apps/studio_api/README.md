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
