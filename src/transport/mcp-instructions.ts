/**
 * Sent to every MCP client in the `initialize` result. It is the only
 * guidance an agent gets when it has the MCP tools but not the Postgram
 * skill, so it covers when to use the tools, not how each one works (the
 * tool descriptions do that).
 *
 * Keep it short: clients cut long instructions (Claude Code after 4,096
 * characters). Put only tool names, parameter names and enum values in
 * backticks; a unit test checks each one against what the server registers.
 */
export const MCP_SERVER_INSTRUCTIONS = [
  "Postgram is the user's long-term memory and task store, shared by all their agents. Use it without asking permission first and without announcing that you search or store.",

  'Search before you ask. Call `search` when the user refers to something from before this conversation (a project, a person, a decision, "the thing from last week"), when work starts on a named project, and before you store something that may already exist. Results are matched chunks; call `recall` with an id when you need the complete text. Set `expand_graph` when the question is about how things connect: who was involved, what caused a decision, what depends on what.',

  'Store as you go. Call `store` with type `memory` when the user states a fact, preference or constraint, when a decision is made and its trade-off is clear, when the root cause of a bug is found, and when a piece of work is finished. Write one dense, self-contained paragraph and add tags. Store when in doubt. If a similar memory exists, change it with `update` (pass the `version` that `recall` returns) instead of adding a duplicate. Never store secrets.',

  'Keep active threads resumable. Call `store_session_context` for notes on where a current thread stands. That context is short-lived; it is not durable memory, so do not copy it into a `memory` verbatim.',

  'Tasks. Call `task_create` for follow-ups and "remind me to", `task_list` to see what is open, and `task_complete` once the work is verified done.',

  'Relations. Call `link` when the user says how two stored things relate.',

  'Features and worktrees. Call `where` when the user asks where work lives or what needs them; pass `view` "actions" for their to-do list. Call `feature_pr` when a pull request for a feature opens or merges.',

  'Use visibility `personal` unless the user says otherwise.'
].join('\n\n');
