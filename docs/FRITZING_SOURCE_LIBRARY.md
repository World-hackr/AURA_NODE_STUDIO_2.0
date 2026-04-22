# Fritzing Source Library

This restart now uses Fritzing as the primary visual source base for Component Lab.

The full preserved Fritzing paired library is imported into:

- `vendor_reference/fritzing_paired/`

That local mirror is the working vendor source for:

- visual SVG inspection
- connector metadata
- breadboard/schematic/pcb source views
- named SVG node targeting when available

## Why Fritzing First

For Component Lab, Fritzing is stronger than the current Wokwi extracts because many parts already expose useful SVG structure such as:

- connector ids
- named groups
- named paths such as shafts, housings, or caps
- consistent part metadata via `part.fzp`

That makes it a better base for:

- snap point correction
- pin anchor correction
- named target selection
- pivot/origin assignment
- simple transform bindings owned by AURA

## Important Rule

Fritzing is the visual source, not the behavior truth.

AURA still owns:

- runtime semantics
- target bindings
- pivot/origin data
- corrected package output

## Working Structure

- `vendor_reference/fritzing_paired/`
  Full imported vendor source mirror.
- `library/starter_sources/fritzing/parts/`
  Small selected working subset for quick tests.
- `library/curated_packages/`
  Trusted AURA-reviewed output packages.

## Recommended Next Step

Build Component Lab around Fritzing-first correction:

1. load `part.fzp`
2. load `breadboard.svg`
3. inspect connector anchors and SVG nodes
4. let the user adjust anchors and assign named targets
5. save AURA-side correction data without rewriting vendor source
