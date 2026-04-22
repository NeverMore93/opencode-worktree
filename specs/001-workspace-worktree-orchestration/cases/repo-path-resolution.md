# Case: repoPath Resolution For Non-Repo Paths

## Status

Open.

## Question

How should `worktree_create.repoPath` resolve when the input path is local and
path-safe but is not itself a git-repo root?

## Constraints Already Agreed

- `repoPath` may be relative or absolute.
- `repoPath` may point to any local path and is not limited to an existing repo
  root.
- Path-safety validation must pass before mutation.
- The implementation MUST avoid ambiguous or implicit repo selection.

## Problem

The current spec allows container-like paths, but it does not yet define how to
derive one unique `resolved_repo_root` from those paths.

## Candidate Directions

| Option | Summary | Tradeoff |
| --- | --- | --- |
| A | Require the path to resolve upward to exactly one repo root | Simple rule; may reject common workspace-container paths |
| B | Allow a container directory only when it contains exactly one direct child repo | Friendly for wrappers; still ambiguous for multi-repo containers |
| C | Accept any path but require an additional explicit repo identifier when the path is not a repo root | Most explicit; expands tool contract |

## MVP Relevance

This case applies only to the legacy `worktree_create` tool's optional
`repoPath` parameter. The MVP `/dev <name>` command auto-detects repos from
`<cwd>` children and does not use `repoPath`.

Resolution of this case is **not blocking** for MVP implementation but remains
open for the legacy tool's headless SDK workflow (spec User Story 3).

## Current Recommendation

No implementation recommendation is locked yet.

The requirement before implementation is narrower:

- the repo-root resolution rule MUST be made explicit
- ambiguous container directories MUST be rejected rather than guessed
