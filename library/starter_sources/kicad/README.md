# KiCad Starter Source

This folder is the workspace-local entry point for KiCad symbol libraries.

It now contains a raw checked-in copy of the KiCad symbol libraries for this
workspace restart.

Current approach:
- `raw/`
  Raw copied KiCad `.kicad_sym` files from the local KiCad install
- `source_config.json`
  Declares that this workspace prefers the local raw copy first
- `library_index.json`
  Generated index of the available KiCad symbol libraries

Current files:
- `raw/`
  Raw KiCad symbol libraries copied into the repo
- `source_config.json`
  Defines how this workspace finds the KiCad symbol source
- `library_index.json`
  Generated index of available KiCad symbol libraries in the selected source dir

Refresh the index from the repo root:

```bash
npm run sync:kicad-library
```
