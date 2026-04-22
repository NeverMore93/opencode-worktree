# Case: Workspace Metadata Authority

## Status

**Superseded** on 2026-04-14 (spec.md Part 2).

Original Option A was ratified earlier on 2026-04-14 (Part 1) but was
explicitly overridden by the spec rewrite in Part 2 of the same session.

## Question

Where should authoritative workspace-level metadata live for multi-repo
workspace orchestration?

## Constraints Already Agreed

- Directory shape alone is not enough to identify a compatible managed
  workspace.
- Workspace-level session reuse and stale-session rebind require persisted
  metadata.
- The current shipped plugin persists only single-repo state in per-project
  SQLite databases.

## Candidate Options

| Option | Summary | Tradeoff |
| --- | --- | --- |
| A | Global `workspace_registry.sqlite` plus per-project member state | Cleanest separation from legacy single-repo tables; adds one more DB |
| B | Mirror workspace association/session rows into each project DB | Keeps one-DB-per-project discipline; cross-project consistency is harder |
| C | Target-workspace metadata file plus SQLite helper state | Human-visible metadata; authority split across file and DB |

## Original Decision (Part 1)

Use **Option A** — global `workspace_registry.sqlite`.

## Superseding Decision (Part 2)

Use **Option B** — per-project DB only. No global registry in MVP.

Spec Part 2 simplified the storage model:

- Workspace association, workspace member, and workspace-session binding are
  stored in per-project databases keyed by each repo's project ID.
- Workspace membership is reconstructable from per-project records keyed by
  workspace `<name>` and target path.
- No global `workspace_registry.sqlite` is required for MVP.

## Consequences (Updated)

- Simpler deployment: no additional shared database to manage.
- Cross-project workspace identity relies on consistent `<name>` + target path
  keys stored in each per-project database.
- Future versions may revisit Option A if cross-project consistency becomes a
  pain point at scale.
