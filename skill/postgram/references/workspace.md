# Workspace tracking: commands and the consolidate procedure

Read this when the work is about features, worktrees, stages or pull
requests. The model and the rules are in [SKILL.md](../SKILL.md); this file
gives the calls.

## What each transport can do

The MCP server cannot see the user's filesystem. It can read and change
what Postgram knows: features, stages, PRs and links. Everything that
inspects or changes a worktree needs the CLI on that machine.

| Need | CLI | MCP tool |
|------|-----|----------|
| Overview by stage | `pgm where` | `where` |
| Human to-do list | `pgm where --actions` | `where` with `view: actions` |
| Feature of this directory | `pgm here` | `workspace_lookup` |
| Create a feature | `pgm feature add "<title>"` | `task_create` with `metadata.kind: feature` |
| Link/unlink a workspace | `pgm feature link <id> [--path <dir>]` / `pgm feature unlink` | `workspace_link` (`feature_id: null` unlinks) |
| Set a stage | `pgm feature stage <id> <stage>` | `feature_stage` |
| Attach a PR | `pgm feature pr <id> <url> [--state merged]` | `feature_pr` |
| New worktree for a feature | `pgm worktree new <feature> [--create]` | — |
| Bootstrap existing worktrees (human) | `pgm scan --root <dir> [--dry-run]` (interactive, needs a terminal) | — |
| Inventory worktrees (agent) | `pgm scan --json` | — |
| Apply an approved plan | `pgm scan --apply plan.json [--dry-run]` | — |
| Follow PR state on GitHub | `pgm feature sync [id]` (needs `gh`) | `feature_pr` per changed PR |
| Finish a feature | `pgm feature done <id>` | `task_complete` |
| Remove a clean worktree | `pgm worktree rm <path>` | — |
| Remove registrations of gone directories | `pgm workspace prune [--dry-run]` | `workspace_delete` (delete scope) |

`pgm scan` asks per worktree; run it in the user's terminal, not from an
agent without a TTY. Use `--yes-exact` to accept only marker and short-id
matches without prompts.

`workspace_report` registers a machine, workspace and session. The hooks
(`pgm hooks install`) call it for you; do not call it by hand when the hooks
are installed.

## The steps, per transport

- **"Where was I?" / "what needs me?"** `pgm where` or `where`. For the
  to-do list: `pgm where --actions` or `where` with `view: actions`.
- **Starting new work.** Find the feature with `pgm search` / `search` or in
  the overview. With the CLI, `pgm worktree new <feature> [--create]`
  creates the branch and worktree, writes the marker and registers the
  workspace. Over MCP alone you can create the feature
  (`task_create` with `metadata.kind: feature`) but not the worktree.
- **Opening a PR.** `pgm feature pr <id> <url>` or `feature_pr`.
- **PR merged.** `pgm feature pr <id> <url> --state merged`, or `feature_pr`
  with `state: merged`. A repo releases on merge after
  `pgm repo set <remote> --release-on-merge true`.
- **Manual stage moves.** `pgm feature stage <id> <stage>` or
  `feature_stage`.

MCP examples:

```
where { "view": "actions" }
workspace_lookup { "machine": "codebox-vm", "path": "/home/dev/workspace/postgram" }
feature_pr { "id": "<feature-id>", "url": "https://github.com/acme/app/pull/42", "state": "merged" }
feature_stage { "id": "<feature-id>", "stage": "functional_test" }
workspace_link { "workspace_id": "<workspace-id>", "feature_id": "<feature-id>" }
```

## Consolidate: "clean up my projects"

Use this when the user asks to get an overview, consolidate or clean up their
projects on a machine. Work in three passes and stop after the second for
approval. Do not hand-roll git discovery and do not call `pgm feature link`
per worktree.

This procedure needs the CLI on the machine that holds the worktrees. If you
only have MCP tools, give the overview with `where`, propose stage and PR
changes from it, and tell the user that the inventory and cleanup of
worktrees must run from an agent with a shell on that machine.

1. **Inventory (read-only).** Run `pgm scan --json` (roots come from
   `scan_roots` in `~/.pgmrc`; pass `--root <dir>` otherwise, often
   `~/workspace`). It lists every worktree with repo remote, branch, last
   commit date and subject, dirty and unpushed state, the link Postgram
   already has and candidate features. It sends nothing and needs no
   terminal. Add `pgm where --all --json` for features without workspaces and
   `gh pr list --head <branch> --state all` where the PR decides the action.
   Run `pgm feature sync` first so PR states and stages are current.
2. **Proposal.** Show one table, one row per worktree: path, branch, last
   activity, risks, and the proposed action:
   - link to an existing feature (give its short id),
   - new feature (give the title),
   - skip,
   - remove (merged or closed PR, no unique commits, or a throwaway
     worktree).
   Also propose a stage per feature, derived from its PR (open → `review`,
   merged → `awaiting_release` or `released`), and which features are
   finished (`pgm feature done`). Group large sets of the same kind (for
   example hundreds of review worktrees from one tool) into one row with a
   count and one decision. Mark rows you are unsure about and ask about
   those; do not guess.
3. **Apply what the user approved.**
   - Write the approved links, new features and skips to a plan file and run
     `pgm scan --apply plan.json --dry-run`, then without `--dry-run`. The
     plan is `{"entries": [{"path", "action": "link", "feature_id"} |
     {"path", "action": "create", "title"} | {"path", "action": "skip"}]}`.
     One invalid entry rejects the whole plan; fix it and rerun.
   - `pgm feature pr <id> <url> [--state merged]` and `pgm feature stage` where
     a PR does not settle the stage; `pgm feature done <id>` for finished
     features.
   - `pgm worktree rm <path>` for approved removals. It refuses dirty files and
     unpushed commits and has no force flag; report the refusal instead of
     working around it. Never run `git worktree remove --force`.
   - `pgm workspace prune --dry-run`, then `pgm workspace prune`, for
     registrations whose directory is gone.
   - If a directory such as the workspace root got registered, add it to
     `ignore_paths` in `~/.pgmrc` and run `pgm workspace prune --ignored`.
   End with `pgm where` so the user sees the result.

Links are per machine: `pgm scan` links paths on the machine where it runs.
For another machine, run each pass there (or over `ssh <connect_target>`),
one machine at a time.
