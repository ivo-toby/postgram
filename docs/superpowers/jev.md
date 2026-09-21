# Postgram × Jev — Research & Architecture Spike

## Mission

Research whether TypeSafe AI's **Jev / System One** model can provide a meaningful architectural advantage inside Postgram.

This is **not an implementation task**.

Your job is to:

1. understand Jev from primary sources;
2. inspect the actual Postgram architecture and relevant code paths;
3. identify and evaluate the strongest integration points;
4. challenge the premise rather than assume Jev belongs in the system;
5. make the important architectural decisions;
6. produce a **compact, well-scoped context package** that a later implementation agent can execute without repeating the research.

The eventual implementation is expected to be performed by **Qwen 3.8 using TinySDD**.

Therefore, optimize your output for **context transfer to another model**, not for showing all of your research process.

---

# Background hypothesis

Postgram contains several fuzzy semantic decisions that currently sit between deterministic code and general-purpose LLM reasoning.

The architectural hypothesis is:

> **LLMs discover and generate. Retrieval systems produce candidates. Jev makes narrow semantic judgments. Deterministic code owns policy and execution.**

Jev should therefore be considered primarily as a **probabilistic decision layer**, not as a replacement for Postgram's generative models, embeddings, BM25, graph, or deterministic logic.

Potential areas include:

- retrieval admission / reranking
- context relevance validation
- deciding whether more retrieval is useful
- graph-expansion gating
- extraction validation
- entity/relation classification
- deduplication candidate validation
- durable-memory admission
- supersession/staleness detection
- escalation to a stronger LLM

Do not assume all or even any of these are good ideas.

---

# Jev research sources

Begin by understanding Jev properly.

## Primary sources

Read these first:

- https://docs.typesafe.ai/introduction
- https://docs.typesafe.ai/concepts/state
- https://docs.typesafe.ai/primitives
- https://docs.typesafe.ai/patterns

Also inspect the complete documentation index:

- https://docs.typesafe.ai/llms.txt

Follow relevant links from there when useful, especially material covering:

- Choice
- Score
- Noul
- confidence/probability semantics
- confidence-gated routing
- speculative fan-out
- composite scoring
- intent routing
- model limitations / jaggedness
- JavaScript/TypeScript SDK
- evaluation/calibration guidance

## Reference implementation / community material

Inspect:

- https://github.com/tegersdorfer-collab/jevkit

Treat third-party implementations as **examples**, not authoritative documentation.

Verify behavioral claims against TypeSafe's own documentation.

---

# Important Jev mental model

Do not treat Jev as a small LLM.

Its API is based around:

```text
state + typed atomic questions → structured probabilistic answers
```

Relevant primitives currently include:

```text
Choice → one option from a defined set + distribution/confidence
Score  → position on an ordered rubric + distribution/confidence
Noul   → probability of a yes/no proposition
```

Questions should represent **atomic semantic judgments**.

If a decision requires multiple independent considerations, Jev's intended pattern is to ask multiple independent questions and combine their outputs in deterministic code.

Multiple questions sharing the same state can be evaluated together.

These characteristics are fundamental to deciding where Jev fits architecturally.

---

# Research principle

The question is not:

> Where can we insert Jev?

The question is:

> Where does Postgram currently make expensive, brittle, heuristic, or context-heavy semantic decisions that would benefit from a fast probabilistic primitive?

Actively look for counterexamples.

If embeddings, deterministic logic, SQL, graph rules, or an existing cheap model are already sufficient, say so.

---

# Inspect Postgram

Build a concise mental model of the current system before proposing changes.

Focus only on components relevant to:

```text
ingestion
    ↓
extraction
    ↓
entity / relationship storage
    ↓
embedding / indexing
    ↓
hybrid retrieval
    ↓
graph expansion
    ↓
context selection
    ↓
consumer agent
```

Also inspect:

- memory-role handling
- durable vs session memory
- extraction queues/workers
- entity deduplication
- graph extraction
- retrieval ranking/filtering
- graph traversal controls
- search APIs
- existing model abstraction/provider layers
- evaluation infrastructure
- relevant configuration/feature-flag mechanisms

Do **not** spend context documenting unrelated Postgram functionality.

---

# Find Jev-shaped decisions

Search the codebase specifically for decisions currently made using:

- embedding similarity thresholds
- hard-coded numeric thresholds
- hand-written heuristics
- prompt-based classification
- general-purpose LLM calls returning small structured outputs
- unconditional graph expansion
- unconditional extraction
- unconditional persistence
- broad context injection followed by downstream filtering
- expensive LLM validation
- boolean/classification logic based on semantic content

For each candidate, determine:

```text
What state would Jev receive?

What is the exact atomic question?

Which primitive fits?
  Choice?
  Score?
  Noul?

What deterministic code consumes the answer?

What happens when confidence is low?

Can the result be evaluated objectively?
```

If those questions cannot be answered cleanly, the candidate is probably not a good Jev use case.

---

# Primary hypothesis: retrieval admission

Investigate this first.

Current retrieval broadly produces candidate context using mechanisms such as semantic/BM25 retrieval and graph relationships.

There are then inherently fuzzy questions such as:

- Is this candidate actually relevant to the user's intent?
- Does it add information beyond already-selected context?
- Is it redundant?
- Is it stale or superseded?
- Is this entity worth graph-expanding?
- Is additional retrieval likely to add useful information?
- Is sufficient evidence already present?
- Should this candidate consume scarce context-window space?

Potential architecture:

```text
query
  │
  ▼
Postgram retrieval
  │
  ▼
candidate chunks/entities
  │
  ▼
Jev semantic decision layer
  │
  ├── relevance
  ├── novelty / information value
  ├── redundancy
  ├── stale/superseded likelihood
  ├── graph-expansion value
  └── context sufficiency
  │
  ▼
deterministic admission policy
  │
  ▼
compact context
  │
  ▼
consumer agent
```

Evaluate whether this provides something meaningfully better than:

- similarity scores;
- rerankers;
- cheap LLM classification;
- deterministic ranking logic.

---

# Secondary hypothesis: extraction validation

Postgram performs open-ended entity / relationship extraction.

Do **not** assume Jev can replace open-ended extraction.

Instead evaluate:

```text
source
   ↓
candidate extraction
   ↓
Jev classification / validation
   ↓
 ┌─────────┬─────────┐
accept    reject    escalate
                    ↓
                stronger LLM
```

Possible atomic judgments include:

```text
is_grounded_in_source
is_worth_persisting
entity_type
relation_type
memory_role
likely_duplicate
candidate_duplicate
contradicts_existing_fact
likely_superseded
requires_expensive_review
```

Determine whether this could enable a cheaper candidate extractor while reserving stronger models for ambiguous cases.

---

# Additional candidate areas

Only investigate these if the codebase suggests they are genuinely useful:

### Memory admission

```text
durable
session
ignore
```

### Retrieval continuation

```text
Do we already have sufficient context?
Would another retrieval step likely add useful evidence?
```

### Graph traversal

```text
Is expanding this node likely to produce relevant context?
```

### Deduplication

Use deterministic/vector candidate generation first.

Then potentially use Jev to judge whether two candidate records refer to the same underlying entity.

### Escalation

Use Jev uncertainty/confidence as one input into:

```text
automatic decision
vs
stronger LLM review
vs
human review
```

---

# Calibration is mandatory

Do not design rules such as:

```text
if probability > 0.8
```

without evidence.

Probabilities and confidence must be validated against representative Postgram data.

Investigate appropriate calibration/evaluation metrics, potentially including:

- precision
- recall
- false-positive/false-negative rates
- calibration curves
- Brier score
- expected calibration error
- downstream answer quality

The actual metric depends on the decision.

For example, retrieval admission should probably bias toward preserving recall rather than aggressively minimizing context.

---

# Preferred first experiment: shadow-mode retrieval validation

Unless codebase research reveals a substantially stronger opportunity, design the first experiment around retrieval.

It should initially be non-destructive:

```text
                         ┌── normal Postgram behavior
existing retrieval ─────┤
                         │
                         └── Jev shadow evaluation
                                  │
                                  ▼
                             evaluation log
```

Jev does **not** control retrieval initially.

Replay historical or representative queries and record:

```text
query
candidate result
current retrieval score/rank
Jev judgments
expected relevance where available
downstream answer/task quality
token/context size
latency
cost
```

Questions to answer experimentally:

1. Can Jev reject irrelevant context without harming useful recall?
2. Can it identify redundant context?
3. Can it predict when graph expansion adds little value?
4. Can it identify when enough context has already been retrieved?
5. Does downstream answer quality remain equal or improve with less context?
6. Is it materially better than simpler alternatives?
7. Are its probabilities sufficiently calibrated to drive policy?

---

# Comparison baselines

Do not evaluate Jev in isolation.

Compare against at least the relevant existing mechanism and, where practical:

```text
existing Postgram behavior
embedding/vector score only
simple deterministic heuristic
cheap generative-model classifier
Jev
```

The goal is to identify an **architectural or economic advantage**, not merely demonstrate that Jev works.

---

# Architecture constraints

Any proposed integration should ideally be:

- optional
- feature flagged
- observable
- replayable
- benchmarkable offline
- provider-independent at the surrounding architecture level
- safe to bypass
- non-destructive during initial rollout
- deterministic in policy even when semantic judgments are probabilistic

Avoid scattering direct Jev API calls throughout business logic.

Investigate whether a small abstraction naturally fits, for example conceptually:

```text
SemanticDecisionProvider
```

or:

```text
DecisionEvaluator<State, Questions>
```

Do not introduce an abstraction merely for hypothetical future providers.

Use the current Postgram architecture to determine whether one is warranted.

---

# Failure modes to investigate

Explicitly research and document:

- poor calibration
- confident wrong answers
- domain shift
- sensitivity to state construction
- English-language bias
- excessive state size
- correlated errors across related judgments
- misleading confidence interpretation
- vendor dependency
- latency under real Postgram workloads
- API availability/reliability
- cost at expected volume
- privacy/data-handling implications
- cases where a reranker or embedding model is simply better

Also inspect TypeSafe's published model limitations / jaggedness documentation.

---

# Deliverable philosophy

Your most important product is **compressed context for the implementation agent**.

Do not produce a 30-page research report.

Do the broad research internally, then compress the useful conclusions.

The eventual implementation agent will be **Qwen 3.8 working through TinySDD**.

Assume that model is capable but should not be asked to rediscover architectural intent from a pile of research notes.

The handoff should make implementation boring.

---

# Required deliverables

Produce two artifacts.

## 1. Research & Architecture Decision

Target: approximately **1500–2500 words maximum**.

Structure:

### Problem

What Postgram problem are we actually trying to improve?

### Current architecture

Only the code paths relevant to the proposed change.

Include concrete module/file references.

### Jev capabilities that matter

Only describe capabilities relevant to Postgram.

### Candidate integration points

Maximum **3–5**.

For each:

```text
Current mechanism:
Jev state:
Jev question(s):
Primitive(s):
Policy consumer:
Expected benefit:
Primary failure mode:
Evaluation difficulty:
```

### Recommendation

Choose:

```text
one primary experiment
one possible follow-up
everything else deferred
```

Explain why.

### Proposed architecture

Show where the decision layer sits without over-designing it.

### Evaluation

Define:

- dataset/traces
- baseline
- metrics
- success criteria
- failure criteria

### Risks / unknowns

Keep these explicit.

### Decision log

Record the important decisions already made so the implementation model does not reopen them unnecessarily.

---

## 2. Implementation Context Packet

Target: **800–1500 words maximum**.

This is specifically for the future Qwen 3.8 + TinySDD implementation session.

It should contain only information required to start SDD.

Use this structure:

```markdown
# Jev Integration — Implementation Context

## Goal

One paragraph.

## Non-goals

Explicit scope exclusions.

## Existing architecture anchors

- path/module → responsibility
- path/module → responsibility
- path/module → responsibility

## Proposed change

Concise description.

## Data flow

Before:

...

After:

...

## Jev decisions

For every intended Jev judgment:

### <decision>

State:
Question:
Primitive:
Consumer:
Fallback:
How evaluated:

## Deterministic policy

Describe which decisions remain code-owned.

## Feature flag / fallback behavior

...

## Observability requirements

...

## Evaluation requirements

...

## Acceptance criteria

...

## Explicitly deferred

...
```

No lengthy explanation of System One theory belongs in this packet.

---

# TinySDD handoff

The research task should **not** create the implementation spec itself unless inspecting TinySDD shows that such a document is part of its normal pre-spec workflow.

Inspect:

- https://github.com/ivo-toby/tiny-sdd

Understand what information TinySDD expects before implementation.

Shape the **Implementation Context Packet** so that the next model can efficiently turn it into TinySDD artifacts without repeating research.

Do not modify TinySDD.

Do not begin Postgram implementation.

---

# Context-budget discipline

While researching:

- inspect broadly enough to understand architecture;
- avoid exhaustively reading unrelated source files;
- prefer entry points, interfaces, tests, and architectural seams;
- record concrete file/module references;
- discard dead-end research from the final output.

The final artifacts should contain **conclusions, evidence, constraints and decisions**, not a transcript of exploration.

If a fact can be recovered trivially from the source code during implementation, omit it unless it affects architectural intent.

If a decision required substantial research to reach, preserve it.

---

# Source discipline

Prefer sources in this order:

1. TypeSafe official documentation
2. TypeSafe SDK/API documentation
3. Postgram source and tests
4. Jev reference/community implementations
5. secondary commentary

Separate documented behavior from inference.

Do not repeat marketing performance claims as facts without verifying their source and applicability.

---

# Final question

At the end, answer this explicitly:

> **What is the smallest Jev integration we can build that would tell us whether System One models materially improve Postgram?**

The answer should be specific enough that the next agent can turn it into a TinySDD specification without further architectural research.
