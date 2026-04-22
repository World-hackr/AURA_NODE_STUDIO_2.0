# Database

## Choice

Use `SQLite`.

This is the easiest serious database for the current project stage.

Why it fits:
- single local file
- no separate server to learn first
- SQL is visible and teachable
- migrations can stay as plain `.sql` files
- easy later path to PostgreSQL if needed

## What The Database Stores

The database is only for Studio-side persistence.

It stores:
- reviewed component packages
- package revisions
- package aliases for AI lookup
- circuit projects
- circuit revisions
- import jobs
- AI generation runs

## What It Does Not Store Yet

- host data
- node data
- inventory data
- phone sync state

## Learning Rule

Keep the database simple:
- plain SQL first
- small number of tables
- text JSON blobs where structure is still evolving
- normalize only stable relationships

## Main File

Local database file should be:

`database/aura_studio.db`

That file is ignored by git.
