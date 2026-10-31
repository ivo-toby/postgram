# Feature Specification: Workspace & Agent-Session Tracking

**Feature Branch**: `004-workspace-session-tracking`
**Created**: 2026-10-31
**Status**: Approved (2026-10-31), ready for implementation
**Input**: User description: "Workspace and agent-session tracking for Postgram (phase 1 of personal project management). Postgram becomes the source of truth for projects, features and tasks. The user runs agent environments on three machines (Mac, codebox, strongbad) with multiple Claude Code and pi coding-agent sessions working on ~7 features in parallel, each in a different stage. They lose track of which feature is where, and after a machine reboot they no longer know which agent session or git worktree belonged to which feature. Sessions and worktrees still exist on disk after reboot; the missing piece is the index."

## Context

This is phase 1 of turning Postgram into a personal project management system where humans and agents work on projects together. Phase 1 solves one acute problem: **knowing where work is happening and what state it is in**, across machines, worktrees and agent sessions.

Agent session transcripts and git worktrees survive a reboot on disk. What gets lost is the mapping between a feature, the machine it lives on, the worktree path, the branch and the agent session that was working on it. This feature makes Postgram hold that mapping, keeps it current without manual effort, and shows it back in a form that lets the user resume any piece of work with one command.

Out of scope for this phase: epics, boards and swimlanes, project templates for non-software projects, importing GitHub issues, and a weekly review agent.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Recover after a reboot (Priority: P1)

A machine was rebooted. The user opens a terminal on any machine and runs `pgm where`. They see every active feature with its stage, the machine and worktree it lives on, which agent sessions were working on it, whether there is uncommitted or unpushed work, and a ready-to-run command that brings them back into the right directory with the right agent session resumed.

**Why this priority**: This is the pain that triggered the feature. Without it the user loses hours reconstructing context and risks losing unpushed work.

**Independent Test**: Register three workspaces with sessions on two machines, simulate a reboot of one machine, run `pgm where` from a third machine, and check that every feature is listed with a correct resume command and the interrupted sessions are flagged.

**Acceptance Scenarios**:

1. **Given** feature A has a workspace on `codebox` with a Claude Code session, **When** the user runs `pgm where` on the Mac, **Then** feature A shows its stage, `codebox`, the worktree path, the branch, last activity time, and a resume command that connects to `codebox`, changes to the worktree and resumes that session.
2. **Given** `strongbad` rebooted while two sessions were running there, **When** any agent session on `strongbad` next reports in, **Then** the two earlier sessions are marked "interrupted" and `pgm where` shows them as such.
3. **Given** a workspace last reported 2 uncommitted files and 3 unpushed commits, **When** the user runs `pgm where`, **Then** that workspace carries a visible "at risk" flag with those counts.
4. **Given** a feature has workspaces on two machines, **When** the user runs `pgm where`, **Then** both workspaces are listed under that one feature.

---

### User Story 2 - Sessions register themselves (Priority: P1)

The user starts a Claude Code or pi session in any directory. Without any action from the user or the agent, Postgram learns which machine, repository, worktree and branch the session runs in, which feature that worktree belongs to, and the current git state. When the session pauses or ends, Postgram records that too.

**Why this priority**: The index is only useful if it stays current. Agents and humans forget manual updates; registration must happen automatically or the data rots within days.

**Independent Test**: Configure the session hooks on one machine, start and stop a session in a worktree, and check that the workspace and session appear with correct details and status transitions.

**Acceptance Scenarios**:

1. **Given** the hooks are installed, **When** a Claude Code session starts in a git worktree, **Then** Postgram records (or updates) the workspace for that machine and path, and records the session as running with its session id.
2. **Given** a running session, **When** the agent finishes a turn and waits for the human, **Then** the session is marked "idle" and the git state snapshot is refreshed.
3. **Given** a running or idle session, **When** the session ends, **Then** it is marked "ended".
4. **Given** the worktree contains a marker that names a feature, **When** a session registers, **Then** the workspace is linked to that feature.
5. **Given** the directory is not inside a git repository, **When** a session registers, **Then** the session is still recorded against a workspace for that machine and path, with no repository or branch.
6. **Given** Postgram is unreachable, **When** the hook runs, **Then** the hook finishes quickly without failing or blocking the agent session.

---

### User Story 3 - See what needs me next (Priority: P1)

The user wants to know what they personally need to do across all features. They run the action view and see features grouped by the human action required: review, functionally test, merge, release. Features still being built by agents are shown separately.

**Why this priority**: "I don't know anymore what needs review, testing or merging" is the second half of the pain. This view turns the index into a to-do list.

**Independent Test**: Put features in different stages and check that the action view groups them correctly and leaves out released features.

**Acceptance Scenarios**:

1. **Given** features in stages building, review, functional_test, ready_to_merge and awaiting_release, **When** the user opens the action view, **Then** they see groups "Review", "Test", "Merge", "Release" with the matching features, and "In progress" for building.
2. **Given** a feature in stage released, **When** the user opens the action view, **Then** it is not listed.
3. **Given** a feature, **When** the user sets its stage, **Then** the change is visible in both `pgm where` and the action view.

---

### User Story 4 - Start a feature in a fresh worktree (Priority: P2)

The user (or an agent) starts work on a feature. They run `pgm worktree new <feature>`. A git worktree is created on a branch named after the feature, the worktree is marked as belonging to that feature, and it is registered in Postgram before any agent session starts.

**Why this priority**: It makes the feature–worktree link explicit from the first moment instead of relying on guessing later. Useful, but User Stories 1–3 deliver value without it.

**Independent Test**: Run the command in a repository for an existing feature and check that the worktree exists, contains the marker, and is registered and linked.

**Acceptance Scenarios**:

1. **Given** an existing feature and a repository, **When** the user runs `pgm worktree new <feature>`, **Then** a worktree is created, a feature marker is written in it, and the workspace is registered and linked to the feature.
2. **Given** the user names a feature that does not exist, **When** they confirm creation, **Then** a new feature is created first and the worktree is linked to it.
3. **Given** the target path or branch already exists, **When** the command runs, **Then** it stops with a clear message and changes nothing.

---

### User Story 5 - Bootstrap from today's mess (Priority: P2)

The user has 7 features spread over 3 machines today, none of them registered. On each machine they run `pgm scan`. Postgram finds existing worktrees of known repositories and recent agent sessions on that machine, proposes which feature each one belongs to, and records whatever the user confirms.

**Why this priority**: Without a bootstrap the user has to register everything by hand, which is the kind of chore that keeps getting postponed. Needed once per machine, so P2.

**Independent Test**: Prepare a machine with several worktrees and session histories, run the scan, confirm some proposals and reject others, and check that only confirmed items are recorded.

**Acceptance Scenarios**:

1. **Given** a machine with worktrees in configured repositories, **When** the user runs `pgm scan`, **Then** each worktree is listed with its branch, git state and the agent sessions found for that path.
2. **Given** a worktree whose branch or marker matches an existing feature, **When** the scan runs, **Then** that feature is proposed as the link.
3. **Given** a worktree with no matching feature, **When** the scan runs, **Then** the user can link it to an existing feature (chosen by search), create a new feature from the branch name, or skip it.
4. **Given** the user rejects a proposal, **When** the scan finishes, **Then** nothing is recorded for that worktree.
5. **Given** a worktree that is already registered, **When** the scan runs again, **Then** it is shown as already known and no duplicate is created.

---

### User Story 6 - Agents use the same index (Priority: P2)

A coding agent working through Postgram's agent tools can register its workspace, look up which feature the current directory belongs to, set the stage of a feature (for example to "review" after opening a pull request), and list where other work is happening.

**Why this priority**: Postgram is the source of truth for agents as well as humans. Agents moving features forward (e.g. to review) keeps the action view accurate without the human doing it.

**Independent Test**: Through the agent tools, register a workspace, read back the current feature, advance its stage, and check the result in `pgm where`.

**Acceptance Scenarios**:

1. **Given** an agent with write access, **When** it registers its workspace and session, **Then** the result is identical to what the CLI registration produces.
2. **Given** an agent in a linked worktree, **When** it asks for the current feature, **Then** it receives the feature and its stage.
3. **Given** an agent opened a pull request, **When** it sets the stage to review and attaches the pull request link, **Then** both are visible in `pgm where` and the action view.

---

### Edge Cases

- **Same path, different machines**: `~/wt/pg-121` on `codebox` and on the Mac are different workspaces. A workspace is identified by machine plus absolute path.
- **Worktree deleted on disk**: when `pgm where` or `pgm scan` runs on the machine that holds it and the path no longer exists, the workspace is flagged "missing". It is never deleted automatically.
- **Branch switched inside a worktree**: the next registration updates the branch. The feature link stays until the user changes it.
- **Session without a known session id** (an agent that does not expose one): the session is recorded and the resume command only changes to the worktree and starts the agent.
- **Machine renamed or hostname changed**: machines are identified by a configured alias with the hostname as fallback, so a hostname change does not split history once the alias is set.
- **Clock skew between machines**: last activity is the time the server received the report.
- **Concurrent reports from many sessions in the same workspace**: each is recorded. The workspace shows the most recent git state.
- **Symlinked paths** (e.g. macOS `/var` → `/private/var`): workspace paths are stored as fully resolved real paths, so the same directory reached through a symlink is one workspace.
- **Feature archived or done while workspaces still exist**: workspaces stay linked, and `pgm where` hides them unless the user asks for all.
- **Hook runs from a directory inside a nested repository or a submodule**: the innermost worktree root is used.
- **Agent transcript deleted by the agent's own retention**: when checked on the local machine, the session shows `transcript gone` and the resume command starts a fresh agent in the worktree instead of resuming.
- **No reboot detection possible on a platform**: sessions are never marked `interrupted` there. `pgm where` shows last activity time, and dormancy applies as usual.
- **Returning to a session after weeks**: the session shows its age and possibly `dormant`, keeps its resume command, and goes back to `running` on the next report.

## Requirements *(mandatory)*

### Functional Requirements

**Features and stages**

- **FR-001**: The system MUST let a task be marked as a feature.
- **FR-002**: Each feature MUST carry a delivery stage, one of: `building`, `review`, `functional_test`, `ready_to_merge`, `awaiting_release`, `released`. New features start in `building`.
- **FR-003**: Users and agents MUST be able to set a feature's stage directly to any value, including moving backwards (e.g. from `functional_test` back to `building` after a failed test).
- **FR-004**: Users and agents MUST be able to attach one or more pull request links to a feature, each with a state of `open`, `merged` or `closed` (default `open`). Adding a link that is already attached updates its state instead of duplicating it.
- **FR-005**: When a pull request link is added or its state changes, the system MUST derive a stage change only in these cases: state `open` while the feature is in `building` → `review`; state `merged` while the feature is in any stage before `awaiting_release` → `awaiting_release`, or `released` when the repository is marked as releasing on merge. In every other case the stage stays unchanged. A derived change MUST never move a stage backwards, whether the current stage was set by hand or derived. Stage order: `building` < `review` < `functional_test` < `ready_to_merge` < `awaiting_release` < `released`.
- **FR-006**: Moving a feature to `released` MUST NOT change its general task status. Completing the task stays a separate decision.

**Machines and workspaces**

- **FR-007**: The system MUST identify each machine by a user-configured alias, falling back to the hostname when no alias is set.
- **FR-008**: The system MUST record workspaces, identified by machine and absolute path, holding: repository identity (remote URL when available), repository root, worktree path, current branch, and last known git state (count of uncommitted changes, count of commits not pushed to the upstream branch, and whether an upstream exists).
- **FR-009**: A workspace MUST be linkable to at most one feature. A feature MAY have any number of workspaces.
- **FR-010**: The user MUST be able to link, re-link and unlink a workspace to a feature.
- **FR-011**: The system MUST store a per-machine connection target used to build resume commands (default: the machine alias), configurable by the user.

**Agent sessions**

- **FR-012**: The system MUST record agent sessions with: agent kind (`claude-code`, `pi`, `talon`, `other`), the agent's own session id when available, the workspace it runs in, start time, last activity time, and status.
- **FR-012a**: A report for an agent session id that is already recorded in that workspace MUST update that record, never create a second one. This covers resuming a session after quitting or after a reboot.
- **FR-013**: Session status MUST be one of `running`, `idle`, `ended`, `interrupted`. Each reported event sets the status regardless of the previous status: `start` and `activity` → `running`, `stop` → `idle`, `end` → `ended`. Only the reboot rule (FR-014) sets `interrupted`. Separately, a session MAY be marked `dormant` (see FR-015).
- **FR-014**: Each report from a machine MUST include an identifier of the machine's current boot. When a report arrives from a machine, every `running` or `idle` session on that machine whose last recorded boot identifier is known and differs from the reported one MUST be marked `interrupted`. Sessions with no recorded boot identifier (for example, sessions found by `pgm scan`) are never marked `interrupted` by this rule.
- **FR-015**: Sessions that are `running` or `idle` and have had no activity for longer than a dormancy threshold (default 30 days, configurable) MUST be shown as `dormant`. Dormant is informational only: it is not a risk flag, does not change the session status, and the session stays resumable. Returning to a session after weeks is normal use.
- **FR-016**: Recording activity for workspaces and sessions MUST NOT create new revisions of the feature or task, and MUST NOT trigger re-indexing, embedding or knowledge extraction of any knowledge entry.

**Registration**

- **FR-017**: `pgm here` MUST work out machine, worktree root, repository, branch and git state from the current directory, and create or update the matching workspace and session in a single call.
- **FR-018**: `pgm here` MUST accept the agent kind, the session id and an event (`start`, `activity`, `stop`, `end`), and MUST be able to read these from the event data that Claude Code hooks provide on standard input.
- **FR-019**: `pgm here` MUST link the workspace to a feature when the worktree contains a feature marker. Otherwise it MUST keep an existing link and MUST NOT create a feature on its own.
- **FR-020**: `pgm here` MUST finish within 2 seconds even when the server is slow or unreachable. In that case it gives up without an error exit code that would disturb the calling agent, and writes a short note to its local log.
- **FR-021**: The CLI MUST offer a command that installs the Claude Code hooks for `pgm here` into the user's Claude Code settings, showing the change before writing it. The installed hooks MUST call `pgm` by absolute path, because hook processes may not have the user's shell `PATH`. Installing twice MUST NOT duplicate hooks.
- **FR-021a**: Because Claude Code deletes session transcripts after 30 days by default, the hook installer MUST offer (with explicit confirmation) to raise that retention so sessions the user returns to after weeks stay resumable.
- **FR-022**: A pi extension MUST report the same events through `pgm here` or the equivalent server call.

**Worktree creation**

- **FR-023**: `pgm worktree new <feature>` MUST create a git worktree for the current repository on a new branch whose name includes a short identifier of the feature, write a feature marker in the worktree, and register and link the workspace.
- **FR-024**: The feature marker MUST be ignored by git in that worktree so it never gets committed.
- **FR-025**: `pgm worktree new` MUST refuse to overwrite an existing path or branch.

**Views**

- **FR-026**: `pgm where` MUST list non-released features grouped by stage, each with: title (the first line of the task content, cut at 80 characters), stage, linked pull requests, and per workspace the machine, path, branch, last activity, git state, session statuses, risk flags, and a resume command.
- **FR-027**: Risk flags MUST include: uncommitted changes, unpushed commits, no upstream branch, interrupted session, workspace missing on disk. Time since last activity alone MUST NOT raise a risk flag.
- **FR-028**: The resume command MUST connect to the workspace's machine (omitted when it is the current machine), change to the worktree path, and resume the workspace's most recently active session that has a known session id, **including `ended` and `interrupted` sessions** (quitting an agent does not make its session unresumable), with the agent-specific resume form. When no session id is known, or the transcript is known to be gone, it starts the agent without resuming.
- **FR-029**: `pgm where` MUST list workspaces that are not linked to a feature in a separate "unassigned" group.
- **FR-030**: When run on a machine, `pgm where` and `pgm scan` MUST check that local workspaces still exist on disk and flag missing ones.
- **FR-031**: The action view MUST group non-released features by required human action: Review (`review`), Test (`functional_test`), Merge (`ready_to_merge`), Release (`awaiting_release`), plus In progress (`building`).
- **FR-032**: Both views MUST support machine-readable output for agents and scripts, and filters by machine and by repository.
- **FR-033**: By default, `pgm where` MUST show per workspace all non-ended sessions plus the most recently active session even when it has ended. On request it MUST include released features and all ended sessions.

**Bootstrap scan**

- **FR-034**: `pgm scan` MUST find worktrees of the repositories the user configures for that machine, and agent session histories stored on that machine for those paths.
- **FR-035**: For each worktree found, `pgm scan` MUST propose a feature link based on (in order) a feature marker, a feature identifier in the branch name (ignored when it matches more than one feature), then a search for features similar to the branch name. The user picks: accept, choose another feature, create a new feature from the branch name, or skip.
- **FR-036**: `pgm scan` MUST record nothing without the user's confirmation, except when the user passes an explicit "accept all exact matches" option.
- **FR-037**: `pgm scan` MUST be safe to re-run: already-registered workspaces are shown as known and never duplicated.

**Agent and API access**

- **FR-038**: Every capability above that does not need local disk access (registering a workspace and session, linking, setting a stage, attaching a pull request, listing where and action views) MUST be available through Postgram's HTTP API and its agent tools.
- **FR-039**: Agent tools MUST let an agent ask "which feature is this workspace linked to" by machine and path.
- **FR-040**: Registration and changes MUST require write permission. Views MUST require read permission. Workspaces and sessions MUST follow the visibility of their linked feature, and unlinked ones are personal.
- **FR-041**: The Postgram agent skill MUST tell coding agents to use these tools: register on start, set the stage when opening a pull request, and use `pgm worktree new` when starting a new feature.

### Key Entities

- **Feature**: an existing Postgram task marked as a feature. Adds a delivery stage, the source of the current stage (set by hand or derived), and linked pull requests with their state. Its title is the first line of the task content. It remains a knowledge entry (searchable, linkable in the graph).
- **Machine**: a computer the user works on. Alias, hostname, connection target for resume commands, last known boot identifier, last seen time. Not a knowledge entry.
- **Workspace**: a directory on a machine, usually a git worktree. Machine, absolute path, repository identity, branch, last git state, last activity, optional link to one feature. Long-lived and not a knowledge entry.
- **Agent Session**: one run of a coding agent in a workspace. Agent kind, agent session id, status, start time, last activity, the boot identifier of its last report. Many per workspace and not a knowledge entry.
- **Feature Marker**: a small file in a worktree that names the feature it belongs to. Lives on disk only and is ignored by git.
- **Machine scan configuration**: per machine, the list of repository locations `pgm scan` looks in. Stored in the local CLI configuration.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After a reboot of any machine, the user can get back into the right worktree with the right agent session for any feature in under 1 minute, using only `pgm where` and the command it prints.
- **SC-002**: 100% of Claude Code sessions started on a machine with hooks installed show up in `pgm where` without manual action.
- **SC-003**: Registration adds no noticeable delay to starting an agent session: under 1 second when the server is reachable, and never more than 2 seconds when it is not.
- **SC-004**: The user can answer "what do I need to review, test, merge or release right now?" with a single command, across all three machines.
- **SC-005**: Bootstrapping the user's current 7 features across 3 machines takes under 15 minutes in total with `pgm scan`.
- **SC-006**: Running 10 agent sessions that each report activity every turn for a full working day creates zero new revisions of features or tasks, and zero re-indexing jobs.
- **SC-007**: Every workspace with uncommitted or unpushed work is flagged in `pgm where`, with no false "clean" for a workspace whose last report showed changes.

## Assumptions

- The user works on macOS and Linux machines with git available. Windows is not a target in this phase.
- Machines can reach the Postgram server over the network. Resume commands across machines assume the user can already connect from one machine to the other (e.g. via SSH host aliases). Setting that up is outside this feature.
- The resume form per agent kind defaults to: Claude Code resumes by session id. pi and Talon use their own resume forms where they have one, and start fresh in the worktree otherwise. The resume form per agent kind is configurable in the CLI.
- Pull request state is read with the GitHub access the user already has on the machine running the command, or reported by an agent. The server does not poll GitHub in this phase.
- "Repository is released on merge" is a per-repository setting the user chooses, defaulting to off.
- Git state is a snapshot from the last report, not live. `pgm where` shows its age.
- Server-side defaults introduced here (such as the dormancy threshold) are exposed as runtime configuration and carried through to the Docker setup, `.env.example` and README configuration tables, per project convention.
- Existing tasks, statuses and the task tools keep working unchanged. Tasks that are not features are unaffected.
- Single user with multiple machines. Multi-user collaboration on the same feature is not a goal of this phase, but nothing here prevents it later.
