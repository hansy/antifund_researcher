# Private signal assessment

A signal is evidence of a concrete recurring change. A product idea, a polished demo, or a large industry alone does not establish one. This rubric is a conservative ordinal decision rule, not a statistical probability or validated investment predictor.

The private assessment pass reads the retained showcase analysis and writes a separate archive. It never publishes, changes the public corpus/profiles, resumes collection, runs the broad pipeline, or retries the two operator-skipped market calls.

## Three separate indicators

| Indicator                                              | Meaning                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Strength: Emerging / Building / Strong                 | How well independent project evidence supports a recurring change              |
| Confidence: Low / Medium / High                        | Reliability of the identities, dates, reported measurements and interpretation |
| Market support: Supportive / Mixed / Adverse / Unknown | Relevant sourced context, including uncertainty and counterevidence            |

Each assessment includes its pattern, why it matters, supporting projects and source excerpts/pages, observed progress/change/user pull, momentum, the result of removing its strongest project, disconfirming evidence, and next evidence needed. Raw records, source URLs and confirmed independent project units are counted separately. Units may recur across overlapping notes; totals must not be added as distinct project or signal counts.

Duplicate titles and overlapping named teams are conservatively merged across URLs. The semantic assessment must also merge the same work under different names. Missing team identity cannot establish independence. A single-project note receives an explicitly identified Emerging/Low baseline; it is retained as a lead, with market context Unknown, rather than sent to a model to invent convergence.

Building requires at least two confirmed independent units with cited demonstrated work and at least one cited concrete change. Strong requires at least three confirmed units, two with measurements, two with concrete changes, at least one with actual external use/demand, High confidence, and a surviving pattern after removing the strongest project. At least two demonstrated units and one concrete change must remain after removal. Repeated observations from one unit cannot inflate these counts. Unknown/out-of-window dates and missing measurement/independence cap High confidence; unknown dates cannot establish momentum. Different dates alone do not prove acceleration.

The model interprets cited evidence; code validates references, partitions, identity merges, verified dates and rating gates. Exact quotation validation does not prove a team's result true or establish independent replication. Assessments remain private interpretations and require inspection before any publication decision.

## Market context

`data/market-context.json` contains primary-source context with source URL, short exact excerpt, publication date when known, observation/forecast period, geography, segment, finding and limitations. Verification retains downloaded bytes, a content hash, final URL and access timestamp. Cached bytes are rechecked. A source blocked by HTTP 403 or failing excerpt verification is retained in `context-failures.json` and cannot support a claim.

The initial catalog covers broad AI adoption, healthcare spending, data-center electricity demand, industrial robot stock and a home-care employment forecast. These are contextual proxies for most product-level patterns. They do not establish niche TAM, growth, willingness to pay or buyer ROI. Unavailable dimensions remain explicit. Forecasts are labeled; nominal expenditure growth is not real volume growth. The catalog is a starting point, not comprehensive market research. Add relevant segment-level evidence and economic headwinds as they become available. Market context cannot change the strength computation.

## Run and inspect

```sh
bun run research:assess-signals
# Bound local subscription-authenticated Codex calls, then resume from checkpoints:
bun run research:assess-signals --budget 3
```

Defaults read `.research-cache/pipeline/showcases-2025/analysis/signals/state.json` and write `.research-cache/pipeline/showcases-2025/analysis/strength/`. `--input` and `--output` override these paths. The pass verifies every input excerpt/page against retained text, fingerprints rubric/input/context, revalidates cached results, preserves per-note checkpoints, and uses one exclusive output lock. At most three independent no-tool model calls run concurrently; the owner applies checkpoints serially. An existing lock is not removed automatically; check its PID before recovering a stale owner. Runs are finite and failures remain explicitly pending for a later resume.

Inspect `signals.md` for recurring candidates, `assessments.json` for all results and individual lead baselines, `status.json` for progress/resources, and `context-failures.json` for inaccessible context sources. No background watcher is installed. No paid model or scraping API is used.
