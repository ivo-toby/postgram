# Workspace tracking

Postgram can keep track of where your work lives: which feature is in which
git worktree, on which machine, which agent session worked on it, and what
you need to do next. After a reboot, `pgm where` gives you a resume command
for every piece of work.

## Concepts

- **Feature**: a task with a delivery stage and its pull requests.
- **Stage**: `building` → `review` → `functional_test` → `ready_to_merge` →
  `awaiting_release` → `released`.
- **Machine**: a host, by alias. Its connect target is the ssh host used in
  resume commands.
- **Workspace**: a directory (usually a worktree) on a machine, linked to at
  most one feature.
- **Agent session**: a Claude Code, pi or Talon session in a workspace:
  `running`, `idle`, `ended` or `interrupted`.

The hooks report sessions and git state automatically. You (or your agent)
decide which feature a workspace belongs to and when its stage changes.

## Onboarding

### 1. Server

Update the server to a release with workspace tracking and restart it. The
database migration runs automatically on boot and only adds tables.

Optional: `WORKSPACE_DORMANT_AFTER_DAYS` (default `30`) sets when an inactive
session shows as dormant.

### 2. Every machine

```bash
npm i -g @ivotoby/postgram-cli@latest
pgm machine set --alias codebox --connect codebox   # --connect: the ssh host your other machines use
pgm hooks install                                    # Claude Code hooks in ~/.claude/settings.json
pgm hooks install --pi                               # pi extension, if you use pi here
```

Check it with `pgm here` in any git repo. It prints
`registered <machine>:<path> (unassigned)` or the linked feature.

Make sure `PGM_API_URL` points to the server you want to track against. A
project `.envrc` that points to a local dev server makes the hooks report
there instead, and they fail silently when it is down.

### 3. Bootstrap the work in flight

Run this once per machine, in your own terminal (it asks per worktree):

```bash
pgm scan --root ~/workspace --dry-run   # look first
pgm scan --root ~/workspace             # record
```

For each worktree you accept a proposed feature, pick a search hit, create a
new feature or skip. `--yes-exact` accepts only certain matches (a feature
marker or short id in the branch) and asks nothing. Set `scan_roots` in
`~/.pgmrc` to skip `--root`.

### 4. Tell your agents

Install the Postgram skill (`skill/postgram/SKILL.md`) for your agents. Its
"Workspace tracking" section tells them to link workspaces, attach PRs and
move stages, and to use `where` when you ask what needs you.

## Daily use

```bash
pgm where              # everything, grouped by stage, with resume commands
pgm where --actions    # what you need to do: Review / Test / Merge / Release
```

Start new work in a registered worktree:

```bash
cd "$(pgm worktree new "Keyword rank fusion" --create)"
claude                 # the SessionStart hook registers the session
```

Link existing work and move it along:

```bash
pgm feature link <id>                        # link the current directory
pgm feature pr <id> <pr-url>                 # open PR: building → review
pgm feature pr <id> <pr-url> --state merged  # merged: → awaiting_release
pgm feature stage <id> functional_test       # manual move, any direction
pgm repo set github.com/<owner>/<repo> --release-on-merge true  # merge means released
```

`<id>` is the feature UUID or its 8-hex short id.

## After a reboot

Run `pgm where` and copy the resume line, for example:

```bash
ssh -t codebox 'cd '\''/home/ivo/wt/1a2b3c4d-kw-rank'\'' && claude --resume '\''8f3c…'\'''
```

Sessions that ran on the rebooted machine show as `interrupted` once that
machine reports again. Resume works as long as the transcript still exists.

## Risks shown by `pgm where`

| Flag | Meaning |
|------|---------|
| `dirty` | uncommitted files |
| `unpushed` | commits not on the upstream |
| `no_upstream` | branch has no upstream |
| `interrupted` | a session was running when the machine rebooted |
| `missing` | the workspace directory no longer exists |

## Reference

- CLI commands and `~/.pgmrc` keys: [cli/README.md](../cli/README.md#workspace-tracking)
- Design and data model: [specs/004-workspace-session-tracking](../specs/004-workspace-session-tracking/)
