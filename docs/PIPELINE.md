# Active collection: 2025–2026 showcases

Run `bun --env-file=.env.local scripts/showcase-runner.ts`. The controller continues bounded collection batches, analyzes every collected record, then extracts private signals and researches their market context. It runs locally through the subscription-authenticated Codex CLI, using GPT-6.1 Sol with medium reasoning.

`data/showcase-scope.json` selects Georgia Tech, Berkeley, Waterloo, MIT and Stanford. Collect all projects from the identified capstone, design competition and hackathon galleries: event pagination, actual project links and retained public API snapshots. There is no 15-project shortlist, per-school source cap or project-count cutoff. This finite source inventory is not exhaustive institutional coverage. Future events, missing rosters and inaccessible URLs remain explicit gaps.

The legacy cache directory names remain `showcases-2025` to preserve checkpoints. Collection status is `.research-cache/pipeline/showcases-2025/status.json`; end-to-end status is `completion-status.json` in that directory. Confirm the recorded PID before recovery. Send SIGTERM to the controller for a cooperative stop; it drains active work and retains checkpoints. Do not start competing writers or restart the broader archive.

Collection downloads six independent sources concurrently. Known Waterloo, Georgia Tech, Devpost and HackMIT structures are extracted deterministically, preserving complete abstracts. Other sources use the evidence-checking classifier. Original PDFs keep page references; transcribed image rosters retain images, hashes and transcription provenance. Hosted hackathons establish event association, not participants’ enrollment.

Analysis runs alongside collection with three Codex calls at a time. Every raw record receives a disposition, topic, robotics/simulation relevance, problem, possible customer, applicability, reported results, interpretation and unknowns. Unknown dates, duplicate candidates, navigation/context records and incomplete projects are accounted for rather than dropped. Per-record fingerprints reuse completed analysis as the collection grows; raw evidence is unchanged.

Invalid quotes and PDF pages fail validation. The controller retries after 30 seconds and stops after three consecutive attempts without another validated record checkpoint. Independent errors encountered while progressing through the corpus do not exhaust a shared retry limit; completed records remain cached.

Signal retry metadata uses atomic replacement so interrupted writes cannot truncate the last valid retry state. When recovering an older partial file, retain it outside `signal-attempts` before resuming; never discard research evidence or completed drafts.

Source workers clone only their own source records. Rediscovered URLs add provenance without resetting another source's download metadata. Analysis shares one read per source revision, and Codex diagnostics stream to private files. The existing status refresh records RSS, heap and external memory; completed collection batches may trigger garbage collection above 1 GB RSS. Check resource trends at milestones without starting additional watchers or workers.

Large candidate archive records retain their associations in separate `candidate` records named `<candidateId>:associations:<index>`. The parent retains its URL and revision metadata, sets `associations` to an empty array, and includes `associationCount` plus `associationChunks` containing exact record IDs and revision hashes. Reconstruct associations by reading those immutable revisions in order. The local canonical archive keeps the full original candidate unchanged.

Signal extraction waits for all selected sources to finish and every retained record to be analyzed. It groups relevant projects, drafts private opportunities, and checks market claims against primary sources. Single-project leads remain private; a recommendation is not publication authorization. Final evidence accounting is saved under `analysis/review-ledger.json`, with private drafts under `analysis/signals/` and the result in `analysis/outcome.json`.

Archive metadata is mirrored additively to development and production Convex using existing environment credentials. Public projects, signals and profiles are preserved. Raw files, logs and private analysis never enter Git. The broader `.research-cache/intake` archive remains intact and deferred. A monitor may report progress or recover a confirmed stopped process; the controller itself advances the work.

## Previous broad intake implementation (deferred)

Run from the repository with Bun and the operator's subscription-authenticated Codex CLI. The existing `runCodex` uses GPT-6.1 Sol with medium reasoning; no paid model or scraping API is introduced.

```sh
bun scripts/pipeline.ts run --minutes 120 --depth 5
bun scripts/pipeline.ts status
bun scripts/pipeline.ts stop
```

Use `--root PATH` for a different canonical intake archive. All three commands must use the same root. `--pipeline-root PATH` optionally overrides the private pipeline directory, and must also match across commands. Defaults place it in `.research-cache/pipeline/<archive-path-hash>/`.

Four independent actors continuously take fresh snapshots:

| Lane     | Work                                                                         | Default budget per iteration             |
| -------- | ---------------------------------------------------------------------------- | ---------------------------------------- |
| collect  | Download, preserve raw revisions, parse, follow links, then discover sources | 10 downloads and up to 2 discovery calls |
| classify | Extract projects from retained text chunks                                   | 3 agent calls                            |
| group    | Rebuild keyword graph, then propose semantic buyer/problem groups            | 3 agent calls                            |
| analyze  | Derive opportunity hypotheses, then verify market excerpts                   | 2 total agent calls                      |

Set `--collect-budget`, `--classify-budget`, `--group-budget`, or `--analyze-budget` to positive integers. `--school ID` limits discovery/download/classification to a school; grouping and analysis still use all retained items. `--depth` defaults to 3. Discovery runs after each bounded download batch so existing sources reach classification promptly. The analysis budget first reserves approximately half for derivation and uses remaining calls for market research, including unused derivation capacity.

The coordinator owns the canonical archive's `writer.lock` for the entire run. Existing intake/analysis commands and another coordinator cannot write that archive concurrently. Every lane has its own private checkpoint/evidence directory and a `structuredClone` of state. Raw/text paths stay absolute so classifiers can read downloads from the collector's archive. Lane callbacks merge incremental changes through one canonical checkpoint queue; they never replace the canonical state with a stale snapshot. Collection owns candidates/cells, classification owns items/classification progress, grouping owns edges/clusters/insights, and analysis owns opportunities. Item deletions are restricted to baseline records. Opportunity revisions merge by ID. Grouping recomputes clusters against the latest canonical items, preserving items classified while the grouping call was running.

Successful grouping batches are cached by the actual supplied input. Derived hypotheses skip unchanged fingerprints and researched opportunities skip completed market work. Signal failures retain input-specific exponential backoff in the stable lane directories. Collection/classification honor their recorded retry times. The coordinator waits between iterations, backs off on unsuccessful work, and bypasses grouping/analysis lane cooldown when new input arrives. An unchanged completed input does not keep running agent calls.

A run stops when drained, when its runtime expires (120 minutes by default), on `stop`, or on SIGINT/SIGTERM. `--idle-seconds N` optionally stops after N seconds without successful canonical progress once active lanes finish. Without that option, pending failed work waits for its retry time within the runtime limit. Stopping is cooperative: in-flight calls finish or reach their deadline, checkpoint their progress, and all actors drain before the coordinator releases its lock. A model call already in flight may take up to its existing timeout (usually 3–4 minutes); a source download may take its network timeout. The runtime prevents new model/download calls after the deadline and caps new model-call timeouts to the remaining duration. A force kill may leave a stale lock; inspect the PID and process before manually removing it. The coordinator never removes another writer's lock.

`status.json` records the PID, run state, per-lane iterations/checkpoints/successes/calls, last success, errors/retry times, intake summary and mirror state. `status` also reports whether that PID exists; PID reuse is possible, so inspect the process for a stale record. `errors.log` and the existing Codex diagnostics are private operator logs. Directories/files use owner-only permissions. None of the lane downloads or logs belong in git.

When `CONVEX_URL` and `RESEARCH_WRITE_SECRET` are available, the CLI's separate mirror actor sends coherent canonical snapshots through `createIntakeSync` at most once per 15 seconds, plus a final flush. Requests have a 30-second deadline. Batches contain at most 75 records or approximately 256 KB, allowing larger individual records within the server limit, and each deployment sends at most 0.5 MB/s. Only acknowledged records advance the local sync cursor. Set `CONVEX_PRODUCTION_URL` to mirror production too. Both destinations receive archive metadata and lane job state; neither receives raw files. Network waits do not hold the canonical checkpoint queue. Mirror errors are visible in status and retry on later passes. Library/test calls do not use environment destinations unless explicitly enabled. Credentials never enter a lane snapshot or the Codex child environment.

On normal shutdown, `manifest.json` contains canonical evidence metadata and `publication.json` contains a prepared additive corpus for inspection; canonical `state.json` is durable after each lane checkpoint. Group proposals, opportunity revisions and verified market downloads remain in their respective private lane directories. This pipeline never publishes the public corpus or changes the UI. Review source URLs, exact quotes, dates, PDF pages, reported results versus interpretation, and unresolved questions before using the existing explicit publication workflow. Planned school coverage remains pending until collection actually completes.

Focused checks:

```sh
bun test scripts/pipeline.test.ts
bun run typecheck
```

The pipeline tests exercise stale interleaved merges, classifier ambiguity removal, actual concurrent collection/classification/grouping/derivation with a blocked classifier and fake agent, existing lock preservation, runtime cleanup, and stop-file checkpoint draining.

Signal publication is on hold until the active selected collection has been reviewed in full. Bounded batch completion or `publishRecommended` does not lift this hold. Retained ambiguous records, unknown dates, incomplete source classifications and failed parses must be accounted for. Design competitions, capstone presentations (programs, posters, project books and demo days), and hackathon submissions are explicit discovery targets; competition formats are included in the existing capstone lane.
