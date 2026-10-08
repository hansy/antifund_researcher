# Preservation-first intake

The intake archive covers the top-50 school registry in `data/corpus.json`, with separate discovery cells for hackathons, capstones, and research in 2025 and 2026 through the run date. Discovery searches all disciplines. A searched cell means a bounded search attempt completed; it never means every school project was collected.

Use Bun and the operator's subscription-authenticated Codex CLI. No model API keys or paid scraping service are required. PDF text extraction needs local Poppler (`pdftotext`). Scanned PDFs remain preserved with a parse failure and an explicit OCR requirement; intake does not invent text.

```sh
bun run research:intake status
bun run research:scan # all 50 schools; resumes; three archive searches per school
bun scripts/intake.ts scan-school mit --budget 6 --minutes 20
bun scripts/intake.ts collect --budget 30 --minutes 20
bun scripts/intake.ts crawl --school mit --budget 30 --depth 4
bun scripts/intake.ts classify --budget 10 --minutes 20
bun scripts/intake.ts graph
```

`crawl` and `collect` are aliases. Run the same command again to resume. `--budget` limits discovery calls, downloaded/parsed candidates, or classified text chunks, according to the command. `--minutes` limits scheduling additional work; a request already in flight can finish up to its bounded timeout. Collection is sequential to keep checkpoint behavior small and predictable. HTML/PDF downloads are bounded to 25 MB, a 30-second request timeout, and four redirects. Classification processes the entire retained text in 8,000-character chunks (older checkpoints retain their original chunk size) with overlap and checkpoints after each chunk.

Failed work records the stage, timestamp, error, and exponential retry time. `--retry` explicitly bypasses retry backoff. `--refresh` reruns completed discovery cells or downloads already collected candidates to preserve new revisions. Classification retries resume the failed chunk. A process interrupted during PDF parsing resumes from the preserved raw file. The CLI takes a local writer lock; after an unclean termination, verify that its recorded process is gone before removing `.research-cache/intake/writer.lock`. Imported mutation functions expect the lead to serialize calls.

Everything stays under ignored `.research-cache/intake/`:

- `state.json`: candidate queue, all school/category/year associations, classification progress, failures, revisions, and coverage.
- `discoveries/`: complete discovery responses with reported dates, titles, rationale, and affiliation sources.
- `raw/<sha256>.html` , `.pdf`, or `.bin`: immutable content-addressed downloads, shared across URL aliases. Candidate revisions retain requested and final URLs, access timestamps, SHA-256, paths, parse status, and PDF page counts.
- Corresponding `.txt`: full extracted text; PDF text has `[PDF PAGE N]` markers. Poppler's original output is retained too.
- `classifications/`: complete structured extraction responses, including date evidence and ambiguity.
- `opportunities/`: immutable signal and market research revisions.
- `market/`: primary-source market pages.
- `edges.json`, `clusters.json`, `insights.json`: inspectable grouping output, separate from original evidence.

Candidate records are saved before download/parse/classification failures can remove them. URL normalization removes fragments and tracking parameters while retaining functional pagination parameters. Repeated URLs merge associations; changed content creates an additional revision. Repeated bytes share a raw file. Unknown-date and ambiguous items remain retained with `unverified` dates. Items outside the target window also remain preserved and are labeled `outside-window`.

The crawler extracts all approved HTML anchor links, including gallery pagination and project detail links, with no topic filter. Links are retained even when their depth exceeds the current traversal depth. Project/archive-shaped URLs receive traversal priority without changing retention. Generic navigation can still create a large queue; budgets and depth are visible limitations, not evidence of complete enumeration. JavaScript-only galleries, authentication, robots/access restrictions, broken pages, scanned PDFs, and incomplete hosted search can prevent full collection. Intake has no headless browser, graph database, or OCR service. Inspect failure records and archive text before interpreting coverage.

HTTPS school domains and their subdomains are allowed. External archives are allowed only after an official school page actually links to their host. An external result is retained at discovery but cannot be downloaded until a preserved official school page actually links it. The crawler records that exact school affiliation source; Links on that same external host retain the original affiliation link. Unverified external domains, IP URLs, credentials, nonstandard ports, and private/reserved DNS addresses are rejected; every redirect is checked again. Hosted-search output alone cannot authorize an external download.

Classification records category, domain, problem, approach, keywords, embodiment, readiness, date, school associations, and exact source evidence. Evidence must match retained text; PDF page references must match that page. Reported results, our interpretation, and unanswered questions remain separate. A classification failure leaves an inspectable ambiguous placeholder. Page/project identity and school affiliation can still need manual inspection; no classification establishes market demand.

The graph is a deterministic hypothesis index. Two items need at least two shared classification keywords for an edge; edge reasons expose those keywords and any shared domain. Connected components form clusters, including isolated items. `research:signals group` adds reasoned links between projects with a possible shared buyer problem, even when their keywords differ. These semantic edges carry explicit hypothesis labels; grouping is bounded to overlapping windows and cannot guarantee that every related pair was compared. The initial grouping notes only describe shared keywords. `research:signals derive` interprets buyer problems and reported advances with project references. `research:signals market` checks current alternatives using independent primary sources, archives their pages and validates each short excerpt. Commercial conclusions remain hypotheses. `research:signals prepare` builds an additive public corpus using only verified-date, exact-evidence projects; ingest it explicitly with `research:seed`. Every opportunity revision is retained locally and mirrored to Convex.

## Integration API

`scripts/intake.ts` exports `loadSchools`, `loadIntake`, `checkpoint`, `scanSchool`, `scanAll`, `collect`, `classify`, `graph`, `intakeStatus`, `intakeManifest`, and `intakeMain`, plus the state/model types. Each mutating operation accepts `IntakeOptions`, including `root`, `budget`, `runtimeMs`, `retry`, `refresh`, `schoolId`, and optional async `onCheckpoint(state)`. The callback runs after the atomic local state save, so the lead can mirror collection/job metadata to Convex. A callback failure stops the command but preserves its local checkpoint. The lead owns authentication, remote writes, public projection, and command integration.

`intakeStatus` provides planned/searched/failed cells plus per-cell candidate counts and archive/classification/graph progress. `intakeManifest` omits raw paths, full downloaded text, and error messages. It still includes project evidence excerpts and titles; the lead must choose an appropriate publication projection. The complete `State` passed to checkpoint callbacks is private archive state and must not be published wholesale. Never commit raw downloads, local logs, credentials, or personal account configuration.

Run `bun test scripts/intake.test.ts` for preservation, retry, revision/hash deduplication, all-field/unknown-date classification, PDF failure provenance, link pagination, URL boundaries, and inspectable clustering. Repository-wide checks, production/browser validation, deployment, and final autoreview belong to the lead.
