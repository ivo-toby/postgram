# Experiment: Jev as a search-result judge

**Status:** done (October 2026)

**Decision:** we won't use Jev to order search results. The experiment branch (PR #107) is not merged.

## Question

Can a semantic judge ([Jev](https://docs.typesafe.ai)) improve Postgram search? We looked at three ways it could help:

- **Reorder** the results.
- **Filter** out irrelevant results.
- **Flag** results that contradict the query.

## Setup

- We ran a build of PR #107 against production search traffic in **shadow mode**. Jev judged the top 10 results of each search in the background and logged its answers. Search results were never changed.
- For each candidate Jev saw the query, the chunk text (up to 4k characters), the entity type and the tags. It did not see the ranker's scores.
- It answered three yes/no questions, each with a probability:
  - `relevant`
  - `evidence` (whether the candidate gives usable evidence)
  - `contradicts` (whether it contradicts the query's premise)
- Cost was about 2.8k tokens per search, with a median latency of about 300 ms (in the background).

## Method

- **Labels.** We sampled searches from the log and labeled each candidate blind, without seeing Jev's scores:
  - 0: not relevant
  - 1: partly relevant
  - 2: what the query was after

  The labels were model-made. In round 1 a human spot-checked 30 of them.

- **Metrics:**
  - nDCG@5 and MRR for ranking.
  - AUROC and Brier score for how well a score separates relevant from irrelevant results.
  - Paired bootstrap 95% confidence intervals.
- **Policies compared:**
  - The ranker's own order.
  - The order by Jev's `relevant` score.
  - A fusion of the two (RRF).
  - A filter that drops candidates with `relevant` < 0.15.

## Round 1: old ranker

Ranker: a weighted sum of cosine similarity and a keyword score, applied to a candidate pool built from vector search only.

- **Sample:** 645 searches logged; 59 labeled.
- **Reordering helped clearly.**

  | Reranking                | Gain in nDCG@5 over the ranker      |
  | ------------------------ | ----------------------------------- |
  | Jev's order              | +0.14 (after the spot-check)        |
  | Fusion of ranker and Jev | +0.11, with 3 losses in 53 searches |

- **Filtering:** the < 0.15 filter removed 30% of irrelevant results and lost 1 best answer.
- **`contradicts` was unreliable:** only 1 of 11 candidates above 0.8 was an actual contradiction.
- **`evidence` was weak:** AUROC 0.6.
- **Most of Jev's gain was making up for ranker bugs.** The data showed that the keyword score dominated the ranking (#109). It also showed that keyword-only matches such as ticket IDs never entered the candidate pool (#114). Both were fixed in #116, and we measured again.

## Round 2: new ranker (#116)

Ranker: reciprocal rank fusion of vector and keyword ranks, with keyword candidate retrieval.

- **Sample:** 109 labeled searches.
  - 50 organic searches made after the deploy.
  - A replay of the 59 round-1 queries.

### The ranker fix

On the same 59 queries:

| Ranker     | nDCG@5 |
| ---------- | ------ |
| Old ranker | 0.595  |
| New ranker | 0.718  |

- The gain is +0.12 (95% CI +0.03 to +0.22): 35 wins and 15 losses.
- Best answers in the top 10 went from 80 to 102 of 122.
- **Biggest gains:** date-led queries (0.27 → 0.58) and ticket-ID queries (0.54 → 0.70).
- **Regression:** 1–2 word queries got worse (0.80 → 0.67, n = 9).

### What Jev adds on top of the new ranker

| Searches     | Fusion of ranker and Jev, gain in nDCG@5 over the ranker |
| ------------ | -------------------------------------------------------- |
| Organic (50) | +0.008 (not significant)                                 |
| Replay (59)  | +0.064 (CI +0.02 to +0.11)                               |
| All          | +0.041 (CI +0.01 to +0.07)                               |

- On organic traffic, ordering by Jev alone was slightly worse than the ranker.
- The ranker's own score now separates relevant from irrelevant results about as well as Jev (AUROC 0.79 vs 0.78).

### Signals that still worked

- **Filter:** dropping `relevant` < 0.15 removed 35% of irrelevant results and lost 0 of 139 best answers.
- **"Nothing relevant" detection:** the highest `relevant` score in a search predicted whether the search had any relevant result (AUROC 0.92). Many searches are agents checking for an existing entity before creating one, so this signal could help prevent duplicates.

## Jev as the only semantic step?

We also asked whether we could drop vector search and use keyword search for retrieval, with Jev ordering the results. We rejected this without measuring it:

- **A judge can only reorder what retrieval returns.** Keyword search here is Postgres full-text search with the `simple` configuration: no stemming and no synonyms. It misses paraphrased queries, which are common in agent traffic, and Jev cannot recover them.
- **It would put Jev on the critical path of every search.** Jev would also have to judge a larger pool, which means more tokens and latency, and search would fail whenever Jev is slow or down.
- Embedding search is local and cheap, and the round-2 data shows the combined retriever already does most of the work.

## Conclusion

- **Ordering:** dropped. After #116 the gain is too small for the cost and the extra dependency.
- **`contradicts` and `evidence`:** dropped.
- **Filter and "nothing relevant" flag:** not pursued for now. If they are revisited, the starting point is the < 0.15 filter and a per-search flag based on max `relevant`, run in shadow mode first.
- **The experiment's main value was diagnostic.** Comparing the judge with the ranker exposed the ranking bugs fixed in #116, which gave a larger gain (+0.12 nDCG@5) than Jev added on top of the fixed ranker.

## Caveats

- The labels are model-made, and only round 1 was spot-checked by a human. In that check, 8 of 30 labels changed and the conclusions held.
- The samples are small: 59 and 109 searches, all from a single user's traffic.
- The 1–2 word regression in the new ranker rests on only 9 queries. It is worth watching.
