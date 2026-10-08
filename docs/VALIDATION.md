# Validation

- TypeScript check and production Vite build pass.
- Seven Bun tests cover corpus references, citation grounding, retrieval, worker leases, model tool restrictions, credential isolation and source URL boundaries.
- Production Cloudflare → Convex → local Codex question flow returned a cited sim-to-real answer. Citation drawer showed the matching excerpt and original MIT source.
- A real ETH-hosted presentation PDF was downloaded, page-labeled and extracted into a valid record with five page-one quotations. This dry-run artifact stays local.
- Oxford discovery and extraction, mobile interaction, queue integration tests and final autoreview are being completed before delivery.

Local environment note: this network's IPv6 route stalls the local Cloudflare runtime's outbound requests. Hosted Cloudflare requests work. Network timeouts keep failed requests bounded.
