# Implementation plan

## Outcome

A public research workspace for robotics and real-world simulation emerging from leading engineering schools. People can discover projects, read cross-project insights, ask questions, and inspect the evidence behind an answer.

## Four-hour MVP

1. Define a fixed, sourced 50-school registry and shared research contracts.
2. Build a resumable Bun collection pipeline. Discover official project pages, presentations, posters, and PDFs from 2021 through the collection date in 2026. Cache downloads locally. Codex extracts structured projects and evidence.
3. Store schools, sources, projects, insights, and bounded question jobs in Convex. Protect ingestion and worker writes with a server-side capability. Keep public reads separate from worker operations.
4. Build a minimal TanStack Start interface on Cloudflare: a research feed, project detail, source drawer, search/filters, and questions.
5. Import a verified initial corpus, synthesize useful insights, and run a real collection and question smoke test. Show measured coverage; broader collection remains resumable.
6. Deploy, test desktop/mobile interaction, review source grounding, run one final autoreview, and fix accepted findings directly.

## Architecture

Browser → TanStack Start / Cloudflare → Convex

Bun runner ↔ Convex; Codex CLI → public web sources / local PDFs → validated records

The local runner uses subscription-backed Codex. Poppler exposes PDF text and page images; Tesseract is available for scans. The hosted app remains useful with the runner offline. Live question processing is bounded and exposes no shell or arbitrary file access to visitors.

## Scope

The target is 50 schools and the 2021–2026 date range, not an assertion of exhaustive coverage. Sources and projects are separate: one showcase may contain many projects, and one project may have several sources. The first demo should contain credible, connected examples across multiple schools, not fabricated breadth.

## Delivery

Commit and push at coherent milestones. Keep setup, architecture, data provenance, operational commands, and limitations concise. The lead reviews agent work during integration and makes fixes without a review loop.
