# Fritzing Paired Library

This is a derived working folder built from:

- `vendor_reference/fritzing_official/fritzing-parts`

Purpose:

- keep each Fritzing part definition (`.fzp`) together with the SVG views it uses
- make import and correction work easier in `Component Lab`
- avoid mutating the official cloned Fritzing library

Layout:

- `parts/<moduleId>/part.fzp`
- `parts/<moduleId>/breadboard.svg`
- `parts/<moduleId>/schematic.svg`
- `parts/<moduleId>/pcb.svg`
- `parts/<moduleId>/icon.svg`
- `parts/<moduleId>/part.meta.json`
- `index.json`

Notes:

- not every part has every view
- `part.meta.json` records copied and missing views plus connector summaries
- rebuild this folder with:
  - `node local_tools/fritzing_tools/build_paired_library.mjs`
