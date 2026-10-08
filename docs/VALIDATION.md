# Validation

Validated on 8 October 2026.

- TypeScript checks, production Vite build and 12 Bun tests pass. Tests cover corpus references, quote/page grounding, retrieval, URL boundaries, credential isolation, capability checks, rate limits, idempotent ingestion and expired worker leases.
- The deployed Cloudflare → Convex → local Codex flow answered a sim-to-real question with five verified citations. Opening a citation showed its exact excerpt and original source.
- Production requests reject foreign origins (403), short questions (400) and oversized bodies (413).
- Desktop and 390px mobile checks cover signal/project navigation, school filtering and source dialogs. The mobile page and dialog fit without horizontal overflow.
- An actual ETH-hosted PDF passed download, page extraction, structured Codex parsing and quote validation. Five page-one quotations are saved on the existing presentation record.
- Oxford discovery found six candidate sources. Four passed exact quotation checks and added four projects; two were rejected. A real synthesis run produced the current five signals from 26 projects across ten schools.
- One final autoreview is pending; its result and any direct fixes will be recorded here before delivery.

Local environment: this network's IPv6 route stalls the local Cloudflare runtime's outbound requests. Hosted Cloudflare requests work. Server timeouts bound failures. The production question runner runs locally and requires this computer to remain awake.
