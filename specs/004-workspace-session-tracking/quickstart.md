# Quickstart: Workspace & Agent-Session Tracking

This guide gets you from scattered sessions on three machines to a single `pgm where`.

## 1. Server

Deploy a Postgram build that contains migration `018_workspace_tracking.sql`. Migrations run on boot.

The dormancy threshold is optional and defaults to 30 days:

```bash
WORKSPACE_DORMANT_AFTER_DAYS=30
```

## 2. Every machine (Mac, codebox, strongbad)

```bash
npm i -g @ivotoby/postgram-cli@latest
pgm machine set --alias codebox --connect codebox   # ssh host alias usable from your other machines
pgm hooks install                                    # Claude Code hooks; review the diff, accept cleanupPeriodDays=365
pgm hooks install --pi                               # pi extension, if you use pi on this machine
```

## 3. Bootstrap the work in flight (once per machine)

```bash
pgm scan --root ~/src --root ~/wt
```

For each worktree, accept the proposed feature, pick a search hit, create a new feature, or skip.

## 4. Daily use

```bash
pgm where              # everything, grouped by stage, with resume commands
pgm where --actions    # what YOU need to do: Review / Test / Merge / Release
pgm feature stage <id> functional_test
pgm feature pr <id> https://github.com/ivo-toby/postgram/pull/121
```

Start new work in a registered worktree:

```bash
cd "$(pgm worktree new "Keyword rank fusion" --create)"
claude                 # SessionStart hook registers the session automatically
```

## 5. After a reboot

```bash
pgm where
# copy the printed resume line, e.g.
ssh -t strongbad 'cd '\''/home/ivo/wt/1a2b3c4d-kw-rank'\'' && claude --resume '\''8f3c…'\'''
```

Sessions that were running on the rebooted machine show as `interrupted` once that machine reports again. The resume command still works, as long as the transcript was not cleaned up.

## Smoke test (sprite, per CLAUDE.md)

After the standard sprite setup:

1. Create a key with `read,write`.
2. Run `pgm here --agent claude-code --session-id s1 --event start` in a temp git repo.
3. Run `pgm where --json` and check that the workspace appears under `unassigned`.
4. `pgm feature add "Smoke"` → `pgm feature link <id>` → `pgm where` shows it under `building`.
5. Simulate a reboot: send a `source: hook` report with no session (or for another session `s2`) and a different `boot_id` through `curl` to `/api/workspaces/report`. Check that `s1` becomes `interrupted` (the reporting session itself is never interrupted).
6. Check that the entity version for the feature did not change across 20 `activity` reports.
