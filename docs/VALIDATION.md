# Validation

Validated on 8 October 2026.

The signal redesign passes TypeScript checks, the production Vite build and 31 Bun tests. Tests cover evidence and date boundaries, unknown-date retention, unsupported-file preservation, immutable Convex metadata, semantic-link retention, duplicate-project rejection, capability checks and the existing question-worker protections.

Local and deployed browser walkthroughs verified the signal list, full brief, source drilldown, deep-link reload, browser back navigation and keyboard disclosure of market context. Source views distinguish reported results, interpretation and limitations. The current in-app browser's viewport scaling prevented a reliable 390px walkthrough; responsive rules were inspected, but a new mobile-device check remains outstanding.

All 300 school/category/year discovery cells completed one bounded search pass across the 50-school registry. This found 363 initial archive URLs. A 100-attempt crawl retained thousands more links and archived 57 downloaded pages before integration of the separate smoke archive. These are discovery and download counts, not completed school coverage.

A real Waterloo capstone PDF was downloaded and parsed with all 44 pages preserved. Subscription Codex classified Georgia Tech software capstones and Waterloo material with exact source checks. Partial/failed chunks and ambiguous records remain archived. Semantic grouping produced three proposed links; two derived opportunities were withheld from publication for insufficient evidence. Collection and classification remain incomplete.

One bounded Autoreview used GPT-6.1 Sol with medium reasoning against base `76c37ff`. Its reviewed bundle was scoped-clean at P0/P1, with no actionable findings; the mandatory outgoing secret scan passed. Subsequent integration refinements were checked directly with typecheck and focused tests, without another review loop.

Cloudflare and production Convex were deployed, and the initial five edited signals were seeded successfully. The public starting corpus remains 26 projects across ten schools. Collection runs locally with the operator's subscription; raw downloads and logs remain ignored and private.
