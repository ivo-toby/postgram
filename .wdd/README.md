# Wave-Driven Development

This `.wdd/` directory is the durable source of truth for Wave-Driven Development in this repository. WDD state is stored as local text artifacts so work can be resumed, reviewed, and audited without relying on a separate CLI or service.

## Layout

- `constitution.md`: the project workflow contract, defaults, and open setup questions.
- `work/`: micro-wave work packets for bounded ticket-sized work.
- `epics/`: full epic artifacts, tickets, task files, wave plans, shared context, validation notes, and final handoff material.
- `templates/`: starter text templates copied from the installed WDD skills.

## Phase Order

1. Constitution: confirm project workflow choices and amend `constitution.md`.
2. Micro-wave or epic: use `.wdd/work/` for bounded work or `.wdd/epics/` for broader initiatives.
3. Planning: define deliverables, tickets, tasks, dependencies, conflict domains, and verification expectations.
4. Execution: activate waves, dispatch workers, track gates, and keep task state current.
5. Reconciliation: review completed work, branch freshness, shared context updates, and readiness for the next wave.
6. Validation: validate completed epics when applicable.
7. Final handoff: prepare the final PR or completion summary for human review.

External trackers such as GitHub Projects, Issues, Jira, or other boards are adapters. The local `.wdd/` artifacts remain the source of truth unless the constitution explicitly says otherwise.

WDD itself is text-only. It does not require scripts, a package manager, generated validators, or a dedicated CLI.
