# Database Folder

This folder contains the Studio database setup.

Files:
- `schema.sql`
  Full readable schema
- `migrations/0001_init.sql`
  First migration
- `migrations/0002_symbol_schematic.sql`
  Adds symbol-schematic project storage

Local runtime database:
- `aura_studio.db`

## Current Rule

Keep migrations as plain SQL.
Do not hide the database shape behind heavy tooling yet.
