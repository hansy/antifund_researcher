# Local research runner

The browser reads Convex's public corpus. Cloudflare hashes the visitor IP with a server salt and enqueues bounded questions using a server-only capability. A local Bun process uses subscription-authenticated Codex CLI to answer from retrieved evidence. It does not use a paid model API or scraping service.

Set `CONVEX_URL`, `RESEARCH_WRITE_SECRET`, and `RESEARCH_MODEL` locally. Set the same capability in Convex and Cloudflare; never prefix it with `VITE_`. Log in with `codex login`. `RESEARCH_MODEL` defaults to the user-requested `gpt-6.1-sol` and must appear in `codex debug models`. `RESEARCH_CODEX_COMMAND` can name an absolute alternate Codex executable. The runner fails closed if the model is missing.

```
bun scripts/research.ts seed
bun scripts/research.ts status
bun scripts/research.ts discover mit
bun scripts/research.ts discover mit --collect
bun scripts/research.ts discover-batch 2
bun scripts/research.ts extract mit https://official.mit.edu/project
bun scripts/research.ts synthesize
bun scripts/research.ts worker --once
bun scripts/research.ts worker
```

Use IDs from the fixed `data/corpus.json` school registry. Discovery returns at most six official university sources per school. Batches process one to five schools that currently have no collected project records; they checkpoint after each source and ingest after each school. Local attempt timestamps prevent repeatedly failing schools from starving the rest of the registry. `--collect` skips already collected URLs, checkpoints validated records after each source, then upserts Convex. Extraction accepts only HTTPS on the school's domain/subdomains, checks each redirect, limits downloads to 25 MB and text to 500,000 characters, and uses Poppler with page markers for PDFs. Local `.research-cache/` contains raw downloads, text and metadata; never commit it. Cache metadata preserves requested/final URL, school, date and SHA256. Pages with little extractable text are rendered with Poppler and OCRed with local Tesseract (at most 12 scanned pages per PDF, with 30-second subprocess limits). A source larger than the bounded prompt is limited to its first 140,000 text characters; later pages require separate operator extraction.

The collector validates schema, slug uniqueness, known dates, school/source/project/insight links and exact evidence quotations before import. Source excerpts must be exact contiguous passages. Each project quotation is checked against the downloaded text and saved separately; PDF quotations are checked against the stated page. Missing findings must be explicit. Re-running seed uses idempotent slug upserts. School, source and project records are upserted. Insights are replaced by the current synthesis to avoid stale signals.

## Public question safety

Enqueue needs the capability and a 64-character SHA256 client key. Limits: 8–1200 characters, five jobs per client/hour, 100 globally per rolling day, 20 queued/running jobs. Claims have a four-minute lease. Expired jobs can be reclaimed; only the exact worker and lease token may finish before expiration. Public reads expose text/status/answer and a generic failure message, never capability, IP key, worker IDs or logs. Heartbeat updates every 30 seconds; last-seen over 90 seconds indicates the runner is offline. The app remains readable while the runner is offline.

Visitor synthesis retrieves at most eight projects and 16 source excerpts using text/topic matching. Codex runs in a fresh temporary directory with `--ignore-user-config`, `--ignore-rules`, `--ephemeral`, a read-only sandbox, disabled web search, disabled shell/app/plugin/browser/computer/agent tools, and an isolated model catalog with `shell_type=disabled`, `apply_patch_tool_type=null` and no experimental tools. Its environment is a whitelist; Convex and server credentials are not inherited. `CODEX_HOME` retains subscription authentication, while configuration is ignored. Output uses a strict JSON schema. The installed CLI is inspected before each run; a missing model fails closed.

Shell disabling alone is insufficient: official Codex [tool registration source](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/spec_plan.rs) gates apply_patch independently of shell_tool. The runner explicitly disables it through the documented [model catalog override](https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json). Discovery enables the code-mode host needed by Codex web search, while shell and local tools remain disabled. It is an operator command using only hosted web search; it never accepts a visitor question and still has no local tools.

Answer IDs must be in the retrieved subset; each quote must match whitespace-normalized saved evidence, and PDF page citations must match a saved evidence record on that page. Convex repeats provenance checks against saved records before accepting completion. Unsupported questions can return an honest answer with no projects or citations.
