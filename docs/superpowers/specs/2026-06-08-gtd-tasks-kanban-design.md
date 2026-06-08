# GTD Tasks Kanban Page - Design Spec

**Date:** 2026-06-08
**Status:** Approved

---

## Overview

Add a dedicated `Tasks` view to the Postgram web UI for quickly processing and managing GTD tasks created by agents. The page is a responsive kanban-style board with direct status transitions, intuitive editing, and bulk state changes.

This view does not include task capture. Agents and other integrations remain responsible for creating tasks. The UI focuses on reviewing inbox items, moving tasks into the right GTD state, editing task details, and marking completed work done immediately.

---

## Goals

- Make GTD task triage fast and low-friction.
- Make status changes doable with one visible button for common transitions.
- Support bulk movement of selected tasks between GTD states.
- Keep mobile use practical with one visible lane at a time.
- Reuse existing task data and REST endpoints instead of adding backend behavior unless necessary.
- Preserve reliability through optimistic locking, clear failure handling, and lane refreshes.

## Non-Goals

- No task capture form in this page.
- No drag-and-drop in the first implementation.
- No date-time scheduling; scheduling uses a date-only field.
- No new task status taxonomy beyond the existing GTD statuses.
- No project-level planning or calendar view.

---

## Information Architecture

Add a top-bar navigation tab:

```
Search | Graph | Projector | Tasks
```

The `Tasks` tab opens a full-page task board. The default board lanes are:

- `Inbox`
- `Next`
- `Waiting`
- `Scheduled`
- `Someday`

`Done` and `Archived` are excluded from the default board so the view stays focused on actionable work. The first implementation omits a completed-task history view; the backend data remains available through search and existing entity views.

---

## Layout

### Desktop

Desktop uses a multi-column board:

```
┌───────────────────────────────────────────────────────────────┐
│ Top bar                                                       │
├───────────────────────────────────────────────────────────────┤
│ Toolbar: refresh, density, selected-count/bulk actions         │
├───────────┬───────────┬───────────┬───────────┬───────────────┤
│ Inbox     │ Next      │ Waiting   │ Scheduled │ Someday       │
│ cards     │ cards     │ cards     │ cards     │ cards         │
└───────────┴───────────┴───────────┴───────────┴───────────────┘
```

Each lane has a fixed header with the status label, count, refresh state, and a `Select` control. Cards scroll within the page. The layout stays dense and operational rather than decorative.

### Mobile

Mobile shows one lane at a time:

```
┌──────────────────────────────┐
│ Top bar                      │
├──────────────────────────────┤
│ Inbox Next Waiting Scheduled │  sticky status tabs
├──────────────────────────────┤
│ Active lane header + count   │
├──────────────────────────────┤
│ Full-width task card         │
│ Full-width task card         │
│ ...                          │
├──────────────────────────────┤
│ Bulk action bar if selected  │  fixed bottom
└──────────────────────────────┘
```

The mobile board avoids horizontal scrolling and drag/drop. Status tabs preserve the kanban model while keeping cards readable and actions touch-friendly.

---

## Task Cards

Cards show the information needed for quick triage:

- Content preview, clamped to a few lines.
- Status and visibility only when useful for context.
- Tags.
- Task context from `metadata.context`.
- Due date from `metadata.due_date`.
- Scheduled date from `metadata.scheduled_for` if present.
- Priority from `metadata.priority`.
- Updated timestamp as low-emphasis metadata.

Cards must keep stable spacing and avoid layout shifts when actions appear. Empty lanes show a compact empty state.

---

## Single-Task Actions

Status changes are visible, explicit, and one button away. The UI must not require opening a menu for common state changes.

Inbox cards prioritize:

- `Next`
- `Waiting`
- `Schedule`
- `Someday`
- `Done`

Other lanes show direct buttons for common moves:

- `Done`
- `Inbox`
- `Next`
- `Waiting`
- `Schedule`
- `Someday`

Buttons that would move a task to its current lane are hidden. On narrow cards, the direct actions can wrap into a compact action row, but they remain visible buttons.

`Schedule` opens a small date-only picker. Confirming it moves the task to `scheduled` and writes the selected date into metadata.

`Done` calls the dedicated task completion endpoint so `completed_at` is written consistently.

---

## Editing

Editing must be intuitive and focused. Each card has an `Edit` button. On desktop it opens a side drawer; on mobile it opens a bottom sheet.

The edit surface includes:

- Content editor or textarea first.
- Status segmented control with all GTD states visible.
- Tags.
- Context.
- Due date.
- Scheduled date.
- Priority.
- Visibility.

Changing status inside the editor is one tap/click through the segmented control. Saving uses optimistic locking with the task version.

The editor is optimized for task fields rather than exposing raw entity metadata first. Advanced/raw metadata remains available through the existing entity detail/editor surface, not as the primary GTD edit path.

---

## Bulk Mode

Each lane has a `Select` button. In select mode:

- Cards show checkboxes.
- Tapping a card toggles selection instead of opening edit.
- A sticky bulk action bar appears.
- Selected tasks can span multiple lanes.
- The action bar shows the selected count and direct state buttons.

Bulk action buttons:

- `Inbox`
- `Next`
- `Waiting`
- `Schedule`
- `Someday`
- `Done`

On mobile, the bulk action bar is fixed to the bottom of the viewport. On desktop, it can be sticky near the top toolbar or bottom edge as long as it remains visible while scrolling.

`Schedule` asks for one date and applies it to every selected task. `Done` completes every selected task.

Bulk updates run per task using each task's current version. Successful tasks leave selection and move to the target lane. Failed tasks stay selected, show an error count, and can be retried after the lane refreshes.

---

## Data Flow

The page uses the existing `/api/tasks` REST endpoints:

- `GET /api/tasks?status=<status>&limit=<n>&offset=<n>`
- `PATCH /api/tasks/:id`
- `POST /api/tasks/:id/complete`

The UI adds typed helpers to `ui/src/lib/api.ts`:

- `listTasks(params)`
- `updateTask(id, input)`
- `completeTask(id, version)`

Initial load fetches the five board statuses independently. A lane refresh fetches only that lane. Status transitions update the task, then remove it from the source lane and insert or refresh it in the destination lane.

For scheduled date support, the first implementation writes `metadata.scheduled_for` through `PATCH /api/tasks/:id` by preserving the task's existing metadata and adding or replacing `scheduled_for`.

---

## Error Handling

- Lane load failure shows an inline lane-level retry state.
- Single-task update failure keeps the card in place and shows a concise card-level error.
- Version conflicts trigger a refresh for the affected lane and ask the user to retry.
- Bulk update failures are partial by design: successful tasks move, failed tasks remain selected.
- Unauthorized responses continue to use the existing logout behavior from the API client.

---

## Testing

Add focused tests for:

- API client task helpers build the expected URLs and request bodies.
- The task board renders lanes and task cards from API data.
- Mobile mode switches the visible lane with status tabs.
- Single-button status transitions call the task update endpoint and move the card.
- `Done` calls the completion endpoint.
- Bulk select mode applies a target status to multiple tasks.
- Bulk schedule applies the same date to selected tasks.
- Failed bulk updates leave failed tasks selected and report the failure count.

Run the UI test suite and build before claiming completion.

---

## Implementation Notes

Keep the first implementation pragmatic:

- Add `TasksPage.tsx` plus focused supporting components for lane, card, edit drawer, schedule picker, and bulk action bar.
- Prefer explicit buttons over drag/drop.
- Keep styling consistent with the existing dark Tailwind UI.
- Do not introduce a routing library; extend the existing `Page` union and top-bar navigation.
- Reuse existing `Entity` type for tasks.
- Keep CSS additions minimal and component-scoped through Tailwind classes where possible.
